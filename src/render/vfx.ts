// Event-driven visual effects. Owns only render-side state (pools + timers); never touches GameState.

import { LOGICAL_H, LOGICAL_W, type AreaShape, type DamageSource, type GameEvent, type GameState, type SkillAction, type Team, type Telegraph } from '../types';
import { PLAYER_COLORS } from '../config';
import { getCharacter, getPet } from '../data';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from './camera';
import { COLORS, FONT_STACK, OTHER_PLAYER_FX, ROLE_GLYPH, boldFont, lighten, mix, petColor, type UnitLook, unitLook } from './look';
import { Pool } from './pool';
import { DIR_VEC, aimSamples, hitsArea } from '../sim/geometry';
import { TAU, areaRadius, pathArea, pathRoundRect } from './shapes';
import { type UnitMemo, bodyHeight, bodyTop, bodyWidth, drawBody } from './units';
import { DASH_LAND } from './dashtime';
import { Fx, type FxHost, Impact, SkillFx } from './skillfx';
import { type CastInfo, castFx, swingFx } from './castfx';

// ─────────────────────────── effect records (pooled) ───────────────────────────

interface Floater {
  x: number;
  y: number;
  z: number;
  dx: number;
  age: number;
  dur: number;
  text: string;
  color: string;
  size: number;
  targetId: number;
  /** 0 basic dmg, 1 basic crit, 2 heal, 3 absorbed, 4 skill hit, 5 damage over time */
  kind: FloaterKind;
  amount: number;
  pop: number;
  /** Tiny skill name under a skill number ('' = none). */
  label: string;
  /** Outline colour. */
  stroke: string;
  alpha: number;
  /** Numbers only merge with the same key (skill hits of one skill). */
  key: string;
}

type FloaterKind = 0 | 1 | 2 | 3 | 4 | 5;

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  age: number;
  dur: number;
  color: string;
  width: number;
  fill: number;
}

interface AreaFlash {
  cx: number;
  cy: number;
  ox: number;
  oy: number;
  hasOrigin: boolean;
  area: AreaShape;
  age: number;
  dur: number;
  color: string;
  strength: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  age: number;
  dur: number;
  color: string;
  size: number;
}

interface Ghost {
  look: UnitLook;
  tier: UnitMemo['tier'];
  radius: number;
  x: number;
  y: number;
  s: number;
  phase: number;
  age: number;
  dur: number;
  mode: 0 | 1; // 0 death, 1 leave (swap out)
}

interface Warn {
  x: number;
  y: number;
  age: number;
  dur: number;
}

interface Label {
  x: number;
  y: number;
  z: number;
  age: number;
  dur: number;
  text: string;
  color: string;
  size: number;
  /** Entity whose head it floats over (−1 = fixed world point). */
  follow: number;
  stroke: string;
  alpha: number;
  /** Screen y after stacking (per frame). */
  sy: number;
  sx: number;
  w: number;
  /** Skill callout: drawn on a dark pill with a border in this colour ('' = plain text). */
  pill: string;
}

interface Deferred {
  ev: Extract<GameEvent, { type: 'damage' }>;
  t: number;
  ax: number;
  ay: number;
}

interface TeleSnap {
  cx: number;
  cy: number;
  ox: number;
  oy: number;
  area: AreaShape;
  team: Team;
  remaining: number;
  stamp: number;
}

/** Dash streak (3차 R28): the sim already moved the caster; we replay from → to and leave afterimages. */
interface DashFx {
  entityId: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  age: number;
  /** Seconds standing at `from` (landing) before the streak starts. */
  land: number;
  /** Streak travel time. */
  travel: number;
  color: string;
  look: UnitLook;
  radius: number;
  tier: UnitMemo['tier'];
  s: number;
}

export { DASH_LAND };
const DASH_TRAIL_FADE = 0.5;

interface HealAcc {
  amount: number;
  age: number;
  x: number;
  y: number;
}

export interface VfxContext {
  state: GameState;
  memos: Map<number, UnitMemo>;
  localPlayer: number;
}

/** Top HUD row ends around logical y ≈ 105; world labels never float above this line. */
const LABEL_MIN_Y = 132;
/** Callout pill box around the text baseline (× size): top above it, bottom below it; and the space kept between pills. */
const PILL_TOP = 0.98;
const PILL_BOTTOM = 0.32;
const PILL_GAP = 2;
const LABEL_MARGIN_X = 110;
const MERGE_WINDOW = 0.25;
const HEAL_WINDOW = 0.4;
/** Heals below this fraction of max HP (accumulated) don't get a number — they only sparkle. */
const HEAL_SHOW_FRAC = 0.025;
const HEAL_SHOW_ABS = 12;
const HEAL_TRICKLE_WINDOW = 1.2;

const SINGLE_AREA: AreaShape = { shape: 'single' };
const TMP_C = { x: 0, y: 0 };
const TMP_O = { x: 0, y: 0 };

/** Wind-up before a melee basic attack connects (the number, flash and jolt wait for the swing). */
const SWING_WINDUP = 0.07;
/** Two numbers on one target this close together are stacked (the later one sits above), not drawn on each other. */
const STACK_WINDOW = 0.2;
/** My drag skill's ally buffs / self shield: a one-time text on whoever got them ("공속 +40%", "보호막"). */
const BUFF_TEXT_COLOR = '#7ff0e0';
const SKILL_NUM_COLOR: Partial<Record<DamageSource, string>> = { normal: '#6fe7ff', drag: '#a6ff6b', ult: '#ffd23f', pet: '#ff9ad5' };
const SKILL_NUM_SIZE: Partial<Record<DamageSource, number>> = { normal: 20, drag: 24, ult: 24, pet: 21 };

