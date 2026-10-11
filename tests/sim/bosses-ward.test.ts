// 기획 20차 보스 형태 — 폐병동 bosses (docs/bosses.md 4-3): 번호 없는 서랍 (고정형) · 투시 촬영기 (자리 이동형) ·
// 멈추지 않는 제세동기 (배회형) · 빈 병상 행렬 (배회형).
// The zone table and each boss's form / body numbers, the shared contract of a new boss (also under the 보스 튜닝 knobs),
// every pattern as a small fight — the right kind of warning, standing still is hit, the swap / drop its tip names is
// not — phase / enrage / groggy, a seeded fight with one direct-swap seat and two bots, determinism, and the looks
// (bodies in every pose, floor art, the 빈 침대, voices).
// How a pattern test works: soft('<id>') = a fight whose boss casts nothing by itself and whose hits land softly (real
// damage events); castSkill() starts every part of one real skill as ONE cast (like the boss would).
import { describe, expect, it } from 'vitest';
import { BOSS_VOICE } from '../../src/audio/synth/bossVoices';
import { DEFAULT_TUNABLES } from '../../src/config';
import { BOSSES, BOSS_RAID_BAND, BOSS_UNITS, ZONE_BOSSES, getBoss, getMonster } from '../../src/data';
import { BOSS_FORM, ENRAGE } from '../../src/data/bosses';
import { WARD_BOSSES, WARD_UNITS } from '../../src/data/bosses/ward';
import type { BossDrawOpts } from '../../src/render/boss';
import { BOSS_TELE_MOTIF, BOSS_ZONE_LOOKS, MINION_LOOKS, bossLook } from '../../src/render/bosses';
import { bossBody, drawBossBody, newBodyAnim, stepBodyAnim } from '../../src/render/bosses/body';
import type { BossPose } from '../../src/render/bosses/types';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y } from '../../src/render/camera';
import { bossFormOf, spotFacing } from '../../src/sim/bossForm';
import { unitCtx } from '../../src/sim/ctx';
import { tick } from '../../src/sim/game';
import { areaDir, hitsArea } from '../../src/sim/geometry';
import { groggyMax } from '../../src/sim/groggy';
import { justCue } from '../../src/sim/justSwap';
import { startAction } from '../../src/sim/skills';
import { effStats } from '../../src/sim/stats';
import { applyStatus, hasStatus, statusValue } from '../../src/sim/status';
import { monsterCdMult } from '../../src/sim/units';
import type { PendingHit, SimEntity } from '../../src/sim/world';
import type { AreaShape, BossForm, GameEvent, MonsterSkill, PlayerSetup, Telegraph, Tunables, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, HUMAN2, active, advance, clearEvents, drain, eventsOf, type TestGame } from './helpers';
import { allSkills, bossOf, crossPhase, expectBossContract, inBossBox, partsOf, raidGame } from './bossRaidHelpers';

const IDS = ['morgue_drawers', 'xray_machine', 'defibrillator', 'empty_beds'] as const;
type Id = (typeof IDS)[number];
const MOVING: Id[] = ['xray_machine', 'defibrillator', 'empty_beds'];
const CALM = { invincible: true, bossGroggyThreshold: 0 } as const;
/** A character's body radius, roughly. */
const R = 0.45;
const SOFT = 0.01;
const THIRD: PlayerSetup = { ...HUMAN, name: '셋' };
/** The party index of the mage in HUMAN (a swap that brings in a character who stays where it is dropped). */
const MAGE = 2;

type Cast = Extract<GameEvent, { type: 'skillCast' }>;

/** docs/bosses.md 1-2 · 4-3: name, form, body radius, HP, attack, attack speed and groggy of the four new bosses (floor 1). */
const TABLE: Record<Id, { name: string; form: BossForm; radius: number; hp: number; atk: number; atkSpeed: number; groggy: number; signature: string }> = {
  morgue_drawers: { name: '번호 없는 서랍', form: 'fixed', radius: 3, hp: 7600, atk: 30, atkSpeed: 0.5, groggy: 0.9, signature: 'md_order' },
  xray_machine: { name: '투시 촬영기', form: 'relocating', radius: 1.8, hp: 7800, atk: 28, atkSpeed: 0.55, groggy: 1, signature: 'xr_scan' },
  defibrillator: { name: '멈추지 않는 제세동기', form: 'roaming', radius: 1.6, hp: 6800, atk: 30, atkSpeed: 0.5, groggy: 1, signature: 'df_clear' },
  empty_beds: { name: '빈 병상 행렬', form: 'roaming', radius: 1.5, hp: 8000, atk: 30, atkSpeed: 0.5, groggy: 1, signature: 'eb_procession' },
};

/** Per skill [cooldown, first use] and the phase [name, HP line, attack speed ×, cooldown ×] (docs/bosses.md 4-3). */
const SKILLS: Record<Id, { skills: Record<string, [number, number]>; phase: [string, number, number | undefined, number] }> = {
  morgue_drawers: { skills: { md_order: [13, 4], md_frost: [11, 8], md_wake: [15, 7], md_reverse: [13, 1.5] }, phase: ['전원 개방', 0.5, 1.1, 0.85] },
  xray_machine: { skills: { xr_scan: [12, 4], xr_rail: [14, 9], xr_develop: [11, 6.5], xr_scan_back: [13, 1.5] }, phase: ['과다 노출', 0.5, undefined, 0.85] },
  defibrillator: { skills: { df_clear: [11, 4], df_paddles: [10, 7], df_revive: [18, 10], df_double: [12, 1.5] }, phase: ['재충전', 0.45, 1.15, 0.85] },
  empty_beds: { skills: { eb_rush: [9, 4], eb_procession: [16, 8], eb_sheet: [11, 6], eb_pileup: [10, 1.5] }, phase: ['연쇄 추돌', 0.5, undefined, 0.8] },
};

/** The one-line tips of docs/bosses.md 4-3 (the first time a pattern is used). */
const TIPS: Record<string, string> = {
  md_order: '번호 없는 칸으로 교체하세요',
  md_reverse: '이번엔 아래부터 — 왼쪽 위가 안전',
  xr_scan: '줄이 지나간 쪽으로 교체하세요',
  xr_rail: '자리를 옮기면 줄 방향도 바뀌어요',
  xr_develop: '뼈가 찍힌 캐릭터는 빼세요',
  xr_scan_back: '줄이 돌아와요 — 기계에서 먼 쪽으로',
  df_clear: '터지기 전엔 멀리, 터진 뒤엔 옆',
  df_paddles: '패들의 옆이나 뒤에 꺼내세요',
  df_revive: '충전 중 — 그로기로 끊으세요',
  df_double: '안 → 밖 → 안, 박자에 맞춰 꺼내기',
  eb_rush: '빨간 길 밖으로 — 도발하면 탱커 쪽',
  eb_procession: '길과 길 사이에 꺼내세요',
  eb_sheet: '덮치기 직전에 교체하세요',
  eb_pileup: '침대가 멈춘 자리도 터져요',
};

/** The fields 기획 20차 added to a boss entry — the zone's classic boss must have none of them. */
const FORM_FIELDS = ['form', 'spawn', 'move', 'spots', 'stage', 'guard', 'trail', 'signature'] as const;

// ─────────────────────────── helpers ───────────────────────────

/** The boss's own casts so far, in order. */
function bossCasts(tg: TestGame): Cast[] {
  const id = tg.w.state.bossId;
  return drain(tg).filter((e): e is Cast => e.type === 'skillCast' && e.sourceId === id);
}

/** The boss casts nothing by itself (the test casts single skills by hand) and no phase starts. */
function silence(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.skillCds = b.rt.skillCds.map(() => 9999);
  b.rt.phase = 99;
}

/** The boss stands where the test puts it and never swings. */
function hold(tg: TestGame): void {
  const b = bossOf(tg);
  b.rt.lockTime = 9999;
  b.rt.attackCd = 9999;
}

/**
 * A silent boss past its entrance pose whose hits really land (damage events) but hurt like a feather; no basic
 * attacks: every hit is a skill. groggy = keep the gauge (a forced break can then knock it down).
 */
function soft(id: Id, players: PlayerSetup[] = [HUMAN], groggy = false, tunables: Partial<Tunables> = {}): TestGame {
  const tg = raidGame(id, { hpMult: 50, players, tunables: { monsterDmgMult: SOFT, ...(groggy ? null : { bossGroggyThreshold: 0 }), ...tunables } });
  silence(tg);
  advance(tg, 1.1);
  hold(tg);
  tg.w.state.projectiles.length = 0;
  clearEvents(tg);
  return tg;
}

function skill(id: Id, skillId: string): MonsterSkill {
  const sk = allSkills(getBoss(id)).find(s => s.id === skillId);
  if (!sk) throw new Error(`no skill ${skillId}`);
  return sk;
}

/** Cast every part of one real skill as ONE cast of the boss at `target`; variant 1 = its first `cycle` shape. */
function castSkill(tg: TestGame, id: Id, skillId: string, target: SimEntity, variant = 0): (PendingHit | null)[] {
  const b = bossOf(tg);
  b.targetId = target.id;
  const sk = skill(id, skillId);
  const shape = variant === 0 ? sk : sk.cycle![variant - 1];
  const ctx = unitCtx(tg.w, b, sk.id, sk.name);
  return [shape.action, ...(shape.extra ?? [])].map((a, i) => startAction(tg.w, ctx, a, undefined, i));
}

/** Give the boss exactly this one skill of its own, due now, and let it act. */
function give(tg: TestGame, id: Id, skillId: string): void {
  const b = bossOf(tg);
  b.rt.skills = [skill(id, skillId)];
  b.rt.skillCds = [0];
  b.rt.skillGap = 0;
  b.rt.lockTime = 0;
  b.rt.attackCd = 9999;
}

/** Hold a character still at a spot. */
function pin(e: SimEntity, pos: Vec2): void {
  e.pos = { ...pos };
  e.rt.lockTime = 9999;
}

/**
 * Swap player 0's field character out for the mage, dropped at `pos` — the scripted answer to a pattern. The newcomer
 * is pinned there and loses its appear protection, so only the spot keeps it safe.
 */
function swapTo(tg: TestGame, pos: Vec2, partyIndex = MAGE): SimEntity {
  expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex, pos }).ok).toBe(true);
  const fresh = active(tg);
  pin(fresh, pos);
  fresh.invulnTime = 0;
  return fresh;
}

/** The skill hits `e` took so far, oldest first. */
function hitsOn(tg: TestGame, e: SimEntity): number[] {
  return eventsOf(tg, 'damage').filter(d => d.targetId === e.id).map(d => d.amount);
}

/** Every skill hit on a character of the party so far. */
const partyHits = (tg: TestGame): number => eventsOf(tg, 'damage').filter(d => d.targetTeam === 'ally').length;

