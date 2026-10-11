// 기획 20차 보스 형태 — 로비·상가 bosses (docs/bosses.md 4-1): 인형 뽑기 기계 (배회) · 혼자 도는 세탁기 (배회) · 지하 7번 노래방 (고정) ·
// 거꾸로 가는 에스컬레이터 (전장).
//   1. the zone table and the shared contract of a new boss (also under the 보스 튜닝 knobs)
//   2. form and body of each boss as docs/bosses.md 4-1 says
//   3. every pattern: the right kind of warning, who it hits — and that the answer its tip gives works (a scripted swap /
//      a drop position avoids it, standing still does not)
//   4. phase skills, groggy, a seeded fight per boss (1 seat that swaps by hand + 2 bots, 8 seeds) that ends without a
//      soft lock, determinism, and a render smoke of every pose of the three bodies and the two floors
// A pattern test hosts the boss silent and frozen (its own skills off), casts one skill by hand — every part with one
// ctx, as the sim does — and reads the damage events. The classic boss of the zone (elevator_keeper) is covered by
// boss-roster / boss-mechanics / the goldens.
import { describe, expect, it } from 'vitest';
import { BOSS_POS } from '../../src/config';
import { BOSSES, BOSS_RAID_BAND, ZONE_BOSSES, getBoss } from '../../src/data';
import { BOSS_FORM } from '../../src/data/bosses';
import { LOBBY_BOSSES } from '../../src/data/bosses/lobby';
import { LOBBY_BOSS_VOICE } from '../../src/audio/synth/bossVoices/lobby';
import type { BossDrawOpts } from '../../src/render/boss';
import { LOBBY_LOOKS, LOBBY_TELE_MOTIF, LOBBY_ZONE_LOOKS } from '../../src/render/bosses/lobby';
import type { BossPose } from '../../src/render/bosses/types';
import { Camera } from '../../src/render/camera';
import { bossFormOf } from '../../src/sim/bossForm';
import { unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { scaleArea } from '../../src/sim/geometry';
import { forceGroggy } from '../../src/sim/groggy';
import { startAction } from '../../src/sim/skills';
import { hasStatus } from '../../src/sim/status';
import type { PendingHit, SimEntity } from '../../src/sim/world';
import type { AreaShape, BossForm, GameEvent, MonsterSkill, PlayerSetup, Telegraph, Tunables, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, active, advance, clearEvents, eventsOf, makeGame, type TestGame } from './helpers';
import { allSkills, bossOf, crossPhase, expectBossContract, inBossBox, raidGame } from './bossRaidHelpers';

const IDS = ['claw_machine', 'washer_drum', 'karaoke_room', 'reverse_escalator'] as const;
type Id = (typeof IDS)[number];

/** docs/bosses.md 1-2 · 4-1: name, form, body radius, HP and attack of the four new bosses (floor 1). */
const TABLE: Record<Id, { name: string; form: BossForm; radius: number; hp: number; atk: number }> = {
  claw_machine: { name: '인형 뽑기 기계', form: 'roaming', radius: 1.7, hp: 8200, atk: 30 },
  washer_drum: { name: '혼자 도는 세탁기', form: 'roaming', radius: 1.6, hp: 8800, atk: 29 },
  karaoke_room: { name: '지하 7번 노래방', form: 'fixed', radius: 3, hp: 8600, atk: 30 },
  reverse_escalator: { name: '거꾸로 가는 에스컬레이터', form: 'arena', radius: 1.3, hp: 9000, atk: 30 },
};

/** docs/bosses.md 4-1: the three skills, the phase skill and the signature of each boss. */
const SKILLS: Record<Id, { base: string[]; phase: string; signature: string }> = {
  claw_machine: { base: ['cm_grab', 'cm_coins', 'cm_prizes'], phase: 'cm_jackpot', signature: 'cm_grab' },
  washer_drum: { base: ['wd_roll', 'wd_suds', 'wd_socks'], phase: 'wd_roll_back', signature: 'wd_roll' },
  karaoke_room: { base: ['kr_mirror', 'kr_beat', 'kr_high_note'], phase: 'kr_mirror_back', signature: 'kr_mirror' },
  reverse_escalator: { base: ['re_lurch', 're_stop', 're_handrail'], phase: 're_lurch_twice', signature: 're_lurch' },
};

/** The fields 기획 20차 added to a boss entry — the zone's classic boss must have none of them. */
const FORM_FIELDS = ['form', 'spawn', 'move', 'spots', 'stage', 'guard', 'trail', 'signature'] as const;

const TWO: PlayerSetup[] = [HUMAN, { ...HUMAN, name: '둘' }];
const THREE: PlayerSetup[] = [...TWO, { ...HUMAN, name: '셋' }];
/** HUMAN's party: 0 가디언 (melee), 1 블레이드 (melee), 2 메이지 (ranged). */
const MAGE = 2;

// ─────────────────────────── helpers ───────────────────────────

/**
 * A fight whose boss does nothing by itself: skills silenced, no basic attacks, standing where the test puts it. Hits
 * land softly (the party is not invincible, so damage events are real) and the boss never dies.
 */
function host(id: Id, tunables: Partial<Tunables> = {}, players: PlayerSetup[] = [HUMAN]): TestGame {
  const tg = raidGame(id, { hpMult: 80, players, tunables: { monsterDmgMult: 0.01, bossGroggyThreshold: 0, ...tunables } });
  silence(tg);
  advance(tg, 1.1); // past the entrance pose
  freeze(tg);
  tg.w.state.projectiles.length = 0;
  clearEvents(tg);
  return tg;
}

/** The boss casts nothing by itself (and has no phase skill coming). */
function silence(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.skillCds = b.rt.skillCds.map(() => 9999);
  b.rt.phase = 99;
}

/** The boss stands still (as if casting) and never swings. */
function freeze(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.lockTime = 9999;
  b.rt.attackCd = 9999;
}

/** Hold a character still at a spot (it no longer walks or attacks). */
function pin(e: SimEntity, pos: Vec2): SimEntity {
  e.pos = { ...pos };
  e.rt.lockTime = 9999;
  return e;
}

function skillOf(id: Id, skillId: string): MonsterSkill {
  const sk = allSkills(getBoss(id)).find(s => s.id === skillId);
  if (!sk) throw new Error(`${id} has no skill ${skillId}`);
  return sk;
}

/** Cast one skill of the boss by hand at `target`: every part with one ctx (one cast), as the sim does. */
function castSkill(tg: TestGame, skillId: string, target?: SimEntity): (PendingHit | null)[] {
  const b = bossOf(tg);
  const sk = skillOf(b.defId as Id, skillId);
  if (target) b.targetId = target.id;
  const ctx = unitCtx(tg.w, b, sk.id, sk.name);
  return [sk.action, ...(sk.extra ?? [])].map(a => startAction(tg.w, ctx, a));
}

/** Swap player 0's field character for party member `index` at `pos`, and hold the new one there. */
function swapTo(tg: TestGame, index: number, pos: Vec2): SimEntity {
  expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: index, pos }).ok, 'the swap is accepted').toBe(true);
  return pin(active(tg), pos);
}