export class Vfx implements FxHost {
  readonly floaters = new Pool<Floater>(
    () => ({ x: 0, y: 0, z: 0, dx: 0, age: 0, dur: 1, text: '', color: '#fff', size: 16, targetId: -1, kind: 0, amount: 0, pop: 0, label: '', stroke: '#0a0a0a', alpha: 1, key: '' }),
    110,
  );
  /** Per-skill flavour effects (slashes, arrows, meteors, clocks …). */
  readonly sfx = new SkillFx();
  readonly rings = new Pool<Ring>(() => ({ x: 0, y: 0, r0: 0, r1: 1, age: 0, dur: 1, color: '#fff', width: 2, fill: 0 }), 80);
  readonly flashes = new Pool<AreaFlash>(
    () => ({ cx: 0, cy: 0, ox: 0, oy: 0, hasOrigin: false, area: SINGLE_AREA, age: 0, dur: 1, color: '#fff', strength: 1 }),
    48,
  );
  readonly particles = new Pool<Particle>(
    () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, age: 0, dur: 1, color: '#fff', size: 3 }),
    360,
  );
  readonly ghosts = new Pool<Ghost>(
    () => ({ look: unitLook('monster', '?'), tier: 'normal', radius: 0.4, x: 0, y: 0, s: 1, phase: 0, age: 0, dur: 1, mode: 0 }),
    48,
  );
  readonly warns = new Pool<Warn>(() => ({ x: 0, y: 0, age: 0, dur: 1 }), 40);
  readonly labels = new Pool<Label>(
    () => ({ x: 0, y: 0, z: 0, age: 0, dur: 1, text: '', color: '#fff', size: 14, follow: -1, stroke: '#120508', alpha: 1, sy: 0, sx: 0, w: 0, pill: '' }),
    20,
  );
  /** skillCast keys seen since the last update (twin-cast dedupe). */
  private readonly castKeys = new Set<string>();
  /** Per source+skill: how many skillCast events this frame (= which data action each one is). */
  private readonly castSeq = new Map<string, number>();
  /** Melee swings started this frame: their basic damage waits for the wind-up. */
  private readonly pendingSwing = new Map<number, { ax: number; ay: number }>();
  private readonly deferred = new Pool<Deferred>(() => ({ ev: null as unknown as Deferred['ev'], t: 0, ax: 0, ay: 0 }), 64);
  /** Skill names I cast recently (my skill numbers are drawn full size, others' smaller). Value = expiry (vfx clock). */
  private readonly myNames = new Map<string, number>();
  private clock = 0;
  private memosRef: Map<number, UnitMemo> = new Map();
  /** Camera shake amplitude (px), decays fast. Only my own heavy skills shake. */
  shakeAmp = 0;
  /** Persistent skill fields that should not wear the generic tint (블리자드 is ice, not fire): centre → colour. */
  private readonly zoneTints: { x: number; y: number; color: string; until: number }[] = [];
  /** Ult screen pulse. */
  pulseT = 99;
  private pulseColor = '#ffffff';
  readonly dashes = new Pool<DashFx>(
    () => ({ entityId: -1, fx: 0, fy: 0, tx: 0, ty: 0, age: 0, land: DASH_LAND, travel: 0.18, color: '#fff', look: unitLook('monster', '?'), radius: 0.5, tier: 'character', s: 1 }),
    8,
  );

  private lastDamage = new Map<number, Floater>();
  /** Last number spawned per target (any kind): a near-simultaneous one is stacked above it. */
  private lastSpawn = new Map<number, Floater>();
  private heals = new Map<number, HealAcc>();
  private teles = new Map<number, TeleSnap>();
  private teleStamp = 0;

  // screen-space effects
  enrageT = 99;
  clearT = 99;
  fadeT = 99;
  bossFlash = 0;
  bossRetreatT = -1;
  banner = { active: false, age: 0, dur: 1.5, title: '', sub: '', color: '#fff', glyph: '' };

  reset(): void {
    this.floaters.clear();
    this.rings.clear();
    this.flashes.clear();
    this.particles.clear();
    this.ghosts.clear();
    this.warns.clear();
    this.labels.clear();
    this.dashes.clear();
    this.castKeys.clear();
    this.castSeq.clear();
    this.pendingSwing.clear();
    this.deferred.clear();
    this.myNames.clear();
    this.lastSpawn.clear();
    this.sfx.clear();
    this.zoneTints.length = 0;
    this.shakeAmp = 0;
    this.pulseT = 99;
    this.lastDamage.clear();
    this.heals.clear();
    this.teles.clear();
    this.bossFlash = 0;
    this.bossRetreatT = -1;
    this.enrageT = 99;
    this.banner.active = false;
  }

  // ─────────────────────────── event intake ───────────────────────────

  handle(ev: GameEvent, c: VfxContext): void {
    switch (ev.type) {
      case 'damage':
        this.onDamage(ev, c, null);
        break;
      case 'heal': {
        if (ev.amount <= 0) break;
        const acc = this.heals.get(ev.targetId);
        if (acc) {
          acc.amount += ev.amount;
          acc.x = ev.pos.x;
          acc.y = ev.pos.y;
        } else {
          this.heals.set(ev.targetId, { amount: ev.amount, age: 0, x: ev.pos.x, y: ev.pos.y });
        }
        break;
      }
      case 'attack':
        this.onAttack(ev, c);
        break;
      case 'skillCast': {
        // which data action this is: a skill's actions arrive in order, in the same frame
        const seqKey = `${ev.sourceId}|${ev.player}|${ev.skillId}`;
        const idx = this.castSeq.get(seqKey) ?? 0;
        this.castSeq.set(seqKey, idx + 1);
        // one skill = one flash: actions that share a footprint (bard's band hits allies AND enemies) arrive as twin casts
        const key = `${ev.sourceId}|${ev.skillId}|${ev.center.x},${ev.center.y}|${JSON.stringify(ev.area)}`;
        if (this.castKeys.has(key)) break;
        this.castKeys.add(key);
        this.onSkillCast(ev, c, idx);
        break;
      }
      case 'dash': {
        const ent = findEntity(c.state, ev.entityId);
        const d = this.dashes.spawn();
        d.entityId = ev.entityId;
        d.fx = ev.from.x;
        d.fy = ev.from.y;
        d.tx = ev.to.x;
        d.ty = ev.to.y;
        d.age = 0;
        d.land = ent && ent.anim === 'appear' ? DASH_LAND : 0;
        d.travel = Math.max(0.06, ev.duration);
        d.look = ent ? unitLook(ent.kind, ent.defId) : unitLook('monster', '?');
        d.color = ent && ent.kind === 'character' && ent.ownerPlayer !== null && ent.partyIndex !== null
          ? characterColor(c.state, ent.ownerPlayer, ent.partyIndex) ?? d.look.color
          : d.look.color;
        d.radius = ent ? ent.radius : 0.5;
        d.tier = ent ? ent.tier : 'character';
        d.s = ev.to.x >= ev.from.x ? 1 : -1;
        break;
      }
      case 'appear': {
        // landing burst in the character's own colour (matches the drag preview), not the player ring colour
        const color = characterColor(c.state, ev.player, ev.partyIndex) ?? playerColor(c.state, ev.player);
        this.ring(ev.pos.x, ev.pos.y, 0.3, 2.2, 0.45, color, 4, 0.25);
        this.ring(ev.pos.x, ev.pos.y, 0.2, 1.4, 0.3, '#ffffff', 2, 0);
        this.burst(ev.pos.x, ev.pos.y, 0.2, 14, color, 3.5, 2.5, 0.5);
        this.burst(ev.pos.x, ev.pos.y, 0.05, 10, '#cfc6b8', 2.2, 0.6, 0.45);
        break;
      }
      case 'leave': {
        let found: UnitMemo | null = null;
        for (const m of c.memos.values()) {
          if (m.kind === 'character' && m.ownerPlayer === ev.player && m.partyIndex === ev.partyIndex) {
            found = m;
            break;
          }
        }
        const color = playerColor(c.state, ev.player);
        if (found) this.ghost(found, 1, 0.35);
        this.burst(ev.pos.x, ev.pos.y, 0.5, 10, color, 2, 2.5, 0.4);
        break;
      }
      case 'death': {
        const m = c.memos.get(ev.entityId);
        if (ev.tier === 'boss') {
          if (this.bossRetreatT < 0) this.bossRetreatT = 0;
          break;
        }
        if (m) this.ghost(m, 0, ev.tier === 'mid' ? 0.8 : 0.5);
        const color = m ? m.look.color : ev.kind === 'character' ? '#cccccc' : '#aa6666';
        const big = ev.tier === 'mid';
        this.burst(ev.pos.x, ev.pos.y, 0.4, big ? 26 : 10, color, big ? 4 : 2.6, 3, big ? 0.8 : 0.5);
        if (big) this.ring(ev.pos.x, ev.pos.y, 0.4, 3, 0.6, '#ffd23f', 4, 0.15);
        if (ev.kind === 'character') this.burst(ev.pos.x, ev.pos.y, 0.8, 8, '#e0e7ff', 0.6, 1.2, 1.0, -1.5);
        break;
      }
      case 'spawnWarning': {
        const w = this.warns.spawn();
        w.x = ev.pos.x;
        w.y = ev.pos.y;
        w.age = 0;
        w.dur = Math.max(0.2, ev.delay);
        break;
      }
      case 'spawn': {
        // the marker's job is done once the unit is there (sim speed may differ from our real-time timer)
        const ws = this.warns;
        for (let i = ws.count - 1; i >= 0; i--) {
          const w = ws.items[i];
          if (Math.abs(w.x - ev.pos.x) < 0.8 && Math.abs(w.y - ev.pos.y) < 0.8) ws.kill(i);
        }
        const mid = ev.tier === 'mid';
        this.ring(ev.pos.x, ev.pos.y, 0.2, mid ? 3 : 1.3, mid ? 0.7 : 0.4, mid ? '#ff4d6d' : '#d8c7ff', mid ? 5 : 2, 0.2);
        this.burst(ev.pos.x, ev.pos.y, 0.05, mid ? 22 : 8, '#b8a99a', mid ? 3.5 : 2, 0.8, 0.5);
        if (mid) this.label(ev.pos.x, ev.pos.y, 2.6, '중형보스 등장!', '#ff6b6b', 20, 1.8);
        break;
      }
      case 'enrage':
        this.enrageT = 0;
        break;
      case 'floorStart':
        this.reset();
        this.fadeT = 0;
        break;
      case 'floorClear':
        this.clearT = 0;
        break;
      case 'bossRetreat':
        if (this.bossRetreatT < 0) this.bossRetreatT = 0;
        break;
      default:
        break;
    }
  }

  // ─────────────────────────── damage / attacks ───────────────────────────

  /** `swing` = the melee attacker's position when this hit waited for the swing's wind-up (null = immediate). */
  private onDamage(ev: Extract<GameEvent, { type: 'damage' }>, c: VfxContext, swing: { ax: number; ay: number } | null): void {
    if (!swing && (ev.source === undefined || ev.source === 'basic')) {
      const sw = this.pendingSwing.get(ev.targetId);
      if (sw) {
        const d = this.deferred.spawn();
        d.ev = ev;
        d.t = SWING_WINDUP;
        d.ax = sw.ax;
        d.ay = sw.ay;
        return;
      }
    }
    const m = c.memos.get(ev.targetId);
    if (m) {
      m.flash = 0.12;
      if (m.tier !== 'boss' && ev.amount >= 0.5) {
        // jolt away from the attacker (melee), otherwise a small knock back-and-up
        m.joltT = 0.14;
        if (swing) {
          const dx = (m.x - swing.ax) * PX_PER_UNIT;
          const dy = (m.y - swing.ay) * PX_PER_UNIT_Y;
          const d = Math.hypot(dx, dy) || 1;
          m.joltX = dx / d;
          m.joltY = dy / d;
        } else {
          m.joltX = Math.cos(m.facing + Math.PI) * 0.8;
          m.joltY = -0.4;
        }
      }
    }
    if (m && m.tier === 'boss') this.bossFlash = 1;
    if (ev.amount >= 0.5) {
      const src = ev.source;
      if (ev.targetTeam === 'ally') {
        this.addNumber(ev.targetId, ev.crit ? 1 : 0, ev.amount, ev.pos.x, ev.pos.y, COLORS.dmgAlly, m, '', ev.crit ? 22 : 16, '', 1, 'ally');
      } else if (ev.skillName && src && SKILL_NUM_COLOR[src]) {
        // skill hit: bigger, coloured by its slot; mine full size, other players' smaller and dimmer. No name under the
        // number (it was 12 px — unreadable on a phone): the callout over the caster already names the skill.
        const mine = (this.myNames.get(ev.skillName) ?? -1) >= this.clock;
        const base = (SKILL_NUM_SIZE[src] ?? 20) * (ev.crit ? 1.2 : 1);
        this.addNumber(ev.targetId, 4, ev.amount, ev.pos.x, ev.pos.y, SKILL_NUM_COLOR[src]!, m, '', mine ? base : base * 0.74, '', mine ? 1 : 0.7, `${src}:${ev.skillName}`, ev.crit ? '!' : '');
      } else if (src && src !== 'basic' && src !== 'summon' && src !== 'pet') {
        // burns, auras, leftover zones: small and warm, never mistaken for a hit
        this.addNumber(ev.targetId, 5, ev.amount, ev.pos.x, ev.pos.y, '#ffb36b', m, '', 13, '', 0.9, 'dot');
      } else {
        const crit = ev.crit;
        this.addNumber(ev.targetId, crit ? 1 : 0, ev.amount, ev.pos.x, ev.pos.y, crit ? COLORS.dmgCrit : COLORS.dmgEnemy, m, '', crit ? 24 : 15, '', 1, 'basic', crit ? '!' : '');
      }
    } else if (ev.absorbed >= 0.5) {
      this.addNumber(ev.targetId, 3, ev.absorbed, ev.pos.x, ev.pos.y, COLORS.absorbed, m, '', 13, '', 1, 'abs');
    }
  }

  private onAttack(ev: Extract<GameEvent, { type: 'attack' }>, c: VfxContext): void {
    const src = c.memos.get(ev.sourceId);
    if (!src) return;
    const t = c.memos.get(ev.targetId);
    const hero = src.kind === 'character';
    const k = hero ? (src.ownerPlayer === c.localPlayer ? 1 : 0.8) : 0.65;
    if (ev.ranged) {
      // muzzle / bow-string / casting flash at the weapon, toward the target
      const dx = t ? t.x - src.x : Math.cos(src.facing);
      const dy = t ? t.y - src.y : Math.sin(src.facing);
      const d = Math.hypot(dx, dy) || 1;
      const color = hero ? (src.look.accessory === 'gun' ? '#ffd166' : src.look.light) : '#ffb3b3';
      const f = this.sfx.add(Fx.Muzzle, src.x + (dx / d) * src.radius * 1.1, src.y + (dy / d) * src.radius * 1.1, 0.09, color, k);
      f.z = bodyHeight(src.look, src.radius) * 0.5 / PX_PER_UNIT_Z;
      f.r = src.look.accessory === 'gun' ? 13 : hero ? 9 : 7;
      f.ang = Math.atan2(dy * PX_PER_UNIT_Y, dx * PX_PER_UNIT);
      return;
    }
    if (!t) return;
    this.pendingSwing.set(ev.targetId, { ax: src.x, ay: src.y });
    if (t.tier === 'boss') return;
    // crescents for heroes' swings and for whatever hits MY character; a crowd of monsters trading blows with bots
    // only gets the hit flash + jolt (keeps 30-monster fights cheap and readable)
    if (!hero && !(t.kind === 'character' && t.ownerPlayer === c.localPlayer)) return;
    const color = hero ? src.look.light : '#ffb3b3';
    const tz = (bodyHeight(t.look, t.radius) * 0.5) / PX_PER_UNIT_Z;
    swingFx(this.sfx, src.x, src.y, t.x, t.y, tz, color, k, SWING_WINDUP * 0.6, hero && (src.look.accessory === 'axe' || src.look.accessory === 'hammer'));
  }

  // ─────────────────────────── skills ───────────────────────────

  private onSkillCast(ev: Extract<GameEvent, { type: 'skillCast' }>, c: VfxContext, idx: number): void {
    const ally = ev.team === 'ally';
    const pColor = ev.player !== null ? playerColor(c.state, ev.player) : '#7fd1ff';
    const src = ev.sourceId !== null ? c.memos.get(ev.sourceId) ?? null : null;
    const srcEnt = ev.sourceId !== null ? findEntity(c.state, ev.sourceId) : null;
    // a character's skills use its own colour (same as the drag preview / landing burst / card)
    const charColor = srcEnt && srcEnt.kind === 'character' && srcEnt.ownerPlayer !== null && srcEnt.partyIndex !== null
      ? characterColor(c.state, srcEnt.ownerPlayer, srcEnt.partyIndex)
      : src && src.kind === 'character' ? src.look.color : null;
    const color = ev.slot === 'pet' ? (petColor(ev.skillId) ?? pColor) : charColor ?? (ally ? pColor : '#ff4d4d');
    const ox = srcEnt ? srcEnt.pos.x : src ? src.x : ev.center.x;
    const oy = srcEnt ? srcEnt.pos.y : src ? src.y : ev.center.y;
    const delayed = (ev.delay ?? 0) > 0 || hasTelegraphAt(c.state.telegraphs, ev.team, ev.center.x, ev.center.y);

    if (!ally) {
      const tier = src ? src.tier : null;
      // boss pattern names are shown by the HUD as a cast pill under the boss bar (a world label sat on the eye)
      if (tier === 'mid' && idx === 0) {
        const m = src!;
        const z = bodyTop(m.look, m.tier, bodyHeight(m.look, m.radius), bodyWidth(m.radius)) / PX_PER_UNIT_Z + 1.5;
        this.label(ox, oy, z, ev.name, '#ff8a8a', 16, 1.4);
      }
      if (src && tier !== 'boss') this.ring(ox, oy, 0.3, 1.4, 0.35, '#ff4d4d', 3, 0.15);
      if (!delayed) this.flash(ev.center.x, ev.center.y, ox, oy, ev.area, 0.35, '#ff4d4d', 0.6);
      return;
    }

    const local = ev.player === c.localPlayer;
    const strong = ev.slot === 'ult' || ev.slot === 'drag' || ev.slot === 'pet';
    // another player's cast: same shape and direction, drawn softer (fewer particles, fainter fill) so it never buries
    // my own preview or fight; mine stay at full strength
    const k = ev.player !== null && !local ? OTHER_PLAYER_FX : 1;
    const action = actionFor(ev.skillId, ev.slot, idx);
    if (local && ev.name) this.myNames.set(ev.name, this.clock + 1.5 + (ev.delay ?? 0) + (ev.hits ?? 1) * (ev.hitInterval ?? 0.2) + (action?.zone?.duration ?? 0));
    // cast pose on the caster (index.ts reads these timers)
    if (src && idx === 0) {
      if (ev.slot === 'ult') src.ultT = 0;
      else if (ev.slot === 'normal' || ev.slot === 'drag') src.skillT = 0;
    }
    if (idx === 0) this.callout(ev, c, src, local, color);
    if (local && ev.slot === 'drag' && action) this.buffText(ev, c, action, src);

    const selfOnly = action?.affects === 'self';
    if (!delayed && !selfOnly) this.flash(ev.center.x, ev.center.y, ox, oy, ev.area, strong ? 0.55 : 0.4, color, (strong ? 0.8 : 0.5) * k);
    const info: CastInfo = {
      ev,
      action,
      ox,
      oy,
      src: ev.sourceId ?? -1,
      face: src ? (Math.cos(src.facing) >= 0 ? 1 : -1) : 1,
      color,
      k,
      local,
      dashTravel: this.dashTravel(ev.sourceId),
    };
    castFx(this.sfx, this, info);
    if (action?.zone && ZONE_TINT[ev.skillId]) {
      if (this.zoneTints.length > 8) this.zoneTints.shift();
      this.zoneTints.push({ x: ev.center.x, y: ev.center.y, color: ZONE_TINT[ev.skillId], until: this.clock + action.zone.duration + 1 });
    }
    if ((ev.slot === 'drag' || ev.slot === 'pet') && !delayed && !selfOnly) {
      const a = ev.area;
      if (a.shape === 'circle' || a.shape === 'single') {
        const r = Math.min(8, areaRadius(a));
        this.ring(ev.center.x, ev.center.y, 0.2, Math.max(1.2, r), 0.45, color, 5, 0.18 * k);
        this.ring(ev.center.x, ev.center.y, 0.1, Math.max(0.8, r * 0.6), 0.3, '#ffffff', 2, 0);
        this.burst(ev.center.x, ev.center.y, 0.3, Math.round((ev.slot === 'pet' ? 18 : 22) * k), color, Math.max(2, r * 1.6), 2.5, 0.6);
      } else {
        // shaped skills: dust spread over the footprint (and swept along its direction)
        this.burstArea(ev.center.x, ev.center.y, a, Math.round(24 * k), color);
      }
    }
    if (ev.slot === 'pet' && delayed) {
      // frog bomb & co: something visibly falls onto the spot while the telegraph counts down
      const f = this.sfx.add(Fx.Meteor, ev.center.x, ev.center.y, Math.min(0.4, ev.delay ?? 0.4), color, k);
      f.x2 = ev.center.x;
      f.y2 = ev.center.y;
      f.r = Math.min(4, areaRadius(ev.area));
      f.wait = Math.max(0, (ev.delay ?? 0.4) - 0.4);
      f.impact = Impact.Fire;
    }
    if (ev.slot === 'ult' && idx === 0) {
      this.ring(ox, oy, 0.4, 4, 0.7, color, 6, 0.12 * k);
      this.ring(ox, oy, 0.6, 11, 0.8, lighten(color, 0.4), 8 * k, 0);
      this.burst(ox, oy, 0.5, Math.round(26 * k), color, 5, 4, 0.8);
      const pl = this.sfx.add(Fx.Pillar, ox, oy, 0.7, color, k);
      pl.r = 0.8;
      pl.z = 5.5;
      pl.follow = ev.sourceId ?? -1;
      if (local) {
        this.showBanner(ev, c, color);
        this.pulse(color);
      }
    }
  }

  /** Seconds the dash of `id` (started this frame) takes, 0 when it isn't dashing. */
  private dashTravel(id: number | null): number {
    if (id == null) return 0;
    const ds = this.dashes;
    for (let i = ds.count - 1; i >= 0; i--) if (ds.items[i].entityId === id) return ds.items[i].travel;
    return 0;
  }

  /**
   * Skill name over the caster: mine bigger (drag ones biggest, with "!"), other players' small and dim; another
   * player's ult says whose it is. Follows the caster; one callout per caster (a new one replaces the old).
   */
  private callout(ev: Extract<GameEvent, { type: 'skillCast' }>, c: VfxContext, src: UnitMemo | null, local: boolean, color: string): void {
    if (!ev.name) return;
    let text = ev.name;
    let size = 15;
    let dur = 1.1;
    let fill = '#ffffff';
    let alpha = 1;
    // other players: only their drag skills and ults get a name, with whose it is and a border in their player colour
    // (their normal skills and pets stay silent — those tiny names were read as mine)
    const who = !local && ev.player != null ? c.state.players[ev.player]?.name : null;
    switch (ev.slot) {
      case 'normal':
        if (!local) return;
        size = 18;
        break;
      case 'drag':
        text = who ? `${who} · ${ev.name}` : `${ev.name}!`;
        size = local ? 27 : 16;
        dur = 1.4;
        fill = local ? lighten(color, 0.45) : '#e6ebf5';
        alpha = local ? 1 : 0.8;
        break;
      case 'ult':
        if (who) text = `${who} · ${ev.name}`;
        size = local ? 24 : 17;
        dur = 1.6;
        fill = '#ffe08a';
        alpha = local ? 1 : 0.8;
        break;
      case 'pet':
        if (!local) return;
        size = 18;
        fill = lighten(color, 0.5);
        break;
      default:
        return;
    }
    const follow = ev.slot !== 'pet' && src ? src.id : -1;
    // the same caster's previous callout of the same kind gives way (a fresh normal skill replaces the last one);
    // different kinds stack (a drag callout stays while the normal skill fires right after the landing)
    const ls = this.labels;
    if (follow >= 0) for (let i = ls.count - 1; i >= 0; i--) if (ls.items[i].follow === follow && ls.items[i].size === size) ls.kill(i);
    const z = src && ev.slot !== 'pet' ? (bodyTop(src.look, src.tier, bodyHeight(src.look, src.radius), bodyWidth(src.radius)) + (local ? 66 : 42)) / PX_PER_UNIT_Z : 1.6; // above the name tag (+ my ▼)
    const l = this.label(follow >= 0 && src ? src.x : ev.center.x, follow >= 0 && src ? src.y : ev.center.y, z, text, fill, size, dur);
    l.follow = follow;
    l.stroke = mix(color, '#000000', 0.72);
    l.alpha = alpha;
    l.pill = local || ev.player == null ? color : playerColor(c.state, ev.player);
  }

  /**
   * My drag skill's non-damage part, said once: "아군 3명 공속 +40% · 공격력 +30%" (바드), "아군 2명 방어 +25%"
   * (팔라딘), "보호막 30%" over the caster (가디언 / 워든). Heals already show as "+N".
   */
  private buffText(ev: Extract<GameEvent, { type: 'skillCast' }>, c: VfxContext, action: SkillAction, src: UnitMemo | null): void {
    const bits: string[] = [];
    for (const e of action.effects) {
      if (e.kind === 'shield') bits.push(`보호막 ${Math.round(e.amount * 100)}%`);
      else if (e.kind === 'status' && e.status === 'haste') bits.push(`공속 +${Math.round(e.value * 100)}%`);
      else if (e.kind === 'status' && e.status === 'atkUp') bits.push(`공격력 +${Math.round(e.value * 100)}%`);
      else if (e.kind === 'status' && e.status === 'defUp') bits.push(`방어 +${Math.round(e.value * 100)}%`);
    }
    if (!bits.length) return;
    const text = bits.join(' · ');
    if (action.affects === 'self') {
      if (!src) return;
      const z = (bodyTop(src.look, src.tier, bodyHeight(src.look, src.radius), bodyWidth(src.radius)) + 10) / PX_PER_UNIT_Z;
      const l = this.label(src.x, src.y, z, text, BUFF_TEXT_COLOR, 16, 1.4);
      l.follow = src.id;
      l.stroke = '#05221f';
      l.pill = BUFF_TEXT_COLOR;
      return;
    }
    if (action.affects !== 'allies') return;
    // one line, not one per ally (four identical pills piled up): over my caster when it got it too, with how many did
    let n = 0;
    let first: UnitMemo | null = null;
    for (const m of c.memos.values()) {
      if (m.kind !== 'character' || m.team !== 'ally') continue;
      if (!hitsArea(ev.area, ev.center, ev.center, { x: m.x, y: m.y }, m.radius)) continue;
      n++;
      if (!first || m === src) first = m;
    }
    if (!first) return;
    const z = (bodyTop(first.look, first.tier, bodyHeight(first.look, first.radius), bodyWidth(first.radius)) + 10) / PX_PER_UNIT_Z;
    const l = this.label(first.x, first.y, z, n > 1 ? `아군 ${n}명 ${text}` : text, BUFF_TEXT_COLOR, 16, 1.4);
    l.follow = first.id;
    l.stroke = '#05221f';
    l.pill = BUFF_TEXT_COLOR;
  }

  /** Colour for a persistent zone at (x, y) when a skill gave it its own look (null = the generic kind tint). */
  zoneTint(x: number, y: number): string | null {
    for (let i = this.zoneTints.length - 1; i >= 0; i--) {
      const t = this.zoneTints[i];
      if (t.until < this.clock) continue;
      if (Math.abs(t.x - x) < 0.05 && Math.abs(t.y - y) < 0.05) return t.color;
    }
    return null;
  }

  // ─────────────────────────── FxHost ───────────────────────────

  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** Brief coloured glow from the screen edges (my ult). */
  private pulse(color: string): void {
    this.pulseT = 0;
    this.pulseColor = color;
  }

  private showBanner(ev: Extract<GameEvent, { type: 'skillCast' }>, c: VfxContext, color: string): void {
    const b = this.banner;
    const m = ev.sourceId !== null ? c.memos.get(ev.sourceId) : undefined;
    b.active = true;
    b.age = 0;
    b.dur = 1.5;
    b.title = ev.name;
    b.sub = m ? `${m.look.name} · 궁극기` : '궁극기';
    b.color = m ? m.look.color : color;
    b.glyph = m && m.look.role ? ROLE_GLYPH[m.look.role] : '★';
  }

  /**
   * Where a dashing entity should be DRAWN this frame, as an offset from its sim position (= the dash end), plus the
   * landing lift. null when it is not dashing.
   */
  dashPose(entityId: number, out: { ox: number; oy: number; z: number }): boolean {
    const ds = this.dashes;
    for (let i = ds.count - 1; i >= 0; i--) {
      const d = ds.items[i];
      if (d.entityId !== entityId) continue;
      if (d.age >= d.land + d.travel) return false;
      let x = d.fx;
      let y = d.fy;
      let z = 0;
      if (d.age < d.land) {
        const k = 1 - d.age / d.land;
        z = k * k * 1.6;
      } else {
        const k = easeOut(Math.min(1, (d.age - d.land) / d.travel));
        x = d.fx + (d.tx - d.fx) * k;
        y = d.fy + (d.ty - d.fy) * k;
      }
      out.ox = x - d.tx;
      out.oy = y - d.ty;
      out.z = z;
      return true;
    }
    return false;
  }

  private dashHead(d: DashFx): number {
    return d.age < d.land ? 0 : easeOut(Math.min(1, (d.age - d.land) / d.travel));
  }

  // ─────────────────────────── spawners ───────────────────────────

  private addNumber(
    targetId: number,
    kind: FloaterKind,
    amount: number,
    x: number,
    y: number,
    color: string,
    m: UnitMemo | undefined,
    prefix: string,
    size: number,
    label: string,
    alpha: number,
    key: string,
    suffix = '',
  ): void {
    {
      // hits on one target within the window add up into one number: same skill, or basic hits (a crit among them
      // turns the whole number into a crit) — a pile of "182! 13 113!" became one readable number
      const last = this.lastDamage.get(targetId);
      const win = kind === 2 ? HEAL_WINDOW : kind === 4 ? MERGE_WINDOW * 1.3 : MERGE_WINDOW;
      const basicLike = (k: FloaterKind) => k === 0 || k === 1;
      const same = last && (last.kind === kind || (basicLike(kind) && basicLike(last.kind)));
      if (last && same && last.targetId === targetId && last.key === key && last.age < win && last.age < last.dur) {
        last.amount += amount;
        const crit = suffix === '!' || last.text.endsWith('!');
        if (kind === 1 && last.kind === 0) {
          last.kind = 1;
          last.color = color;
          last.size = Math.max(last.size, size);
          last.stroke = '#4a2500';
          last.dur = 1.05;
        }
        last.text = prefix + Math.round(last.amount) + (crit ? '!' : suffix);
        last.pop = 0;
        if (label && !last.label) last.label = label;
        return;
      }
    }
    const f = this.floaters.spawn();
    const boss = m && m.tier === 'boss';
    f.targetId = targetId;
    f.kind = kind;
    f.amount = amount;
    f.text = prefix + Math.round(amount) + suffix;
    f.color = color;
    f.size = boss && kind === 0 ? Math.max(size, 17) : size;
    f.age = 0;
    f.dur = kind === 1 || kind === 4 ? 1.05 : kind === 5 ? 0.7 : 0.85;
    f.pop = 0;
    f.label = label;
    f.alpha = alpha;
    f.key = key;
    f.stroke = kind === 1 ? '#4a2500' : kind === 4 ? mix(color, '#000000', 0.8) : '#0a0a0a';
    if (boss && m) {
      // numbers on the boss pop on its flanks, beside (not over) the big eye and low enough that they rise and fade
      // before the line under the top HUD (they used to pile up on that line), spread a little in height
      const sideX = Math.random() < 0.5 ? -1 : 1;
      f.x = x + sideX * m.radius * (0.78 + Math.random() * 0.3);
      f.y = y + 3.2;
      f.z = Math.random() * 0.8;
    } else {
      // skill numbers sit a little higher than basic ones so the two don't pile into one blob
      f.x = x + (Math.random() - 0.5) * (kind === 4 ? 0.9 : 0.5);
      f.y = y;
      const h = m ? bodyTop(m.look, m.tier, bodyHeight(m.look, m.radius), bodyWidth(m.radius)) : 50;
      f.z = h / PX_PER_UNIT_Z + (kind === 4 ? 0.75 : kind === 5 ? 0.15 : 0.45);
    }
    f.dx = (Math.random() - 0.5) * (kind === 4 ? 26 : 18);
    // another number on this target a moment ago (a different skill, a burn tick …): start above it, not on it — at
    // most two levels up (a pile climbing into the top HUD was worse). The boss spreads its numbers over its flanks.
    const prev = this.lastSpawn.get(targetId);
    if (!boss && prev && prev !== f && prev.targetId === targetId && prev.age < STACK_WINDOW && prev.age < prev.dur) {
      const step = (prev.size * 0.95) / PX_PER_UNIT_Z;
      f.z = Math.min(Math.max(f.z, prev.z + step), f.z + 2 * step);
      f.x = prev.x;
      f.dx = prev.dx;
    }
    this.lastSpawn.set(targetId, f);
    this.lastDamage.set(targetId, f);
  }

  ring(x: number, y: number, r0: number, r1: number, dur: number, color: string, width: number, fill: number): void {
    const r = this.rings.spawn();
    r.x = x;
    r.y = y;
    r.r0 = r0;
    r.r1 = r1;
    r.age = 0;
    r.dur = dur;
    r.color = color;
    r.width = width;
    r.fill = fill;
  }

  flash(cx: number, cy: number, ox: number, oy: number, area: AreaShape, dur: number, color: string, strength: number): void {
    const f = this.flashes.spawn();
    f.cx = cx;
    f.cy = cy;
    f.ox = ox;
    f.oy = oy;
    f.hasOrigin = true;
    f.area = area;
    f.age = 0;
    f.dur = dur;
    f.color = color;
    f.strength = strength;
  }

  /** Radial particle burst. speed in units/s, up = initial upward speed. g < 0 → floats up. */
  burst(x: number, y: number, z: number, n: number, color: string, speed: number, up: number, dur: number, g = 9): void {
    for (let i = 0; i < n; i++) {
      const p = this.particles.spawn();
      const a = Math.random() * TAU;
      const sp = speed * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.vz = up * (0.5 + Math.random() * 0.7);
      p.g = g;
      p.age = 0;
      p.dur = dur * (0.6 + Math.random() * 0.5);
      p.color = color;
      p.size = 2.5 + Math.random() * 3;
    }
  }

  /** Particles scattered over a shaped footprint; fixed-direction shapes also push them along their direction. */
  private burstArea(cx: number, cy: number, area: AreaShape, n: number, color: string): void {
    const samples = aimSamples(area);
    const dir = area.shape === 'rect' || area.shape === 'cone' ? DIR_VEC[area.dir] : null;
    const spread = area.shape === 'rect' ? area.width / 2 : area.shape === 'cross' ? area.width / 2 : 0.7;
    for (let i = 0; i < n; i++) {
      const s0 = samples[i % samples.length];
      const p = this.particles.spawn();
      const a = Math.random() * TAU;
      const sp = 1.2 + Math.random() * 2;
      p.x = cx + s0.x + (Math.random() - 0.5) * spread * 2;
      p.y = cy + s0.y + (Math.random() - 0.5) * spread * 2;
      p.z = 0.1;
      p.vx = Math.cos(a) * sp + (dir ? dir.x * 5 : 0);
      p.vy = Math.sin(a) * sp + (dir ? dir.y * 5 : 0);
      p.vz = 2 + Math.random() * 2;
      p.g = 9;
      p.age = 0;
      p.dur = 0.4 + Math.random() * 0.3;
      p.color = i % 3 === 0 ? '#ffffff' : color;
      p.size = 2.5 + Math.random() * 3;
    }
  }

  private ghost(m: UnitMemo, mode: 0 | 1, dur: number): void {
    const g = this.ghosts.spawn();
    g.look = m.look;
    g.tier = m.tier;
    g.radius = m.radius;
    g.x = m.x;
    g.y = m.y;
    g.s = Math.cos(m.facing) >= 0 ? 1 : -1;
    g.phase = m.phase;
    g.age = 0;
    g.dur = dur;
    g.mode = mode;
  }

  private label(x: number, y: number, z: number, text: string, color: string, size: number, dur: number): Label {
    const l = this.labels.spawn();
    l.x = x;
    l.y = y;
    l.z = z;
    l.text = text;
    l.color = color;
    l.size = size;
    l.age = 0;
    l.dur = dur;
    l.follow = -1;
    l.stroke = '#120508';
    l.alpha = 1;
    l.pill = '';
    l.w = 0;
    return l;
  }

  // ─────────────────────────── per-frame update ───────────────────────────

  /** Track telegraphs to fire an impact flash when one resolves (disappears near the end of its timer). */
  trackTelegraphs(teles: Telegraph[]): void {
    const stamp = ++this.teleStamp;
    for (const t of teles) {
      let s = this.teles.get(t.id);
      if (!s) {
        s = { cx: 0, cy: 0, ox: 0, oy: 0, area: t.area, team: t.team, remaining: 0, stamp };
        this.teles.set(t.id, s);
      }
      s.cx = t.center.x;
      s.cy = t.center.y;
      s.ox = t.origin.x;
      s.oy = t.origin.y;
      s.area = t.area;
      s.team = t.team;
      s.remaining = t.remaining;
      s.stamp = stamp;
    }
    this.teles.forEach(this.resolveTele);
  }

  /** Map.forEach callback (bound once): fires the impact flash for telegraphs that vanished this frame. */
  private readonly resolveTele = (s: TeleSnap, id: number): void => {
    if (s.stamp === this.teleStamp) return;
    if (s.remaining <= 0.25 && s.team === 'enemy') {
      const enemy = s.team === 'enemy';
      const color = enemy ? '#ff4d4d' : '#7fd1ff';
      this.flash(s.cx, s.cy, s.ox, s.oy, s.area, 0.45, color, 1);
      const r = Math.min(8, areaRadius(s.area));
      if (s.area.shape === 'circle' || s.area.shape === 'single') {
        this.ring(s.cx, s.cy, r * 0.3, r * 1.08, 0.4, enemy ? '#ffb199' : '#ffffff', 4, 0);
        this.burst(s.cx, s.cy, 0.1, Math.min(30, 8 + Math.round(r * 4)), enemy ? '#ff7b54' : '#bde0fe', r * 1.4, 3, 0.55);
      } else if (s.area.shape !== 'line') {
        this.burstArea(s.cx, s.cy, s.area, 22, enemy ? '#ff7b54' : '#bde0fe');
      } else {
        const mx = (s.ox + s.cx) / 2;
        const my = (s.oy + s.cy) / 2;
        this.burst(mx, my, 0.1, 18, enemy ? '#ff7b54' : '#bde0fe', 3, 3, 0.5);
      }
    }
    this.teles.delete(id);
  };

  update(dt: number, c: VfxContext): void {
    this.castKeys.clear();
    this.castSeq.clear();
    this.pendingSwing.clear();
    this.clock += dt;
    this.memosRef = c.memos;
    // melee hits that waited for the swing's wind-up
    const dq = this.deferred;
    for (let i = dq.count - 1; i >= 0; i--) {
      const d = dq.items[i];
      d.t -= dt;
      if (d.t > 0) continue;
      const ev = d.ev;
      TMP_SW.ax = d.ax;
      TMP_SW.ay = d.ay;
      dq.kill(i);
      this.onDamage(ev, c, TMP_SW);
    }
    this.sfx.update(dt, this, c.memos);
    this.shakeAmp = this.shakeAmp > 0.2 ? this.shakeAmp * Math.exp(-dt * 14) : 0;
    this.pulseT += dt;
    if (this.myNames.size > 24) for (const [n, t] of this.myNames) if (t < this.clock) this.myNames.delete(n);
    // flush accumulated heals: big heals become numbers, trickles (aura/regen ticks) only sparkle
    for (const [id, h] of this.heals) {
      h.age += dt;
      if (h.age < HEAL_WINDOW * 0.5) continue;
      const m = c.memos.get(id);
      const threshold = m && m.maxHp > 0 ? m.maxHp * HEAL_SHOW_FRAC : HEAL_SHOW_ABS;
      if (h.amount >= threshold) {
        this.addNumber(id, 2, h.amount, h.x, h.y, COLORS.heal, m, '+', 16, '', 1, 'heal');
        this.heals.delete(id);
      } else if (h.age >= HEAL_TRICKLE_WINDOW) {
        if (m && h.amount > 0) this.burst(h.x, h.y, 0.6, 2, COLORS.heal, 0.4, 1.2, 0.7, -1);
        this.heals.delete(id);
      }
    }
    const fl = this.floaters;
    for (let i = fl.count - 1; i >= 0; i--) {
      const f = fl.items[i];
      f.age += dt;
      f.pop += dt;
      if (f.age >= f.dur) {
        if (this.lastDamage.get(f.targetId) === f) this.lastDamage.delete(f.targetId);
        fl.kill(i);
      }
    }
    ageAll(this.rings, dt);
    ageAll(this.flashes, dt);
    ageAll(this.ghosts, dt);
    ageAll(this.warns, dt);
    ageAll(this.labels, dt);
    const ls = this.labels;
    for (let i = 0; i < ls.count; i++) {
      const l = ls.items[i];
      if (l.follow < 0) continue;
      const m = c.memos.get(l.follow);
      if (m) {
        l.x = m.x;
        l.y = m.y;
      }
    }
    const ds = this.dashes;
    for (let i = ds.count - 1; i >= 0; i--) {
      const d = ds.items[i];
      const was = d.age;
      d.age += dt;
      // a puff of dust when the streak starts and when it stops
      if (was < d.land && d.age >= d.land) this.burst(d.fx, d.fy, 0.1, 8, '#cfc6b8', 2.5, 0.8, 0.35);
      if (was < d.land + d.travel && d.age >= d.land + d.travel) {
        this.burst(d.tx, d.ty, 0.2, 12, d.color, 3, 1.5, 0.4);
        this.ring(d.tx, d.ty, 0.2, 1.2, 0.3, '#ffffff', 2.5, 0);
      }
      if (d.age >= d.land + d.travel + DASH_TRAIL_FADE) ds.kill(i);
    }
    const ps = this.particles;
    for (let i = ps.count - 1; i >= 0; i--) {
      const p = ps.items[i];
      p.age += dt;
      if (p.age >= p.dur) {
        ps.kill(i);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= p.g * dt;
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.3;
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      const drag = Math.exp(-2.5 * dt);
      p.vx *= drag;
      p.vy *= drag;
    }
    this.enrageT += dt;
    this.clearT += dt;
    this.fadeT += dt;
    this.bossFlash = Math.max(0, this.bossFlash - dt * 8);
    if (this.bossRetreatT >= 0) this.bossRetreatT += dt;
    if (this.banner.active) {
      this.banner.age += dt;
      if (this.banner.age >= this.banner.dur) this.banner.active = false;
    }
  }

  // ─────────────────────────── drawing ───────────────────────────

  /** Ground-level effects (under units): spawn warnings, area flashes, rings. */
  drawGround(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    // spawn warnings
    const ws = this.warns;
    for (let i = 0; i < ws.count; i++) {
      const w = ws.items[i];
      if (!cam.visibleX(w.x, 2)) continue;
      const p = Math.min(1, w.age / w.dur);
      const sx = cam.sx(w.x);
      const sy = cam.sy(w.y);
      const pulse = 0.5 + 0.5 * Math.sin(time * 14);
      ctx.globalAlpha = 0.18 + 0.12 * pulse;
      ctx.fillStyle = COLORS.spawnWarn;
      ctx.beginPath();
      ctx.ellipse(sx, sy, 0.8 * PX_PER_UNIT, 0.8 * PX_PER_UNIT_Y, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.spawnWarn;
      ctx.stroke();
      const rr = 1.8 - 1.0 * p;
      ctx.globalAlpha = 0.4 + 0.5 * p;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(sx, sy, rr * PX_PER_UNIT, rr * PX_PER_UNIT_Y, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = boldFont(18);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#2a0016';
      ctx.strokeText('!', sx, sy - 2);
      ctx.fillStyle = '#ffd1e8';
      ctx.fillText('!', sx, sy - 2);
    }
    // area flashes
    const fs = this.flashes;
    for (let i = 0; i < fs.count; i++) {
      const f = fs.items[i];
      const p = f.age / f.dur;
      const area = clampArea(f.area);
      const grow = 0.88 + 0.12 * easeOut(Math.min(1, p * 3));
      TMP_C.x = f.cx;
      TMP_C.y = f.cy;
      TMP_O.x = f.ox;
      TMP_O.y = f.oy;
      pathArea(ctx, cam, TMP_C, f.hasOrigin ? TMP_O : null, area, area.shape === 'line' ? 1 : grow);
      ctx.globalAlpha = (1 - p) * 0.45 * f.strength;
      ctx.fillStyle = f.color;
      ctx.fill();
      ctx.globalAlpha = (1 - p) * 0.9 * f.strength;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.sfx.drawGround(ctx, cam, this.memosRef, time);
    this.drawDashStreaks(ctx, cam);
    // rings
    const rs = this.rings;
    for (let i = 0; i < rs.count; i++) {
      const r = rs.items[i];
      const p = r.age / r.dur;
      const rad = r.r0 + (r.r1 - r.r0) * easeOut(p);
      const sx = cam.sx(r.x);
      const sy = cam.sy(r.y);
      ctx.beginPath();
      ctx.ellipse(sx, sy, Math.max(0.5, rad * PX_PER_UNIT), Math.max(0.5, rad * PX_PER_UNIT_Y), 0, 0, TAU);
      if (r.fill > 0) {
        ctx.globalAlpha = r.fill * (1 - p);
        ctx.fillStyle = r.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = r.width * (1 - p * 0.5);
      ctx.strokeStyle = r.color;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Ground streak of each dash: a tapered band in the character colour from the start to the moving head. */
  private drawDashStreaks(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const ds = this.dashes;
    for (let i = 0; i < ds.count; i++) {
      const d = ds.items[i];
      if (d.age < d.land) continue;
      const head = this.dashHead(d);
      const end = d.land + d.travel;
      const fade = d.age <= end ? 1 : Math.max(0, 1 - (d.age - end) / DASH_TRAIL_FADE);
      const hx = d.fx + (d.tx - d.fx) * head;
      const hy = d.fy + (d.ty - d.fy) * head;
      // tail catches up after arrival so the streak shrinks into the character
      const tailK = d.age <= end ? 0 : Math.min(1, (d.age - end) / DASH_TRAIL_FADE);
      const tx0 = d.fx + (hx - d.fx) * tailK;
      const ty0 = d.fy + (hy - d.fy) * tailK;
      const x0 = cam.sx(tx0);
      const y0 = cam.sy(ty0);
      const x1 = cam.sx(hx);
      const y1 = cam.sy(hy);
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 2) continue;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const w = d.radius * PX_PER_UNIT * 1.9;
      ctx.save();
      ctx.translate(x0, y0);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.65 * fade;
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, -w / 2);
      ctx.lineTo(len, w / 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(len * 0.3, 0);
      ctx.lineTo(len, -w * 0.14);
      ctx.lineTo(len, w * 0.14);
      ctx.closePath();
      ctx.fill();
      // speed lines
      ctx.globalAlpha = 0.6 * fade;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const k of [-0.42, 0.42]) {
        ctx.moveTo(len * 0.45, k * w);
        ctx.lineTo(len * 0.95, k * w);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** Fading bodies of dead / swapped-out units (drawn before live units) + dash afterimages. */
  drawGhosts(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const ds = this.dashes;
    for (let i = 0; i < ds.count; i++) {
      const d = ds.items[i];
      if (d.age < d.land) continue;
      const head = this.dashHead(d);
      const end = d.land + d.travel;
      const fade = d.age <= end ? 1 : Math.max(0, 1 - (d.age - end) / DASH_TRAIL_FADE);
      const w = bodyWidth(d.radius);
      const h = w * d.look.heightMul;
      for (let j = 1; j <= 4; j++) {
        const k = head - j * 0.2;
        if (k <= 0) break;
        const x = d.fx + (d.tx - d.fx) * k;
        const y = d.fy + (d.ty - d.fy) * k;
        ctx.globalAlpha = 0.42 * (1 - j / 5) * fade;
        drawBody(ctx, d.look, d.tier, cam.sx(x), cam.sy(y), w, h, d.s, time, 0, true);
      }
    }
    ctx.globalAlpha = 1;
    const gs = this.ghosts;
    for (let i = 0; i < gs.count; i++) {
      const g = gs.items[i];
      if (!cam.visibleX(g.x, 3)) continue;
      const p = g.age / g.dur;
      const w = bodyWidth(g.radius);
      const h = w * g.look.heightMul;
      const fx = cam.sx(g.x);
      let fy = cam.sy(g.y);
      ctx.save();
      if (g.mode === 0) {
        // death: flatten + fade
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.translate(fx, fy);
        ctx.scale(1 + p * 0.25, Math.max(0.05, 1 - p * 0.85));
        drawBody(ctx, g.look, g.tier, 0, 0, w, h, g.s, time, g.phase, p < 0.15);
      } else {
        // leave: rise + thin out
        fy -= p * 40;
        ctx.globalAlpha = (1 - p) * 0.8;
        ctx.translate(fx, fy);
        ctx.scale(Math.max(0.1, 1 - p * 0.7), 1 + p * 0.3);
        drawBody(ctx, g.look, g.tier, 0, 0, w, h, g.s, time, g.phase, true);
      }
      ctx.restore();
    }
  }

  /** Airborne effects over units: particles + skill flavour (slashes, arrows, meteors …). */
  drawAir(ctx: CanvasRenderingContext2D, cam: Camera, time = 0): void {
    const ps = this.particles;
    for (let i = 0; i < ps.count; i++) {
      const p = ps.items[i];
      const k = 1 - p.age / p.dur;
      const s = p.size * (0.4 + 0.6 * k);
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(cam.sx(p.x) - s / 2, cam.sy(p.y) - p.z * PX_PER_UNIT_Z - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    this.sfx.drawAir(ctx, cam, this.memosRef, time);
  }

  /** Floating numbers + world labels (topmost world layer). */
  drawOverlay(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const ls = this.labels;
    // layout pass: clamp into the field area, then lift any callout that would sit on an earlier one
    for (let i = 0; i < ls.count; i++) {
      const l = ls.items[i];
      const p = l.age / l.dur;
      if (l.w <= 0) {
        ctx.font = boldFont(l.size);
        const mt = ctx.measureText(l.text) as TextMetrics | undefined;
        l.w = (mt && Number.isFinite(mt.width) ? mt.width : l.text.length * l.size * 0.9) + 10;
      }
      // keep world labels (e.g. "중형보스 등장!" at a top-edge spawn) clear of the top HUD row and the screen edges
      l.sx = Math.min(LOGICAL_W - LABEL_MARGIN_X, Math.max(LABEL_MARGIN_X, cam.sx(l.x)));
      l.sy = Math.max(LABEL_MIN_Y, cam.sy(l.y) - l.z * PX_PER_UNIT_Z) - easeOut(Math.min(1, p * 4)) * 10;
      // callout pills are ~1.3 × size tall: keep their boxes apart; at the top edge (units by the wall, labels clamped
      // to LABEL_MIN_Y) there is no room above, so the later one goes below instead of under the HUD row
      // (moves only up, or once out of room only down, so it settles)
      let down = false;
      for (let guard = 0; guard < 12; guard++) {
        let hit: Label | null = null;
        for (let j = 0; j < i && !hit; j++) {
          const o = ls.items[j];
          if (
            Math.abs(o.sx - l.sx) < (o.w + l.w) / 2 + 8 &&
            l.sy - l.size * PILL_TOP < o.sy + o.size * PILL_BOTTOM + PILL_GAP - 0.01 &&
            o.sy - o.size * PILL_TOP < l.sy + l.size * PILL_BOTTOM + PILL_GAP - 0.01
          )
            hit = o;
        }
        if (!hit) break;
        const up = hit.sy - hit.size * PILL_TOP - PILL_GAP - l.size * PILL_BOTTOM;
        if (!down && up >= LABEL_MIN_Y) l.sy = up;
        else {
          down = true;
          l.sy = hit.sy + hit.size * PILL_BOTTOM + PILL_GAP + l.size * PILL_TOP;
        }
      }
    }
    const fl = this.floaters;
    for (let i = 0; i < fl.count; i++) {
      const f = fl.items[i];
      const p = f.age / f.dur;
      const rise = easeOut(p) * (f.kind === 1 || f.kind === 4 ? 46 : f.kind === 5 ? 22 : 36);
      const x = cam.sx(f.x) + f.dx * p;
      // like the callouts: never up into the top HUD row (boss / mid-boss bar, DBG, timer)
      const y = Math.max(LABEL_MIN_Y, cam.sy(f.y) - f.z * PX_PER_UNIT_Z - rise);
      if (x < -60 || x > LOGICAL_W + 60) continue;
      const strong = f.kind === 1 || f.kind === 4;
      const pop = f.pop < 0.12 ? 1 + (strong ? 0.6 : 0.35) * (1 - f.pop / 0.12) : 1;
      ctx.globalAlpha = (p > 0.65 ? Math.max(0, (1 - p) / 0.35) : 1) * f.alpha;
      ctx.font = boldFont(f.size * pop);
      ctx.lineWidth = strong ? 5 : 3.5;
      ctx.strokeStyle = f.stroke;
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
      if (f.label) {
        ctx.font = boldFont(12);
        ctx.lineWidth = 3;
        ctx.strokeText(f.label, x, y + 14);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(f.label, x, y + 14);
      }
    }
    // skill callouts last: on top of the numbers, on a dark pill so they read over a crowd
    for (let i = 0; i < ls.count; i++) {
      const l = ls.items[i];
      const p = l.age / l.dur;
      const pop = l.age < 0.12 ? 1 + 0.35 * (1 - l.age / 0.12) : 1;
      const a = (p > 0.75 ? (1 - p) / 0.25 : 1) * l.alpha;
      if (l.pill) {
        const w = l.w * pop + 8;
        const hh = l.size * (PILL_TOP + PILL_BOTTOM) * pop;
        pathRoundRect(ctx, l.sx - w / 2, l.sy - l.size * PILL_TOP * pop, w, hh, hh / 2);
        ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = '#080a12';
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.lineWidth = l.size >= 20 ? 2.5 : 1.5;
        ctx.strokeStyle = l.pill;
        ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.font = boldFont(l.size * pop);
      ctx.lineWidth = l.pill ? 3 : l.size >= 20 ? 6 : 4;
      ctx.strokeStyle = l.stroke;
      ctx.strokeText(l.text, l.sx, l.sy);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.sx, l.sy);
    }
    ctx.globalAlpha = 1;
  }

  /** Full-screen effects: enrage tint pulse, floor-clear flash, fade-in, ult cut-in banner. */
  drawScreen(ctx: CanvasRenderingContext2D, bossEnraged: boolean, time: number, vignette: CanvasGradient | null): void {
    if (this.enrageT < 2.2) {
      const p = this.enrageT / 2.2;
      const pulse = Math.max(0, Math.sin(this.enrageT * Math.PI * 3));
      ctx.globalAlpha = (1 - p) * (0.12 + 0.28 * pulse);
      ctx.fillStyle = '#ff0022';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    }
    if (bossEnraged && vignette) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(time * 3);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    }
    if (this.clearT < 0.8) {
      const p = this.clearT / 0.8;
      ctx.globalAlpha = 0.55 * (1 - p) * (1 - p);
      ctx.fillStyle = '#fff6d5';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    }
    if (this.fadeT < 0.5) {
      ctx.globalAlpha = 1 - this.fadeT / 0.5;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    }
    if (this.pulseT < 0.6) {
      // my ult: a coloured glow from the screen edges (two wide border strokes: cheap, the field stays readable)
      const p = this.pulseT / 0.6;
      const a = (1 - p) * (p < 0.08 ? p / 0.08 : 1);
      ctx.strokeStyle = this.pulseColor;
      ctx.globalAlpha = 0.28 * a;
      ctx.lineWidth = 150;
      ctx.strokeRect(0, 0, LOGICAL_W, LOGICAL_H);
      ctx.globalAlpha = 0.45 * a;
      ctx.lineWidth = 50;
      ctx.strokeRect(0, 0, LOGICAL_W, LOGICAL_H);
    }
    ctx.globalAlpha = 1;
    if (this.banner.active) this.drawBanner(ctx);
  }

  /**
   * Ult cut-in: a slanted band sliding in from the right in the empty cliff band under the field (local screen only).
   * It sits right of the character cards (x ≥ ~580): the active card and its status pips rise into this band on the left,
   * while the ult gauge and pet cards start below it (y > 565).
   */
  private drawBanner(ctx: CanvasRenderingContext2D): void {
    const b = this.banner;
    const t = b.age;
    const inT = 0.16;
    const outT = 0.25;
    let slide = 0;
    if (t < inT) slide = 1 - easeOut(t / inT);
    else if (t > b.dur - outT) slide = easeIn((t - (b.dur - outT)) / outT);
    const alpha = t > b.dur - outT ? 1 - (t - (b.dur - outT)) / outT : 1;
    const cy = 530;
    const h = 58;
    const skew = 28;
    const bw = 680;
    const L = LOGICAL_W - bw + slide * (bw + 80);
    const R = LOGICAL_W + 20 + slide * (bw + 80);
    const top = cy - h / 2;
    const bot = cy + h / 2;
    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = '#080a12';
    ctx.beginPath();
    ctx.moveTo(L + skew, top);
    ctx.lineTo(R, top);
    ctx.lineTo(R, bot);
    ctx.lineTo(L - skew, bot);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(L + skew + 3, top - 5);
    ctx.lineTo(R, top - 5);
    ctx.lineTo(R, top);
    ctx.lineTo(L + skew, top);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(L - skew, bot);
    ctx.lineTo(R, bot);
    ctx.lineTo(R, bot + 5);
    ctx.lineTo(L - skew - 3, bot + 5);
    ctx.closePath();
    ctx.fill();
    // speed streaks (clipped to the band)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L + skew, top);
    ctx.lineTo(R, top);
    ctx.lineTo(R, bot);
    ctx.lineTo(L - skew, bot);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = alpha * 0.22;
    for (let i = 0; i < 5; i++) {
      const yy = top + 8 + i * 11;
      const xx = ((t * 1400 + i * 211) % (bw + 200)) - 160;
      ctx.fillRect(L + xx, yy, 110, 2);
    }
    ctx.restore();
    // portrait disc
    const px = L + 80;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(px, cy, 25, 0, TAU);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.font = boldFont(23);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#0b0d14';
    ctx.strokeText(b.glyph, px, cy + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b.glyph, px, cy + 1);
    // text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 14px ${FONT_STACK}`;
    ctx.fillStyle = b.color;
    ctx.fillText(b.sub, px + 42, cy - 9);
    ctx.font = boldFont(28);
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(b.title, px + 42, cy + 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b.title, px + 42, cy + 20);
    ctx.restore();
  }
}

// ─────────────────────────── helpers ───────────────────────────

function ageAll<T extends { age: number; dur: number }>(pool: Pool<T>, dt: number): void {
  for (let i = pool.count - 1; i >= 0; i--) {
    const x = pool.items[i];
    x.age += dt;
    if (x.age >= x.dur) pool.kill(i);
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function easeIn(t: number): number {
  return t * t;
}

const TMP_SW = { ax: 0, ay: 0 };
/** Skills whose field has its own colour. */
const ZONE_TINT: Record<string, string> = { mage_u: '#7fdcff' };

const SLOT_KEY = { n: 'normal', d: 'drag', u: 'ult' } as const;
const actionCache = new Map<string, readonly SkillAction[] | null>();

/** The data action a skillCast event stands for: skill id `<character>_<n|d|u>` or a pet id, idx = order in the cast. */
export function actionFor(skillId: string, slot: string, idx: number): SkillAction | null {
  let list = actionCache.get(skillId);
  if (list === undefined) {
    list = null;
    try {
      if (slot === 'pet') list = [getPet(skillId).action];
      else {
        const cut = skillId.lastIndexOf('_');
        const key = SLOT_KEY[skillId.slice(cut + 1) as keyof typeof SLOT_KEY];
        if (key) list = getCharacter(skillId.slice(0, cut))[key].actions;
      }
    } catch {
      list = null;
    }
    actionCache.set(skillId, list);
  }
  return list ? list[Math.min(idx, list.length - 1)] ?? null : null;
}

const BIG_CIRCLE: AreaShape = { shape: 'circle', radius: 30 };
function clampArea(a: AreaShape): AreaShape {
  return a.shape === 'circle' && a.radius > 30 ? BIG_CIRCLE : a;
}

export function playerColor(state: GameState, player: number): string {
  const p = state.players[player];
  return (p && p.color) || PLAYER_COLORS[player % PLAYER_COLORS.length] || '#ffffff';
}

/** Placeholder art colour of a player's party member (null when unknown). */
export function characterColor(state: GameState, player: number, partyIndex: number): string | null {
  const m = state.players[player]?.party[partyIndex];
  if (!m) return null;
  try {
    return getCharacter(m.defId).color;
  } catch {
    return null;
  }
}

function findEntity(state: GameState, id: number) {
  const es = state.entities;
  for (let i = 0; i < es.length; i++) if (es[i].id === id) return es[i];
  return null;
}

function hasTelegraphAt(teles: Telegraph[], team: Team, x: number, y: number): boolean {
  for (const t of teles) {
    if (t.team !== team) continue;
    if (Math.abs(t.center.x - x) < 0.05 && Math.abs(t.center.y - y) < 0.05 && t.remaining > t.total - 0.2) return true;
  }
  return false;
}