/** What one skill hit of `amount` × the boss's attack does to `e` in a soft fight (its defence applies). */
function softHit(tg: TestGame, id: Id, e: SimEntity, amount: number): number {
  return amount * getBoss(id).stats.atk * SOFT * (1 - effStats(tg.w, e).def);
}

const teles = (tg: TestGame): Telegraph[] => tg.w.state.telegraphs.filter(t => t.team === 'enemy');
const covers = (t: { area: AreaShape; center: Vec2; origin: Vec2 }, p: Vec2): boolean => hitsArea(t.area, t.center, t.origin, p, R);
const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const spot = (v: Vec2): [number, number] => [r6(v.x), r6(v.y)];
const adds = (tg: TestGame): SimEntity[] => tg.w.state.entities.filter(e => e.team === 'enemy' && e.tier !== 'boss' && !e.rt.gone);
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Tick until `done` says so (at most `seconds`); returns the seconds it took, −1 when it never did. */
function until(tg: TestGame, seconds: number, done: () => boolean): number {
  for (let t = 0; t < seconds * 30; t++) {
    tick(tg.w);
    tg.events.push(...tg.game.drainEvents());
    if (done()) return (t + 1) / 30;
  }
  return -1;
}

// ─────────────────────────── the zone ───────────────────────────

describe('폐병동: the zone table', () => {
  it('has five bosses — the four new ones with data, then the classic boss, which is untouched (no 기획 20차 field)', () => {
    expect(ZONE_BOSSES.ward).toEqual([...IDS, 'surgeon_director']);
    for (const id of ZONE_BOSSES.ward) expect(BOSSES.some(b => b.id === id && b.zone === 'ward'), id).toBe(true);
    expect(IDS.map(id => BOSS_RAID_BAND[id])).toEqual(['early', 'mid', 'mid', 'late']);
    const classic = WARD_BOSSES[0];
    expect(classic.id).toBe('surgeon_director');
    for (const k of FORM_FIELDS) expect(classic[k], `surgeon_director.${k}`).toBeUndefined();
    expect(classic.radius).toBe(3);
    expect(classic.stationary).toBe(true);
    expect([classic.stats.maxHp, classic.stats.atk, classic.stats.atkSpeed]).toEqual([7400, 30, 0.55]);
    expect(allSkills(classic).map(sk => sk.id)).toEqual(['sd_scalpels', 'sd_summon', 'sd_gas', 'sd_incision', 'sd_scalpel_storm']);
    for (const sk of allSkills(classic)) {
      expect(sk.cycle ?? sk.castMove ?? sk.hint, `${sk.id}: no 기획 20차 skill field`).toBeUndefined();
      for (const a of [sk.action, ...(sk.extra ?? [])]) {
        expect(a.center, sk.id).not.toBe('arena');
        expect(a.rel ?? a.once ?? a.bound ?? a.relocate ?? a.trail, `${sk.id}: no 기획 20차 part field`).toBeUndefined();
      }
    }
  });

  it.each(IDS)('%s: name, form, body, HP, attack, groggy and signature are the table rows', id => {
    const def = getBoss(id);
    const row = TABLE[id];
    expect(def.name).toBe(row.name);
    expect(def.zone).toBe('ward');
    expect(bossFormOf(def)).toBe(row.form);
    expect(def.radius).toBe(row.radius);
    expect([def.stats.maxHp, def.stats.atk, def.stats.atkSpeed, def.groggy?.threshold]).toEqual([row.hp, row.atk, row.atkSpeed, row.groggy]);
    expect(def.signature).toBe(row.signature);
    expect(def.enrage).toEqual(ENRAGE);
    expect(def.lore.length).toBeLessThanOrEqual(80);
  });

  it.each(IDS)('%s: cooldowns, first uses, the phase row and the tips', id => {
    const def = getBoss(id);
    const row = SKILLS[id];
    expect(Object.fromEntries(allSkills(def).map(sk => [sk.id, [sk.cooldown, sk.initialDelay]]))).toEqual(row.skills);
    const ph = def.phases![0];
    expect([ph.name, ph.hpBelow, ph.atkSpeedMult, ph.cooldownMult]).toEqual(row.phase);
    for (const sk of allSkills(def)) {
      expect(sk.hint, `${sk.id} tip`).toBe(TIPS[sk.id]);
      if (sk.hint) expect(sk.hint.length, `${sk.id}: a tip fits one HUD line`).toBeLessThanOrEqual(46);
    }
  });

  it('forms: the 서랍 is the room (top centre, no move data); the 촬영기 has four stations and starts on the west one; the 제세동기 rounds its three stops, the 병상 walks after the nearest character', () => {
    const md = getBoss('morgue_drawers');
    expect([md.stationary, md.stats.range, md.stats.moveSpeed, md.spawn, md.move, md.spots]).toEqual([true, 40, 0, undefined, undefined, undefined]);
    const xr = getBoss('xray_machine');
    expect(xr.stationary).toBe(true);
    expect(xr.stats.moveSpeed).toBe(0);
    expect(xr.basic).toEqual({ kind: 'projectile', speed: 11 });
    expect(xr.spots).toEqual([{ x: 3.5, y: 6, facing: 'right' }, { x: 12, y: 3, facing: 'down' }, { x: 20.5, y: 6, facing: 'left' }, { x: 12, y: 10, facing: 'up' }]);
    const df = getBoss('defibrillator');
    const round = { mode: 'patrol', waypoints: [{ x: 18, y: 4 }, { x: 6, y: 4.5 }, { x: 12, y: 9 }], dwell: 3, turnRate: 120 };
    expect([df.spawn, df.move, df.stats.moveSpeed, df.stats.range, df.basic]).toEqual([{ x: 18, y: 4 }, round, 1.8, 1, { kind: 'melee' }]);
    expect(df.guard ?? df.trail).toBeUndefined();
    const eb = getBoss('empty_beds');
    expect([eb.spawn, eb.move, eb.stats.moveSpeed, eb.stats.range, eb.basic]).toEqual([{ x: 21, y: 6 }, { mode: 'pursue' }, 1.4, 1, { kind: 'melee', splashRadius: 1.2 }]);
    // where they stand when the floor starts
    expect(spot(bossOf(raidGame('xray_machine')).pos)).toEqual([3.5, 6]);
    expect(spot(bossOf(raidGame('defibrillator')).pos)).toEqual([18, 4]);
    expect(spot(bossOf(raidGame('empty_beds')).pos)).toEqual([21, 6]);
  });

  it('빈 침대: the one summon-only unit of the zone — small numbers, one rush in its 12 s', () => {
    expect(WARD_UNITS.map(u => u.id)).toEqual(['bed_decoy']);
    expect(BOSS_UNITS).toContain(WARD_UNITS[0]);
    const u = getMonster('bed_decoy');
    expect([u.name, u.tier, u.radius, u.look]).toEqual(['빈 침대', 'normal', 1.3, 'bed_decoy']);
    expect(u.stats).toMatchObject({ maxHp: 240, atk: 18, atkSpeed: 0.6, range: 0.6, moveSpeed: 2 });
    expect(u.basic).toEqual({ kind: 'melee' });
    expect(u.skills).toHaveLength(1);
    expect(u.skills![0]).toMatchObject({ id: 'bd_rush', cooldown: 9, initialDelay: 3, castRange: 10 });
    expect(u.skills![0].action).toMatchObject({ area: { shape: 'line', length: 10, width: 2 }, delay: 1.4, charge: { distance: 10 }, effects: [{ kind: 'damage', amount: 1 }] });
    // removed with the 기획 19차 patterns: the 간호 인형 summon (docs/bosses.md 4-5)
    const summons = IDS.flatMap(id => allSkills(getBoss(id)).flatMap(partsOf)).flatMap(a => (a.summon ? [a.summon.unitId] : []));
    expect(summons).toEqual(['iv_zombie', 'bed_decoy']);
  });
});

describe('폐병동: the contract of a new boss', () => {
  it.each(IDS)('%s: shape by form, every skill within 45 s with no idle stretch, phase → phase skill, kill → clear, same seed same fight', id => {
    expectBossContract(id);
  }, 30000);
});

// 보스 튜닝 (docs/boss-raid.md 4-2, docs/bosses.md 3장): no pattern may depend on the numbers as written.
describe('폐병동: the contract holds under the boss tuning knobs', () => {
  const KNOBS: Partial<Tunables>[] = [
    { bossTelegraphMult: 2, bossAreaMult: 0.5, bossMoveMult: 1.5 },
    { bossTelegraphMult: 0.5, bossAreaMult: 2, bossMoveMult: 0.6 },
  ];
  for (const knobs of KNOBS) {
    it.each(IDS)(`%s: 예고 ×${knobs.bossTelegraphMult}, 범위 ×${knobs.bossAreaMult}, 이동 ×${knobs.bossMoveMult}`, id => {
      expectBossContract(id, knobs);
    }, 30000);
  }

  it('the knobs reach every pattern of the zone: warnings ×2 (the gaps of a line too), areas ×0.5 at the same spots; ring holes, rush lengths and one-target hits stay', () => {
    for (const id of IDS) {
      for (const sk of allSkills(getBoss(id))) {
        const plain = soft(id);
        const tuned = soft(id, [HUMAN], false, { bossTelegraphMult: 2, bossAreaMult: 0.5 });
        for (const tg of [plain, tuned]) {
          pin(active(tg), { x: 9, y: 8 });
          if (bossFormOf(getBoss(id)) === 'roaming') bossOf(tg).pos = { x: 15, y: 5 };
        }
        const a = castSkill(plain, id, sk.id, active(plain)).filter((p): p is PendingHit => p !== null);
        const b = castSkill(tuned, id, sk.id, active(tuned)).filter((p): p is PendingHit => p !== null);
        expect(b.length, sk.id).toBe(a.length);
        // every warned part is a pending hit (the two summons are instant: nothing to scale)
        expect(a.length, sk.id).toBe(partsOf(sk).slice(0, 1 + (sk.extra?.length ?? 0)).filter(p => (p.delay ?? 0) > 0).length);
        a.forEach((p, i) => {
          const q = b[i];
          expect(q.remaining, `${sk.id} warning ${i}`).toBeCloseTo(p.remaining * 2, 6);
          if (p.telegraphLead != null) expect(q.telegraphLead, `${sk.id} lead ${i}`).toBeCloseTo(p.telegraphLead * 2, 6);
          expect(spot(q.center), `${sk.id} spot ${i}`).toEqual(spot(p.center));
          expect(q.area.shape).toBe(p.area.shape);
          const [x, y] = [p.area, q.area];
          if (x.shape === 'ring' && y.shape === 'ring') {
            expect(y.outer, `${sk.id} outer`).toBeCloseTo(x.outer * 0.5, 6);
            expect(y.inner, `${sk.id} hole`).toBeCloseTo(Math.min(x.inner, y.outer), 6);
          }
          if (x.shape === 'circle' && y.shape === 'circle') expect(y.radius, `${sk.id} radius`).toBeCloseTo(x.radius * 0.5, 6);
          if (x.shape === 'fan' && y.shape === 'fan') expect([y.radius, y.angle], sk.id).toEqual([x.radius * 0.5, x.angle]);
          // 기획 20차 점검: 번호 없는 서랍's cells are fixedArea — on their grid whatever the knob says
          const k = p.action.fixedArea ? 1 : 0.5;
          if (x.shape === 'rect' && y.shape === 'rect') expect([y.length, y.width], `${sk.id} strip`).toEqual([x.length * k, x.width * k]);
          if (x.shape === 'line' && y.shape === 'line') {
            // a rush runs as far, on a path half as wide
            expect(y.width, `${sk.id} path`).toBeCloseTo(x.width * 0.5, 6);
            expect(q.chargeTo, `${sk.id} end`).toEqual(p.chargeTo);
          }
        });
      }
    }
  });
});