type Damage = Extract<GameEvent, { type: 'damage' }>;
/** Damage events on one unit so far. */
const hitsOn = (tg: TestGame, e: SimEntity): Damage[] => eventsOf(tg, 'damage').filter(d => d.targetId === e.id);
/** Damage events on any character of the party so far. */
const partyHits = (tg: TestGame): Damage[] => eventsOf(tg, 'damage').filter(d => d.targetTeam === 'ally');
const teles = (tg: TestGame): Telegraph[] => tg.w.state.telegraphs.filter(t => t.team === 'enemy');
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a: Vec2, b: Vec2, eps = 1e-6): boolean => dist(a, b) < eps;
const rotOf = (t: Telegraph): number => (t.area as { rot?: number }).rot ?? NaN;

// ─────────────────────────── 1. table and contract ───────────────────────────

describe('로비·상가: the zone table', () => {
  it('has five bosses — the four new ones with data, then the classic boss, which is untouched (no 기획 20차 field)', () => {
    expect(ZONE_BOSSES.lobby).toEqual([...IDS, 'elevator_keeper']);
    for (const id of ZONE_BOSSES.lobby) expect(BOSSES.some(b => b.id === id && b.zone === 'lobby'), id).toBe(true);
    const classic = LOBBY_BOSSES[0];
    expect(classic.id).toBe('elevator_keeper');
    for (const k of FORM_FIELDS) expect(classic[k], `elevator_keeper.${k}`).toBeUndefined();
    expect(classic.radius).toBe(3);
    expect(classic.stationary).toBe(true);
    for (const sk of [...classic.skills, ...(classic.phases ?? []).flatMap(p => p.skills ?? [])]) {
      expect(sk.cycle ?? sk.castMove, `${sk.id}: no 기획 20차 skill field`).toBeUndefined();
      for (const a of [sk.action, ...(sk.extra ?? [])]) {
        expect(a.center, sk.id).not.toBe('arena');
        expect(a.rel ?? a.once ?? a.bound ?? a.relocate ?? a.trail, `${sk.id}: no 기획 20차 part field`).toBeUndefined();
      }
    }
  });

  it.each(IDS)('%s: name, form, body, HP and attack are the table rows; it has a band', id => {
    const def = getBoss(id);
    const row = TABLE[id];
    expect(def.name).toBe(row.name);
    expect(bossFormOf(def)).toBe(row.form);
    expect(def.radius).toBe(row.radius);
    expect(def.stats.maxHp).toBe(row.hp);
    expect(def.stats.atk).toBe(row.atk);
    expect(['early', 'mid', 'late']).toContain(BOSS_RAID_BAND[id]);
  });

  it.each(IDS)('%s: its three skills, phase skill and signature are those of docs/bosses.md 4-1 — and the sound table names exactly them', id => {
    const def = getBoss(id);
    const want = SKILLS[id];
    expect(def.skills.map(s => s.id)).toEqual(want.base);
    expect(def.phases![0].skills!.map(s => s.id)).toEqual([want.phase]);
    expect(def.signature).toBe(want.signature);
    expect(Object.keys(LOBBY_BOSS_VOICE[id].kinds).sort()).toEqual([...want.base, want.phase].sort());
    // every pattern that asks something of the player says so once (the first-time tip); summons have none
    for (const sk of allSkills(def)) {
      const summonOnly = [sk.action, ...(sk.extra ?? [])].every(a => a.summon);
      if (summonOnly) expect(sk.hint, sk.id).toBeUndefined();
      else expect(sk.hint && /[가-힣]/.test(sk.hint), `${sk.id} has a Korean tip`).toBe(true);
    }
  });

  it('the warning-motif table names only skills that exist; no lobby boss leaves a trail', () => {
    const ids = new Set(IDS.flatMap(id => allSkills(getBoss(id)).map(s => s.id)));
    for (const k of Object.keys(LOBBY_TELE_MOTIF)) expect(ids.has(k), k).toBe(true);
    expect(LOBBY_TELE_MOTIF).toMatchObject({ cm_grab: 'pull', re_lurch: 'push', re_stop: 'push', re_lurch_twice: 'push', wd_suds: 'linger', cm_prizes: 'spawn', wd_socks: 'spawn' });
    expect(LOBBY_ZONE_LOOKS).toEqual({});
  });
});

describe('로비·상가: the contract of a new boss', () => {
  it.each(IDS)('%s: shape by form, every skill within 45 s with no idle stretch, phase → phase skill, kill → clear, same seed same fight', id => {
    expectBossContract(id);
  });
});

// 보스 튜닝 (docs/boss-raid.md 4-2, docs/bosses.md 3장): no pattern may depend on the numbers as written.
describe('로비·상가: the contract holds under the boss tuning knobs', () => {
  it.each(IDS)('%s: 예고 ×2, 범위 ×0.5, 이동 ×1.5', id => {
    expectBossContract(id, { bossTelegraphMult: 2, bossAreaMult: 0.5, bossMoveMult: 1.5 });
  });

  it.each(IDS)('%s: 예고 ×0.6, 범위 ×1.5, 이동 ×0.5', id => {
    expectBossContract(id, { bossTelegraphMult: 0.6, bossAreaMult: 1.5, bossMoveMult: 0.5 });
  });
});

// ─────────────────────────── 2. form and body ───────────────────────────

