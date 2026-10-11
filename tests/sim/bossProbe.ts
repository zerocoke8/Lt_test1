// 기획 20차 보스 형태: the soft-lock probe of a boss fight (docs/bosses.md 3장) — shared by tests/review/boss-softlock.ts
// (the tool: every boss, both parties, exit code) and tests/sim/boss-softlock.test.ts (the light version in the suite).
// No vitest import here, so the tool can run it with vite-node.
import { BOSS_FORM } from '../../src/data/bosses';
import { tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { effStats } from '../../src/sim/stats';
import type { PlayerSetup, Tunables, Vec2 } from '../../src/types';
import { BOT1, BOT2, HUMAN, makeGame } from './helpers';

/** Is p a legal centre of a moving body (BOSS_FORM.box)? */
export function inBossBox(p: Vec2, slack = 1e-6): boolean {
  const b = BOSS_FORM.box;
  return p.x >= b.xMin - slack && p.x <= b.xMax + slack && p.y >= b.yMin - slack && p.y <= b.yMax + slack;
}

/** Three bot seats of melee characters only (the party that has to walk up to a moving boss). */
export const MELEE_PARTY: PlayerSetup[] = [
  { name: 'BOT A', isBot: true, characters: ['guardian', 'blade', 'berserker'], pets: BOT1.pets },
  { name: 'BOT B', isBot: true, characters: ['paladin', 'shadow', 'blade'], pets: BOT2.pets },
  { name: 'BOT C', isBot: true, characters: ['warden', 'berserker', 'shadow'], pets: BOT1.pets },
];
/** The usual three bot seats (tank + ranged + healer, melee + ranged, …). */
export const MIXED_PARTY: PlayerSetup[] = [{ ...HUMAN, isBot: true }, BOT1, BOT2];

export interface ProbeOpts {
  seed?: number;
  /** Seconds the fight may take (default 240). */
  seconds?: number;
  players?: PlayerSetup[];
  tunables?: Partial<Tunables>;
}

/** What one probed fight found. The `…Max` fields are the longest stretches in seconds. */
export interface ProbeResult {
  boss: string;
  seed: number;
  /** 'clear' = the boss fell, 'wipe' / 'timeout' = the party lost, 'open' = still fighting when the time ran out. */
  end: 'clear' | 'wipe' | 'timeout' | 'open';
  seconds: number;
  /** A moving boss neither moved, swung nor cast while its target was out of reach. */
  bossStallMax: number;
  /** The boss lost no HP while a character was on the field. */
  noDamageMax: number;
  /** The boss cast nothing. */
  noSkillMax: number;
  /** A character on the field (not stunned / rooted / stopped) neither moved, swung nor cast while the boss stood. */
  charStallMax: number;
  /** Share of character-ticks spent standing in an enemy zone. */
  zoneShare: number;
  /** Most zones + telegraphs up at once. */
  clutterMax: number;
  /** Cells the boss walked (charges and blinks included). */
  travelled: number;
  /** NaN / out-of-arena positions, the boss outside its box. */
  badCoords: string[];
  /** Enemy zones, telegraphs or pending hits that survived the floor clear. */
  leftovers: string[];
  /** The probes that failed (empty = fine): 'stall' | 'no-damage' | 'char-stall' | 'no-end' | 'coords' | 'leftovers'. */
  fails: string[];
}

/** The limits of the probe (seconds; shares 0..1). */
export const PROBE_LIMITS = { bossStall: 6, noDamage: 12, noSkill: 25, charStall: 4, zoneShare: 0.25, clutter: 40 } as const;

/**
 * 기획 20차: one bots-only fight against `bossId` on floor 1, watched tick by tick for soft locks — a boss that stands
 * out of reach, a boss nobody can hurt, characters that stop walking, a fight that never ends, bodies outside the
 * arena / the box, and anything of the old floor left after the clear. No rng of its own (same seed, same result).
 */
export function probeFight(bossId: string, opts: ProbeOpts = {}): ProbeResult {
  const seed = opts.seed ?? 20;
  const limit = opts.seconds ?? 240;
  // the raid attack knob stays at its default: this is the fight a player gets
  const tg = makeGame({ seed, players: opts.players ?? MIXED_PARTY, tunables: opts.tunables, mode: 'bossRaid', bossRaid: { onlyBoss: bossId } });
  const w = tg.w;
  const s = w.state;
  const dt = 1 / 30;
  const boss = s.entities.find(x => x.id === s.bossId && !x.rt.gone);
  if (!boss) throw new Error(`no boss on the floor (${bossId})`);
  const bossId0 = boss.id;
  const moving = !!boss.rt.form && boss.rt.form.form !== 'relocating';
  const r: ProbeResult = { boss: bossId, seed, end: 'open', seconds: 0, bossStallMax: 0, noDamageMax: 0, noSkillMax: 0, charStallMax: 0, zoneShare: 0, clutterMax: 0, travelled: 0, badCoords: [], leftovers: [], fails: [] };
  let bossStall = 0;
  let noDamage = 0;
  let noSkill = 0;
  let bx = boss.pos.x;
  let by = boss.pos.y;
  let hp = boss.hp;
  let charTicks = 0;
  let zoneTicks = 0;
  const still = new Map<number, { x: number; y: number; t: number }>();
  const bad = (what: string): void => {
    if (r.badCoords.length < 5 && !r.badCoords.includes(what)) r.badCoords.push(what);
  };
  for (let t = 0; t < limit * 30; t++) {
    tick(w);
    const events = tg.game.drainEvents();
    r.seconds = (t + 1) * dt;
    if (events.some(e => e.type === 'floorClear')) {
      r.end = 'clear';
      // the next floor has started in the same tick (bots pick their reward at once): nothing of this fight may be left
      for (const z of s.zones) if (z.team === 'enemy') r.leftovers.push(`zone ${z.id}`);
      for (const tele of s.telegraphs) if (tele.team === 'enemy') r.leftovers.push(`telegraph ${tele.id}`);
      for (const p of w.pending) if (p.kind === 'hit' && p.ctx.team === 'enemy') r.leftovers.push(`pending ${p.ctx.skillId}`);
      for (const e of s.entities) if (e.team === 'enemy' && e.id !== s.bossId && !e.rt.gone) r.leftovers.push(`enemy ${e.defId}`);
      break;
    }
    if (s.phase !== 'combat') {
      r.end = s.runResult?.reason === 'timeout' ? 'timeout' : 'wipe';
      break;
    }
    if (boss.rt.gone || s.bossId !== bossId0) break;
    // coordinates
    const a = s.plan.arena;
    for (const e of s.entities) {
      if (e.rt.gone) continue;
      if (!Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.y) || !Number.isFinite(e.facing)) bad(`${e.defId}: not a number`);
      else if (e !== boss && (e.pos.x < -0.01 || e.pos.x > a.width + 0.01 || e.pos.y < -0.01 || e.pos.y > a.height + 0.01)) bad(`${e.defId} outside the arena`);
    }
    if (boss.rt.form && !inBossBox(boss.pos, 1e-3)) bad(`${bossId} outside its box (${boss.pos.x.toFixed(2)}, ${boss.pos.y.toFixed(2)})`);
    // the boss
    const step = Math.hypot(boss.pos.x - bx, boss.pos.y - by);
    r.travelled += step;
    bx = boss.pos.x;
    by = boss.pos.y;
    const target = s.entities.find(e => e.id === boss.targetId && !e.rt.gone);
    const down = boss.statuses.some(x => x.id === 'stun' || x.id === 'stasis');
    const busy = step > 1e-4 || boss.anim === 'attack' || boss.anim === 'cast' || boss.rt.lockTime > 0 || down;
    const reach = effStats(w, boss).range + (boss.rt.form?.pinned ? BOSS_FORM.pinReach : 0);
    const outOfReach = !!target && Math.hypot(target.pos.x - boss.pos.x, target.pos.y - boss.pos.y) - target.radius - boss.radius > reach + 1e-6;
    bossStall = moving && !busy && outOfReach ? bossStall + dt : 0;
    r.bossStallMax = Math.max(r.bossStallMax, bossStall);
    const chars = s.entities.filter(e => e.kind === 'character' && !e.rt.gone && e.hp > 0);
    noDamage = boss.hp < hp - 1e-9 || chars.length === 0 || boss.invulnTime > 0 ? 0 : noDamage + dt;
    hp = boss.hp;
    r.noDamageMax = Math.max(r.noDamageMax, noDamage);
    noSkill = events.some(e => e.type === 'skillCast' && e.sourceId === boss.id) || down ? 0 : noSkill + dt;
    r.noSkillMax = Math.max(r.noSkillMax, noSkill);
    // the characters
    const hazards = s.zones.filter(z => z.team === 'enemy' && (z.kind === 'damage' || z.kind === 'debuff'));
    for (const c of chars) {
      charTicks++;
      if (hazards.some(z => hitsArea(z.area ?? { shape: 'circle', radius: z.radius }, z.center, z.center, c.pos, c.radius))) zoneTicks++;
      const m = still.get(c.id) ?? { x: c.pos.x, y: c.pos.y, t: 0 };
      const held = c.statuses.some(x => x.id === 'stun' || x.id === 'root' || x.id === 'stasis' || x.id === 'tether');
      const acting = Math.hypot(c.pos.x - m.x, c.pos.y - m.y) > 1e-4 || c.anim === 'attack' || c.anim === 'cast' || c.anim === 'appear' || c.rt.lockTime > 0 || c.rt.attackCd > 0 || held;
      m.t = acting ? 0 : m.t + dt;
      m.x = c.pos.x;
      m.y = c.pos.y;
      still.set(c.id, m);
      r.charStallMax = Math.max(r.charStallMax, m.t);
    }
    r.clutterMax = Math.max(r.clutterMax, s.zones.length + s.telegraphs.length);
  }
  r.zoneShare = charTicks > 0 ? zoneTicks / charTicks : 0;
  if (r.bossStallMax >= PROBE_LIMITS.bossStall) r.fails.push('stall');
  if (r.noDamageMax >= PROBE_LIMITS.noDamage) r.fails.push('no-damage');
  if (r.charStallMax >= PROBE_LIMITS.charStall) r.fails.push('char-stall');
  if (r.end === 'open') r.fails.push('no-end');
  if (r.badCoords.length > 0) r.fails.push('coords');
  if (r.leftovers.length > 0) r.fails.push('leftovers');
  return r;
}