describe('폐병동: warnings come in order, with the right footprints', () => {
  // first casts in a calm fight: skill ids by their first use, then the footprint of each part with its delay
  const ORDER: Record<Id, string[]> = {
    morgue_drawers: ['md_order', 'md_wake', 'md_frost'],
    xray_machine: ['xr_scan', 'xr_develop', 'xr_rail'],
    defibrillator: ['df_clear', 'df_paddles', 'df_revive'],
    empty_beds: ['eb_rush', 'eb_sheet', 'eb_procession'],
  };
  const SHAPES: Record<string, [AreaShape['shape'], number][]> = {
    md_order: [['rect', 1.6], ['rect', 1.9], ['rect', 2.2], ['rect', 2.5], ['rect', 2.8]],
    md_frost: [['ring', 1.2]],
    md_wake: [['circle', 0]],
    md_reverse: [['rect', 1.3], ['rect', 1.55], ['rect', 1.8], ['rect', 2.05], ['rect', 2.3]],
    xr_scan: [1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3, 3.3, 3.6].map((d): [AreaShape['shape'], number] => ['rect', d]),
    xr_rail: [['circle', 1.3]],
    xr_develop: [['circle', 1.6], ['circle', 2]],
    xr_scan_back: [1.2, 1.44, 1.68, 1.92, 2.16, 2.4, 2.64, 2.88, 3.12].map((d): [AreaShape['shape'], number] => ['rect', d]),
    df_clear: [['circle', 1.6], ['ring', 2.1]],
    df_paddles: [['fan', 1.3]],
    df_revive: [['circle', 2.5]],
    df_double: [['circle', 1.2], ['ring', 1.7], ['circle', 2.2]],
    eb_rush: [['line', 1.4]],
    eb_procession: [['circle', 0]],
    eb_sheet: [['circle', 1.2]],
    eb_pileup: [['line', 1.2], ['circle', 2.2]],
  };

  it.each(IDS)('%s: its three base patterns in the order of their first use, then the phase pattern', id => {
    const tg = raidGame(id, { hpMult: 50, tunables: CALM });
    advance(tg, 14);
    const casts = bossCasts(tg);
    expect([...new Set(casts.map(c => c.skillId))]).toEqual(ORDER[id]);
    for (const sk of getBoss(id).skills) {
      const mine = casts.filter(c => c.skillId === sk.id).slice(0, SHAPES[sk.id].length);
      expect(mine.map(c => [c.area.shape, r6(c.delay ?? 0)]), sk.id).toEqual(SHAPES[sk.id]);
    }
    clearEvents(tg);
    crossPhase(tg);
    advance(tg, 6);
    const ph = getBoss(id).phases![0].skills![0];
    const mine = bossCasts(tg).filter(c => c.skillId === ph.id).slice(0, SHAPES[ph.id].length);
    expect(mine.map(c => [c.area.shape, r6(c.delay ?? 0)]), ph.id).toEqual(SHAPES[ph.id]);
  });

  it('every skill of the zone is in the shape table and has a tip row (nothing unchecked)', () => {
    const ids = IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id));
    expect(Object.keys(SHAPES).sort()).toEqual([...ids].sort());
    for (const k of Object.keys(TIPS)) expect(ids, k).toContain(k);
  });
});

