// 기획 17차 Track A: 등장·착지 + 퇴장 + 직업 특기 + 교대 연계 rewards (src/sim/rewards/swap.ts, data
// src/data/rewards/swap.ts) — each family fires when it should and not otherwise, numbers match the card, 「두 번」
// stacking, the caps, the 원정 gear merge, multiplayer team scope and determinism.
import { describe, expect, it } from 'vitest';
import { REWARDS, SYNERGY_TAGS, getFamily, getReward } from '../../src/data';
import { relicParam } from '../../src/sim/modifiers';
import { ROLE_NUM } from '../../src/data/rewards/swap';
import { SWAP_FAMILIES } from '../../src/data/rewards/swap';
import { tick } from '../../src/sim/game';
import { effStats } from '../../src/sim/stats';
import { grantReward } from '../../src/sim/rewards/offers';
import { rwOnAppear, rwOnHealOverflow, rwStatMods, rwTakenMult } from '../../src/sim/rewards/hooks';
import { relayFlagBoost, rewardTakesOver } from '../../src/sim/rewards/swap';
import { charCtx } from '../../src/sim/ctx';
import type { CastCtx, SimEntity, SimPlayer } from '../../src/sim/world';
import type { PlayerSetup, Vec2 } from '../../src/types';
import { HUMAN, active, advance, clearEvents, eventsOf, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const TANK_MELEE_RANGED = HUMAN; // guardian · blade · mage
const HEAL_PARTY: PlayerSetup = { ...HUMAN, characters: ['blade', 'cleric', 'guardian'] };
const SUPPORT_PARTY: PlayerSetup = { ...HUMAN, characters: ['bard', 'blade', 'chrono'] };
const TWO_TANKS: PlayerSetup = { ...HUMAN, characters: ['guardian', 'paladin', 'mage'] };
const OTHER: PlayerSetup = { ...HUMAN, name: '둘', characters: ['ranger', 'cleric', 'berserker'] };

function setup(opts: { players?: PlayerSetup[]; startFloor?: number; invincible?: boolean; seed?: number } = {}): TestGame {
  const tg = makeGame({ players: opts.players ?? [HUMAN], tunables: { invincible: opts.invincible ?? true }, ...(opts.startFloor ? { startFloor: opts.startFloor } : null), ...(opts.seed ? { seed: opts.seed } : null) });
  quietFloor(tg);
  for (let i = 0; i < 20; i++) tick(tg.w);
  clearEvents(tg);
  return tg;
}

const P = (tg: TestGame, i = 0): SimPlayer => tg.w.state.players[i];

/** Swap card idx in at pos now (its cooldown and the appear lock cleared; ready since `readyFor` s). */
function swap(tg: TestGame, idx: number, pos: Vec2, o: { player?: number; readyFor?: number } = {}): SimEntity {
  const p = P(tg, o.player ?? 0);
  p.appearLock = 0;
  p.party[idx].swapCooldownRemaining = 0;
  p.party[idx].rt.readyAt = tg.w.state.time - (o.readyFor ?? 30);
  p.party[idx].rt.cooling = false;
  const r = tg.game.dispatch({ type: 'swap', player: p.id, partyIndex: idx, pos });
  expect(r.ok, r.ok ? '' : r.reason).toBe(true);
  return active(tg, p.id);
}

function procs(tg: TestGame, family: string) {
  return eventsOf(tg, 'rewardProc').filter(e => e.rewardId === family);
}

function casts(tg: TestGame, skillId: string) {
  return eventsOf(tg, 'skillCast').filter(e => e.skillId === skillId);
}

const hurt = (e: SimEntity) => e.hp < e.maxHp - 1e-6;
const alive = (tg: TestGame, defId: string) => tg.w.state.entities.filter(e => !e.rt.gone && e.hp > 0 && e.defId === defId);
const statusOf = (e: { statuses: { id: string; remaining: number; value: number }[] }, id: string) => e.statuses.find(s => s.id === id);

/** Put the field character at `at` (so the leave spot is known). */
function stand(tg: TestGame, at: Vec2, player = 0): SimEntity {
  const e = active(tg, player);
  e.pos.x = at.x;
  e.pos.y = at.y;
  return e;
}

/** A plain enemy that never walks (positions stay put; 밀기 / 끌기 tests use movable ones). */
function dummy(tg: TestGame, at: Vec2, id = 'golem'): SimEntity {
  const e = spawnAt(tg, id, at);
  e.rt.base.moveSpeed = 0;
  e.rt.base.atk = 0;
  return e;
}

describe('data', () => {
  it('26 families; ids in REWARDS; tags real; legendary families are unique; numbers in the text', () => {
    expect(SWAP_FAMILIES.length).toBe(26);
    const tagIds = new Set(SYNERGY_TAGS.map(t => t.id));
    for (const f of SWAP_FAMILIES) {
      for (const t of f.tags) expect(tagIds.has(t)).toBe(true);
      const rs = Object.keys(f.params);
      expect(rs.length).toBeGreaterThan(0);
      if (rs.includes('legendary')) {
        expect(rs).toEqual(['legendary']);
        expect(f.unique).toBe(true);
      }
      for (const r of rs) {
        const def = getReward(`${f.key}_${r}`);
        expect(REWARDS).toContain(def);
        expect(def.description).toMatch(/\d/);
      }
    }
    expect(SWAP_FAMILIES.filter(f => f.params.legendary).map(f => f.key)).toEqual(['doppel']);
  });

  it('bot weights: positional 0.6, the rest by the contract', () => {
    for (const k of ['relay_line', 'inplace', 'prompt', 'combo']) expect(getFamily(k).botWeight).toBe(0.6);
    for (const k of ['mine', 'cover_swap', 'aftercare', 'relay3']) expect(getFamily(k).botWeight).toBe(0.8);
    expect(getFamily('tricolor').botWeight).toBe(1.2);
    expect(getFamily('bolt').botWeight).toBe(1);
  });

  it('role card text names the role and shows its lines up to the level', () => {
    const f = getFamily('role');
    expect(f.describe({ level: 2 }, { role: 'tank' })).toContain('육중한 착지');
    expect(f.describe({ level: 2 }, { role: 'tank' })).toContain('버려진 방패');
    expect(f.describe({ level: 2 }, { role: 'tank' })).not.toContain('짚 인형');
  });
});

describe('등장·착지', () => {
  it('등장 에너지탄: N nearest, twice +1 target; nothing without enemies', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'bolt_common', null);
    swap(tg, 1, { x: 8, y: 6 });
    expect(procs(tg, 'bolt').length).toBe(0);
    for (let i = 0; i < 6; i++) dummy(tg, { x: 9 + i, y: 6 });
    grantReward(tg.w, p, 'bolt_rare', null);
    swap(tg, 2, { x: 8, y: 6 });
    const bolts = tg.w.state.projectiles.filter(pr => (pr as unknown as { rt: { ctx: CastCtx; amount: number } }).rt.ctx.skillId === 'bolt');
    expect(bolts.length).toBe(4); // max(2, 3) + 1
    expect((bolts[0] as unknown as { rt: { amount: number } }).rt.amount).toBeCloseTo(0.6 + 0.75, 9);
  });

  it('깜짝 등장: stuns within the radius, once per enemy per 5 s, never a boss / mid boss; twice +0.2 s', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'startle_common', null);
    stand(tg, { x: 22, y: 10 }); // out of the guardian's own reach (its normal skill stuns too)
    const near = dummy(tg, { x: 10, y: 6 });
    const far = dummy(tg, { x: 14, y: 6 });
    const mid = dummy(tg, { x: 9, y: 7 });
    mid.tier = 'mid';
    // the hook alone (the drag skills have stuns of their own)
    const appear = () => {
      const e = active(tg);
      rwOnAppear(tg.w, p, { idx: p.activeIndex!, e, at: { x: 8, y: 6 }, leave: null, just: false, sinceReady: 0, cooling: 0, forced: false });
    };
    appear();
    expect(statusOf(near, 'stun')?.remaining).toBeCloseTo(0.6, 6);
    expect(statusOf(far, 'stun')).toBeUndefined();
    expect(statusOf(mid, 'stun')).toBeUndefined();
    expect(procs(tg, 'startle').length).toBe(1);
    near.statuses.length = 0;
    advance(tg, 1);
    clearEvents(tg);
    appear();
    expect(statusOf(near, 'stun')).toBeUndefined(); // same enemy within 5 s
    expect(procs(tg, 'startle').length).toBe(0);
    advance(tg, 5);
    grantReward(tg.w, p, 'startle_rare', null);
    appear();
    expect(statusOf(near, 'stun')?.remaining).toBeCloseTo(1.0, 6); // max 0.8 + 0.2
  });

  it('원혼의 손짓: pulls normal enemies toward the drop and slows them; a mid boss stays', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'beckon_common', null);
    const g = dummy(tg, { x: 11, y: 6 });
    const mid = dummy(tg, { x: 8, y: 9 });
    mid.tier = 'mid';
    swap(tg, 1, { x: 8, y: 6 });
    expect(g.pos.x).toBeCloseTo(8.5, 6); // 3 away → 2.5 closer
    expect(statusOf(g, 'slow')?.value).toBeCloseTo(0.3, 9);
    expect(mid.pos).toEqual({ x: 8, y: 9 });
    expect(statusOf(mid, 'slow')?.value).toBeCloseTo(0.3, 9);
  });

  it('그을린 발자국: a fire zone at the drop (reward zone), burns enemies inside', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'scorch_rare', null);
    const g = dummy(tg, { x: 8.5, y: 6 });
    swap(tg, 1, { x: 8, y: 6 });
    const z = tg.w.state.zones.find(x => (x as unknown as { rt: { ctx: CastCtx } }).rt.ctx.skillId === 'scorch')!;
    expect(z).toBeDefined();
    expect(z.radius).toBeCloseTo(2, 9);
    expect(p.rt.rewardZones).toContain(z.id);
    advance(tg, 1);
    expect(statusOf(g, 'burn')).toBeDefined();
  });

  it('교대선: hits enemies on the leave → drop band only, extended to 3 cells; no leaver → nothing', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'relay_line_rare', null);
    stand(tg, { x: 4, y: 6 });
    const on = dummy(tg, { x: 7, y: 6 });
    const off = dummy(tg, { x: 7, y: 9 });
    swap(tg, 1, { x: 10, y: 6 });
    expect(hurt(on)).toBe(true);
    expect(hurt(off)).toBe(false);
    expect(procs(tg, 'relay_line').length).toBe(1);
    expect(p.stats.damageBySource.relic).toBeGreaterThan(0);
  });

  it('맞교대: a drop within 1.5 of the leave spot → +1 s invulnerable, the leaver’s cooldown halved (min 4)', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'inplace_rare', null);
    stand(tg, { x: 6, y: 6 });
    const e = swap(tg, 1, { x: 7, y: 6 });
    const m0 = P(tg).party[0];
    expect(m0.swapCooldownRemaining).toBeCloseTo(Math.max(Math.min(m0.swapCooldownTotal, 4), m0.swapCooldownTotal * 0.5), 6);
    expect(e.invulnTime).toBeCloseTo(tg.w.tunables.appearInvulnTime + 1, 6);
    expect(procs(tg, 'inplace').length).toBe(1);
    advance(tg, 1);
    clearEvents(tg);
    swap(tg, 2, { x: 15, y: 6 }); // far → nothing
    expect(procs(tg, 'inplace').length).toBe(0);
    expect(P(tg).party[1].swapCooldownRemaining).toBeCloseTo(P(tg).party[1].swapCooldownTotal, 6);
  });

  it('준비 즉시 / 오래 쉰 자의 분노: drag power from how long the card has been ready', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'prompt_rare', null);
    grantReward(tg.w, p, 'rested_epic', null);
    const e = active(tg);
    const base = { idx: p.activeIndex!, e, at: { ...e.pos }, leave: null, just: false, cooling: 0, forced: false };
    const quick = rwOnAppear(tg.w, p, { ...base, sinceReady: 1.2 });
    expect(quick.dmgMult).toBeCloseTo(1.4 * (1 + 1 * 0.05), 9); // 즉시 (≤ 1.5 s) + 1 stack
    const slow = rwOnAppear(tg.w, p, { ...base, sinceReady: 7.5 });
    expect(slow.dmgMult).toBeCloseTo(1 + 7 * 0.05, 9);
    const capped = rwOnAppear(tg.w, p, { ...base, sinceReady: 30 });
    expect(capped.dmgMult).toBeCloseTo(1 + 10 * 0.05, 9);
    const cooling = rwOnAppear(tg.w, p, { ...base, sinceReady: 0, cooling: 3 });
    expect(cooling.dmgMult).toBe(1);
    expect(procs(tg, 'prompt').map(x => x.text)).toEqual(['즉시!']);
  });

  it('준비 즉시 / 오래 쉰 자의 분노: a cooldown that ends without counting down (출근 도장, 막간 박수) counts as just ready', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'punch_in_rare', null);
    grantReward(tg.w, p, 'rested_epic', null);
    grantReward(tg.w, p, 'prompt_rare', null);
    advance(tg, 15);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 4, y: 4 } }); // guardian leaves with 0 s (출근 도장)
    expect(p.party[0].swapCooldownRemaining).toBe(0);
    advance(tg, 0.6);
    clearEvents(tg);
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 4, y: 4 } });
    expect(procs(tg, 'rested').length).toBe(0); // ready only 0.6 s: no stack (it used to read the time before the field stint)
    expect(procs(tg, 'prompt').length).toBe(1);
    // a cooldown cut straight to 0 on the bench (막간 박수, 괴담, debug) also stamps 'ready now'
    p.appearLock = 0;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 4, y: 4 } });
    p.party[0].swapCooldownRemaining = 6;
    advance(tg, 3);
    p.party[0].swapCooldownRemaining = 0;
    advance(tg, 0.5);
    clearEvents(tg);
    p.appearLock = 0;
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { x: 4, y: 4 } });
    expect(procs(tg, 'rested').length).toBe(0);
    expect(procs(tg, 'prompt').length).toBe(1);
  });

  it('준비 즉시 gives the incoming character +5 % ult', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'prompt_common', null);
    p.party[1].ult.charge = 0.2;
    swap(tg, 1, { x: 8, y: 6 }, { readyFor: 0.5 });
    expect(p.party[1].ult.charge).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(procs(tg, 'prompt').length).toBe(1);
  });

  it('부적 착지: cleanses every player’s characters near the drop; shield per status (capped)', () => {
    const tg = setup({ players: [HUMAN, OTHER] });
    grantReward(tg.w, P(tg), 'talisman_common', null);
    const mate = stand(tg, { x: 9, y: 6 }, 1);
    mate.statuses.push({ id: 'slow', remaining: 3, total: 3, value: 0.3, sourcePlayer: null }, { id: 'burn', remaining: 3, total: 3, value: 5, sourcePlayer: null });
    const e = swap(tg, 1, { x: 8, y: 6 });
    expect(mate.statuses.some(s => s.id === 'slow' || s.id === 'burn')).toBe(false);
    expect(e.shield).toBeCloseTo(0.1 * e.maxHp, 6);
  });

  it('도플갱어: after a 0.6 s telegraph the incoming drag lands again at the leave spot (no groggy), with an afterimage', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'doppel_legendary', null);
    stand(tg, { x: 5, y: 6 });
    const g = dummy(tg, { x: 5, y: 6.5 });
    swap(tg, 2, { x: 15, y: 6 }); // mage far away
    expect(tg.w.state.telegraphs.some(t => t.team === 'ally' && Math.abs(t.center.x - 5) < 1e-6)).toBe(true);
    expect(alive(tg, 'rw_doppel').length).toBe(1);
    expect(hurt(g)).toBe(false);
    advance(tg, 0.7);
    expect(procs(tg, 'doppel').length).toBe(1);
    advance(tg, 1.5);
    expect(hurt(g)).toBe(true);
    expect(tg.w.state.telegraphs.some(t => t.team === 'ally' && Math.abs(t.center.x - 5) < 1e-6 && t.remaining <= 0)).toBe(false);
    // the recast is reward damage ('relic'), not a drag hit (no drag ×2 on a groggy boss, no 약점, no drag on-hit hooks)
    const onG = eventsOf(tg, 'damage').filter(d => d.targetId === g.id);
    expect(onG.some(d => d.source === 'relic')).toBe(true);
    expect(onG.some(d => d.source === 'drag')).toBe(false); // the mage's own drag landed far away (x 15)
  });
});