describe('로비·상가: form and body', () => {
  it('인형 뽑기 기계: a roaming body that appears at the left wall (4, 5.5), throws from range 3, and slides after the FARTHEST character along one axis at a time', () => {
    const def = getBoss('claw_machine');
    expect(def.move).toEqual({ mode: 'pursue', target: 'farthest', retarget: 6, axis: true, axisAlternate: true });
    expect(def.stats.range).toBe(3); // 기획 20차 점검: 5 reached everyone from one row — it never took its vertical leg
    expect(def.basic.kind).toBe('projectile');
    const tg = raidGame('claw_machine', { hpMult: 50, players: TWO, tunables: { invincible: true, bossGroggyThreshold: 0 } });
    const b = bossOf(tg);
    expect(b.pos).toEqual({ x: 4, y: 5.5 });
    expect(b.radius).toBe(1.7);
    silence(tg);
    advance(tg, 0.9);
    expect(b.pos, 'it stands for its entrance').toEqual({ x: 4, y: 5.5 });
    // from the top row, so that the far corner needs the column move too (its toss reaches 3 cells)
    b.pos = { x: 4, y: 3 };
    const [close, far] = [pin(active(tg, 0), { x: 5.5, y: 5.5 }), pin(active(tg, 1), { x: 20, y: 11.5 })];
    b.rt.form!.retargetIn = 0;
    advance(tg, 0.4);
    expect(b.targetId).toBe(far.id);
    b.rt.form!.retargetIn = 9999;
    let moved = 0;
    let sawY = false;
    for (let t = 0; t < 8 * 30; t++) {
      const before = { ...b.pos };
      tick(tg.w);
      const dx = Math.abs(b.pos.x - before.x);
      const dy = Math.abs(b.pos.y - before.y);
      expect(dx < 1e-9 || dy < 1e-9, 'one axis at a time').toBe(true);
      if (dy > 1e-9) sawY = true;
      else if (dx > 1e-9) expect(sawY, 'the row first, then the column').toBe(false);
      moved += dx + dy;
      expect(inBossBox(b.pos, 1e-6)).toBe(true);
    }
    expect(moved).toBeGreaterThan(6);
    expect(sawY).toBe(true);
    expect(dist(b.pos, far.pos)).toBeLessThan(dist({ x: 4, y: 3 }, far.pos));
    void close;
  });

  it('혼자 도는 세탁기: a roaming body at (20, 3.5) that rolls up to the FARTHEST character and bumps it (melee), then — picking again every 5 s — turns for the other one: it keeps crossing the party', () => {
    const def = getBoss('washer_drum');
    expect(def.move).toEqual({ mode: 'pursue', target: 'farthest', retarget: 5 });
    expect(def.basic).toEqual({ kind: 'melee', splashRadius: 1.2 });
    const tg = raidGame('washer_drum', { hpMult: 50, players: TWO, tunables: { monsterDmgMult: 0.01, bossGroggyThreshold: 0 } });
    const b = bossOf(tg);
    expect(b.pos).toEqual({ x: 20, y: 3.5 });
    expect(b.rt.heavy).toBe(true);
    silence(tg);
    advance(tg, 1.1);
    const [close, far] = [pin(active(tg, 0), { x: 18, y: 6 }), pin(active(tg, 1), { x: 11, y: 8 })];
    b.rt.form!.retargetIn = 0;
    clearEvents(tg);
    advance(tg, 4.8);
    expect(b.targetId).toBe(far.id);
    expect(dist(b.pos, far.pos), 'it reached the far one').toBeLessThan(b.radius + far.radius + 1);
    expect(hitsOn(tg, far).length, 'and bumps it').toBeGreaterThan(0);
    // now the other one is the farthest: at the next pick it turns round and rolls back
    const before = dist(b.pos, close.pos);
    advance(tg, 2.5);
    expect(b.targetId).toBe(close.id);
    expect(dist(b.pos, close.pos)).toBeLessThan(before - 1);
  });

  it('지하 7번 노래방: fixed — the set piece at the top centre, exactly where a 기획 19차 boss stands, and it never moves', () => {
    const tg = raidGame('karaoke_room', { hpMult: 50, tunables: { invincible: true, bossGroggyThreshold: 0 } });
    const b = bossOf(tg);
    expect(b.pos).toEqual(BOSS_POS);
    expect(b.radius).toBe(3);
    advance(tg, 12);
    expect(b.pos).toEqual(BOSS_POS);
    expect(b.rt.form?.form ?? 'fixed').toBe('fixed');
  });

  it('거꾸로 가는 에스컬레이터: the core 「틈새의 손」 appears on the first point of its path and rides it in order at speed 1, never leaving the box', () => {
    const def = getBoss('reverse_escalator');
    const way = def.move!.waypoints!;
    expect(way).toEqual([{ x: 5, y: 3.5 }, { x: 5, y: 9.5 }, { x: 19, y: 9.5 }, { x: 19, y: 3.5 }]);
    expect(def.stage).toEqual({ floor: 'escalator' });
    const tg = raidGame('reverse_escalator', { hpMult: 50, tunables: { invincible: true, bossGroggyThreshold: 0 } });
    const b = bossOf(tg);
    expect(b.pos).toEqual(way[0]);
    expect(b.radius).toBe(1.3);
    silence(tg);
    const visited: number[] = [];
    let travelled = 0;
    for (let t = 0; t < 30 * 30; t++) {
      const before = { ...b.pos };
      tick(tg.w);
      travelled += dist(b.pos, before);
      expect(inBossBox(b.pos, 1e-6)).toBe(true);
      const at = way.findIndex(p => near(p, b.pos, 0.05));
      if (at >= 0 && visited[visited.length - 1] !== at) visited.push(at);
    }
    expect(visited.slice(0, 4)).toEqual([0, 1, 2, 3]);
    // 29 s of riding at speed 1 (it turns on each corner, so a little less)
    expect(travelled).toBeGreaterThan(22);
    expect(travelled).toBeLessThanOrEqual(29 + 1e-6);
  });
});

// ─────────────────────────── 3. patterns ───────────────────────────

describe('인형 뽑기 기계: patterns', () => {
  const HOME = { x: 12, y: 6 };
  /** A spot in the machine's row, and one on a diagonal (off both its row and its column, outside its slam). */
  const ROW = { x: 17, y: 6 };
  const DIAGONAL = { x: 16, y: 10 };

  it('★ 집게 내리기: a + through the machine pulls whoever stands in its row / column to it (no damage), then the claw hits around the machine; a diagonal spot is neither pulled nor hit', () => {
    const tg = host('claw_machine', {}, TWO);
    const b = bossOf(tg);
    b.pos = { ...HOME };
    const [row, diag] = [pin(active(tg, 0), ROW), pin(active(tg, 1), DIAGONAL)];
    castSkill(tg, 'cm_grab', row);
    const ts = teles(tg);
    expect(ts.map(t => t.area)).toEqual([{ shape: 'cross', length: 10, width: 2.4 }, { shape: 'circle', radius: 3.2 }]);
    expect(ts.every(t => near(t.center, HOME))).toBe(true);
    expect(ts[0].total).toBeCloseTo(1.2, 6);
    expect(ts[1].total).toBeCloseTo(2, 6);
    advance(tg, 1.25);
    expect(partyHits(tg), 'the pull does not hurt').toHaveLength(0);
    expect(row.pos.x, 'dragged up to the machine').toBeLessThan(ROW.x - 2.5);
    expect(dist(row.pos, HOME)).toBeLessThan(3.2);
    expect(diag.pos).toEqual(DIAGONAL);
    expect(b.pos, 'the machine itself never moves').toEqual(HOME);
    advance(tg, 0.8);
    expect(hitsOn(tg, row)).toHaveLength(1);
    expect(hitsOn(tg, diag)).toHaveLength(0);
  });

  it('★ 집게 내리기, the answer: after the pull, swapping to a diagonal spot avoids the claw — swapping onto a spot beside the machine does not', () => {
    for (const [drop, hits] of [[DIAGONAL, 0], [{ x: 14.6, y: 6 }, 1]] as const) {
      const tg = host('claw_machine');
      bossOf(tg).pos = { ...HOME };
      pin(active(tg), ROW);
      castSkill(tg, 'cm_grab', active(tg));
      advance(tg, 1.3); // pulled in; 0.7 s before the claw lands (the appear invulnerability is over by then)
      swapTo(tg, MAGE, drop);
      advance(tg, 0.8);
      expect(partyHits(tg), `dropped at (${drop.x}, ${drop.y})`).toHaveLength(hits);
    }
  });

  it('동전 투입: four lanes out of the machine — right, down, left, up, 0.35 s apart; only its row and column are hit', () => {
    const tg = host('claw_machine', {}, THREE);
    bossOf(tg).pos = { ...HOME };
    const [right, up, diag] = [pin(active(tg, 0), { x: 18, y: 6 }), pin(active(tg, 1), { x: 12, y: 3 }), pin(active(tg, 2), DIAGONAL)];
    castSkill(tg, 'cm_coins', right);
    const ts = teles(tg);
    expect(ts.map(t => (t.area as { dir: string }).dir)).toEqual(['right', 'down', 'left', 'up']);
    expect(ts.map(t => +t.total.toFixed(2))).toEqual([1, 1.35, 1.7, 2.05]);
    for (const t of ts) expect(t.area).toMatchObject({ shape: 'rect', length: 11, width: 2.2 });
    const seen: Record<string, number[]> = { right: [], up: [], diag: [] };
    let n = 0;
    for (let t = 0; t < 2.3 * 30; t++) {
      tick(tg.w);
      const all = eventsOf(tg, 'damage');
      for (; n < all.length; n++) {
        const who = all[n].targetId === right.id ? 'right' : all[n].targetId === up.id ? 'up' : 'diag';
        seen[who].push((t + 1) / 30);
      }
    }
    expect(seen.right).toHaveLength(1);
    expect(seen.right[0]).toBeCloseTo(1, 1);
    expect(seen.up).toHaveLength(1);
    expect(seen.up[0]).toBeCloseTo(2.05, 1);
    expect(seen.diag).toHaveLength(0);
  });

  it('경품 배출: three or four 뽑기 인형 around the machine, no warning to dodge', () => {
    const tg = host('claw_machine');
    bossOf(tg).pos = { ...HOME };
    castSkill(tg, 'cm_prizes', active(tg));
    advance(tg, 0.2);
    const dolls = tg.w.state.entities.filter(e => e.defId === 'prize_doll' && !e.rt.gone);
    expect(dolls.length).toBeGreaterThanOrEqual(3);
    expect(dolls.length).toBeLessThanOrEqual(4);
    for (const d of dolls) expect(dist(d.pos, HOME)).toBeLessThan(5);
  });

  it('잭팟 (페이즈): the diagonals first, the row and column 0.8 s later — a spot between the lines is never hit', () => {
    const tg = host('claw_machine', {}, THREE);
    bossOf(tg).pos = { ...HOME };
    const [diag, row, between] = [pin(active(tg, 0), { x: 15, y: 9 }), pin(active(tg, 1), ROW), pin(active(tg, 2), { x: 17, y: 8 })];
    castSkill(tg, 'cm_jackpot', diag);
    expect(teles(tg).map(t => t.area)).toEqual([{ shape: 'cross', length: 10, width: 2.4, diagonal: true }, { shape: 'cross', length: 10, width: 2.4 }]);
    advance(tg, 1.4);
    expect(hitsOn(tg, diag)).toHaveLength(1);
    expect(hitsOn(tg, row)).toHaveLength(0);
    advance(tg, 0.8);
    expect(hitsOn(tg, diag)).toHaveLength(1);
    expect(hitsOn(tg, row)).toHaveLength(1);
    expect(hitsOn(tg, between)).toHaveLength(0);
  });
});