describe('폐병동: phase, enrage, groggy', () => {
  it.each(IDS)('%s: the phase starts under its HP line, enrage multiplies attack / speed / cooldowns, the gauge uses its threshold', id => {
    const def = getBoss(id);
    const ph = def.phases![0];
    const tg = raidGame(id, { hpMult: 50, tunables: { invincible: true } });
    advance(tg, 1);
    const b = bossOf(tg);
    expect(b.maxHp).toBeCloseTo(def.stats.maxHp * 50, 3);
    const before = effStats(tg.w, b);
    expect(before.atk).toBeCloseTo(def.stats.atk, 6);
    expect(before.atkSpeed).toBeCloseTo(def.stats.atkSpeed, 6);
    clearEvents(tg);
    b.hp = (ph.hpBelow + 0.02) * b.maxHp; // well above the line: the party is hitting it
    advance(tg, 0.2);
    expect(eventsOf(tg, 'bossPhase')).toHaveLength(0);
    expect(monsterCdMult(b)).toBe(1);
    crossPhase(tg);
    expect(eventsOf(tg, 'bossPhase').map(e => e.name)).toEqual([ph.name]);
    expect(monsterCdMult(b)).toBeCloseTo(ph.cooldownMult ?? 1, 6);
    expect(effStats(tg.w, b).atkSpeed).toBeCloseTo(def.stats.atkSpeed * (ph.atkSpeedMult ?? 1), 6);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceEnrage' } }).ok).toBe(true);
    const hot = effStats(tg.w, b);
    expect(hot.atk).toBeCloseTo(def.stats.atk * ENRAGE.atkMult, 6);
    expect(hot.atkSpeed).toBeCloseTo(def.stats.atkSpeed * (ph.atkSpeedMult ?? 1) * ENRAGE.atkSpeedMult, 6);
    expect(monsterCdMult(b)).toBeCloseTo((ph.cooldownMult ?? 1) * ENRAGE.cooldownMult, 6);
    if (def.stats.moveSpeed > 0) expect(hot.moveSpeed).toBeCloseTo(def.stats.moveSpeed * BOSS_FORM.enrageMove, 6);
    // groggy: one human seat → base 100 × the boss's threshold; a forced break knocks it down
    expect(groggyMax(tg.w)).toBeCloseTo(DEFAULT_TUNABLES.bossGroggyThreshold * def.groggy!.threshold, 6);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    advance(tg, 0.2);
    expect(eventsOf(tg, 'bossGroggy').some(e => e.entityId === b.id)).toBe(true);
  });

  it.each(MOVING)('%s: a groggy break drops its warnings and stops it where it is (no step, no turn) until it stands up', id => {
    const tg = raidGame(id, { hpMult: 50, tunables: { invincible: true } });
    const me = active(tg);
    pin(me, { x: 4, y: 9 });
    const b = bossOf(tg);
    // run to the middle of its first wind-up
    expect(until(tg, 8, () => teles(tg).length > 0)).toBeGreaterThan(0);
    advance(tg, 0.2);
    expect(tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    advance(tg, 0.2);
    expect(teles(tg), 'the wind-up is broken').toHaveLength(0);
    const at = { ...b.pos };
    const facing = b.facing;
    clearEvents(tg);
    advance(tg, 1.5);
    expect(b.pos).toEqual(at);
    expect(b.facing).toBe(facing);
    expect(bossCasts(tg)).toHaveLength(0);
    expect(partyHits(tg)).toBe(0);
  });

  it('left alone, the floor timer enrages the boss at bossFloorTime (as on a classic boss floor)', () => {
    const tg = raidGame('morgue_drawers', { hpMult: 50, tunables: CALM });
    expect(tg.w.state.plan.timeLimit).toBe(DEFAULT_TUNABLES.bossFloorTime);
    advance(tg, DEFAULT_TUNABLES.bossFloorTime - 1);
    expect(tg.w.state.bossEnraged).toBe(false);
    advance(tg, 1.2);
    expect(tg.w.state.bossEnraged).toBe(true);
  });

  it('a raid on the ward floors (11–15) meets these bosses on the ward background, with the floor scaling on top', () => {
    const tg = raidGame('empty_beds', { floor: 13 });
    expect(tg.w.state.plan).toMatchObject({ kind: 'boss', bossId: 'empty_beds', theme: 'ward' });
    expect(bossOf(tg).maxHp).toBeGreaterThan(getBoss('empty_beds').stats.maxHp);
  });
});

// ─────────────────────────── 번호 없는 서랍 ───────────────────────────

describe('번호 없는 서랍 (고정형)', () => {
  const LEFT: AreaShape = { shape: 'rect', dir: 'right', length: 12, width: 4 };
  const RIGHT: AreaShape = { shape: 'rect', dir: 'left', length: 12, width: 4 };
  /** Is the inside of the cell around (cx, cy) free of every warning, while the rest of the floor is covered? */
  function onlySafeCell(tele: Telegraph[], cx: number, cy: number): void {
    for (let x = 0.5; x < 24; x += 1) {
      for (let y = 0.5; y < 12; y += 1) {
        const inside = Math.abs(x - cx) < 6 - R && Math.abs(y - cy) < 2 - R;
        const outside = Math.abs(x - cx) > 6 + R || Math.abs(y - cy) > 2 + R;
        if (inside) expect(tele.some(t => covers(t, { x, y })), `safe ${x},${y}`).toBe(false);
        if (outside) expect(tele.some(t => covers(t, { x, y })), `open ${x},${y}`).toBe(true);
      }
    }
  }

  it('번호 순서: five of the six cells open in number order, 0.3 s apart — the unnumbered cell (bottom right) never does', () => {
    const tg = soft('morgue_drawers', [HUMAN, HUMAN2, THIRD]);
    const [first, last, safe] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(first, { x: 5, y: 2 }); // ① top left
    pin(last, { x: 5, y: 10 }); // ⑤ bottom left
    pin(safe, { x: 18, y: 10 }); // the unnumbered one
    castSkill(tg, 'morgue_drawers', 'md_order', first);
    const tele = teles(tg);
    expect(tele.map(t => t.area)).toEqual([LEFT, RIGHT, LEFT, RIGHT, LEFT]);
    expect(tele.map(t => spot(t.center))).toEqual([[0, 2], [24, 2], [0, 6], [24, 6], [0, 10]]);
    expect(tele.map(t => r6(t.total))).toEqual([1.6, 1.9, 2.2, 2.5, 2.8]);
    expect(tele.every(t => t.motif === undefined)).toBe(true);
    onlySafeCell(tele, 18, 10);
    advance(tg, 1.5);
    expect(hitsOn(tg, first)).toHaveLength(0);
    advance(tg, 0.2);
    expect(hitsOn(tg, first)).toHaveLength(1);
    expect(hitsOn(tg, first)[0]).toBeCloseTo(softHit(tg, 'morgue_drawers', first, 2), 6);
    expect(hitsOn(tg, last)).toHaveLength(0);
    advance(tg, 1.2);
    expect(hitsOn(tg, first)).toHaveLength(1);
    expect(hitsOn(tg, last)).toHaveLength(1);
    expect(hitsOn(tg, safe)).toHaveLength(0);
    expect(teles(tg)).toHaveLength(0);
  });

  it('the answer is a swap into the unnumbered cell: neither the character that left nor the one dropped there is hit', () => {
    const tg = soft('morgue_drawers');
    const me = active(tg);
    pin(me, { x: 5, y: 6 }); // ③ — would be hit at 2.2 s
    castSkill(tg, 'morgue_drawers', 'md_order', me);
    advance(tg, 1);
    const fresh = swapTo(tg, { x: 18, y: 10 });
    expect(teles(tg).some(t => covers(t, fresh.pos))).toBe(false);
    advance(tg, 2.2);
    expect(partyHits(tg)).toBe(0);
  });

  it('the next cast is mirrored (safe = bottom left), the one after is the first shape again — a counter, no rng', () => {
    const tg = soft('morgue_drawers');
    pin(active(tg), { x: 12, y: 6 });
    give(tg, 'morgue_drawers', 'md_order');
    const lastCells: [number, number][] = [];
    const firstCells: [number, number][] = [];
    for (let t = 0; t < 30 * 30 && lastCells.length < 3; t++) {
      tick(tg.w);
      const parts = tg.game.drainEvents().filter((e): e is Cast => e.type === 'skillCast' && e.skillId === 'md_order');
      if (parts.length === 0) continue;
      expect(parts).toHaveLength(5);
      firstCells.push(spot(parts[0].center));
      lastCells.push(spot(parts[4].center));
      if (lastCells.length === 2) onlySafeCell(teles(tg), 6, 10);
    }
    expect(firstCells).toEqual([[0, 2], [24, 2], [0, 2]]);
    expect(lastCells).toEqual([[0, 10], [24, 10], [0, 10]]);
  });

  it('거꾸로 순서 (phase 2): from the bottom up, 0.25 s apart — now the top-left cell is the safe one', () => {
    const tg = soft('morgue_drawers', [HUMAN, HUMAN2]);
    const [safe, low] = [active(tg, 0), active(tg, 1)];
    pin(safe, { x: 6, y: 2 });
    pin(low, { x: 18, y: 10 });
    castSkill(tg, 'morgue_drawers', 'md_reverse', low);
    const tele = teles(tg);
    expect(tele.map(t => spot(t.center))).toEqual([[24, 10], [0, 10], [24, 6], [0, 6], [24, 2]]);
    expect(tele.map(t => r6(t.total))).toEqual([1.3, 1.55, 1.8, 2.05, 2.3]);
    onlySafeCell(tele, 6, 2);
    advance(tg, 1.4);
    expect(hitsOn(tg, low)).toHaveLength(1);
    advance(tg, 1.1);
    expect(hitsOn(tg, low)).toHaveLength(1);
    expect(hitsOn(tg, safe)).toHaveLength(0);
  });

  it('냉기 · 일어난 환자 are as in 기획 19차: a ring of frost around the target (its hole is safe), 2–3 링거 환자 with no warning', () => {
    const tg = soft('morgue_drawers', [HUMAN, HUMAN2]);
    const [called, near] = [active(tg, 0), active(tg, 1)];
    pin(called, { x: 12, y: 6 });
    pin(near, { x: 15, y: 6 });
    castSkill(tg, 'morgue_drawers', 'md_frost', called);
    expect(teles(tg).map(t => [t.area, t.total, t.center])).toEqual([[{ shape: 'ring', inner: 1.5, outer: 4.5 }, 1.2, { x: 12, y: 6 }]]);
    advance(tg, 1.3);
    expect(hitsOn(tg, called)).toHaveLength(0);
    expect(hitsOn(tg, near)).toHaveLength(1);
    expect(statusValue(near, 'slow')).toBeCloseTo(0.4, 6);
    castSkill(tg, 'morgue_drawers', 'md_wake', called);
    expect(adds(tg).length).toBeGreaterThanOrEqual(2);
    expect(adds(tg).length).toBeLessThanOrEqual(3);
    expect(adds(tg).every(a => a.defId === 'iv_zombie')).toBe(true);
    expect(teles(tg)).toHaveLength(0);
  });
});

// ─────────────────────────── 투시 촬영기 ───────────────────────────

describe('투시 촬영기 (자리 이동형)', () => {
  const SPOTS = getBoss('xray_machine').spots!;
  /** The north station (looks down) — the pattern tests below park the machine there. */
  const NORTH = SPOTS.findIndex(s => s.facing === 'down');
  /** Put the machine on station `i` as if it had ridden there (place, facing, the station counter). */
  function park<T extends TestGame>(tg: T, i = NORTH): T {
    const b = bossOf(tg);
    b.pos = { x: SPOTS[i].x, y: SPOTS[i].y };
    b.facing = spotFacing(getBoss('xray_machine'), i);
    b.rt.form!.spot = i;
    return tg;
  }

  /** Tick `seconds`, noting every sweep strip that showed (its centre, once) and when `who` was first hit. */
  function watchScan(tg: TestGame, seconds: number, who: SimEntity): { strips: [number, number][]; hitAt: number } {
    const strips: [number, number][] = [];
    const seen = new Set<number>();
    let hitAt = -1;
    for (let t = 0; t < seconds * 30; t++) {
      tick(tg.w);
      tg.events.push(...tg.game.drainEvents());
      for (const tele of teles(tg)) {
        if (seen.has(tele.id)) continue;
        seen.add(tele.id);
        expect(tele.motif, 'a step of the moving line').toBe('sweep');
        expect(tele.total).toBeLessThanOrEqual(0.9 + 1 / 30 + 1e-6);
        expect(tele.area).toMatchObject({ shape: 'rect', length: 26, width: 2, anchor: 'center' });
        strips.push(spot(tele.center));
      }
      if (hitAt < 0 && hitsOn(tg, who).length > 0) hitAt = (t + 1) / 30;
    }
    return { strips, hitAt };
  }

  it('촬영 from the north station: the line slides down the floor from the machine, 2 cells every 0.3 s; whoever it reaches is hit once and marked (취약 35 %, 4 s)', () => {
    const tg = park(soft('xray_machine', [HUMAN, HUMAN2]));
    const b = bossOf(tg);
    expect(spot(b.pos)).toEqual([12, 3]);
    const [me, beside] = [active(tg, 0), active(tg, 1)];
    pin(me, { x: 6, y: 9 }); // 6 ahead of the machine: the third strip
    pin(beside, { x: 16, y: 3 }); // level with the machine: the line starts in front of it
    const parts = castSkill(tg, 'xray_machine', 'xr_scan', me);
    expect(parts).toHaveLength(9);
    expect(teles(tg), 'each strip shows only for its last 0.9 s').toHaveLength(0);
    const { strips, hitAt } = watchScan(tg, 4, me);
    expect(strips).toEqual([5, 7, 9, 11, 13, 15, 17, 19, 21].map(y => [12, y])); // straight down from (12, 3)
    expect(hitAt).toBeCloseTo(1.2 + 2 * 0.3, 1);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hitsOn(tg, me)[0]).toBeCloseTo(softHit(tg, 'xray_machine', me, 1.6), 6);
    expect(statusValue(me, 'vulnerable')).toBeCloseTo(0.35, 6);
    expect(hitsOn(tg, beside)).toHaveLength(0);
    advance(tg, 1.5);
    expect(hasStatus(me, 'vulnerable')).toBe(true);
    advance(tg, 1.2);
    expect(hasStatus(me, 'vulnerable')).toBe(false);
  });

  it('the answer is a swap to where the line has passed: drop the next character right in front of the machine after the first strip', () => {
    const tg = park(soft('xray_machine'));
    const me = active(tg);
    pin(me, { x: 12, y: 9 }); // would be hit at 1.8 s
    castSkill(tg, 'xray_machine', 'xr_scan', me);
    advance(tg, 1.3); // the first strip (y 4–6) has landed
    const fresh = swapTo(tg, { x: 12, y: 5.2 });
    advance(tg, 3);
    expect(partyHits(tg)).toBe(0);
    expect(hasStatus(fresh, 'vulnerable')).toBe(false);
    // …while standing still was hit (the test above), and dropping AHEAD of the line is hit too
    const late = park(soft('xray_machine'));
    pin(active(late), { x: 12, y: 5 });
    castSkill(late, 'xray_machine', 'xr_scan', active(late));
    advance(late, 0.6);
    const ahead = swapTo(late, { x: 12, y: 11 });
    advance(late, 3);
    expect(hitsOn(late, ahead)).toHaveLength(1);
  });

  it('it starts on the west station (not at the top centre): its first 촬영 slides to the right across the whole floor — all nine strips lie inside the arena', () => {
    const tg = soft('xray_machine');
    const b = bossOf(tg);
    expect(spot(b.pos)).toEqual([3.5, 6]);
    expect(Math.cos(b.facing)).toBeCloseTo(1, 6);
    const me = active(tg);
    pin(me, { x: 21.5, y: 2 }); // the far end, up by the top wall
    castSkill(tg, 'xray_machine', 'xr_scan', me);
    const { strips, hitAt } = watchScan(tg, 4.2, me);
    expect(strips).toEqual([5.5, 7.5, 9.5, 11.5, 13.5, 15.5, 17.5, 19.5, 21.5].map(x => [x, 6]));
    expect(hitAt).toBeCloseTo(1.2 + 8 * 0.3, 1);
  });

  it('레일 이동: the next station is warned for 1.3 s (tagged arrive), then the machine is there, facing the way the station looks, and its ring is hit', () => {
    const tg = park(soft('xray_machine', [HUMAN, HUMAN2]));
    const b = bossOf(tg);
    const EAST = SPOTS[(NORTH + 1) % SPOTS.length];
    const [under, away] = [active(tg, 0), active(tg, 1)];
    pin(under, { x: 19, y: 7.5 }); // 2.1 from the east station
    pin(away, { x: 12, y: 8 });
    castSkill(tg, 'xray_machine', 'xr_rail', under);
    const tele = teles(tg);
    expect(tele).toHaveLength(1);
    expect(tele[0]).toMatchObject({ motif: 'arrive', total: 1.3, area: { shape: 'circle', radius: 3 } });
    expect(spot(tele[0].center)).toEqual([EAST.x, EAST.y]);
    advance(tg, 1.2);
    expect(spot(b.pos), 'it is hittable on its old station through the whole warning').toEqual([12, 3]);
    advance(tg, 0.2);
    expect(spot(b.pos)).toEqual([20.5, 6]);
    expect(Math.cos(b.facing)).toBeCloseTo(-1, 6); // the east station looks left
    expect(eventsOf(tg, 'blink').some(e => e.entityId === b.id)).toBe(true);
    expect(hitsOn(tg, under)).toHaveLength(1);
    expect(hitsOn(tg, under)[0]).toBeCloseTo(softHit(tg, 'xray_machine', under, 2), 6);
    expect(hitsOn(tg, away)).toHaveLength(0);
    // a swap off the station before it arrives: nobody is hit
    const dodge = park(soft('xray_machine'));
    pin(active(dodge), { x: 19, y: 7.5 });
    castSkill(dodge, 'xray_machine', 'xr_rail', active(dodge));
    advance(dodge, 0.6);
    swapTo(dodge, { x: 8, y: 9 });
    advance(dodge, 1);
    expect(partyHits(dodge)).toBe(0);
  });

  it('station by station (north → east → south → west → north) the scan line comes from a new side', () => {
    const tg = park(soft('xray_machine'));
    const b = bossOf(tg);
    const me = active(tg);
    pin(me, { x: 12, y: 6 });
    // where the first strip lies after each move: 2 cells in front of the station, across the way it looks
    const want: { at: [number, number]; first: [number, number]; along: 'x' | 'y' }[] = [
      { at: [20.5, 6], first: [18.5, 6], along: 'y' },
      { at: [12, 10], first: [12, 8], along: 'x' },
      { at: [3.5, 6], first: [5.5, 6], along: 'y' },
      { at: [12, 3], first: [12, 5], along: 'x' },
    ];
    for (const w of want) {
      castSkill(tg, 'xray_machine', 'xr_rail', me);
      advance(tg, 1.8); // arrived, past the appear pose
      expect(spot(b.pos)).toEqual(w.at);
      const [first] = castSkill(tg, 'xray_machine', 'xr_scan', me);
      expect(spot(first!.center)).toEqual(w.first);
      const dir = areaDir(first!.area as { dir: 'right'; rot?: number });
      expect(Math.abs(w.along === 'x' ? dir.x : dir.y), `${w.at}: the strip lies along ${w.along}`).toBeCloseTo(1, 6);
      advance(tg, 4);
    }
  });

  it('재촬영 (phase 2): the same line comes back from the far side toward the machine, faster — far from the machine is safe once it has passed', () => {
    const tg = park(soft('xray_machine', [HUMAN, HUMAN2]));
    const [near, far] = [active(tg, 0), active(tg, 1)];
    pin(near, { x: 12, y: 5 }); // 2 ahead: the last strip
    pin(far, { x: 12, y: 11 }); // 8 ahead: the sixth strip
    castSkill(tg, 'xray_machine', 'xr_scan_back', near);
    const { strips, hitAt } = watchScan(tg, 4, far);
    expect(strips).toEqual([21, 19, 17, 15, 13, 11, 9, 7, 5].map(y => [12, y]));
    expect(hitAt).toBeCloseTo(1.2 + 5 * 0.24, 1);
    expect(hitsOn(tg, far)).toHaveLength(1);
    expect(hitsOn(tg, near)).toHaveLength(1);
    // the answer: once the line has passed the far end, drop the next character there
    const dodge = park(soft('xray_machine'));
    pin(active(dodge), { x: 12, y: 5 });
    castSkill(dodge, 'xray_machine', 'xr_scan_back', active(dodge));
    advance(dodge, 2.5); // the strip at y 11 landed at 2.4 s
    swapTo(dodge, { x: 12, y: 11 });
    advance(dodge, 2);
    expect(partyHits(dodge)).toBe(0);
  });

  it('촬영 → 현상: both hits of 현상 land 35 % harder on a character whose bones were taken; a swap sends them to a fresh one, plain', () => {
    const scanned = (): { tg: TestGame; marked: SimEntity } => {
      const tg = park(soft('xray_machine'));
      const marked = active(tg);
      pin(marked, { x: 12, y: 5 });
      castSkill(tg, 'xray_machine', 'xr_scan', marked);
      advance(tg, 1.3);
      expect(statusValue(marked, 'vulnerable')).toBeCloseTo(0.35, 6);
      clearEvents(tg);
      castSkill(tg, 'xray_machine', 'xr_develop', marked);
      expect(teles(tg).filter(t => t.area.shape === 'circle').map(t => [t.area, t.total])).toEqual([[{ shape: 'circle', radius: 2.2 }, 1.6], [{ shape: 'circle', radius: 2.2 }, 2]]);
      return { tg, marked };
    };
    const a = scanned();
    advance(a.tg, 2.1);
    const hits = hitsOn(a.tg, a.marked);
    expect(hits).toHaveLength(2);
    for (const h of hits) expect(h).toBeCloseTo(softHit(a.tg, 'xray_machine', a.marked, 1.5) * 1.35, 6);
    // the tip: take the marked character out
    const b = scanned();
    advance(b.tg, 0.4);
    expect(b.tg.game.dispatch({ type: 'swap', player: 0, partyIndex: MAGE, pos: { x: 5, y: 3.4 } }).ok).toBe(true);
    const fresh = active(b.tg);
    fresh.invulnTime = 0;
    bossOf(b.tg).targetId = fresh.id;
    advance(b.tg, 1.8);
    const plain = hitsOn(b.tg, fresh);
    expect(plain).toHaveLength(2);
    for (const h of plain) expect(h).toBeCloseTo(softHit(b.tg, 'xray_machine', fresh, 1.5), 6);
    expect(hitsOn(b.tg, b.marked)).toHaveLength(0);
  });
});