describe('퇴장', () => {
  it('교대 폭발: a blast at the leave spot; with the relic 교대의 깃발 one boosted flag blast instead', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'relay_blast_rare', null);
    stand(tg, { x: 6, y: 6 });
    const g = dummy(tg, { x: 7.5, y: 6 });
    swap(tg, 1, { x: 15, y: 6 });
    expect(hurt(g)).toBe(true);
    expect(casts(tg, 'relay_blast')[0].area).toEqual({ shape: 'circle', radius: 2 });
    expect(relayFlagBoost(p)).toEqual({ amountMult: 1.5, radiusAdd: 0.5 });
    p.relics.push('relay_flag');
    advance(tg, 1);
    clearEvents(tg);
    swap(tg, 2, { x: 15, y: 6 });
    expect(casts(tg, 'relay_blast').length).toBe(0);
    const flag = casts(tg, 'relay_flag');
    expect(flag.length).toBe(1);
    expect(flag[0].area).toEqual({ shape: 'circle', radius: relicParam('relay_flag', 'radius') + 0.5 });
  });

  it('잔상: an untargetable afterimage at the leave spot that shoots; cap 2 (the oldest goes); #퇴장 set +1 s', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'shade_rare', null);
    stand(tg, { x: 6, y: 6 });
    const g = dummy(tg, { x: 8, y: 6 });
    swap(tg, 1, { x: 15, y: 6 });
    const s = alive(tg, 'rw_shade');
    expect(s.length).toBe(1);
    expect(s[0].rt.untargetable).toBe(true);
    advance(tg, 1.5);
    expect(hurt(g)).toBe(true);
    swap(tg, 2, { x: 15, y: 6 });
    swap(tg, 0, { x: 15, y: 6 });
    expect(alive(tg, 'rw_shade').length).toBe(2);
    advance(tg, 4);
    expect(alive(tg, 'rw_shade').length).toBe(0);
    grantReward(tg.w, p, 'mine_common', null);
    grantReward(tg.w, p, 'fog_common', null); // #퇴장 ×3 (shade, mine, fog)
    swap(tg, 1, { x: 15, y: 6 });
    advance(tg, 3.5);
    expect(alive(tg, 'rw_shade').length).toBe(1); // 3 + 1 s
  });

  it('발밑 지뢰: a mine at the leave spot, cap 2 (common) / 3 (rare); it roots and damages', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'mine_common', null);
    for (const [i, x] of [[1, 3], [2, 5], [0, 7]] as const) {
      stand(tg, { x, y: 3 });
      swap(tg, i, { x: 20, y: 9 });
      advance(tg, 0.6);
    }
    expect(alive(tg, 'rw_mine').length).toBe(2);
    const g = spawnAt(tg, 'golem', { x: 7.3, y: 3 });
    tick(tg.w);
    expect(hurt(g)).toBe(true);
    expect(statusOf(g, 'root')).toBeDefined();
  });

  it('응급 후송: leaving at ≤ 35 % HP heals the card on the bench for 4 s (rare: cd −1.5 s), once per 20 s', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'evac_rare', null);
    const e = active(tg);
    e.hp = e.maxHp * 0.3;
    swap(tg, 1, { x: 15, y: 6 });
    const m0 = p.party[0];
    expect(m0.swapCooldownRemaining).toBeCloseTo(Math.max(4, m0.swapCooldownTotal), 6);
    const hp0 = m0.hp;
    advance(tg, 4.2);
    expect(m0.hp - hp0).toBeCloseTo(0.08 * 4 * m0.maxHp, 3);
    expect(procs(tg, 'evac').length).toBe(1);
    // within 20 s: no second time
    swap(tg, 0, { x: 6, y: 6 });
    active(tg).hp = active(tg).maxHp * 0.2;
    advance(tg, 0.6);
    clearEvents(tg);
    swap(tg, 2, { x: 15, y: 6 });
    expect(procs(tg, 'evac').length).toBe(0);
  });

  it('응급 후송 does not fire above 35 % HP', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'evac_common', null);
    active(tg).hp = active(tg).maxHp * 0.5;
    swap(tg, 1, { x: 15, y: 6 });
    expect(procs(tg, 'evac').length).toBe(0);
  });

  it('마지막 인사: the leaver’s normal skill at the leave spot, once per character per 6 s', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'farewell_rare', null);
    stand(tg, { x: 6, y: 6 });
    const g = dummy(tg, { x: 7, y: 6 });
    swap(tg, 1, { x: 18, y: 6 });
    expect(casts(tg, 'farewell').length).toBeGreaterThan(0);
    advance(tg, 1.5);
    expect(hurt(g)).toBe(true);
    clearEvents(tg);
    swap(tg, 0, { x: 6, y: 6 });
    advance(tg, 0.6);
    swap(tg, 2, { x: 18, y: 6 });
    expect(casts(tg, 'farewell').length).toBe(0); // guardian again within 6 s
  });

  it('검은 안개: a fog zone at the leave spot slows and weakens enemies inside', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'fog_rare', null);
    stand(tg, { x: 6, y: 6 });
    const g = dummy(tg, { x: 6.5, y: 6 });
    swap(tg, 1, { x: 18, y: 6 });
    advance(tg, 0.6);
    expect(statusOf(g, 'slow')?.value).toBeCloseTo(0.4, 9);
    expect(statusOf(g, 'atkDown')?.value).toBeCloseTo(0.25, 9);
    const z = tg.w.state.zones.find(x => (x as unknown as { rt: { ctx: CastCtx } }).rt.ctx.skillId === 'fog')!;
    expect(z.radius).toBeCloseTo(3.5, 9);
    expect(z.total).toBeCloseTo(4, 9);
  });

  // 기획 17차 밸런스: 2 / 3 cells → 1 / 1.5 cells, stun 0 / 0.4 → 0.3 / 0.5 s (pushing out of the drag hurt)
  it('물러서!: pushes enemies away from the leave spot (rare 1.5 cells + 0.5 s stun once per 5 s); bosses stay', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'shove_rare', null);
    stand(tg, { x: 6, y: 6 });
    const g = dummy(tg, { x: 7, y: 6 });
    const mid = dummy(tg, { x: 5, y: 6 });
    mid.tier = 'mid';
    swap(tg, 1, { x: 18, y: 6 });
    expect(g.pos.x).toBeCloseTo(8.5, 6);
    expect(statusOf(g, 'stun')?.remaining).toBeCloseTo(0.5, 6);
    expect(mid.pos.x).toBe(5);
  });
});