describe('혼자 도는 세탁기: patterns', () => {
  const START = { x: 4, y: 6 };
  const WALL = { x: BOSS_FORM.box.xMax, y: 6 };

  it('★ 탈수 돌진: the path to the wall is warned as a rush; it hits and shoves whoever is on it, then the 「쿵」 ring around where it stopped spares whoever hugs the washer', () => {
    const tg = host('washer_drum', {}, TWO);
    const b = bossOf(tg);
    b.pos = { ...START };
    const [onPath, off] = [pin(active(tg, 0), { x: 14, y: 6 }), pin(active(tg, 1), { x: 14, y: 10.5 })];
    castSkill(tg, 'wd_roll', onPath);
    // only the rush shows at first: the ring shows for its last 0.9 s, around the spot it will have reached
    expect(teles(tg)).toHaveLength(1);
    const rush = teles(tg)[0];
    expect(rush.motif).toBe('charge');
    // the warning is the path it will really run (to the wall of its box) plus its own body, 3.2 wide
    expect(rush.area).toMatchObject({ shape: 'line', width: 3.2 });
    expect((rush.area as { length: number }).length).toBeCloseTo(WALL.x - START.x + b.radius, 6);
    expect(rush.origin).toEqual(START);
    expect(rush.center, 'it runs to the wall of its box').toEqual(WALL);
    expect(rush.total).toBeCloseTo(1.3, 6);
    advance(tg, 1.35);
    expect(b.pos).toEqual(WALL);
    expect(eventsOf(tg, 'dash').filter(e => e.entityId === b.id)).toHaveLength(1);
    expect(hitsOn(tg, onPath)).toHaveLength(1);
    expect(onPath.pos.x, 'shoved').not.toBe(14);
    expect(hitsOn(tg, off)).toHaveLength(0);
    // the 「쿵」
    const ring = teles(tg);
    expect(ring).toHaveLength(1);
    expect(ring[0].area).toEqual({ shape: 'ring', inner: 3.3, outer: 7 });
    // the hole is wide enough for a melee character fighting the body (reach 0.7 at most, a hit reaches 0.45 into a
    // character) — and the ring is still a ring at 「보스 범위 크기 배율」 ×0.5 (the hole never shrinks)
    expect(b.radius + onPath.radius + 0.7 + onPath.radius).toBeLessThan(3.3);
    expect(scaleArea(ring[0].area, 0.5)).toEqual({ shape: 'ring', inner: 3.3, outer: 3.5 });
    expect(near(ring[0].center, WALL)).toBe(true);
    expect(ring[0].total).toBeLessThanOrEqual(0.9 + 1 / 30 + 1e-6);
    // one hugs the washer, the other stands a few steps away
    pin(onPath, { x: WALL.x - 2.2, y: 6 });
    pin(off, { x: WALL.x - 5, y: 6 });
    clearEvents(tg);
    advance(tg, 1);
    expect(hitsOn(tg, onPath), 'right beside the washer: safe').toHaveLength(0);
    expect(hitsOn(tg, off), 'a few steps away: hit').toHaveLength(1);
  });

  it('★ 탈수 돌진, the answer: standing on the red path is hit; swapping off the path makes the rush whiff', () => {
    for (const dodge of [false, true]) {
      const tg = host('washer_drum');
      bossOf(tg).pos = { ...START };
      pin(active(tg), { x: 14, y: 6 });
      castSkill(tg, 'wd_roll', active(tg));
      advance(tg, 0.6); // 0.7 s before the rush
      if (dodge) swapTo(tg, MAGE, { x: 14, y: 10.5 });
      advance(tg, 0.8);
      expect(partyHits(tg), dodge ? 'swapped off the path' : 'stood still').toHaveLength(dodge ? 0 : 1);
      expect(bossOf(tg).pos, 'the rush runs either way').toEqual(WALL);
    }
  });

  it('★ 탈수 돌진, the second answer: after the bump, a drop right beside the washer is safe from the 「쿵」 — a drop a few steps away is not', () => {
    for (const [drop, hits] of [[{ x: WALL.x - 2.3, y: 6.3 }, 0], [{ x: WALL.x - 5, y: 7 }, 1]] as const) {
      const tg = host('washer_drum');
      bossOf(tg).pos = { ...START };
      pin(active(tg), { x: 14, y: 6 });
      castSkill(tg, 'wd_roll', active(tg));
      advance(tg, 1.45); // it ran over the character and bumped the wall; 0.75 s before the ring
      expect(bossOf(tg).pos).toEqual(WALL);
      clearEvents(tg);
      swapTo(tg, MAGE, drop);
      advance(tg, 0.9);
      expect(partyHits(tg), `dropped at (${drop.x}, ${drop.y})`).toHaveLength(hits);
    }
  });

  it('거품: a puddle that stays 5 s where the target stood; a character left alone walks out of it by itself (rule N8)', () => {
    const tg = host('washer_drum');
    bossOf(tg).pos = { x: 20, y: 4 };
    const me = pin(active(tg), { x: 9, y: 8 });
    castSkill(tg, 'wd_suds', me);
    expect(teles(tg).map(t => t.area)).toEqual([{ shape: 'circle', radius: 2.4 }]);
    expect(near(teles(tg)[0].center, { x: 9, y: 8 })).toBe(true);
    advance(tg, 1);
    const zone = tg.w.state.zones.find(z => z.team === 'enemy')!;
    expect(zone).toMatchObject({ kind: 'damage', radius: 2.4, total: 5 });
    expect(zone.look, 'a plain zone, not a trail').toBeUndefined();
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hasStatus(me, 'slow')).toBe(true);
    me.rt.lockTime = 0; // let it walk
    advance(tg, 2.5);
    expect(dist(me.pos, zone.center), 'it left the puddle').toBeGreaterThan(2.4 + me.radius);
    advance(tg, 2.6);
    expect(tg.w.state.zones.filter(z => z.team === 'enemy')).toHaveLength(0);
  });

  it('한 짝 양말: three or four 외짝 양말 around the washer', () => {
    const tg = host('washer_drum');
    castSkill(tg, 'wd_socks', active(tg));
    advance(tg, 0.2);
    const socks = tg.w.state.entities.filter(e => e.defId === 'lost_sock' && !e.rt.gone);
    expect(socks.length).toBeGreaterThanOrEqual(3);
    expect(socks.length).toBeLessThanOrEqual(4);
  });

  it('역회전 돌진 (페이즈): the same rush, then the opposite — the circle right around the washer; hugging it is hit, standing off is safe', () => {
    const tg = host('washer_drum', {}, TWO);
    const b = bossOf(tg);
    b.pos = { ...START };
    const [hug, away] = [pin(active(tg, 0), { x: 14, y: 6 }), pin(active(tg, 1), { x: 14, y: 10.5 })];
    castSkill(tg, 'wd_roll_back', hug);
    expect(teles(tg)[0].motif).toBe('charge');
    expect(teles(tg)[0].total).toBeCloseTo(1.1, 6);
    advance(tg, 1.15);
    expect(b.pos).toEqual(WALL);
    const landed = { ...b.pos };
    expect(teles(tg).map(t => t.area)).toEqual([{ shape: 'circle', radius: 3.4 }]);
    pin(hug, { x: landed.x - 2.2, y: landed.y });
    pin(away, { x: landed.x - 5, y: landed.y });
    clearEvents(tg);
    advance(tg, 1);
    expect(hitsOn(tg, hug)).toHaveLength(1);
    expect(hitsOn(tg, away)).toHaveLength(0);
  });
});