// ─────────────────────────── 멈추지 않는 제세동기 ───────────────────────────

describe('멈추지 않는 제세동기 (배회형)', () => {
  const AT = { x: 12, y: 6 };

  it('it makes its round on its own — 3 s on each of its three stops, wherever the party stands — and leaves it for whoever taunts it', () => {
    const stops = getBoss('defibrillator').move!.waypoints!;
    const tg = raidGame('defibrillator', { hpMult: 50, players: [HUMAN, HUMAN2], tunables: CALM });
    silence(tg);
    const b = bossOf(tg);
    b.rt.attackCd = 9999;
    const [nearest, far] = [active(tg, 0), active(tg, 1)];
    pin(nearest, { x: 21, y: 9 });
    pin(far, { x: 3, y: 9 });
    expect(spot(b.pos)).toEqual([stops[0].x, stops[0].y]);
    advance(tg, 3.5); // the entrance (1 s) and most of its 3 s on the first stop
    expect(spot(b.pos), 'still on its first stop').toEqual([stops[0].x, stops[0].y]);
    advance(tg, 2.5);
    expect(b.pos.x, 'on its way to the second stop — away from the nearest character').toBeLessThan(17);
    advance(tg, 6); // 12 cells at 1.8 a second
    expect(dist(b.pos, stops[1])).toBeLessThan(0.05);
    expect(inBossBox(b.pos)).toBe(true);
    expect(applyStatus(b, 'taunt', 3, 0, 0, 'drag', { sourceEntityId: far.id })).toBe(true);
    const before = dist(b.pos, far.pos);
    advance(tg, 2.5);
    expect(b.targetId).toBe(far.id);
    expect(dist(b.pos, far.pos)).toBeLessThan(before - 1.5);
  });

  it('물러서세요: the circle around its body bursts (stun 0.6 s), then the ring outside it — the cart stands still to the end', () => {
    const tg = soft('defibrillator', [HUMAN, HUMAN2, THIRD]);
    const b = bossOf(tg);
    b.pos = { ...AT };
    const [close, mid, far] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(close, { x: 14.5, y: 6 }); // 2.5 away: the circle
    pin(mid, { x: 18, y: 6 }); // 6 away: the ring
    pin(far, { x: 22, y: 6 }); // 10 away: out of both
    castSkill(tg, 'defibrillator', 'df_clear', close);
    const tele = teles(tg);
    expect(tele.map(t => [t.area, t.total, t.center])).toEqual([
      [{ shape: 'circle', radius: 4.5 }, 1.6, AT],
      [{ shape: 'ring', inner: 4.5, outer: 8 }, 2.1, AT],
    ]);
    advance(tg, 1.5);
    expect(partyHits(tg)).toBe(0);
    advance(tg, 0.2);
    expect(hitsOn(tg, close)).toHaveLength(1);
    expect(hitsOn(tg, close)[0]).toBeCloseTo(softHit(tg, 'defibrillator', close, 2.2), 6);
    expect(hasStatus(close, 'stun')).toBe(true);
    expect(hitsOn(tg, mid)).toHaveLength(0);
    advance(tg, 0.5);
    expect(hitsOn(tg, mid)).toHaveLength(1);
    expect(hitsOn(tg, mid)[0]).toBeCloseTo(softHit(tg, 'defibrillator', mid, 1.6), 6);
    expect(hasStatus(mid, 'stun')).toBe(false);
    expect(hitsOn(tg, close)).toHaveLength(1); // the ring passed outside it
    expect(hitsOn(tg, far)).toHaveLength(0);
    expect(b.pos).toEqual(AT);
  });

  it('cast by the boss itself it does not take a step or turn until the outer ring has gone off (2.1 s), then it walks again', () => {
    const tg = raidGame('defibrillator', { hpMult: 50, tunables: CALM });
    silence(tg);
    advance(tg, 1.1);
    const b = bossOf(tg);
    const me = active(tg);
    b.pos = { ...AT };
    b.rt.form!.dwell = 0; // off its stop: it is rolling to the next one
    pin(me, { x: 21, y: 9 });
    advance(tg, 0.5);
    give(tg, 'defibrillator', 'df_clear');
    tick(tg.w);
    expect(teles(tg)).toHaveLength(2);
    const at = { ...b.pos };
    const facing = b.facing;
    me.pos = { x: 3, y: 9 }; // whatever the party does: it must not roll on yet
    advance(tg, 2);
    expect(b.pos).toEqual(at);
    expect(b.facing).toBe(facing);
    advance(tg, 1.5);
    expect(dist(b.pos, at)).toBeGreaterThan(0.5);
  });

  it('the two answers of its tip: drop far before it bursts; drop right beside it once the inside has burst', () => {
    const farDrop = soft('defibrillator');
    bossOf(farDrop).pos = { ...AT };
    pin(active(farDrop), { x: 14.5, y: 6 });
    castSkill(farDrop, 'defibrillator', 'df_clear', active(farDrop));
    advance(farDrop, 1);
    const fresh = swapTo(farDrop, { x: 21.5, y: 9 });
    expect(teles(farDrop).some(t => covers(t, fresh.pos))).toBe(false);
    advance(farDrop, 1.5);
    expect(partyHits(farDrop)).toBe(0);

    const hug = soft('defibrillator');
    bossOf(hug).pos = { ...AT };
    pin(active(hug), { x: 18, y: 6 }); // in the ring
    castSkill(hug, 'defibrillator', 'df_clear', active(hug));
    advance(hug, 1.7); // the inside has gone off
    swapTo(hug, { x: 14.2, y: 6 });
    advance(hug, 0.8);
    expect(partyHits(hug)).toBe(0);
  });

  it('패들: a fan from the cart toward its target (6.5 long, 100°) — beside or behind it is safe', () => {
    const tg = soft('defibrillator', [HUMAN, HUMAN2, THIRD]);
    const b = bossOf(tg);
    b.pos = { ...AT };
    const [front, behind, side] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(front, { x: 16, y: 6 });
    pin(behind, { x: 8, y: 6 });
    pin(side, { x: 12, y: 10 });
    castSkill(tg, 'defibrillator', 'df_paddles', front);
    const tele = teles(tg);
    expect(tele.map(t => [t.area, t.total])).toEqual([[{ shape: 'fan', radius: 6.5, angle: 100 }, 1.3]]);
    expect(tele[0].origin).toEqual(AT);
    expect(covers(tele[0], { x: 17, y: 9 })).toBe(true); // 31° off the middle
    expect(covers(tele[0], { x: 19.5, y: 6 })).toBe(false); // past its reach
    advance(tg, 1.4);
    expect(hitsOn(tg, front)).toHaveLength(1);
    expect(hitsOn(tg, front)[0]).toBeCloseTo(softHit(tg, 'defibrillator', front, 2.4), 6);
    expect(hitsOn(tg, behind)).toHaveLength(0);
    expect(hitsOn(tg, side)).toHaveLength(0);
    // the answer: swap to its back
    const dodge = soft('defibrillator');
    bossOf(dodge).pos = { ...AT };
    pin(active(dodge), { x: 16, y: 6 });
    castSkill(dodge, 'defibrillator', 'df_paddles', active(dodge));
    advance(dodge, 0.6);
    swapTo(dodge, { x: 8.5, y: 6 });
    advance(dodge, 1);
    expect(partyHits(dodge)).toBe(0);
  });

  it('심폐소생: 2.5 s of charging shown as its own ring around the cart (no danger), then it heals 6 % — a groggy break cancels it (규칙 M1)', () => {
    const tg = soft('defibrillator');
    const b = bossOf(tg);
    b.pos = { ...AT };
    const me = active(tg);
    pin(me, { x: 13.5, y: 6 });
    b.hp = b.maxHp * 0.5;
    castSkill(tg, 'defibrillator', 'df_revive', me);
    expect(teles(tg)).toHaveLength(1);
    expect(teles(tg)[0]).toMatchObject({ self: true, total: 2.5, area: { shape: 'circle', radius: 3.4 }, center: AT });
    advance(tg, 2.2);
    expect(justCue(tg.w.state, tg.w.tunables, 0)).toEqual({ danger: false, now: false, landIn: null });
    advance(tg, 0.4);
    const heals = eventsOf(tg, 'heal').filter(e => e.targetId === b.id);
    expect(heals).toHaveLength(1);
    expect(heals[0].amount).toBeCloseTo(0.06 * b.maxHp, 3);
    expect(partyHits(tg)).toBe(0);

    const broken = soft('defibrillator', [HUMAN], true);
    const c = bossOf(broken);
    c.hp = c.maxHp * 0.5;
    castSkill(broken, 'defibrillator', 'df_revive', active(broken));
    advance(broken, 1.2);
    expect(broken.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } }).ok).toBe(true);
    advance(broken, 3);
    expect(eventsOf(broken, 'heal').filter(e => e.targetId === c.id)).toHaveLength(0);
    expect(teles(broken)).toHaveLength(0);
    expect(c.hp).toBeLessThanOrEqual(c.maxHp * 0.5);
  });

  it('두 번 충격 (phase 2): inside → outside → inside, 0.5 s apart — beside it is hit twice, the ring once, far never', () => {
    const tg = soft('defibrillator', [HUMAN, HUMAN2, THIRD]);
    bossOf(tg).pos = { ...AT };
    const [close, mid, far] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(close, { x: 14.5, y: 6 });
    pin(mid, { x: 18, y: 6 });
    pin(far, { x: 22, y: 6 });
    castSkill(tg, 'defibrillator', 'df_double', close);
    expect(teles(tg).map(t => [t.area.shape, t.total])).toEqual([['circle', 1.2], ['ring', 1.7], ['circle', 2.2]]);
    advance(tg, 1.3);
    expect([hitsOn(tg, close).length, hitsOn(tg, mid).length]).toEqual([1, 0]);
    advance(tg, 0.5);
    expect([hitsOn(tg, close).length, hitsOn(tg, mid).length]).toEqual([1, 1]);
    advance(tg, 0.5);
    expect([hitsOn(tg, close).length, hitsOn(tg, mid).length, hitsOn(tg, far).length]).toEqual([2, 1, 0]);
    for (const h of hitsOn(tg, close)) expect(h).toBeCloseTo(softHit(tg, 'defibrillator', close, 1.8), 6);
    expect(hasStatus(close, 'stun')).toBe(false);
  });
});