describe('직업 특기', () => {
  it('탱커 1: push + 30 % guard on landing; twice for tanks → numbers ×1.5', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'role_common', 0); // guardian = tank
    swap(tg, 1, { x: 15, y: 6 });
    const g = dummy(tg, { x: 9, y: 6 });
    const e = swap(tg, 0, { x: 8, y: 6 });
    expect(g.pos.x).toBeCloseTo(10, 6);
    expect(rwTakenMult(tg.w, e, p)).toBeCloseTo(0.7, 9);
    expect(procs(tg, 'role').length).toBeGreaterThan(0);
    grantReward(tg.w, p, 'role_common', 0);
    advance(tg, 0.6);
    swap(tg, 1, { x: 15, y: 6 });
    advance(tg, 3.2);
    const e2 = swap(tg, 0, { x: 3, y: 6 });
    expect(rwTakenMult(tg.w, e2, p)).toBeCloseTo(1 - 0.45, 9);
  });

  it('탱커 2/3: the abandoned shield guards any player inside; the straw doll taunts and banks a shield', () => {
    const tg = setup({ players: [HUMAN, OTHER] });
    const p = P(tg);
    grantReward(tg.w, p, 'role_epic', 0);
    const tank = stand(tg, { x: 6, y: 6 });
    const mate = stand(tg, { x: 6.5, y: 6.5 }, 1);
    const g = dummy(tg, { x: 8, y: 6 });
    swap(tg, 1, { x: 18, y: 6 });
    advance(tg, 0.2);
    expect(rwTakenMult(tg.w, mate, P(tg, 1))).toBeCloseTo(0.8, 9);
    const doll = alive(tg, 'rw_straw')[0];
    expect(doll).toBeDefined();
    expect(doll.maxHp).toBeCloseTo(0.3 * tank.maxHp, 6);
    expect(statusOf(g, 'taunt')).toBeDefined();
    doll.hp -= 100;
    advance(tg, 0.1);
    expect(p.rt.reward?.['straw.store.0']).toBeCloseTo(30, 6);
    advance(tg, 6);
    expect(rwTakenMult(tg.w, mate, P(tg, 1))).toBe(1); // the zone is gone
    const e = swap(tg, 0, { x: 15, y: 6 });
    expect(e.shield).toBeGreaterThanOrEqual(30 - 1e-6);
  });

  it('근접딜러 1/2: a slash toward the nearest enemy after the drag; low-HP normal enemies are executed', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'role_rare', 1); // blade = melee
    const far = dummy(tg, { x: 13, y: 6 }); // 5 cells away: only the slash reaches it
    const weak = dummy(tg, { x: 9, y: 6 });
    weak.hp = weak.maxHp * 0.1;
    swap(tg, 1, { x: 8, y: 6 });
    expect(weak.rt.gone).toBe(true);
    advance(tg, 2);
    expect(hurt(far)).toBe(true);
    expect(casts(tg, 'role').some(c => c.area.shape === 'line')).toBe(true);
  });

  it('원거리딜러 1: the next hit within 3 s is dodged, move speed +30 %', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'role_common', 2); // mage = ranged
    const e = swap(tg, 2, { x: 8, y: 6 });
    const base = e.rt.base.moveSpeed;
    expect(effStats(tg.w, e).moveSpeed).toBeCloseTo(base * 1.3, 6);
    expect(rwTakenMult(tg.w, e, p)).toBe(0);
    expect(rwTakenMult(tg.w, e, p)).toBe(1); // used up
    expect(procs(tg, 'role').some(x => x.text === '회피')).toBe(true);
  });

  it('원거리딜러 2/3: a turret at the leave spot; the drag again on both sides 0.4 s later', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'role_epic', 2);
    const left = dummy(tg, { x: 6.5, y: 6 });
    const right = dummy(tg, { x: 9.5, y: 6 });
    swap(tg, 2, { x: 8, y: 6 });
    clearEvents(tg);
    advance(tg, 0.5);
    expect(procs(tg, 'role').length).toBeGreaterThan(0);
    advance(tg, 2);
    expect(hurt(left) && hurt(right)).toBe(true);
    swap(tg, 1, { x: 18, y: 6 });
    expect(alive(tg, 'rw_turret').length).toBe(1);
  });

  it('힐러 1: heals the most wounded member (bench too) by 15 %, dead ones revive 3 s sooner', () => {
    const tg = setup({ players: [HEAL_PARTY] });
    const p = P(tg);
    grantReward(tg.w, p, 'role_common', 1); // cleric
    const g = p.party[2];
    g.hp = g.maxHp * 0.4;
    swap(tg, 1, { x: 8, y: 6 });
    expect(g.hp / g.maxHp).toBeCloseTo(0.55, 6);
  });

  it('힐러 2/3: a heal zone at the leave spot (guard inside); the drag again at the most wounded ally', () => {
    const tg = setup({ players: [HEAL_PARTY, OTHER] });
    const p = P(tg);
    grantReward(tg.w, p, 'role_epic', 1);
    const mate = stand(tg, { x: 14, y: 6 }, 1);
    mate.hp = mate.maxHp * 0.3;
    swap(tg, 1, { x: 6, y: 6 });
    expect(procs(tg, 'role').some(x => Math.abs(x.pos.x - 14) < 1e-6)).toBe(true); // 두 갈래 손길 on the mate
    advance(tg, 0.6);
    const e = stand(tg, { x: 6, y: 6 });
    swap(tg, 0, { x: 6.5, y: 6 }); // cleric leaves at (6,6), guardian lands inside the zone
    stand(tg, { x: 6.5, y: 6 }); // (its drag dashes)
    const z = tg.w.state.zones.find(x => (x as unknown as { rt: { ctx: CastCtx } }).rt.ctx.skillId === 'role');
    expect(z).toBeDefined();
    advance(tg, 0.2);
    expect(rwTakenMult(tg.w, active(tg), p)).toBeCloseTo(0.9, 9);
    expect(e.rt.gone).toBe(true);
  });

  it('서포터 1/2/3: the next one is buffed, a team cheer on appear, bench supports raise attack', () => {
    const tg = setup({ players: [SUPPORT_PARTY, OTHER] });
    const p = P(tg);
    grantReward(tg.w, p, 'role_epic', 0); // bard = support
    const mate = stand(tg, { x: 9, y: 6 }, 1);
    // bard (slot 0) is on the field: the leaving support buffs blade
    const blade = swap(tg, 1, { x: 8, y: 6 });
    expect(statusOf(blade, 'atkUp')?.value).toBeCloseTo(0.25, 9);
    expect(statusOf(blade, 'haste')?.value).toBeGreaterThanOrEqual(0.2 - 1e-9);
    // 대기석 응원단: two supports on the bench → +20 % atk on blade
    const into = { hpPct: 0, atkPct: 0, defFlat: 0, atkSpeedPct: 0, moveSpeedPct: 0, critChance: 0, critMult: 0 };
    rwStatMods(tg.w, blade, p, into);
    expect(into.atkPct).toBeCloseTo(0.2, 9);
    advance(tg, 0.6);
    swap(tg, 2, { x: 8.5, y: 6 }); // chrono (support) appears: the cheer reaches the other player
    expect(statusOf(mate, 'atkUp')?.value).toBeCloseTo(0.15, 9);
  });
});