describe('지하 7번 노래방: patterns', () => {
  const PIVOT = { x: 12, y: 6 };
  /** Straight above the pivot: only the 90° strip (the 4th step) reaches it. */
  const ABOVE = { x: 12, y: 1 };

  it('★ 미러볼: one strip through the arena centre turns clockwise in six steps of 30°, each showing for its last 0.9 s as one moving line; a character is hit when it arrives — once', () => {
    const tg = host('karaoke_room', {}, TWO);
    const [above, mid] = [pin(active(tg, 0), ABOVE), pin(active(tg, 1), { x: 12.2, y: 6.2 })];
    castSkill(tg, 'kr_mirror', above);
    expect(teles(tg), 'the first strip shows 0.6 s in').toHaveLength(0);
    const seen: number[] = [];
    let aboveAt = -1;
    for (let t = 0; t < 4.2 * 30; t++) {
      tick(tg.w);
      for (const tele of teles(tg)) {
        expect(tele.motif).toBe('sweep');
        expect(tele.area).toMatchObject({ shape: 'rect', length: 22, width: 1.8, anchor: 'center' });
        expect(near(tele.center, PIVOT)).toBe(true);
        expect(tele.total).toBeLessThanOrEqual(0.9 + 1 / 30 + 1e-6);
        if (!seen.includes(rotOf(tele))) seen.push(rotOf(tele));
      }
      if (aboveAt < 0 && hitsOn(tg, above).length > 0) aboveAt = (t + 1) / 30;
    }
    expect(seen, 'clockwise').toEqual([0, 30, 60, 90, 120, 150]);
    expect(aboveAt).toBeCloseTo(1.5 + 3 * 0.45, 1);
    expect(hitsOn(tg, above)).toHaveLength(1);
    expect(hitsOn(tg, mid), 'at the pivot every strip covers it — still one hit').toHaveLength(1);
    expect(teles(tg)).toHaveLength(0);
  });

  it('★ 미러볼, the answer: standing still is hit when the beam comes round; swapping to where it has already passed is not', () => {
    for (const dodge of [false, true]) {
      const tg = host('karaoke_room');
      pin(active(tg), ABOVE);
      castSkill(tg, 'kr_mirror', active(tg));
      advance(tg, 2.05); // the 0° and 30° strips have landed
      if (dodge) swapTo(tg, MAGE, { x: 5, y: 6 }); // on the 0° line: the beam is past it
      advance(tg, 2.2);
      expect(partyHits(tg), dodge ? 'swapped behind the beam' : 'stood still').toHaveLength(dodge ? 0 : 1);
    }
  });

  it('박자: the same spot three times, 0.5 s apart; leaving after the first beat (a swap to another spot) skips the other two', () => {
    for (const dodge of [false, true]) {
      const tg = host('karaoke_room');
      const me = pin(active(tg), { x: 8, y: 8 });
      castSkill(tg, 'kr_beat', me);
      expect(teles(tg).map(t => +t.total.toFixed(2))).toEqual([1.2, 1.7, 2.2]);
      for (const t of teles(tg)) expect(t.area).toEqual({ shape: 'circle', radius: 2 });
      advance(tg, 1.25);
      expect(hitsOn(tg, me)).toHaveLength(1);
      if (dodge) swapTo(tg, MAGE, { x: 16, y: 8 });
      advance(tg, 1.1);
      expect(partyHits(tg)).toHaveLength(dodge ? 1 : 3);
    }
  });

  it('고음: a fan from the boss toward its target, then 「간주」 — the boss itself is vulnerable (+30 %) for 4 s (rule M1: a yellow ring, not a danger)', () => {
    const tg = host('karaoke_room', {}, TWO);
    const b = bossOf(tg);
    const [target, side] = [pin(active(tg, 0), { x: 12, y: 8 }), pin(active(tg, 1), { x: 3, y: 4 })];
    castSkill(tg, 'kr_high_note', target);
    const ts = teles(tg);
    expect(ts.map(t => t.area.shape)).toEqual(['fan', 'circle']);
    expect(ts[0].self).toBeUndefined();
    expect(ts[1].self).toBe(true);
    advance(tg, 1.55);
    expect(hitsOn(tg, target)).toHaveLength(1);
    expect(hitsOn(tg, side)).toHaveLength(0);
    advance(tg, 0.1);
    expect(hasStatus(b, 'vulnerable')).toBe(true);
    advance(tg, 3.8);
    expect(hasStatus(b, 'vulnerable')).toBe(true);
    advance(tg, 0.4);
    expect(hasStatus(b, 'vulnerable')).toBe(false);
  });

  it('앙코르 미러볼 (페이즈): a cross of two strips turns the OTHER way in three steps; still one hit per cast', () => {
    const tg = host('karaoke_room', {}, TWO);
    const [above, mid] = [pin(active(tg, 0), ABOVE), pin(active(tg, 1), { x: 12.2, y: 6.2 })];
    castSkill(tg, 'kr_mirror_back', above);
    const steps: string[] = [];
    const aboveAt = (() => {
      let at = -1;
      for (let t = 0; t < 3 * 30; t++) {
        tick(tg.w);
        // the pairs that are up together (two strips land on the same tick: the two arms of one step)
        const byLanding = new Map<number, number[]>();
        for (const tele of teles(tg)) {
          expect(tele.motif).toBe('sweep');
          expect(tele.area).toMatchObject({ shape: 'rect', length: 22, width: 1.6 });
          const key = Math.round(tele.remaining * 30);
          byLanding.set(key, [...(byLanding.get(key) ?? []), rotOf(tele)]);
        }
        for (const pair of byLanding.values()) {
          const s = pair.sort((a, c) => a - c).join(',');
          if (!steps.includes(s)) steps.push(s);
        }
        if (at < 0 && hitsOn(tg, above).length > 0) at = (t + 1) / 30;
      }
      return at;
    })();
    expect(steps, 'counter-clockwise, two arms a step').toEqual(['0,90', '-30,60', '-60,30']);
    expect(aboveAt, 'the 90° arm of the first step').toBeCloseTo(1.3, 1);
    expect(hitsOn(tg, above)).toHaveLength(1);
    expect(hitsOn(tg, mid)).toHaveLength(1);
  });
});