// ─────────────────────────── 빈 병상 행렬 ───────────────────────────

describe('빈 병상 행렬 (배회형)', () => {
  it('질주: the path to its target is warned for 1.4 s (tagged charge), then the bed runs to the end of its box — on the path: hit and shoved; off it: nothing', () => {
    const tg = soft('empty_beds', [HUMAN, HUMAN2]);
    const b = bossOf(tg);
    b.pos = { x: 4, y: 6 };
    const [onPath, off] = [active(tg, 0), active(tg, 1)];
    pin(onPath, { x: 14, y: 6 });
    pin(off, { x: 14, y: 9 });
    castSkill(tg, 'empty_beds', 'eb_rush', onPath);
    const tele = teles(tg);
    expect(tele).toHaveLength(1);
    expect(tele[0]).toMatchObject({ motif: 'charge', total: 1.4, area: { shape: 'line', width: 2.6 } });
    expect(tele[0].origin).toEqual({ x: 4, y: 6 });
    expect(tele[0].center).toEqual({ x: BOSS_FORM.box.xMax, y: 6 });
    expect(b.facing).toBe(0); // it turns to its path at once
    expect(covers(tele[0], off.pos)).toBe(false);
    advance(tg, 1.3);
    expect(b.pos).toEqual({ x: 4, y: 6 });
    advance(tg, 0.2);
    expect(b.pos).toEqual({ x: BOSS_FORM.box.xMax, y: 6 });
    expect(hitsOn(tg, onPath)).toHaveLength(1);
    expect(hitsOn(tg, onPath)[0]).toBeCloseTo(softHit(tg, 'empty_beds', onPath, 2.4), 6);
    expect(dist(onPath.pos, { x: 14, y: 6 })).toBeCloseTo(1.5, 6); // shoved 1.5
    expect(hitsOn(tg, off)).toHaveLength(0);
    expect(tg.w.state.zones.filter(z => z.team === 'enemy'), 'a rush leaves nothing behind').toHaveLength(0);
  });

  it('the answer is a swap out of the red path — and a taunt steers the rush: it runs at the taunter, not at its old target', () => {
    const dodge = soft('empty_beds');
    bossOf(dodge).pos = { x: 4, y: 6 };
    pin(active(dodge), { x: 14, y: 6 });
    castSkill(dodge, 'empty_beds', 'eb_rush', active(dodge));
    advance(dodge, 0.8);
    swapTo(dodge, { x: 12, y: 9.5 });
    advance(dodge, 1);
    expect(partyHits(dodge)).toBe(0);

    const tg = raidGame('empty_beds', { hpMult: 50, players: [HUMAN, HUMAN2], tunables: CALM });
    silence(tg);
    advance(tg, 1.1);
    const b = bossOf(tg);
    b.rt.attackCd = 9999;
    b.pos = { x: 12, y: 6 };
    const [nearest, tank] = [active(tg, 0), active(tg, 1)];
    pin(nearest, { x: 15, y: 6 });
    pin(tank, { x: 12, y: 9.8 });
    b.targetId = nearest.id;
    advance(tg, 0.3);
    expect(b.targetId).toBe(nearest.id);
    expect(applyStatus(b, 'taunt', 4, 0, 0, 'drag', { sourceEntityId: tank.id })).toBe(true);
    give(tg, 'empty_beds', 'eb_rush');
    expect(until(tg, 3, () => teles(tg).length > 0)).toBeGreaterThan(0);
    const path = teles(tg)[0];
    expect(path.motif).toBe('charge');
    expect(covers(path, tank.pos)).toBe(true);
    expect(covers(path, nearest.pos)).toBe(false);
    expect(Math.abs(path.center.x - path.origin.x)).toBeLessThan(1.5); // down the floor, toward the taunter
    expect(path.center.y).toBeGreaterThan(path.origin.y + 2);
  });

  it('행렬: 2–3 빈 침대 appear around the bed with no warning; each rushes once (a 10-cell path, 1.4 s) and they are gone 12 s later', () => {
    const tg = soft('empty_beds');
    const b = bossOf(tg);
    b.pos = { x: 14, y: 5 };
    const me = active(tg);
    pin(me, { x: 9, y: 8 });
    castSkill(tg, 'empty_beds', 'eb_procession', me);
    const beds = adds(tg);
    expect(beds.length).toBeGreaterThanOrEqual(2);
    expect(beds.length).toBeLessThanOrEqual(3);
    expect(teles(tg), 'the summon itself has no warning').toHaveLength(0);
    for (const bed of beds) {
      expect(bed.defId).toBe('bed_decoy');
      expect(bed.expiresIn).toBe(12);
      expect(dist(bed.pos, b.pos)).toBeLessThan(3);
    }
    // every bed warns one straight path within the first 5 s; at some moment at least two paths are up together
    const paths = new Map<number, Telegraph>();
    let together = 0;
    for (let t = 0; t < 6 * 30; t++) {
      tick(tg.w);
      const up = teles(tg);
      together = Math.max(together, up.length);
      for (const tele of up) paths.set(tele.id, { ...tele });
    }
    tg.events.push(...tg.game.drainEvents());
    expect(paths.size).toBe(beds.length);
    for (const p of paths.values()) {
      // a straight path of width 2 from the bed, 10 cells long (+ its own body; cut short at a wall)
      expect(p).toMatchObject({ total: 1.4, area: { shape: 'line', width: 2 } });
      expect((p.area as { length: number }).length).toBeLessThanOrEqual(10 + getMonster('bed_decoy').radius + 1e-6);
      expect(p.motif, 'a small unit, not a form boss').toBeUndefined();
    }
    expect(together).toBeGreaterThanOrEqual(2);
    const rushes = eventsOf(tg, 'skillCast').filter(e => e.skillId === 'bd_rush');
    expect(rushes).toHaveLength(beds.length);
    expect(hitsOn(tg, me).length, 'standing in their way is hit').toBeGreaterThan(0);
    advance(tg, 6.5);
    expect(adds(tg)).toHaveLength(0);
    expect(eventsOf(tg, 'skillCast').filter(e => e.skillId === 'bd_rush'), 'one rush in a bed\'s life').toHaveLength(beds.length);
  });

  it('between the paths is safe: a character dropped beside every warned path is missed by all the beds', () => {
    const tg = soft('empty_beds');
    const b = bossOf(tg);
    b.pos = { x: 14, y: 5 };
    pin(active(tg), { x: 6, y: 5 });
    castSkill(tg, 'empty_beds', 'eb_procession', active(tg));
    const n = adds(tg).length;
    // hold the beds back from their bites: only the rushes count
    for (const bed of adds(tg)) bed.rt.attackCd = 9999;
    const seen = new Set<number>();
    let fresh: SimEntity | null = null;
    for (let t = 0; t < 7 * 30; t++) {
      tick(tg.w);
      for (const tele of teles(tg)) seen.add(tele.id);
      if (!fresh && seen.size === n && teles(tg).length > 0) {
        // all the paths are known: find a spot none of them covers, far from every bed
        const free = [{ x: 3, y: 10 }, { x: 21, y: 10 }, { x: 12, y: 10.5 }, { x: 3, y: 3.5 }, { x: 21, y: 3.5 }].find(p => !teles(tg).some(tele => covers(tele, p)) && adds(tg).every(bed => dist(bed.pos, p) > 4));
        expect(free, 'a gap between the paths').toBeDefined();
        fresh = swapTo(tg, free!);
        clearEvents(tg);
      }
    }
    tg.events.push(...tg.game.drainEvents());
    expect(fresh).not.toBeNull();
    expect(eventsOf(tg, 'skillCast').filter(e => e.skillId === 'bd_rush').length + seen.size).toBeGreaterThan(0);
    expect(hitsOn(tg, fresh!)).toHaveLength(0);
  });

  it('시트 덮침: the sheet follows its target until it drops (2 × attack, 50 % slow for 2 s) — a swap in its last 0.5 s is a 저스트 교대 and it whiffs', () => {
    const tg = soft('empty_beds');
    const me = active(tg);
    pin(me, { x: 6, y: 4 });
    castSkill(tg, 'empty_beds', 'eb_sheet', me);
    expect(teles(tg).map(t => [t.area, t.total])).toEqual([[{ shape: 'circle', radius: 2.4 }, 1.2]]);
    me.pos = { x: 9, y: 8 };
    advance(tg, 0.6);
    expect(teles(tg)[0].center).toEqual({ x: 9, y: 8 });
    advance(tg, 0.7);
    expect(hitsOn(tg, me)).toHaveLength(1);
    expect(hitsOn(tg, me)[0]).toBeCloseTo(softHit(tg, 'empty_beds', me, 2), 6);
    expect(statusValue(me, 'slow')).toBeCloseTo(0.5, 6);

    const just = soft('empty_beds');
    pin(active(just), { x: 6, y: 4 });
    castSkill(just, 'empty_beds', 'eb_sheet', active(just));
    advance(just, 0.9); // 0.3 s left
    clearEvents(just);
    expect(just.game.dispatch({ type: 'swap', player: 0, partyIndex: MAGE, pos: { x: 6, y: 4 } }).ok).toBe(true);
    expect(eventsOf(just, 'justSwap')).toHaveLength(1);
    advance(just, 0.6);
    expect(partyHits(just)).toBe(0);
  });

  it('연쇄 추돌 (phase 2): a wider rush, then the spot where the bed stopped bursts (shown for its last 1.0 s, stun 0.5 s) — away from where it stops is safe', () => {
    const tg = soft('empty_beds', [HUMAN, HUMAN2, THIRD]);
    const b = bossOf(tg);
    b.pos = { x: 4, y: 6 };
    const [onPath, atStop, away] = [active(tg, 0), active(tg, 1), active(tg, 2)];
    pin(onPath, { x: 10, y: 6 });
    pin(atStop, { x: 21, y: 8.5 }); // off the path, 2.7 from where it stops
    pin(away, { x: 12, y: 10 });
    const parts = castSkill(tg, 'empty_beds', 'eb_pileup', onPath);
    expect(teles(tg).map(t => [t.motif, t.area.shape, t.total])).toEqual([['charge', 'line', 1.2]]);
    expect((teles(tg)[0].area as { width: number }).width).toBe(3.2);
    expect(parts[1]).toMatchObject({ remaining: 2.2, telegraphLead: 1 });
    advance(tg, 1.3);
    expect(b.pos).toEqual({ x: BOSS_FORM.box.xMax, y: 6 });
    expect(hitsOn(tg, onPath)).toHaveLength(1);
    expect(hitsOn(tg, onPath)[0]).toBeCloseTo(softHit(tg, 'empty_beds', onPath, 2.2), 6);
    expect(hitsOn(tg, atStop)).toHaveLength(0);
    // the burst shows around the bed where it now stands
    const burst = teles(tg);
    expect(burst).toHaveLength(1);
    expect(burst[0]).toMatchObject({ area: { shape: 'circle', radius: 3.5 }, center: { x: BOSS_FORM.box.xMax, y: 6 } });
    expect(burst[0].total).toBeLessThanOrEqual(1 + 1 / 30 + 1e-6);
    advance(tg, 1);
    expect(hitsOn(tg, atStop)).toHaveLength(1);
    expect(hitsOn(tg, atStop)[0]).toBeCloseTo(softHit(tg, 'empty_beds', atStop, 2.2), 6);
    expect(hasStatus(atStop, 'stun')).toBe(true);
    expect(hitsOn(tg, onPath)).toHaveLength(1);
    expect(hitsOn(tg, away)).toHaveLength(0);
  });
});

