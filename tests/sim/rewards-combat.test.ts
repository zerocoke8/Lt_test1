// 기획 17차 Track B floor rewards (docs/floor-rewards.md 「궁극기·보스·펫·상태이상」 + 「저스트 교대」): each family fires
// when it should and not otherwise, with the numbers its card shows; stacking, caps, team scope and determinism.
import { describe, expect, it } from 'vitest';
import type { AreaShape, GameEvent, PlayerSetup, Tunables, Vec2 } from '../../src/types';
import { JUST_SWAP } from '../../src/config';
import { REWARDS, getFamily, getReward } from '../../src/data';
import { COMBAT_FAMILIES } from '../../src/data/rewards/combat';
import { applyDamage, killEntity } from '../../src/sim/combat';
import { petCooldownFor } from '../../src/sim/cooldowns';
import { MIN_PET_COOLDOWN } from '../../src/sim/constants';
import { familyEligible } from '../../src/sim/rewards/offers';
import { charCtx, unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { justParams } from '../../src/sim/justSwap';
import { replayActions, rewardStatusDuration } from '../../src/sim/rewards/combat';
import { rwDealtMult, rwGaugeCap, rwGroggyMult, rwOnFieldEventSuccess, rwOnPet, rwPetRadiusAdd, rwStatusDuration } from '../../src/sim/rewards/hooks';
import { grantReward } from '../../src/sim/rewards/offers';
import { tagActive } from '../../src/sim/rewards/query';
import { startAction } from '../../src/sim/skills';
import { applyStatus, hasStatus } from '../../src/sim/status';
import { getEntity, type CastCtx, type PendingHit, type SimEntity, type SimPlayer } from '../../src/sim/world';
import { getCharacter } from '../../src/data';
import { BOT1, BOT2, HUMAN, HUMAN2, active, advance, clearEvents, eventsOf, makeGame, quietFloor, spawnAt, type TestGame } from './helpers';

const party = (characters: string[], pets = ['owl_frost', 'cat_void', 'frog_bomb']): PlayerSetup => ({ name: '나', isBot: false, characters, pets });

function setup(o: { chars?: string[]; players?: PlayerSetup[]; floor?: number; t?: Partial<Tunables>; seed?: number } = {}): TestGame {
  const players = o.players ?? [party(o.chars ?? ['guardian', 'blade', 'mage'])];
  const tg = makeGame({ seed: o.seed ?? 77, players, tunables: { invincible: true, ...(o.t ?? {}) }, ...(o.floor ? { startFloor: o.floor } : null) });
  quietFloor(tg);
  for (let i = 0; i < 20; i++) tick(tg.w);
  clearEvents(tg);
  return tg;
}

const P = (tg: TestGame, i = 0): SimPlayer => tg.w.state.players[i];
const grant = (tg: TestGame, id: string, pi = 0, member: number | null = null) => grantReward(tg.w, P(tg, pi), id, member);
function swap(tg: TestGame, idx: number, pos: Vec2, pi = 0) {
  P(tg, pi).appearLock = 0;
  return tg.game.dispatch({ type: 'swap', player: pi, partyIndex: idx, pos });
}
function ult(tg: TestGame, pi = 0) {
  tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: pi } });
  return tg.game.dispatch({ type: 'ult', player: pi });
}
const procs = (tg: TestGame, key: string) => eventsOf(tg, 'rewardProc').filter(e => e.rewardId === key);
const holdNormals = (tg: TestGame) => {
  for (const p of tg.w.state.players) for (const m of p.party) m.normalCooldownRemaining = 999;
};
const bossOf = (tg: TestGame): SimEntity => getEntity(tg.w, tg.w.state.bossId)!;
function allyCtx(tg: TestGame, pi = 0): CastCtx {
  return charCtx(tg.w, active(tg, pi), 'drag', null);
}

/** A telegraphed enemy part landing `delay` s from now at `at` (caster: a monster, else casterless). */
function threat(tg: TestGame, at: Vec2, delay: number, caster?: SimEntity, area: AreaShape = { shape: 'circle', radius: 1.5 }): PendingHit {
  const base: CastCtx = caster
    ? { ...unitCtx(tg.w, caster, 'test_skill', '테스트'), point: { ...at } }
    : {
        casterId: null, selfId: null, team: 'enemy', player: null, partyIndex: null, slot: 'monster', source: 'basic', skillId: 'test_skill', name: '테스트',
        atk: 10, critChance: 0, critMult: 1, dmgMult: 1, healMult: 1, shieldMult: 1, radiusMult: 1, point: { ...at }, targetId: null, targetPos: null,
        allyTargetId: null, origin: { ...at }, isDrag: false, summonMult: 1,
      };
  return startAction(tg.w, base, { center: 'point', area, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.5 }], delay })!;
}
function until(tg: TestGame, p: PendingHit, left: number): void {
  for (let i = 0; i < 300 && p.remaining > left + 1e-9; i++) tick(tg.w);
}
/** A 저스트 교대 of player 0 to card idx at drop (an attack under the field character, swap with 0.3 s left). */
function justSwap(tg: TestGame, idx: number, drop: Vec2, caster?: SimEntity, pre?: () => void): void {
  const me = active(tg);
  const p = threat(tg, me.pos, 1.2, caster);
  until(tg, p, 0.3);
  clearEvents(tg);
  pre?.();
  expect(swap(tg, idx, drop).ok).toBe(true);
  expect(eventsOf(tg, 'justSwap').length).toBe(1);
}

// ─────────────────────────── data ───────────────────────────