describe('거꾸로 가는 에스컬레이터: patterns', () => {
  const WHOLE: AreaShape = { shape: 'rect', dir: 'right', anchor: 'center', length: 24, width: 12 };
  const UPPER = { x: 10, y: 4 };
  const LOWER = { x: 14, y: 8 };

  it('★ 덜컹: the whole staircase shoves everyone 3.5 down (no damage, the core does not budge), then the bottom row bites — who started in the upper half is not in it', () => {
    const tg = host('reverse_escalator', {}, TWO);
    const b = bossOf(tg);
    const core = { ...b.pos };
    const [upper, lower] = [pin(active(tg, 0), UPPER), pin(active(tg, 1), LOWER)];
    castSkill(tg, 're_lurch', upper);
    const ts = teles(tg);
    expect(ts.map(t => t.area)).toEqual([WHOLE, { ...WHOLE, width: 2.4 }]);
    expect(ts[0].center).toEqual({ x: 12, y: 6 });
    expect(ts[1].center.y, 'the bottom row: y 9.6–12').toBeCloseTo(10.8, 9);
    expect(ts.map(t => +t.total.toFixed(2))).toEqual([1.2, 2]);
    advance(tg, 1.25);
    expect(partyHits(tg)).toHaveLength(0);
    expect(upper.pos).toEqual({ x: 10, y: 7.5 });
    expect(lower.pos.x).toBe(14);
    expect(lower.pos.y).toBeGreaterThan(11);
    expect(b.pos, 'the core is heavy').toEqual(core);
    advance(tg, 0.8);
    expect(hitsOn(tg, upper)).toHaveLength(0);
    expect(hitsOn(tg, lower)).toHaveLength(1);
    expect(hasStatus(lower, 'stun')).toBe(true);
  });

  it('★ 덜컹, the answer: a character standing in the lower half is carried into the gap; one swapped in up the stairs — or swapped in at the last moment, which is not shoved at all — is not', () => {
    // stood still in the lower half
    const still = host('reverse_escalator');
    pin(active(still), LOWER);
    castSkill(still, 're_lurch', active(still));
    advance(still, 2.1);
    expect(partyHits(still)).toHaveLength(1);
    // position: swapped to the upper half well before the shove
    const up = host('reverse_escalator');
    pin(active(up), LOWER);
    castSkill(up, 're_lurch', active(up));
    advance(up, 0.4);
    const fresh = swapTo(up, MAGE, UPPER);
    advance(up, 1.7);
    expect(fresh.pos.y, 'shoved, but not into the bottom row').toBeCloseTo(7.5, 6);
    expect(partyHits(up)).toHaveLength(0);
    // timing: swapped 0.2 s before the shove — 저스트 교대, and the newcomer is still untouchable when the stairs lurch
    const late = host('reverse_escalator');
    pin(active(late), LOWER);
    castSkill(late, 're_lurch', active(late));
    advance(late, 1);
    clearEvents(late);
    const just = swapTo(late, MAGE, { x: 14, y: 7 });
    expect(eventsOf(late, 'justSwap')).toHaveLength(1);
    advance(late, 1.1);
    expect(just.pos, 'not shoved').toEqual({ x: 14, y: 7 });
    expect(partyHits(late)).toHaveLength(0);
  });

  it('비상정지: the other way — everyone 3.5 up, then the top row; the lower half is safe', () => {
    const tg = host('reverse_escalator', {}, TWO);
    const [upper, lower] = [pin(active(tg, 0), UPPER), pin(active(tg, 1), LOWER)];
    castSkill(tg, 're_stop', upper);
    expect(teles(tg).map(t => t.area)).toEqual([WHOLE, { ...WHOLE, width: 2.4 }]);
    expect(teles(tg)[1].center.y, 'the top row: y 0–2.4').toBeCloseTo(1.2, 9);
    advance(tg, 1.25);
    expect(upper.pos.y).toBeLessThan(1);
    expect(lower.pos).toEqual({ x: 14, y: 4.5 });
    advance(tg, 0.8);
    expect(hitsOn(tg, upper)).toHaveLength(1);
    expect(hitsOn(tg, lower)).toHaveLength(0);
  });

  it('손잡이: the two side bands (x 0–3, then x 21–24 0.3 s later) hit and push 3 toward the middle; the middle is untouched', () => {
    const tg = host('reverse_escalator', {}, THREE);
    const [left, right, mid] = [pin(active(tg, 0), { x: 1.5, y: 6 }), pin(active(tg, 1), { x: 22.5, y: 7 }), pin(active(tg, 2), { x: 12, y: 8 })];
    castSkill(tg, 're_handrail', mid);
    const ts = teles(tg);
    expect(ts.map(t => t.area)).toEqual([{ ...WHOLE, length: 3 }, { ...WHOLE, length: 3 }]);
    expect(ts.map(t => t.center.x)).toEqual([1.5, 22.5]);
    expect(ts.map(t => +t.total.toFixed(2))).toEqual([1.3, 1.6]);
    advance(tg, 1.35);
    expect(hitsOn(tg, left)).toHaveLength(1);
    expect(hitsOn(tg, right)).toHaveLength(0);
    advance(tg, 0.3);
    expect(hitsOn(tg, right)).toHaveLength(1);
    expect(hitsOn(tg, mid)).toHaveLength(0);
    expect(left.pos).toEqual({ x: 4.5, y: 6 });
    expect(right.pos).toEqual({ x: 19.5, y: 7 });
    expect(mid.pos).toEqual({ x: 12, y: 8 });
  });

  it('연속 덜컹 (페이즈): two shoves of 3, then the bottom row and a half (y 8.4–12) — only the top stair is far enough up', () => {
    const tg = host('reverse_escalator', {}, TWO);
    const [top, second] = [pin(active(tg, 0), { x: 10, y: 1.5 }), pin(active(tg, 1), { x: 14, y: 4 })];
    castSkill(tg, 're_lurch_twice', top);
    const ts = teles(tg);
    expect(ts.map(t => t.area)).toEqual([WHOLE, WHOLE, { ...WHOLE, width: 2.4 * 1.5 }]);
    expect(ts.map(t => +t.total.toFixed(2))).toEqual([1.1, 1.9, 2.7]);
    expect(ts[2].center.y).toBeCloseTo(10.2, 9);
    advance(tg, 1.15);
    expect(top.pos.y).toBeCloseTo(4.5, 9);
    advance(tg, 0.8);
    expect(top.pos.y).toBeCloseTo(7.5, 9);
    expect(second.pos.y).toBeCloseTo(10, 9);
    advance(tg, 0.8);
    expect(hitsOn(tg, top)).toHaveLength(0);
    expect(hitsOn(tg, second)).toHaveLength(1);
    expect(hasStatus(second, 'stun')).toBe(true);
  });
});

// ─────────────────────────── 4. phase, groggy, fights ───────────────────────────