// ─────────────────────────── whole fights ───────────────────────────

describe('폐병동: seeded fights — one direct-swap seat and two bots', () => {
  const SEEDS = [3, 11, 19, 27, 101, 202, 303, 404];
  const DROPS: Vec2[] = [{ x: 8, y: 8 }, { x: 16, y: 8 }, { x: 12, y: 9.5 }, { x: 6, y: 5 }, { x: 18, y: 5 }];

  interface Fight {
    end: 'clear' | 'wipe' | 'late' | 'open';
    time: number;
    swaps: number;
    /** The longest stretch (s) the boss lost no HP while a character stood on the field. */
    noDamage: number;
    travelled: number;
    hp: number;
  }

  /**
   * Floor 1 against `id`: seat 0 is a human driven by a fixed script (every 4 s it swaps to its next living character,
   * dropped on the next spot of DROPS), seats 1–2 are bots. Stops at the clear, a wipe, the enrage, or after 240 s.
   */
  function fightOnce(id: Id, seed: number): Fight {
    const tg = raidGame(id, { seed, players: [HUMAN, BOT1, BOT2], tunables: { bossRaidAtkMult: DEFAULT_TUNABLES.bossRaidAtkMult } });
    const s = tg.w.state;
    const b = bossOf(tg);
    const r: Fight = { end: 'open', time: 0, swaps: 0, noDamage: 0, travelled: 0, hp: 1 };
    let quiet = 0;
    let hp = b.hp;
    let at = { ...b.pos };
    let drop = 0;
    for (let t = 0; t < 240 * 30; t++) {
      if (t > 0 && t % 120 === 0) {
        const p = s.players[0];
        for (let k = 1; k <= 2 && !p.out; k++) {
          const next = ((p.activeIndex ?? 0) + k) % p.party.length;
          if (!tg.game.dispatch({ type: 'swap', player: 0, partyIndex: next, pos: DROPS[drop % DROPS.length] }).ok) continue;
          r.swaps++;
          drop++;
          break;
        }
      }
      tick(tg.w);
      const events = tg.game.drainEvents();
      r.time = (t + 1) / 30;
      if (events.some(e => e.type === 'floorClear')) {
        r.end = 'clear';
        break;
      }
      if (s.phase !== 'combat') {
        r.end = 'wipe';
        break;
      }
      if (s.bossEnraged) {
        r.end = 'late';
        break;
      }
      const fielded = s.entities.some(e => e.kind === 'character' && !e.rt.gone && e.hp > 0);
      quiet = b.hp < hp - 1e-9 || !fielded || b.invulnTime > 0 ? 0 : quiet + 1 / 30;
      r.noDamage = Math.max(r.noDamage, quiet);
      hp = b.hp;
      r.travelled += dist(b.pos, at);
      at = { ...b.pos };
      if (bossFormOf(getBoss(id)) !== 'fixed') expect(inBossBox(b.pos, 1e-3), `${id} seed ${seed}: outside its box at ${JSON.stringify(b.pos)}`).toBe(true);
      expect(Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y) && Number.isFinite(b.facing)).toBe(true);
    }
    r.hp = Math.max(0, b.hp / b.maxHp);
    return r;
  }

  it.each(IDS)('%s: 8 seeds end (most of them in a clear before the enrage), the boss is never out of reach for long, and the same seed gives the same fight', id => {
    const runs = SEEDS.map(seed => fightOnce(id, seed));
    for (const r of runs) {
      expect(r.end, `${id}: every fight ends — ${JSON.stringify(runs)}`).not.toBe('open');
      expect(r.noDamage, `${id}: the boss can always be hit — ${JSON.stringify(r)}`).toBeLessThan(12);
      expect(r.swaps, `${id}: the scripted seat swapped`).toBeGreaterThan(2);
    }
    const clears = runs.filter(r => r.end === 'clear');
    expect(clears.length, JSON.stringify(runs)).toBeGreaterThanOrEqual(5);
    for (const r of clears) expect(r.time).toBeGreaterThan(8); // never a one-shot
    expect(fightOnce(id, SEEDS[0])).toEqual(runs[0]);
  }, 90000);

  it('the rail machine and the bed really move in those fights; the 서랍 never does', () => {
    const moved = (id: Id): number => Math.max(...[3, 11, 19].map(seed => fightOnce(id, seed).travelled));
    expect(moved('morgue_drawers')).toBe(0);
    expect(moved('xray_machine')).toBeGreaterThan(8); // at least one ride between stations
    expect(moved('empty_beds')).toBeGreaterThan(10); // its rushes
    // (the 제세동기 only walks while nobody stands next to it — with two bot seats somebody always does; its walk is
    // checked by hand in its own block above)
  }, 90000);
});

// ─────────────────────────── looks, sounds ───────────────────────────