describe('Track B data', () => {
  const KEYS = [
    'swap_charge', 'intermission', 'ult_linger', 'duet', 'overcharge', 'groggy_drop', 'groggy_rush', 'crusher', 'pet_call', 'pet_scent', 'tamer', 'pet_breeder', 'fire_hand',
    'burn_chain', 'spell_ext', 'expose', 'possess', 'ghost_hunter', 'grudge', 'just_counter', 'just_cd', 'just_ult', 'just_window', 'just_guard', 'just_freeze', 'just_ghost',
  ];

  it('26 families with the spec rarities, tags, uniques and requirements', () => {
    expect(COMBAT_FAMILIES.map(f => f.key)).toEqual(KEYS);
    const rar = (k: string) => Object.keys(getFamily(k).params).join(',');
    expect(rar('swap_charge')).toBe('common,rare,epic');
    expect(rar('intermission')).toBe('rare,epic');
    expect(rar('overcharge')).toBe('legendary');
    expect(rar('just_ghost')).toBe('legendary');
    expect(rar('just_window')).toBe('rare');
    for (const k of ['overcharge', 'just_ghost', 'just_window']) expect(getFamily(k).unique, k).toBe(true);
    expect(getFamily('crusher').requires).toBe('tankOrMelee');
    expect(getFamily('tamer').requires).toBe('support');
    expect(getFamily('groggy_drop').botWeight).toBe(0.6);
    expect(getFamily('pet_scent').botWeight).toBe(0.6);
    expect(getFamily('grudge').tags).toEqual(['leave', 'status']);
    expect(getFamily('just_counter').tags).toEqual(['just', 'attack']);
    // only the two rule-changing legendaries of this track are legendary
    expect(COMBAT_FAMILIES.filter(f => f.params.legendary).map(f => f.key)).toEqual(['overcharge', 'just_ghost']);
  });

  it('every card text shows its own numbers (Korean, no template left)', () => {
    for (const r of REWARDS.filter(x => KEYS.includes(x.family))) {
      expect(r.description, r.id).not.toMatch(/undefined|NaN|\{|\}/);
      expect(r.description.length, r.id).toBeLessThan(120);
    }
    expect(getReward('swap_charge_epic').description).toContain('+8%');
    expect(getReward('intermission_epic').description).toContain('0초');
    expect(getReward('grudge_epic').description).toContain('35%');
    expect(getReward('grudge_epic').description).toContain('6%');
    expect(getReward('just_counter_epic').description).toContain('250%');
    expect(getReward('fire_hand_rare').description).toContain('25%');
    expect(getReward('expose_rare').description).toContain('25%'); // 기획 17차 밸런스: 45 → 25 %
    expect(getReward('pet_breeder_epic').description).toContain('50%');
  });
});

// ─────────────────────────── 궁극기 ───────────────────────────