describe('로비·상가: phase', () => {
  /** What the first warning of the phase skill looks like. */
  const FIRST: Record<Id, (t: Telegraph) => void> = {
    claw_machine: t => expect(t.area).toMatchObject({ shape: 'cross', diagonal: true }),
    washer_drum: t => expect(t.motif).toBe('charge'),
    karaoke_room: t => expect(t.motif).toBe('sweep'),
    reverse_escalator: t => expect(t.area).toMatchObject({ shape: 'rect', length: 24, width: 12 }),
  };

  it.each(IDS)('%s: under half HP it names its phase once and then casts the phase skill — the first warning is the phase pattern', id => {
    const def = getBoss(id);
    const ph = def.phases![0];
    const tg = raidGame(id, { hpMult: 50, tunables: { invincible: true, bossGroggyThreshold: 0 } });
    advance(tg, 1.1);
    const b = bossOf(tg);
    b.rt.skillCds = b.rt.skillCds.map(() => 9999); // only the phase skill is due
    clearEvents(tg);
    crossPhase(tg);
    const named = eventsOf(tg, 'bossPhase');
    expect(named).toHaveLength(1);
    expect(named[0].name).toBe(ph.name);
    let first: Telegraph | undefined;
    let castAt = -1;
    for (let t = 0; t < 6 * 30 && !first; t++) {
      tick(tg.w);
      if (castAt < 0 && eventsOf(tg, 'skillCast').some(e => e.skillId === SKILLS[id].phase)) castAt = (t + 1) / 30;
      if (castAt >= 0) first = teles(tg).find(x => !x.self);
    }
    expect(castAt, 'the phase skill comes about 1.5 s after the phase starts').toBeGreaterThan(1);
    expect(castAt).toBeLessThan(4.5);
    expect(first, 'a warning').toBeDefined();
    FIRST[id](first!);
    crossPhase(tg);
    expect(eventsOf(tg, 'bossPhase'), 'named only once').toHaveLength(1);
  });
});

describe('로비·상가: groggy', () => {
  const GROGGY: Partial<Tunables> = { bossGroggyThreshold: 100 };

  it('혼자 도는 세탁기: knocked down during the wind-up of 탈수 돌진 — the rush never comes, no ring, and it lies where it stood', () => {
    const tg = host('washer_drum', GROGGY);
    const b = bossOf(tg);
    b.pos = { x: 4, y: 6 };
    const me = pin(active(tg), { x: 14, y: 6 });
    castSkill(tg, 'wd_roll', me);
    advance(tg, 0.6);
    b.rt.lockTime = 0;
    expect(forceGroggy(tg.w)).toBe(true);
    advance(tg, 2.5);
    expect(b.pos).toEqual({ x: 4, y: 6 });
    expect(eventsOf(tg, 'dash').filter(e => e.entityId === b.id)).toHaveLength(0);
    expect(teles(tg)).toHaveLength(0);
    expect(partyHits(tg)).toHaveLength(0);
  });

  it.each(['claw_machine', 'washer_drum', 'reverse_escalator'] as const)('%s: a moving body stops while it is down and moves again afterwards', id => {
    const tg = raidGame(id, { hpMult: 80, players: TWO, tunables: { invincible: true, ...GROGGY } });
    silence(tg);
    advance(tg, 1.1);
    const b = bossOf(tg);
    pin(active(tg, 0), { x: 3, y: 10.5 });
    pin(active(tg, 1), { x: 21, y: 10.5 });
    advance(tg, 1.5);
    expect(forceGroggy(tg.w)).toBe(true);
    advance(tg, 0.2);
    const down = { ...b.pos };
    const facing = b.facing;
    advance(tg, 2);
    expect(tg.w.state.bossGroggy!.left).toBeGreaterThan(0);
    expect(b.pos).toEqual(down);
    expect(b.facing).toBe(facing);
    let moved = 0;
    for (let t = 0; t < 14 * 30; t++) {
      const before = { ...b.pos };
      tick(tg.w);
      moved += dist(b.pos, before);
    }
    expect(tg.w.state.bossGroggy!.left).toBe(0);
    expect(moved, 'up and moving again').toBeGreaterThan(1);
  });

  it('지하 7번 노래방: knocked down during 고음 — neither the fan nor the 「간주」 lands (its own wind-up is broken); a 미러볼 turn is cut off where it was', () => {
    const tg = host('karaoke_room', GROGGY);
    const b = bossOf(tg);
    const me = pin(active(tg), { x: 12, y: 8 });
    castSkill(tg, 'kr_high_note', me);
    advance(tg, 0.5);
    b.rt.lockTime = 0;
    expect(forceGroggy(tg.w)).toBe(true);
    advance(tg, 2);
    expect(partyHits(tg)).toHaveLength(0);
    expect(hasStatus(b, 'vulnerable')).toBe(false);
    expect(teles(tg)).toHaveLength(0);

    const beam = host('karaoke_room', GROGGY);
    pin(active(beam), { x: 12, y: 1 }); // the 90° strip would reach it at 2.85 s
    castSkill(beam, 'kr_mirror', active(beam));
    advance(beam, 1.7);
    bossOf(beam).rt.lockTime = 0;
    expect(forceGroggy(beam.w)).toBe(true);
    advance(beam, 3);
    expect(partyHits(beam)).toHaveLength(0);
    expect(teles(beam)).toHaveLength(0);
  });
});

/**
 * A raid fight with one seat that swaps by hand (every 4 s: the next card the game accepts, dropped 3 cells off the
 * boss on a diagonal) and two bots. Returns how it ended, a digest of the last public state, and what went wrong.
 */
function playFight(id: Id, seed: number, seconds = 240): { end: 'clear' | 'lost' | 'open'; seconds: number; digest: string; problems: string[] } {
  // the mode's own knobs (BOSS_RAID hp / attack): the fight a player gets
  const tg = makeGame({ seed, players: [HUMAN, BOT1, BOT2], mode: 'bossRaid', bossRaid: { onlyBoss: id } });
  const s = tg.w.state;
  const boss = bossOf(tg);
  const problems: string[] = [];
  const say = (p: string): void => {
    if (!problems.includes(p)) problems.push(p);
  };
  let end: 'clear' | 'lost' | 'open' = 'open';
  let next = 1;
  let quietFor = 0;
  let hp = boss.hp;
  let t = 0;
  for (; t < seconds * 30; t++) {
    tick(tg.w);
    const events = tg.game.drainEvents();
    if (events.some(e => e.type === 'floorClear')) {
      end = 'clear';
      break;
    }
    if (s.phase !== 'combat') {
      end = 'lost';
      break;
    }
    for (const e of s.entities) if (!e.rt.gone && !(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y))) say(`${e.defId}: position is not a number`);
    if (boss.rt.form && !inBossBox(boss.pos, 1e-3)) say(`boss outside its box (${boss.pos.x.toFixed(2)}, ${boss.pos.y.toFixed(2)})`);
    quietFor = boss.hp < hp - 1e-9 || boss.invulnTime > 0 ? 0 : quietFor + 1 / 30;
    hp = boss.hp;
    if (quietFor > 15) say('nobody hurt the boss for 15 s');
    if (t % 120 === 119) {
      const side = (t / 120) % 2 < 1 ? 1 : -1;
      const pos = tg.game.clampToArena({ x: boss.pos.x + 2.2 * side, y: Math.max(1, boss.pos.y) + 2.2 });
      for (let k = 0; k < 3; k++) {
        const index = (next + k) % 3;
        if (tg.game.dispatch({ type: 'swap', player: 0, partyIndex: index, pos }).ok) {
          next = index + 1;
          break;
        }
      }
    }
  }
  const pub = JSON.stringify(s, (k, v) => (k === 'rt' ? undefined : v));
  let h = 2166136261;
  for (let i = 0; i < pub.length; i++) h = Math.imul(h ^ pub.charCodeAt(i), 16777619) >>> 0;
  return { end, seconds: (t + 1) / 30, digest: `${h}:${s.tick}`, problems };
}