describe('폐병동: looks, floor art, voices', () => {
  const BASE: BossDrawOpts = { color: '#888888', time: 0, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
  const POSES: BossPose[] = ['idle', 'walk', 'windup', 'attack', 'groggy'];

  /** A counting 2D context: every method is a no-op that counts; non-finite numbers and texts are remembered. */
  function counter(): { ctx: CanvasRenderingContext2D; n: () => number; texts: string[]; fills: Set<string>; bad: string[]; sets: Set<string>; reset(): void } {
    let n = 0;
    const texts: string[] = [];
    const fills = new Set<string>();
    const sets = new Set<string>();
    const bad: string[] = [];
    const store: Record<string | symbol, unknown> = { globalAlpha: 1 };
    const ctx = new Proxy(store, {
      get: (target, prop) =>
        prop in target
          ? target[prop]
          : (...args: unknown[]) => {
              n++;
              if (prop === 'fillText') texts.push(String(args[0]));
              for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) bad.push(`${String(prop)}(${args.join(',')})`);
            },
      set: (target, prop, value) => {
        sets.add(String(prop));
        if (prop === 'fillStyle') fills.add(String(value));
        if (typeof value === 'number' && !Number.isFinite(value)) bad.push(`${String(prop)}=${value}`);
        target[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, n: () => n, texts, fills, bad, sets, reset: () => { n = 0; } };
  }

  function cam(): Camera {
    const c = new Camera();
    c.setArena(24, 12);
    c.snap(null);
    return c;
  }

  it('the three moving bosses are bodies in the arena, the 서랍 keeps its set piece; four looks, four colours', () => {
    const colours = new Set<string>();
    for (const id of IDS) {
      const look = bossLook(id);
      expect(look, `${id} look`).toBeDefined();
      expect(look!.color).toBe(getBoss(id).color);
      colours.add(look!.color);
      expect(!!look!.body, `${id}: a body only for a moving boss`).toBe(MOVING.includes(id));
    }
    expect(colours.size).toBe(4);
    // about half the old set piece: a body box no wider than 3.2 cells, the rail machine low enough to clear the HUD at its north station
    expect([bossBody('xray_machine').w, bossBody('xray_machine').h]).toEqual([3.2, 2.5]);
    expect([bossBody('defibrillator').w, bossBody('defibrillator').h]).toEqual([2.9, 2.6]);
    expect([bossBody('empty_beds').w, bossBody('empty_beds').h]).toEqual([3.2, 2]); // a long, low bed
    const c = cam();
    expect(c.sy(3) - bossBody('xray_machine').h * PX_PER_UNIT, 'the top of the machine at (12, 3) is under the HUD boss box').toBeGreaterThan(100);
    // groggy texts are screen-aligned props (a body never draws text: it would mirror)
    expect(typeof bossLook('morgue_drawers')!.props).toBe('function');
    expect(typeof bossLook('defibrillator')!.props).toBe('function');
  });

  it.each(MOVING)('%s: every pose on both sides, calm / phase 2 / enraged — draws something, inside the budget, no text, finite numbers, a palette', id => {
    const c = counter();
    const def = getBoss(id);
    const body = bossBody(id);
    const k = cam();
    for (const pose of POSES) {
      for (const facing of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
        for (const extra of [{}, { phase: 2 }, { enraged: true, phase: 2, flash: 1 }] as Partial<BossDrawOpts>[]) {
          const a = newBodyAnim(12, 6, facing);
          for (let f = 0; f < 8; f++) {
            const o: BossDrawOpts = { ...BASE, color: def.color, time: 3.3 + f * 0.17, ...extra, groggy: pose === 'groggy' ? f / 7 : 0 };
            stepBodyAnim(a, 12 + f * 0.06, 6, facing, 1 / 30);
            c.reset();
            drawBossBody(c.ctx, k, a, { defId: id, x: 12 + f * 0.06, y: 6, facing, pose, p: f / 7, rise: 1 }, o);
            expect(c.n(), `${id} ${pose}: draws something`).toBeGreaterThan(30);
            expect(c.n(), `${id} ${pose} frame ${f}: canvas calls`).toBeLessThanOrEqual(240);
            // the body's own draw alone stays inside its 220
            c.reset();
            body.draw(c.ctx, { fx: 400, fy: 400, w: body.w * PX_PER_UNIT, h: body.h * PX_PER_UNIT, s: Math.cos(facing) < 0 ? -1 : 1, pose, p: f / 7, stride: f / 8, time: o.time, facing }, o);
            expect(c.n(), `${id} ${pose} frame ${f}: the body alone`).toBeLessThanOrEqual(220);
          }
        }
      }
    }
    expect(c.texts).toEqual([]);
    expect(c.bad).toEqual([]);
    expect(c.sets.has('shadowBlur')).toBe(false);
    expect(c.fills.size, `${id} uses a palette`).toBeGreaterThan(5);
    // the set piece of the sheet tools is the same body
    c.reset();
    bossLook(id)!.draw(c.ctx, k, 12, 6.5, def.radius, { ...BASE, color: def.color, charge: 1 });
    expect(c.n()).toBeGreaterThan(30);
    c.reset();
    bossLook(id)!.draw(c.ctx, k, 12, 6.5, def.radius, { ...BASE, retreat: 1 });
    expect(c.n()).toBe(0);
  });

  it("the phase tint and the enrage tint stack on each body's own colour (a colour mixed twice must not fall back to grey)", () => {
    const rgb = (h: string): number[] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const lerp = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v + (b[i] - v) * t);
    const STATES: [number, boolean][] = [[1, false], [2, false], [1, true], [2, true]];
    for (const id of IDS) {
      const look = bossLook(id)!;
      const seen = new Set<string>();
      for (const [phase, enraged] of STATES) {
        let want = rgb(look.color);
        if (phase > 1) want = lerp(want, rgb('#ff2050'), 0.12 * (phase - 1));
        if (enraged) want = lerp(want, rgb('#ff0033'), 0.3);
        const c = counter();
        look.draw(c.ctx, cam(), 12, MOVING.includes(id) ? 6.5 : -1.2, getBoss(id).radius, { ...BASE, phase, enraged, time: 5.1 });
        const fills = [...c.fills].map(f => /^rgb\((\d+),(\d+),(\d+)\)$/.exec(f) ?? /^#(..)(..)(..)$/.exec(f)).filter(m => m !== null).map(m => (m[0].startsWith('#') ? [1, 2, 3].map(i => parseInt(m[i], 16)) : [+m[1], +m[2], +m[3]]));
        const hit = fills.find(f => f.every((v, i) => Math.abs(v - want[i]) <= 1.5));
        expect(hit, `${id} phase ${phase}${enraged ? ' enraged' : ''}: body ${want.map(Math.round)} among ${JSON.stringify(fills)}`).toBeDefined();
        seen.add(`${hit}`);
      }
      expect(seen.size, `${id}: four states, four body colours`).toBe(STATES.length);
    }
  });

  it('floor art: the 서랍 paints its six cells, the 촬영기 its rail between the four stations (both dark floors); no ward boss leaves a trail', () => {
    for (const id of ['morgue_drawers', 'xray_machine'] as const) {
      const stage = bossLook(id)!.stage!;
      expect(stage.tone).toBe('dark');
      for (const phase of [1, 2]) {
        const c = counter();
        stage.bake(c.ctx, { wPx: 24 * PX_PER_UNIT, hPx: 12 * PX_PER_UNIT_Y, cellX: PX_PER_UNIT, cellY: PX_PER_UNIT_Y, phase });
        expect(c.n(), `${id} phase ${phase}`).toBeGreaterThan(8);
        expect(c.bad).toEqual([]);
        expect(c.texts).toEqual([]);
      }
    }
    expect(bossLook('defibrillator')!.stage ?? bossLook('empty_beds')!.stage).toBeUndefined();
    for (const k of Object.keys(BOSS_ZONE_LOOKS)) expect(/^(md|xr|df|eb)/.test(k), k).toBe(false);
    for (const id of IDS) expect(getBoss(id).trail).toBeUndefined();
  });

  it('빈 침대 has its own small body (never the boss with a sheet); groggy props and warning motifs point at real skills', () => {
    const draw = MINION_LOOKS.bed_decoy;
    expect(typeof draw).toBe('function');
    const c = counter();
    for (const s of [-1, 1]) for (const act of [0, 0.5, 1]) for (const flash of [false, true]) draw(c.ctx, '#adb5bd', flash, 300, 400, 127, 153, s, 2.5, 0.7, act);
    expect(c.n()).toBeGreaterThan(40);
    expect(c.n() / 12, 'a small unit: a handful of calls').toBeLessThan(60);
    expect(c.bad).toEqual([]);
    expect(c.texts).toEqual([]);
    for (const id of ['morgue_drawers', 'defibrillator'] as const) {
      const p = counter();
      bossLook(id)!.props!(p.ctx, cam(), 12, id === 'defibrillator' ? 6 : -1.2, getBoss(id).radius, { ...BASE, groggy: 1, time: 2 });
      expect(p.texts.length).toBeGreaterThan(0);
      expect(p.texts.length).toBeLessThanOrEqual(2);
      expect(p.bad).toEqual([]);
    }
    expect(BOSS_TELE_MOTIF.md_wake).toBe('spawn');
    expect(BOSS_TELE_MOTIF.eb_procession).toBe('spawn');
    const ids = new Set(IDS.flatMap(id => allSkills(getBoss(id)).map(sk => sk.id)));
    for (const k of Object.keys(BOSS_TELE_MOTIF)) if (/^(md|xr|df|eb)_/.test(k)) expect(ids.has(k), k).toBe(true);
  });

  it('voices: the 기획 19차 rows (root, motif, timbre) and one sound kind per skill of 기획 20차', () => {
    const want: Record<Id, [number, number[], string]> = {
      morgue_drawers: [116.5, [0, -1, -1], 'wind'],
      xray_machine: [146.8, [0, 7, 0], 'hum'],
      defibrillator: [123.5, [0, 0, 12], 'static'],
      empty_beds: [103.8, [0, -2, -5], 'clatter'],
    };
    for (const id of IDS) {
      const v = BOSS_VOICE[id];
      expect([v.base, v.motif, v.timbre]).toEqual(want[id]);
      expect(Object.keys(v.kinds).sort()).toEqual(allSkills(getBoss(id)).map(sk => sk.id).sort());
    }
    expect(BOSS_VOICE.morgue_drawers.kinds).toEqual({ md_order: 'doors', md_frost: 'gas', md_wake: 'summon', md_reverse: 'doors' });
    expect(BOSS_VOICE.xray_machine.kinds).toEqual({ xr_scan: 'beam', xr_rail: 'doors', xr_develop: 'burst', xr_scan_back: 'beam' });
    expect(BOSS_VOICE.defibrillator.kinds).toEqual({ df_clear: 'static', df_paddles: 'burst', df_revive: 'countdown', df_double: 'static' });
    expect(BOSS_VOICE.empty_beds.kinds).toEqual({ eb_rush: 'doors', eb_procession: 'summon', eb_sheet: 'papers', eb_pileup: 'burst' });
    expect(BOSS_VOICE.surgeon_director).toEqual({ base: 110, motif: [0, 6, 5], timbre: 'surgery', kinds: { sd_scalpels: 'blades', sd_scalpel_storm: 'blades', sd_summon: 'summon', sd_gas: 'gas', sd_incision: 'slice' } });
  });
});