describe('교대 연계·편성', () => {
  it('바통 터치: the leaver’s buffs pass on +2 s (whitelist only)', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'baton_rare', null);
    const e = active(tg);
    e.statuses.push({ id: 'atkUp', remaining: 3, total: 3, value: 0.2, sourcePlayer: 0 }, { id: 'slow', remaining: 3, total: 3, value: 0.3, sourcePlayer: null });
    const n = swap(tg, 1, { x: 8, y: 6 });
    expect(statusOf(n, 'atkUp')?.remaining).toBeCloseTo(5, 6);
    expect(statusOf(n, 'slow')).toBeUndefined();
  });

  it('연쇄 교대: stacks per swap within 5 s (max 3), back to 0 after 5 s idle', () => {
    const tg = setup();
    grantReward(tg.w, P(tg), 'combo_rare', null);
    const order = [1, 2, 0, 1, 2];
    for (const i of order) {
      swap(tg, i, { x: 8, y: 6 });
      advance(tg, 1);
    }
    expect(procs(tg, 'combo').map(x => x.text)).toEqual(['연쇄 ×1', '연쇄 ×2', '연쇄 ×3', '연쇄 ×3']);
    advance(tg, 6);
    clearEvents(tg);
    swap(tg, 0, { x: 8, y: 6 });
    expect(procs(tg, 'combo').length).toBe(0);
  });

  it('인수인계: a different role in → the leaver’s blessing (tank → guard 20 %, ranged → crit +15 %)', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'handover_epic', null);
    const blade = swap(tg, 1, { x: 8, y: 6 });
    expect(rwTakenMult(tg.w, blade, p)).toBeCloseTo(0.8, 9);
    advance(tg, 0.6);
    swap(tg, 2, { x: 8, y: 6 });
    advance(tg, 0.6);
    const g = swap(tg, 0, { x: 8, y: 6 }); // mage (ranged) → guardian
    expect(effStats(tg.w, g).critChance).toBeCloseTo(Math.min(1, g.rt.base.critChance + 0.15), 6);
  });

  it('엄호 교대: tank out → dealer in: drag +40 %, guard 25 %', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'cover_swap_rare', null);
    const blade = swap(tg, 1, { x: 8, y: 6 });
    expect(rwTakenMult(tg.w, blade, p)).toBeCloseTo(0.75, 9);
    expect(procs(tg, 'cover_swap').length).toBe(1);
    const e = active(tg);
    const m = rwOnAppear(tg.w, p, { idx: 1, e, at: { ...e.pos }, leave: { idx: 0, pos: { ...e.pos }, defId: 'guardian' }, just: false, sinceReady: 0, cooling: 0, forced: false });
    expect(m.dmgMult).toBeCloseTo(1.4, 9);
  });

  it('뒷수습: dealer out → healer in: the drag’s overflow heal becomes a shield (≤ 30 % max HP)', () => {
    const tg = setup({ players: [HEAL_PARTY] });
    const p = P(tg);
    grantReward(tg.w, p, 'aftercare_rare', null);
    const cleric = swap(tg, 1, { x: 8, y: 6 });
    cleric.shield = 0;
    const ctx: CastCtx = { ...charCtx(tg.w, cleric, 'drag', null), isDrag: true };
    rwOnHealOverflow(tg.w, cleric, 100, ctx);
    expect(cleric.shield).toBeCloseTo(Math.min(60, 0.3 * cleric.maxHp), 6);
    rwOnHealOverflow(tg.w, cleric, 1e6, ctx);
    expect(cleric.shield).toBeCloseTo(0.3 * cleric.maxHp, 6);
  });

  it('릴레이 3연타: all three in within 6 s → shockwave + ult; internal cooldown 15 s', () => {
    const tg = setup();
    const p = P(tg);
    grantReward(tg.w, p, 'relay3_epic', null);
    const g = dummy(tg, { x: 11, y: 6 });
    swap(tg, 1, { x: 8, y: 6 });
    advance(tg, 1);
    p.party[2].ult.charge = 0;
    swap(tg, 2, { x: 8, y: 6 });
    advance(tg, 1);
    expect(procs(tg, 'relay3').length).toBe(0);
    swap(tg, 0, { x: 8, y: 6 }); // the third one within 6 s
    expect(procs(tg, 'relay3').length).toBe(1);
    expect(hurt(g)).toBe(true);
    expect(p.party[0].ult.charge).toBeGreaterThanOrEqual(0.15 - 1e-9);
    advance(tg, 1);
    clearEvents(tg);
    swap(tg, 1, { x: 8, y: 6 });
    expect(procs(tg, 'relay3').length).toBe(0); // ICD 15 s
  });

  it('동업자: a tank in → the other tank’s cooldown −2 s, drag +15 %', () => {
    const tg = setup({ players: [TWO_TANKS] });
    const p = P(tg);
    grantReward(tg.w, p, 'partners_rare', null);
    swap(tg, 2, { x: 8, y: 6 }); // mage
    const g = p.party[0];
    g.swapCooldownRemaining = 6;
    p.appearLock = 0;
    p.party[1].swapCooldownRemaining = 0;
    expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 8, y: 6 } }).ok).toBe(true);
    expect(g.swapCooldownRemaining).toBeCloseTo(4, 6);
    expect(procs(tg, 'partners').length).toBe(1);
  });

  // 기획 17차 밸런스: +5 % → +3 %
  it('삼색 파티: attack / max HP +3 % and +2 % ult to the incoming card', () => {
    const tg = setup();
    const p = P(tg);
    const e0 = active(tg);
    const atk0 = effStats(tg.w, e0).atk;
    grantReward(tg.w, p, 'tricolor_common', null);
    expect(effStats(tg.w, e0).atk / atk0).toBeCloseTo(1.03 / 1, 6);
    p.party[1].ult.charge = 0;
    swap(tg, 1, { x: 8, y: 6 });
    expect(p.party[1].ult.charge).toBeGreaterThanOrEqual(0.02 - 1e-9);
  });
});