describe('로비·상가: a whole fight ends', () => {
  const SEEDS = [3, 11, 20, 42, 77, 101, 256, 999];

  it.each(IDS)('%s: 8 seeds with one hand-swapping seat and two bots — every fight ends (clear or lost) inside 240 s, nothing leaves the arena, the boss can always be hurt', id => {
    let clears = 0;
    for (const seed of SEEDS) {
      const r = playFight(id, seed);
      expect(r.problems, `${id} seed ${seed}`).toEqual([]);
      expect(r.end, `${id} seed ${seed}: the fight ended`).not.toBe('open');
      if (r.end === 'clear') clears++;
    }
    // rough only (no fine balance this round): the party wins at least some of them
    expect(clears, `${id}: clears out of ${SEEDS.length}`).toBeGreaterThanOrEqual(2);
  });

  it.each(IDS)('%s: the same seed and the same swaps give the same fight', id => {
    const a = playFight(id, 20, 60);
    const b = playFight(id, 20, 60);
    expect(a.digest).toBe(b.digest);
    expect(a.seconds).toBe(b.seconds);
    expect(playFight(id, 21, 60).digest).not.toBe(a.digest);
  });
});

// ─────────────────────────── render smoke ───────────────────────────

interface Rec {
  ctx: CanvasRenderingContext2D;
  total: number;
  texts: number;
  bad: string[];
  banned: string[];
}

/** A recording 2D context: counts calls, flags text, gradients, shadowBlur and numbers that are not finite. */
function recorder(): Rec {
  const store: Record<string | symbol, unknown> = { globalAlpha: 1 };
  const rec: Rec = { ctx: null as unknown as CanvasRenderingContext2D, total: 0, texts: 0, bad: [], banned: [] };
  rec.ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const name = String(prop);
      return (...args: unknown[]) => {
        rec.total++;
        if (name === 'fillText' || name === 'strokeText') rec.texts++;
        if (name === 'createLinearGradient' || name === 'createRadialGradient') rec.banned.push(name);
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) rec.bad.push(`${name}(${args.join(',')})`);
        return undefined;
      };
    },
    set(target, prop, value) {
      if (prop === 'shadowBlur') rec.banned.push('shadowBlur');
      if (typeof value === 'number' && !Number.isFinite(value)) rec.bad.push(`${String(prop)}=${value}`);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return rec;
}

describe('로비·상가: looks', () => {
  const BASE: BossDrawOpts = { color: '#888888', time: 0, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
  const POSES: BossPose[] = ['idle', 'walk', 'windup', 'attack', 'groggy'];
  const BODIES = ['claw_machine', 'washer_drum', 'reverse_escalator'] as const;

  it('the three moving bosses have a body, the fixed one keeps its set piece; the two "the place is the boss" fights have a floor', () => {
    for (const id of BODIES) expect(LOBBY_LOOKS[id].body, id).toBeDefined();
    expect(LOBBY_LOOKS.karaoke_room.body).toBeUndefined();
    expect(LOBBY_LOOKS.reverse_escalator.stage?.tone).toBe('dark');
    expect(LOBBY_LOOKS.karaoke_room.stage?.tone).toBe('dark');
    expect(LOBBY_LOOKS.claw_machine.stage ?? LOBBY_LOOKS.washer_drum.stage).toBeUndefined();
    // about half the old set piece (radius 3 ≈ 6 cells across): a body is under 3 cells wide and tall
    for (const id of BODIES) {
      const body = LOBBY_LOOKS[id].body!;
      expect(body.w, id).toBeLessThanOrEqual(3);
      expect(body.h, id).toBeLessThanOrEqual(2.8);
      expect(body.w, id).toBeGreaterThanOrEqual(getBoss(id).radius * 1.5);
    }
  });

  it.each(BODIES)('%s: every pose through its whole range, calm / phase 2 / enraged — ≤ 220 calls, no text, no gradient, finite numbers', id => {
    const body = LOBBY_LOOKS[id].body!;
    const rec = recorder();
    let frames = 0;
    for (const pose of POSES) {
      for (const extra of [{}, { phase: 2 }, { enraged: true, flash: 1 }] as Partial<BossDrawOpts>[]) {
        for (let f = 0; f <= 10; f++) {
          rec.total = 0;
          const o: BossDrawOpts = { ...BASE, ...extra, time: 0.7 + f * 0.13, groggy: pose === 'groggy' ? f / 10 : 0, charge: pose === 'windup' ? f / 10 : 0 };
          body.draw(rec.ctx, { fx: 0, fy: pose === 'walk' ? -3 : 0, w: body.w * 53.33, h: body.h * 53.33, s: 1, pose, p: f / 10, stride: (f * 0.17) % 1, time: o.time, facing: 0 }, o);
          expect(rec.total, `${id} ${pose} ${f}`).toBeGreaterThan(10);
          expect(rec.total, `${id} ${pose} ${f}`).toBeLessThanOrEqual(220);
          expect((rec.ctx as unknown as { globalAlpha: number }).globalAlpha, 'it puts the alpha back').toBe(1);
          frames++;
        }
      }
    }
    expect(frames).toBe(5 * 3 * 11);
    expect(rec.texts).toBe(0);
    expect(rec.banned).toEqual([]);
    expect(rec.bad).toEqual([]);
  });

  it('the floors: the staircase and the mirror-ball light bake for both phases; their moving parts stay under 40 calls a frame', () => {
    const cam = new Camera();
    cam.setArena(24, 12);
    for (const id of ['reverse_escalator', 'karaoke_room'] as const) {
      const stage = LOBBY_LOOKS[id].stage!;
      const rec = recorder();
      for (const phase of [1, 2]) stage.bake(rec.ctx, { wPx: 1280, hPx: 352, cellX: 1280 / 24, cellY: 352 / 12, phase });
      expect(rec.total, `${id} bake`).toBeGreaterThan(20);
      for (const extra of [{}, { phase: 2 }, { groggy: 1 }, { charge: 1, enraged: true }] as Partial<BossDrawOpts>[]) {
        for (let f = 0; f < 20; f++) {
          rec.total = 0;
          stage.live!(rec.ctx, cam, { ...BASE, ...extra }, f * 0.21);
          expect(rec.total, `${id} live`).toBeGreaterThan(3);
          expect(rec.total, `${id} live`).toBeLessThanOrEqual(40);
        }
      }
      expect(rec.texts).toBe(0);
      expect(rec.banned).toEqual([]);
      expect(rec.bad).toEqual([]);
    }
  });

  it.each(BODIES)('%s: the groggy sign is screen-aligned text (a prop), never part of the mirrored body', id => {
    const cam = new Camera();
    cam.setArena(24, 12);
    const rec = recorder();
    LOBBY_LOOKS[id].props!(rec.ctx, cam, 12, 6, getBoss(id).radius, { ...BASE, groggy: 1, time: 1 });
    expect(rec.texts).toBe(1);
    expect(rec.bad).toEqual([]);
  });
});