describe('궁극기 rewards', () => {
  it('교대 충전: the incoming card gets +4 % (two copies add: +10 %); no reward → nothing', () => {
    const tg = setup();
    P(tg).party[1].ult.charge = 0;
    swap(tg, 1, { x: 6, y: 6 });
    expect(P(tg).party[1].ult.charge).toBe(0);
    const tg2 = setup();
    grant(tg2, 'swap_charge_common');
    grant(tg2, 'swap_charge_rare');
    P(tg2).party[1].ult.charge = 0;
    swap(tg2, 1, { x: 6, y: 6 });
    expect(P(tg2).party[1].ult.charge).toBeCloseTo(0.1, 9);
    expect(procs(tg2, 'swap_charge').length).toBe(1);
  });

  it('막간 박수: an ult halves the bench cards\' cooldowns (rare), sets them to 0 (epic or two rares)', () => {
    for (const [ids, want] of [
      [['intermission_rare'], [5, 4]],
      [['intermission_epic'], [0, 0]],
      [['intermission_rare', 'intermission_rare'], [0, 0]],
    ] as const) {
      const tg = setup();
      for (const id of ids) grant(tg, id);
      P(tg).party[1].swapCooldownRemaining = 10;
      P(tg).party[2].swapCooldownRemaining = 8;
      expect(ult(tg).ok).toBe(true);
      expect(P(tg).party[1].swapCooldownRemaining).toBeCloseTo(want[0], 9);
      expect(P(tg).party[2].swapCooldownRemaining).toBeCloseTo(want[1], 9);
      expect(eventsOf(tg, 'swapCdCut').length).toBe(1);
    }
  });

  it('궁극기 여운: leaving within 8 s of the ult replays its last action at the leave spot (40 %, relic damage, no groggy), once', () => {
    const tg = setup();
    holdNormals(tg);
    grant(tg, 'ult_linger_epic');
    expect(ult(tg).ok).toBe(true);
    advance(tg, 2);
    const me = active(tg);
    const g = spawnAt(tg, 'golem', { ...me.pos });
    clearEvents(tg);
    swap(tg, 1, { x: me.pos.x + 8, y: me.pos.y });
    advance(tg, 1);
    expect(procs(tg, 'ult_linger').length).toBe(1);
    const casts = eventsOf(tg, 'skillCast').filter(e => e.skillId === 'ult_linger');
    expect(casts.length).toBe(1);
    const hit = eventsOf(tg, 'damage').filter(e => e.targetId === g.id && e.source === 'relic');
    expect(hit.length).toBeGreaterThan(0);
    // the second leave of the same ult does nothing
    clearEvents(tg);
    swap(tg, 0, { x: 5, y: 5 });
    swap(tg, 2, { x: 6, y: 5 });
    expect(procs(tg, 'ult_linger').length).toBe(0);
  });

  it('궁극기 여운: after 8 s nothing; the replay strips moves, summons and self parts', () => {
    const tg = setup();
    grant(tg, 'ult_linger_epic');
    expect(ult(tg).ok).toBe(true);
    advance(tg, 8.5);
    clearEvents(tg);
    swap(tg, 1, { x: 6, y: 6 });
    expect(procs(tg, 'ult_linger').length).toBe(0);
    for (const id of ['blade', 'shadow', 'puppeteer', 'guardian', 'berserker']) {
      for (const a of replayActions(getCharacter(id).ult.actions)) {
        expect(a.dash ?? a.charge ?? a.blink ?? a.summon ?? a.blinkChain, id).toBeUndefined();
        expect(a.affects).not.toBe('self');
      }
    }
  });

  it('둘이서: an ult calls an 8 s afterimage of the stronger bench character that shoots', () => {
    const tg = setup();
    grant(tg, 'duet_epic');
    const me = active(tg);
    const g = spawnAt(tg, 'golem', { x: me.pos.x + 2, y: me.pos.y });
    expect(ult(tg).ok).toBe(true);
    const duet = tg.w.state.entities.find(e => e.defId === 'rw_duet' && !e.rt.gone)!;
    expect(duet).toBeDefined();
    expect(duet.expiresIn).toBeCloseTo(8, 6);
    expect(duet.rt.untargetable).toBe(true);
    clearEvents(tg);
    advance(tg, 3);
    expect(g.hp).toBeLessThan(g.maxHp);
    advance(tg, 6);
    expect(tg.w.state.entities.some(e => e.defId === 'rw_duet' && !e.rt.gone)).toBe(false);
  });

  it('두 번 차는 게이지: the gauge fills past 100 % up to 200 %; casting above 100 % fires again 0.8 s later at 70 %', () => {
    const tg = setup();
    holdNormals(tg);
    const p = P(tg);
    expect(rwGaugeCap(p)).toBe(1);
    grant(tg, 'overcharge_legendary');
    expect(rwGaugeCap(p)).toBe(2);
    const g = p.party[p.activeIndex!].ult;
    g.charge = 0.99;
    advance(tg, 60);
    expect(g.charge).toBeGreaterThan(1.5);
    expect(g.charge).toBeLessThanOrEqual(2);
    clearEvents(tg);
    expect(tg.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    expect(g.charge).toBe(0);
    advance(tg, 0.7);
    expect(procs(tg, 'overcharge').filter(e => e.text).length).toBe(0);
    advance(tg, 0.2);
    expect(procs(tg, 'overcharge').filter(e => e.text === '한 번 더!').length).toBe(1);
    // exactly 100 %: no second cast
    const tg2 = setup();
    grant(tg2, 'overcharge_legendary');
    const p2 = P(tg2);
    p2.party[p2.activeIndex!].ult.charge = 1;
    expect(tg2.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    advance(tg2, 1.2);
    expect(procs(tg2, 'overcharge').length).toBe(0);
  });
});

// ─────────────────────────── 보스 ───────────────────────────

describe('보스 rewards', () => {
  const bossGame = (chars: string[]) => {
    const tg = makeGame({ seed: 7, startFloor: 10, players: [party(chars)], tunables: { invincible: true } });
    holdNormals(tg);
    return tg;
  };
  const points = (tg: TestGame) => P(tg).stats.groggyPoints;

  it('그로기 낙하: a drop within 3 of the boss scores ×1.6 and the boss takes +15 % for 1 s; a far drop scores as usual', () => {
    const base = bossGame(['cleric', 'guardian', 'ranger']);
    const tg = bossGame(['cleric', 'guardian', 'ranger']);
    grant(tg, 'groggy_drop_rare');
    holdNormals(tg);
    const at = { ...bossOf(base).pos };
    expect(swap(base, 1, at).ok).toBe(true);
    expect(swap(tg, 1, { ...bossOf(tg).pos }).ok).toBe(true);
    expect(points(base)).toBeGreaterThan(0);
    expect(points(tg)).toBeCloseTo(points(base) * 1.6, 6);
    const v = bossOf(tg).statuses.find(s => s.id === 'vulnerable');
    expect(v?.value).toBeCloseTo(0.15, 9);
    expect(v?.remaining).toBeCloseTo(1, 6);
    expect(procs(tg, 'groggy_drop').length).toBe(1);
  });

  it('파쇄자: tank / melee drags on the boss score ×1.5 (×1.75 rare); ranged drags as usual; with 그로기 낙하 the product stops at ×2', () => {
    const base = bossGame(['cleric', 'guardian', 'ranger']);
    swap(base, 1, { ...bossOf(base).pos });
    const tank = points(base);
    const tg = bossGame(['cleric', 'guardian', 'ranger']);
    grant(tg, 'crusher_common');
    swap(tg, 1, { ...bossOf(tg).pos });
    expect(points(tg)).toBeCloseTo(tank * 1.5, 6);
    // the cap: ×1.6 × ×1.75 = ×2.8 → ×2
    const both = bossGame(['cleric', 'guardian', 'ranger']);
    grant(both, 'crusher_rare');
    grant(both, 'groggy_drop_rare');
    swap(both, 1, { ...bossOf(both).pos });
    expect(points(both)).toBeCloseTo(tank * 2, 6);
    // ranged: unchanged
    const r0 = bossGame(['cleric', 'ranger', 'guardian']);
    const r1 = bossGame(['cleric', 'ranger', 'guardian']);
    grant(r1, 'crusher_rare');
    swap(r0, 1, { ...bossOf(r0).pos });
    swap(r1, 1, { ...bossOf(r1).pos });
    advance(r0, 1);
    advance(r1, 1);
    expect(points(r1)).toBeCloseTo(points(r0), 6);
    // the multiplier itself
    const ctx = { ...allyCtx(tg), slot: 'drag' as const, partyIndex: 1 };
    expect(rwGroggyMult(tg.w, ctx)).toBeCloseTo(1.5, 9);
    expect(rwGroggyMult(tg.w, { ...ctx, partyIndex: 2 })).toBe(1);
  });

  it('그로기 러시: the break halves my bench cooldowns; appearing while the boss is groggy → drag +30 %', () => {
    const tg = bossGame(['cleric', 'guardian', 'ranger']);
    grant(tg, 'groggy_rush_rare');
    P(tg).party[1].swapCooldownRemaining = 10;
    P(tg).party[2].swapCooldownRemaining = 6;
    advance(tg, 1);
    const before = [P(tg).party[1].swapCooldownRemaining, P(tg).party[2].swapCooldownRemaining];
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    expect(P(tg).party[1].swapCooldownRemaining).toBeCloseTo(before[0] / 2, 9);
    expect(P(tg).party[2].swapCooldownRemaining).toBeCloseTo(before[1] / 2, 9);
    P(tg).party[1].swapCooldownRemaining = 0;
    clearEvents(tg);
    swap(tg, 1, { ...bossOf(tg).pos });
    expect(procs(tg, 'groggy_rush').length).toBe(1);
  });

  it('#보스 set (3 boss tags): damage to the boss +10 %, to normal enemies unchanged', () => {
    const tg = bossGame(['cleric', 'guardian', 'ranger']);
    advance(tg, 1);
    grant(tg, 'groggy_drop_rare');
    grant(tg, 'crusher_common');
    expect(tagActive(P(tg), 'boss')).toBe(false);
    grant(tg, 'groggy_rush_rare');
    expect(tagActive(P(tg), 'boss')).toBe(true);
    const src = { casterId: null, team: 'ally' as const, player: 0, source: 'drag' as const, isDrag: true };
    expect(rwDealtMult(tg.w, src, bossOf(tg))).toBeCloseTo(1.1, 9);
    const g = spawnAt(tg, 'golem', { x: 3, y: 3 });
    expect(rwDealtMult(tg.w, src, g)).toBe(1);
  });
});

// ─────────────────────────── 펫 ───────────────────────────

describe('펫 rewards', () => {
  it('펫 호출 신호: on appear the pet with the most cooldown left −1.5 s (twice: −4 s)', () => {
    const tg = setup();
    grant(tg, 'pet_call_common');
    P(tg).pets[0].cooldownRemaining = 5;
    P(tg).pets[1].cooldownRemaining = 8;
    swap(tg, 1, { x: 6, y: 6 });
    expect(P(tg).pets[1].cooldownRemaining).toBeCloseTo(6.5, 9);
    expect(P(tg).pets[0].cooldownRemaining).toBeCloseTo(5, 9);
    grant(tg, 'pet_call_rare');
    swap(tg, 2, { x: 6, y: 6 });
    expect(P(tg).pets[1].cooldownRemaining).toBeCloseTo(2.5, 9);
  });

  it('주인 냄새: for 3 s after an appear, a pet used within 3 of the drop is +40 %', () => {
    const tg = setup();
    grant(tg, 'pet_scent_rare');
    swap(tg, 1, { x: 6, y: 6 });
    expect(procs(tg, 'pet_scent').length).toBe(1);
    expect(rwOnPet(tg.w, P(tg), 0, { x: 7, y: 7 }).power).toBeCloseTo(1.4, 9);
    expect(rwOnPet(tg.w, P(tg), 0, { x: 12, y: 6 }).power).toBe(1);
    advance(tg, 3.2);
    expect(rwOnPet(tg.w, P(tg), 0, { x: 6, y: 6 }).power).toBe(1);
  });

  it('조련사의 손길: with a support on the field the pet cooldown is 30 % shorter and the support gets +20 % attack speed 4 s', () => {
    const tg = setup({ chars: ['bard', 'guardian', 'ranger'] });
    const p = P(tg);
    const plain = petCooldownFor(tg.w, p, 0);
    grant(tg, 'tamer_common');
    expect(petCooldownFor(tg.w, p, 0)).toBeCloseTo(plain * 0.7, 9);
    expect(tg.game.dispatch({ type: 'pet', player: 0, petIndex: 0, pos: { x: 8, y: 6 } }).ok).toBe(true);
    expect(p.pets[0].cooldownRemaining).toBeCloseTo(plain * 0.7, 9);
    const h = active(tg).statuses.find(s => s.id === 'haste');
    expect(h?.value).toBeCloseTo(0.2, 9);
    expect(h?.remaining).toBeCloseTo(4, 6);
    // a non-support on the field: nothing
    swap(tg, 1, { x: 6, y: 6 });
    expect(petCooldownFor(tg.w, p, 0)).toBeCloseTo(plain, 9);
  });

  it('연쇄 화상 is offered only when the party can burn (a mage, 그을린 발자국 / 불붙은 손)', () => {
    const tg = setup({ chars: ['guardian', 'blade', 'ranger'] });
    const f = getFamily('burn_chain');
    expect(familyEligible(tg.w.state, P(tg), f)).toBe(false);
    grant(tg, 'fire_hand_common');
    expect(familyEligible(tg.w.state, P(tg), f)).toBe(true);
    const tg2 = setup({ chars: ['guardian', 'blade', 'mage'] });
    expect(familyEligible(tg2.w.state, P(tg2), f)).toBe(true);
  });

  it('펫 훈련 copies stop at −50 % and stop being offered; a pet cooldown never goes below 8 s with every multiplier', () => {
    const tg = setup({ chars: ['bard', 'guardian', 'ranger'] });
    const p = P(tg);
    const base = petCooldownFor(tg.w, p, 0);
    grant(tg, 'petcd_epic');
    expect(familyEligible(tg.w.state, p, getFamily('petcd'))).toBe(true);
    grant(tg, 'petcd_epic');
    expect(petCooldownFor(tg.w, p, 0)).toBeCloseTo(base * 0.5, 9); // 30 % + 30 % → capped at 50 %
    expect(familyEligible(tg.w.state, p, getFamily('petcd'))).toBe(false);
    for (let i = 0; i < 3; i++) grant(tg, 'petcd_epic');
    grant(tg, 'tamer_common');
    grant(tg, 'tamer_common');
    expect(petCooldownFor(tg.w, p, 0)).toBeGreaterThanOrEqual(Math.min(base, MIN_PET_COOLDOWN) - 1e-9);
    expect(petCooldownFor(tg.w, p, 0)).toBeGreaterThan(0);
  });

  it('펫 사육사: pet power +20 / 35 / 50 % (two copies add), pet radius +20 % (the preview too)', () => {
    const tg = setup();
    expect(rwPetRadiusAdd(P(tg))).toBe(0);
    grant(tg, 'pet_breeder_common');
    expect(rwOnPet(tg.w, P(tg), 0, { x: 5, y: 5 }).power).toBeCloseTo(1.2, 9);
    expect(rwPetRadiusAdd(P(tg))).toBeCloseTo(0.2, 9);
    grant(tg, 'pet_breeder_epic');
    expect(rwOnPet(tg.w, P(tg), 0, { x: 5, y: 5 }).power).toBeCloseTo(1.7, 9);
    expect(rwPetRadiusAdd(P(tg))).toBeCloseTo(0.2, 9);
  });
});

// ─────────────────────────── 상태이상 ───────────────────────────

describe('상태이상 rewards', () => {
  it('불붙은 손: a drag hit burns 3 s at 15 % of the caster\'s attack per second', () => {
    const tg = setup({ chars: ['mage', 'guardian', 'ranger'] });
    grant(tg, 'fire_hand_common');
    const g = spawnAt(tg, 'golem', { x: 8, y: 6 });
    swap(tg, 1, { x: 8, y: 6 });
    const burn = g.statuses.find(s => s.id === 'burn')!;
    expect(burn).toBeDefined();
    const atk = charCtx(tg.w, active(tg), 'drag', null).atk;
    expect(burn.value).toBeCloseTo(0.15 * atk, 6);
    expect(burn.remaining).toBeCloseTo(3, 6);
    expect(burn.sourcePlayer).toBe(0);
  });

  it('연쇄 화상: an enemy dying with my burn passes it on to enemies within 2 (time left, min 2 s); others\' burns do not', () => {
    const tg = setup();
    grant(tg, 'burn_chain_rare');
    const a = spawnAt(tg, 'goblin', { x: 15, y: 9 });
    const b = spawnAt(tg, 'golem', { x: 16, y: 9 });
    const c = spawnAt(tg, 'golem', { x: 19.5, y: 9 });
    applyStatus(a, 'burn', 0.5, 7, 0, 'relic');
    killEntity(tg.w, a, { casterId: null, team: 'ally', player: 0, source: 'normal', isDrag: false });
    const bb = b.statuses.find(s => s.id === 'burn');
    expect(bb?.value).toBe(7);
    expect(bb?.remaining).toBeCloseTo(2, 9);
    expect(hasStatus(c, 'burn')).toBe(false);
    // someone else's burn does not spread
    const d = spawnAt(tg, 'goblin', { x: 5, y: 2 });
    const e = spawnAt(tg, 'golem', { x: 5.5, y: 2 });
    applyStatus(d, 'burn', 3, 7, 1, 'relic');
    killEntity(tg.w, d, { casterId: null, team: 'ally', player: 0, source: 'normal', isDrag: false });
    expect(hasStatus(e, 'burn')).toBe(false);
  });

  it('주문 연장: my stun / root / slow +25 % (rare 40 %), other statuses as they are; the #상태이상 set adds 20 % to every hostile one', () => {
    const tg = setup();
    const ctx = allyCtx(tg);
    expect(rwStatusDuration(tg.w, ctx, 'stun', 1)).toBe(1);
    grant(tg, 'spell_ext_common');
    expect(rwStatusDuration(tg.w, ctx, 'stun', 1)).toBeCloseTo(1.25, 9);
    expect(rwStatusDuration(tg.w, ctx, 'slow', 2)).toBeCloseTo(2.5, 9);
    expect(rwStatusDuration(tg.w, ctx, 'atkDown', 2)).toBe(2);
    expect(rewardStatusDuration(P(tg), 'haste', 2)).toBe(2);
    grant(tg, 'spell_ext_rare');
    expect(rwStatusDuration(tg.w, ctx, 'root', 1)).toBeCloseTo(1.65, 9);
    grant(tg, 'expose_common'); // the third #상태이상 tag
    expect(tagActive(P(tg), 'status')).toBe(true);
    expect(rwStatusDuration(tg.w, ctx, 'root', 1)).toBeCloseTo(1.65 * 1.2, 9);
    expect(rwStatusDuration(tg.w, ctx, 'atkDown', 1)).toBeCloseTo(1.2, 9);
    // an actual drag status: the 가디언 slam stun lasts 0.6 × 1.65 × 1.2 s
    const tg2 = setup({ chars: ['blade', 'guardian', 'mage'] });
    for (const id of ['spell_ext_common', 'spell_ext_rare', 'expose_common']) grant(tg2, id);
    const g = spawnAt(tg2, 'golem', { x: 8, y: 6 });
    swap(tg2, 1, { x: 8, y: 6 });
    const st = g.statuses.find(s => s.id === 'stun');
    expect(st?.total).toBeCloseTo(0.6 * 1.65 * 1.2, 6);
  });

  // 기획 17차 밸런스 (balance.md 17-3): 일반 30 / 15 % → 15 / 8 %, 희귀 45 / 20 % → 25 / 12 %
  it('약점 노출: +15 % on stunned / rooted enemies and the groggy boss, +8 % on slowed ones (rare 25 / 12 %)', () => {
    const tg = setup();
    grant(tg, 'expose_common');
    const src = { casterId: null, team: 'ally' as const, player: 0, source: 'normal' as const, isDrag: false };
    const g = spawnAt(tg, 'golem', { x: 10, y: 6 });
    expect(rwDealtMult(tg.w, src, g)).toBe(1);
    applyStatus(g, 'slow', 2, 0.3, 0, 'relic');
    expect(rwDealtMult(tg.w, src, g)).toBeCloseTo(1.08, 9);
    applyStatus(g, 'stun', 2, 0, 0, 'relic');
    expect(rwDealtMult(tg.w, src, g)).toBeCloseTo(1.15, 9);
    grant(tg, 'expose_rare');
    expect(rwDealtMult(tg.w, src, g)).toBeCloseTo(1.4, 9);
    // someone else's hits are untouched
    expect(rwDealtMult(tg.w, { ...src, player: null }, g)).toBe(1);
  });

  it('홀린 자: a drag hit charms one normal enemy 3 s, then waits 10 s; bosses never', () => {
    const tg = setup();
    grant(tg, 'possess_epic');
    const g = spawnAt(tg, 'goblin', { x: 9, y: 6 });
    swap(tg, 1, { x: 9, y: 6 });
    advance(tg, 0.6);
    expect(hasStatus(g, 'charm')).toBe(true);
    expect(eventsOf(tg, 'statusApplied').some(e => e.status === 'charm' && e.targetId === g.id)).toBe(true);
    const h = spawnAt(tg, 'goblin', { x: 4, y: 3 });
    swap(tg, 2, { x: 4, y: 3 });
    advance(tg, 1.5);
    expect(hasStatus(h, 'charm')).toBe(false);
  });

  it('괴담 사냥꾼: a 돌발 괴담 success → field ult +25 %, bench cooldowns −3 s', () => {
    const tg = setup();
    grant(tg, 'ghost_hunter_common');
    const p = P(tg);
    p.party[p.activeIndex!].ult.charge = 0.1;
    p.party[1].swapCooldownRemaining = 5;
    p.party[2].swapCooldownRemaining = 2;
    rwOnFieldEventSuccess(tg.w);
    expect(p.party[p.activeIndex!].ult.charge).toBeCloseTo(0.35, 9);
    expect(p.party[1].swapCooldownRemaining).toBeCloseTo(2, 9);
    expect(p.party[2].swapCooldownRemaining).toBe(0);
  });

  it('원한의 쪽지: leaving marks the nearest enemy within 6 for 4 s; at the end it bursts 35 % of what it took (relic, pure)', () => {
    const tg = setup({ chars: ['guardian', 'warden', 'paladin'] });
    grant(tg, 'grudge_epic');
    const me = active(tg);
    const g = spawnAt(tg, 'golem', { x: me.pos.x + 4, y: me.pos.y });
    g.statuses.push({ id: 'stasis', remaining: 99, total: 99, value: 0, sourcePlayer: null, data: { stored: 0 } }); // keep it still
    swap(tg, 1, { x: me.pos.x - 10 < 1 ? me.pos.x + 14 : me.pos.x - 10, y: me.pos.y });
    const mark = g.statuses.find(s => s.id === 'grudge')!;
    expect(mark).toBeDefined();
    expect(mark.remaining).toBeCloseTo(4, 6);
    expect(procs(tg, 'grudge').length).toBe(1);
    applyDamage(tg.w, { casterId: null, team: 'ally', player: 0, source: 'normal', isDrag: false, pure: true }, g, 200, false);
    const hp = g.hp;
    mark.remaining = 1e-4;
    clearEvents(tg);
    tick(tg.w);
    const burst = eventsOf(tg, 'damage').filter(e => e.targetId === g.id && e.source === 'relic');
    expect(burst.length).toBe(1);
    expect(burst[0].amount).toBeCloseTo(0.35 * 200 + 0.35 * (hp - (g.hp + burst[0].amount)), 3);
    expect(procs(tg, 'grudge').some(e => e.text === '폭발')).toBe(true);
    // the same enemy is not marked again within 10 s
    swap(tg, 2, { x: g.pos.x + 1, y: g.pos.y });
    swap(tg, 0, { x: 2, y: 2 });
    expect(hasStatus(g, 'grudge')).toBe(false);
  });

  it('원한의 쪽지: a boss bursts at most 6 % of its max HP; two copies → 50 %', () => {
    const tg = makeGame({ seed: 7, startFloor: 10, players: [party(['guardian', 'warden', 'paladin'])], tunables: { invincible: true } });
    holdNormals(tg);
    advance(tg, 3);
    grant(tg, 'grudge_epic');
    grant(tg, 'grudge_epic');
    const boss = bossOf(tg);
    swap(tg, 1, { x: boss.pos.x, y: boss.pos.y + 1 });
    advance(tg, 0.2);
    swap(tg, 2, { x: boss.pos.x, y: boss.pos.y + 1 });
    const mark = boss.statuses.find(s => s.id === 'grudge')!;
    expect(mark).toBeDefined();
    boss.hp -= boss.maxHp * 0.5;
    mark.remaining = 1e-4;
    clearEvents(tg);
    tick(tg.w);
    const burst = eventsOf(tg, 'damage').filter(e => e.targetId === boss.id && e.source === 'relic');
    expect(burst.length).toBe(1);
    expect(burst[0].amount).toBeCloseTo(0.06 * boss.maxHp, 3);
  });
});

// ─────────────────────────── 저스트 교대 ───────────────────────────

describe('저스트 rewards', () => {
  it('되받아치기: the attacker takes 150 % of the incoming character\'s attack and a 0.5 s stun; a normal swap does nothing', () => {
    const tg = setup();
    holdNormals(tg);
    grant(tg, 'just_counter_rare');
    const me = active(tg);
    const caster = spawnAt(tg, 'golem', { x: me.pos.x + 3, y: me.pos.y });
    justSwap(tg, 2, { x: me.pos.x - 6 < 1 ? me.pos.x + 9 : me.pos.x - 6, y: me.pos.y }, caster);
    const hit = eventsOf(tg, 'damage').filter(e => e.targetId === caster.id && e.source === 'relic');
    expect(hit.length).toBe(1);
    const atk = charCtx(tg.w, active(tg), 'passive', null).atk;
    const plain = 1.5 * atk * (1 - 0.2); // the golem's 20 % defense
    expect(hit[0].amount).toBeCloseTo(hit[0].crit ? plain * active(tg).rt.base.critMult : plain, 3);
    expect(procs(tg, 'just_counter').length).toBe(1);
    const st = caster.statuses.find(s => s.id === 'stun');
    expect(st?.remaining).toBeCloseTo(0.5, 6);
    // no just → no counter
    const tg2 = setup();
    grant(tg2, 'just_counter_rare');
    swap(tg2, 2, { x: 5, y: 5 });
    expect(procs(tg2, 'just_counter').length).toBe(0);
  });

  it('간발의 차 / 아슬아슬: bench cooldowns −1.5 s and the incoming gauge +8 % on a just only', () => {
    const tg = setup();
    grant(tg, 'just_cd_common');
    grant(tg, 'just_ult_common');
    const p = P(tg);
    justSwap(tg, 2, { x: 4, y: 4 }, undefined, () => {
      p.party[2].ult.charge = 0;
      p.party[1].swapCooldownRemaining = 5;
    });
    expect(p.party[2].ult.charge).toBeCloseTo(0.08, 9);
    expect(p.party[1].swapCooldownRemaining).toBeCloseTo(3.5, 9);
    const tg2 = setup();
    grant(tg2, 'just_ult_common');
    P(tg2).party[2].ult.charge = 0;
    swap(tg2, 2, { x: 4, y: 4 });
    expect(P(tg2).party[2].ult.charge).toBe(0);
  });

  it('간발의 차 never takes the card the 저스트 just took out below the 저스트 floor (2.4 s)', () => {
    const tg = setup();
    grant(tg, 'just_cd_rare');
    grant(tg, 'just_ghost_legendary');
    const p = P(tg);
    const out = p.activeIndex!;
    justSwap(tg, 2, { x: 4, y: 4 });
    expect(p.party[out].swapCooldownRemaining).toBeCloseTo(JUST_SWAP.minCooldown, 6); // 10 s × 0.3 = 3 s, −2.5 s → kept at 2.4 s
  });

  it('헛손질: every player\'s characters within 3 of the drop get a 10 % max-HP shield for 3 s (team scope)', () => {
    const tg = setup({ players: [party(['guardian', 'blade', 'ranger']), HUMAN2] });
    grant(tg, 'just_guard_common');
    const mate = active(tg, 1);
    const drop = { x: mate.pos.x + 1, y: mate.pos.y };
    const far = spawnAt(tg, 'goblin', { x: 1, y: 1 });
    void far;
    const sh0 = mate.shield;
    justSwap(tg, 2, drop);
    const mine = active(tg);
    expect(mine.shield).toBeGreaterThanOrEqual(0.1 * mine.maxHp - 1e-6);
    expect(mate.shield - sh0).toBeCloseTo(0.1 * mate.maxHp, 6);
    expect(procs(tg, 'just_guard').length).toBe(1);
  });

  it('멈춘 숨: enemies within 4 slowed 60 % 2 s and every drag hit is a crit', () => {
    const tg = setup({ chars: ['blade', 'ranger', 'guardian'] });
    holdNormals(tg);
    grant(tg, 'just_freeze_epic');
    const me = active(tg);
    const drop = { x: me.pos.x + 5 > 20 ? me.pos.x - 5 : me.pos.x + 5, y: me.pos.y };
    const near = spawnAt(tg, 'golem', { x: drop.x + 1, y: drop.y });
    const far = spawnAt(tg, 'golem', { x: drop.x + (drop.x > 12 ? -9 : 9), y: drop.y });
    justSwap(tg, 2, drop);
    const sl = near.statuses.find(s => s.id === 'slow');
    expect(sl?.value).toBeCloseTo(0.6, 9);
    expect(sl?.remaining).toBeCloseTo(2, 6);
    expect(hasStatus(far, 'slow')).toBe(false);
    advance(tg, 0.5);
    const drag = eventsOf(tg, 'damage').filter(e => e.source === 'drag');
    expect(drag.length).toBeGreaterThan(0);
    expect(drag.every(e => e.crit)).toBe(true);
  });

  it('찰나의 감각, 귀신 같은 몸놀림 and the #저스트 set change the 저스트 numbers (caps 0.9 s, ×2.0, 70 %)', () => {
    const tg = setup();
    const p = P(tg);
    expect(justParams(tg.w, p)).toMatchObject({ bonus: 0, mult: 1.5, cut: 0.4 });
    grant(tg, 'just_window_rare');
    expect(justParams(tg.w, p).bonus).toBeCloseTo(0.2, 9);
    grant(tg, 'just_ghost_legendary');
    const jp = justParams(tg.w, p);
    expect(jp.bonus).toBeCloseTo(0.3, 9);
    expect(jp.mult).toBeCloseTo(2, 9);
    expect(jp.cut).toBeCloseTo(0.7, 9);
    // the set alone: window +0.1, power +0.25
    const tg2 = setup();
    grant(tg2, 'just_cd_common');
    grant(tg2, 'just_ult_common');
    expect(justParams(tg2.w, P(tg2)).mult).toBeCloseTo(1.5, 9);
    grant(tg2, 'just_guard_common');
    expect(tagActive(P(tg2), 'just')).toBe(true);
    const j2 = justParams(tg2.w, P(tg2));
    expect(j2.bonus).toBeCloseTo(0.1, 9);
    expect(j2.mult).toBeCloseTo(1.75, 9);
  });
});

// ─────────────────────────── whole runs ───────────────────────────

const TRACK_B_TOP = COMBAT_FAMILIES.map(f => {
  const rs = Object.keys(f.params);
  return `${f.key}_${rs[rs.length - 1]}`;
});

/** Between floors: every seat with cards takes the first one (bots pick on their own when the screen opens). */
function settle(tg: TestGame): void {
  const s = tg.w.state;
  for (let guard = 0; guard < 8 && s.phase === 'reward'; guard++) {
    s.players.forEach((_p, pi) => {
      if (s.rewardOffersByPlayer[pi]) tg.game.dispatch({ type: 'chooseReward', player: pi, offerIndex: 0 });
    });
  }
  if (s.phase === 'goedam') throw new Error('goedam rooms are off in this run');
}

function runAll(seed: number, seconds: number): { hash: string; relic: number; events: Record<string, number> } {
  const tg = makeGame({ seed, players: [BOT1, BOT2, { ...HUMAN, isBot: true, name: '봇3' }], tunables: { goedamRoomsPerZone: 0 }, startFloor: 5 });
  for (const p of tg.w.state.players) for (const id of TRACK_B_TOP) grantReward(tg.w, p, id, null);
  const counts: Record<string, number> = {};
  let relic = 0;
  const n = seconds * 30;
  for (let i = 0; i < n && tg.w.state.phase !== 'runOver'; i++) {
    if (tg.w.state.phase === 'combat') tick(tg.w);
    else settle(tg);
    for (const e of tg.game.drainEvents() as GameEvent[]) {
      if (e.type === 'rewardProc') counts[e.rewardId] = (counts[e.rewardId] ?? 0) + 1;
      if (e.type === 'damage' && e.source === 'relic' && e.targetTeam === 'enemy') relic += e.amount;
      if (e.type === 'damage') expect(Number.isFinite(e.amount)).toBe(true);
    }
  }
  const s = tg.w.state;
  const hash = JSON.stringify([s.time, s.floor, s.entities.map(e => [e.id, Math.round(e.hp * 1000)]), s.players.map(p => [p.stats.damageDealt, p.party.map(m => m.ult.charge)])]);
  return { hash, relic, events: counts };
}

describe('Track B in whole runs', () => {
  it('three bots with every Track B family: no NaN, procs fire, same seed → same run', () => {
    const a = runAll(5, 90);
    const b = runAll(5, 90);
    expect(a.hash).toBe(b.hash);
    expect(a.relic).toBeGreaterThan(0);
    expect(Object.keys(a.events).length).toBeGreaterThan(5);
  });
});

// ─────────────────────────── render ───────────────────────────

describe('Track B reward visuals', () => {
  it('registers once; procs make light rings; marks, scent rings and the overcharge ring draw without errors', async () => {
    const { rewardFxModules, rewardFxEvent, drawRewardFx } = await import('../../src/render/rewardFx');
    const { COMBAT_FX, scentRings } = await import('../../src/render/rewardFx/combat');
    const { Camera } = await import('../../src/render/camera');
    expect(rewardFxModules().filter(m => m === COMBAT_FX).length).toBe(1);
    const tg = setup();
    grant(tg, 'overcharge_legendary');
    const p = P(tg);
    p.party[p.activeIndex!].ult.charge = 1.6;
    const g = spawnAt(tg, 'golem', { x: 8, y: 6 });
    applyStatus(g, 'grudge', 4, 0, 0, 'relic');
    let rings = 0;
    let bursts = 0;
    const host = { ring: () => void rings++, burst: () => void bursts++, flash: () => undefined, shake: () => undefined };
    const view = { cam: null, localPlayer: 0, host, state: tg.w.state };
    rewardFxEvent({ type: 'rewardProc', player: 0, partyIndex: 0, entityId: null, rewardId: 'pet_scent', pos: { x: 5, y: 5 } }, view);
    rewardFxEvent({ type: 'rewardProc', player: 0, partyIndex: 0, entityId: null, rewardId: 'just_counter', pos: { x: 5, y: 5 } }, view);
    rewardFxEvent({ type: 'rewardProc', player: 0, partyIndex: 0, entityId: null, rewardId: 'grudge', pos: { x: 5, y: 5 }, text: '폭발' }, view);
    rewardFxEvent({ type: 'rewardProc', player: 0, partyIndex: 0, entityId: null, rewardId: 'bolt', pos: { x: 5, y: 5 } }, view); // not ours
    expect(scentRings().length).toBe(1);
    expect(rings).toBeGreaterThanOrEqual(3);
    expect(bursts).toBeGreaterThanOrEqual(2);
    let ellipses = 0;
    const noop = () => undefined;
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (k === 'ellipse' ? () => void ellipses++ : noop),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    COMBAT_FX.draw(ctx, tg.w.state, { ...view, cam: new Camera() }, 1);
    expect(ellipses).toBeGreaterThanOrEqual(4); // grudge mark + scent ring + two overcharge rings
    drawRewardFx(ctx, { ...view, cam: new Camera() }, 1);
  });
});