describe('set bonuses, gear merge, determinism', () => {
  it('#등장 ×3: appear invulnerability +0.3 s and appear reward power ×1.2', () => {
    const tg = setup();
    const p = P(tg);
    for (const id of ['bolt_common', 'startle_common', 'beckon_common']) grantReward(tg.w, p, id, null);
    for (let i = 0; i < 3; i++) dummy(tg, { x: 9 + i, y: 3 });
    const e = swap(tg, 1, { x: 8, y: 3 });
    expect(e.invulnTime).toBeCloseTo(tg.w.tunables.appearInvulnTime + 0.3, 6);
    const b = tg.w.state.projectiles.find(pr => (pr as unknown as { rt: { ctx: CastCtx } }).rt.ctx.skillId === 'bolt') as unknown as { rt: { amount: number } };
    expect(b.rt.amount).toBeCloseTo(0.6 * 1.2, 9);
  });

  it('원정 gear with the same effect: the reward takes over (one proc), powers add, targets the larger', () => {
    const tg = setup();
    const p = P(tg);
    p.gear = [{}, { weapon: { slot: 'weapon', tier: 10, rarity: 'epic', optionId: 'w_appear_bolt' } }, {}];
    grantReward(tg.w, p, 'bolt_common', null);
    for (let i = 0; i < 6; i++) dummy(tg, { x: 9 + i, y: 6 });
    expect(rewardTakesOver(p, 1, 'w_appear_bolt')).toBe(true);
    swap(tg, 1, { x: 8, y: 6 });
    expect(eventsOf(tg, 'gearProc').filter(e => e.id === 'w_appear_bolt').length).toBe(0);
    const bolts = tg.w.state.projectiles.filter(pr => (pr as unknown as { rt: { ctx: CastCtx } }).rt.ctx.skillId === 'bolt') as unknown as { rt: { amount: number } }[];
    expect(bolts.length).toBe(4); // max(2, gear Lv3 4)
    expect(bolts[0].rt.amount).toBeCloseTo(0.6 + 0.9, 9);
    expect(rewardTakesOver(p, 1, 'w_execute')).toBe(false);
  });

  it('원정 merges: 그을린 발자국 once (power added); 교대 폭발 + an equipped 교대의 깃발 = one flag blast ×1.5, +0.5 radius', () => {
    const tg = setup();
    const p = P(tg);
    p.gear = [{ weapon: { slot: 'weapon', tier: 10, rarity: 'epic', optionId: 'w_scorch' }, relic: { slot: 'relic', tier: 3, rarity: 'rare', relicId: 'relay_flag' } }, { weapon: { slot: 'weapon', tier: 10, rarity: 'epic', optionId: 'w_scorch' } }, {}];
    grantReward(tg.w, p, 'scorch_common', null);
    grantReward(tg.w, p, 'relay_blast_common', null);
    stand(tg, { x: 6, y: 6 });
    swap(tg, 1, { x: 12, y: 6 });
    const fires = tg.w.state.zones.filter(z => ['scorch', 'w_scorch'].includes((z as unknown as { rt: { ctx: CastCtx } }).rt.ctx.skillId));
    expect(fires.length).toBe(1);
    expect((fires[0] as unknown as { rt: { action: { effects: { kind: string; amount?: number }[] } } }).rt.action.effects[0].amount).toBeCloseTo((0.2 + 0.35) * 0.5, 9);
    const blasts = eventsOf(tg, 'skillCast').filter(e => e.skillId === 'relay_blast' || e.skillId === 'relay_flag' || e.skillId === 'w_relay_blast');
    expect(blasts.length).toBe(1);
    expect(blasts[0].area).toEqual({ shape: 'circle', radius: relicParam('relay_flag', 'radius') + 0.5 });
  });

  it('every Track A family at once: no crash over a minute of bot play; same seed → same run', () => {
    const run = () => {
      const tg = makeGame({ seed: 77, players: [{ ...HUMAN, isBot: true }, { ...OTHER, isBot: true }, { ...HEAL_PARTY, isBot: true }], tunables: { goedamRoomsPerZone: 0 } });
      for (const p of tg.w.state.players) {
        for (const f of SWAP_FAMILIES) {
          const rs = Object.keys(f.params);
          grantReward(tg.w, p, `${f.key}_${rs[rs.length - 1]}`, f.target === 'role' || f.target === 'member' ? 0 : null);
        }
        grantReward(tg.w, p, 'role_epic', 1);
        grantReward(tg.w, p, 'role_epic', 2);
      }
      advance(tg, 60);
      const s = tg.w.state;
      return JSON.stringify({
        t: s.time,
        floor: s.floor,
        players: s.players.map(p => ({ stats: p.stats, hp: p.party.map(m => Math.round(m.hp)) })),
        units: s.entities.filter(e => !e.rt.gone).length,
      });
    };
    const a = run();
    expect(run()).toBe(a);
    const parsed = JSON.parse(a) as { players: { stats: { damageBySource: Record<string, number>; swaps: number } }[] };
    expect(parsed.players.some(p => p.stats.damageBySource.relic > 0)).toBe(true);
    for (const p of parsed.players) for (const v of Object.values(p.stats.damageBySource)) expect(Number.isFinite(v)).toBe(true);
  });

  it('caps hold with everything owned: afterimages ≤ 2, turret ≤ 1, reward zones ≤ 4, guards ≤ −50 %', () => {
    const tg = setup({ players: [HUMAN] });
    const p = P(tg);
    for (const f of SWAP_FAMILIES) {
      const rs = Object.keys(f.params);
      grantReward(tg.w, p, `${f.key}_${rs[rs.length - 1]}`, f.target === 'role' ? 0 : null);
    }
    grantReward(tg.w, p, 'role_epic', 2);
    for (let i = 0; i < 8; i++) dummy(tg, { x: 4 + i * 2, y: 5 });
    for (let k = 0; k < 12; k++) {
      swap(tg, (p.activeIndex! + 1 + (k % 2)) % 3, { x: 5 + (k % 5) * 3, y: 6 });
      advance(tg, 0.7);
      const mine = tg.w.state.entities.filter(e => !e.rt.gone && e.ownerPlayer === 0);
      expect(mine.filter(e => e.defId === 'rw_shade' || e.defId === 'rw_doppel' || e.defId === 'rw_duet').length).toBeLessThanOrEqual(2);
      expect(mine.filter(e => e.defId === 'rw_turret').length).toBeLessThanOrEqual(1);
      expect((p.rt.rewardZones ?? []).filter(id => tg.w.state.zones.some(z => z.id === id)).length).toBeLessThanOrEqual(4);
      rwTakenMult(tg.w, active(tg), p); // 치고 빠지기 may dodge this one (× 0)
      expect(rwTakenMult(tg.w, active(tg), p)).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
  });
});

// keep ROLE_NUM referenced so a changed number shows up in review next to these tests
void ROLE_NUM;

describe('render (src/render/rewardFx/swap.ts)', () => {
  it('lines flash from the leave spot, procs ring, mines blink — no throw without a canvas', async () => {
    const { rewardFxEvent, drawRewardFx } = await import('../../src/render/rewardFx');
    const { Camera } = await import('../../src/render/camera');
    const calls: string[] = [];
    const host = {
      burst: () => calls.push('burst'),
      ring: () => calls.push('ring'),
      flash: (_cx: number, _cy: number, ox: number) => calls.push(`flash:${ox}`),
      shake: () => calls.push('shake'),
    };
    const tg = setup();
    const view = { cam: null, localPlayer: 0, host, state: tg.w.state };
    rewardFxEvent({ type: 'leave', player: 0, partyIndex: 0, pos: { x: 4, y: 6 } }, view);
    rewardFxEvent({ type: 'skillCast', sourceId: null, player: 0, slot: 'passive', skillId: 'relay_line', name: '교대선', center: { x: 10, y: 6 }, area: { shape: 'line', length: 6, width: 1.6 }, team: 'ally' }, view);
    rewardFxEvent({ type: 'rewardProc', player: 0, partyIndex: 0, entityId: null, rewardId: 'shove', pos: { x: 4, y: 6 } }, view);
    expect(calls).toEqual(['flash:4', 'ring']);
    placeMineFor(tg);
    let strokes = 0;
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'stroke' ? () => strokes++ : () => undefined), set: () => true }) as unknown as CanvasRenderingContext2D;
    drawRewardFx(ctx, { ...view, cam: new Camera() }, 1);
    expect(strokes).toBe(1);
  });
});

function placeMineFor(tg: TestGame): void {
  grantReward(tg.w, P(tg), 'mine_common', null);
  swap(tg, 1, { x: 18, y: 6 });
}
