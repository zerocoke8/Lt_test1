// Event-driven visual effects. Owns only render-side state (pools + timers); never touches GameState.

import { LOGICAL_H, LOGICAL_W, type AreaShape, type GameEvent, type GameState, type Team, type Telegraph } from '../types';
import { PLAYER_COLORS } from '../config';
import { getCharacter } from '../data';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from './camera';
import { COLORS, FONT_STACK, ROLE_GLYPH, boldFont, petColor, type UnitLook, unitLook } from './look';
import { Pool } from './pool';
import { TAU, areaRadius, pathArea } from './shapes';
import { type UnitMemo, bodyHeight, bodyTop, bodyWidth, drawBody } from './units';

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
  kind: 0 | 1 | 2 | 3; // 0 dmg, 1 crit, 2 heal, 3 absorbed
  amount: number;
  pop: number;
}

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

interface Slash {
  x: number;
  y: number;
  z: number;
  ang: number;
  age: number;
  dur: number;
  color: string;
  r: number;
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

export class Vfx {
  readonly floaters = new Pool<Floater>(
    () => ({ x: 0, y: 0, z: 0, dx: 0, age: 0, dur: 1, text: '', color: '#fff', size: 16, targetId: -1, kind: 0, amount: 0, pop: 0 }),
    90,
  );
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
  readonly slashes = new Pool<Slash>(() => ({ x: 0, y: 0, z: 0, ang: 0, age: 0, dur: 0.2, color: '#fff', r: 10 }), 48);
  readonly labels = new Pool<Label>(() => ({ x: 0, y: 0, z: 0, age: 0, dur: 1, text: '', color: '#fff', size: 14 }), 16);

  private lastDamage = new Map<number, Floater>();
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
    this.slashes.clear();
    this.labels.clear();
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
      case 'damage': {
        const m = c.memos.get(ev.targetId);
        if (m) m.flash = 0.12;
        if (m && m.tier === 'boss') this.bossFlash = 1;
        if (ev.amount >= 0.5) {
          const kind: 0 | 1 = ev.crit ? 1 : 0;
          const color = ev.targetTeam === 'ally' ? COLORS.dmgAlly : ev.crit ? COLORS.dmgCrit : COLORS.dmgEnemy;
          this.addNumber(ev.targetId, kind, ev.amount, ev.pos.x, ev.pos.y, color, m, '');
        } else if (ev.absorbed >= 0.5) {
          this.addNumber(ev.targetId, 3, ev.absorbed, ev.pos.x, ev.pos.y, COLORS.absorbed, m, '');
        }
        break;
      }
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
      case 'attack': {
        if (ev.ranged) break;
        const t = c.memos.get(ev.targetId);
        const src = c.memos.get(ev.sourceId);
        if (!t || t.tier === 'boss') break;
        const s = this.slashes.spawn();
        const top = bodyHeight(t.look, t.radius);
        s.x = t.x;
        s.y = t.y;
        s.z = (top * 0.5) / PX_PER_UNIT_Z;
        s.ang = src ? Math.atan2((t.y - src.y) * 0.55, t.x - src.x) : 0;
        s.age = 0;
        s.dur = 0.18;
        s.color = src && src.team === 'enemy' ? '#ffb3b3' : '#ffffff';
        s.r = Math.max(14, t.radius * PX_PER_UNIT * 0.9);
        break;
      }
      case 'skillCast':
        this.onSkillCast(ev, c);
        break;
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

  private onSkillCast(ev: Extract<GameEvent, { type: 'skillCast' }>, c: VfxContext): void {
    const ally = ev.team === 'ally';
    const pColor = ev.player !== null ? playerColor(c.state, ev.player) : '#7fd1ff';
    const src = ev.sourceId !== null ? c.memos.get(ev.sourceId) ?? null : null;
    const srcEnt = ev.sourceId !== null ? findEntity(c.state, ev.sourceId) : null;
    // drag skill: the caster's character colour, same as the drag preview / landing burst
    const dragColor = ev.slot === 'drag' && srcEnt && srcEnt.kind === 'character' && srcEnt.ownerPlayer !== null && srcEnt.partyIndex !== null
      ? characterColor(c.state, srcEnt.ownerPlayer, srcEnt.partyIndex)
      : null;
    const color = ev.slot === 'pet' ? (petColor(ev.skillId) ?? pColor) : dragColor ?? (ally ? pColor : '#ff4d4d');
    const ox = srcEnt ? srcEnt.pos.x : src ? src.x : ev.center.x;
    const oy = srcEnt ? srcEnt.pos.y : src ? src.y : ev.center.y;
    const delayed = hasTelegraphAt(c.state.telegraphs, ev.team, ev.center.x, ev.center.y);

    if (!ally) {
      const tier = src ? src.tier : null;
      // boss pattern names are shown by the HUD as a cast pill under the boss bar (a world label sat on the eye)
      if (tier === 'mid') {
        const m = src!;
        const z = bodyTop(m.look, m.tier, bodyHeight(m.look, m.radius), bodyWidth(m.radius)) / PX_PER_UNIT_Z + 1.5;
        this.label(ox, oy, z, ev.name, '#ff8a8a', 16, 1.4);
      }
      if (src && tier !== 'boss') this.ring(ox, oy, 0.3, 1.4, 0.35, '#ff4d4d', 3, 0.15);
      if (!delayed) this.flash(ev.center.x, ev.center.y, ox, oy, ev.area, 0.35, '#ff4d4d', 0.6);
      return;
    }

    const strong = ev.slot === 'ult' || ev.slot === 'drag' || ev.slot === 'pet';
    if (!delayed) this.flash(ev.center.x, ev.center.y, ox, oy, ev.area, strong ? 0.55 : 0.35, color, strong ? 1 : 0.7);
    if (ev.slot === 'drag' || ev.slot === 'pet') {
      const r = Math.min(8, areaRadius(ev.area));
      this.ring(ev.center.x, ev.center.y, 0.2, Math.max(1.2, r), 0.45, color, 5, 0.18);
      this.ring(ev.center.x, ev.center.y, 0.1, Math.max(0.8, r * 0.6), 0.3, '#ffffff', 2, 0);
      this.burst(ev.center.x, ev.center.y, 0.3, ev.slot === 'pet' ? 18 : 22, color, Math.max(2, r * 1.6), 2.5, 0.6);
    }
    if (ev.slot === 'ult') {
      this.ring(ox, oy, 0.4, 4, 0.7, color, 6, 0.12);
      this.burst(ox, oy, 0.5, 26, color, 5, 4, 0.8);
      if (ev.player === c.localPlayer) this.showBanner(ev, c, color);
    }
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

  // ─────────────────────────── spawners ───────────────────────────

  private addNumber(targetId: number, kind: 0 | 1 | 2 | 3, amount: number, x: number, y: number, color: string, m: UnitMemo | undefined, prefix: string): void {
    if (kind === 0 || kind === 2 || kind === 3) {
      const last = this.lastDamage.get(targetId);
      if (last && last.targetId === targetId && last.kind === kind && last.age < (kind === 2 ? HEAL_WINDOW : MERGE_WINDOW) && last.age < last.dur) {
        last.amount += amount;
        last.text = prefix + Math.round(last.amount);
        last.pop = 0;
        return;
      }
    }
    const f = this.floaters.spawn();
    const boss = m && m.tier === 'boss';
    f.targetId = targetId;
    f.kind = kind;
    f.amount = amount;
    f.text = prefix + Math.round(amount);
    f.color = color;
    f.size = kind === 1 ? 26 : kind === 3 ? 13 : boss ? 18 : 16;
    f.age = 0;
    f.dur = kind === 1 ? 1.0 : 0.85;
    f.pop = 0;
    if (boss && m) {
      // numbers on the boss pop on its flanks, beside (not over) the big eye and below the top HUD
      const sideX = Math.random() < 0.5 ? -1 : 1;
      f.x = x + sideX * m.radius * (0.78 + Math.random() * 0.3);
      f.y = y + 2.2;
      f.z = Math.random() * 0.5;
    } else {
      f.x = x + (Math.random() - 0.5) * 0.5;
      f.y = y;
      const h = m ? bodyTop(m.look, m.tier, bodyHeight(m.look, m.radius), bodyWidth(m.radius)) : 50;
      f.z = h / PX_PER_UNIT_Z + 0.45;
    }
    f.dx = (Math.random() - 0.5) * 18;
    if (kind !== 1) this.lastDamage.set(targetId, f);
  }

  private ring(x: number, y: number, r0: number, r1: number, dur: number, color: string, width: number, fill: number): void {
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

  private flash(cx: number, cy: number, ox: number, oy: number, area: AreaShape, dur: number, color: string, strength: number): void {
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
  private burst(x: number, y: number, z: number, n: number, color: string, speed: number, up: number, dur: number, g = 9): void {
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

  private label(x: number, y: number, z: number, text: string, color: string, size: number, dur: number): void {
    const l = this.labels.spawn();
    l.x = x;
    l.y = y;
    l.z = z;
    l.text = text;
    l.color = color;
    l.size = size;
    l.age = 0;
    l.dur = dur;
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
    if (s.remaining <= 0.25) {
      const enemy = s.team === 'enemy';
      const color = enemy ? '#ff4d4d' : '#7fd1ff';
      this.flash(s.cx, s.cy, s.ox, s.oy, s.area, 0.45, color, 1);
      const r = Math.min(8, areaRadius(s.area));
      if (s.area.shape !== 'line') {
        this.ring(s.cx, s.cy, r * 0.3, r * 1.08, 0.4, enemy ? '#ffb199' : '#ffffff', 4, 0);
        this.burst(s.cx, s.cy, 0.1, Math.min(30, 8 + Math.round(r * 4)), enemy ? '#ff7b54' : '#bde0fe', r * 1.4, 3, 0.55);
      } else {
        const mx = (s.ox + s.cx) / 2;
        const my = (s.oy + s.cy) / 2;
        this.burst(mx, my, 0.1, 18, enemy ? '#ff7b54' : '#bde0fe', 3, 3, 0.5);
      }
    }
    this.teles.delete(id);
  };

  update(dt: number, c: VfxContext): void {
    // flush accumulated heals: big heals become numbers, trickles (aura/regen ticks) only sparkle
    for (const [id, h] of this.heals) {
      h.age += dt;
      if (h.age < HEAL_WINDOW * 0.5) continue;
      const m = c.memos.get(id);
      const threshold = m && m.maxHp > 0 ? m.maxHp * HEAL_SHOW_FRAC : HEAL_SHOW_ABS;
      if (h.amount >= threshold) {
        this.addNumber(id, 2, h.amount, h.x, h.y, COLORS.heal, m, '+');
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
    ageAll(this.slashes, dt);
    ageAll(this.labels, dt);
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

  /** Fading bodies of dead / swapped-out units (drawn before live units). */
  drawGhosts(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
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

  /** Airborne effects over units: particles + melee slashes. */
  drawAir(ctx: CanvasRenderingContext2D, cam: Camera): void {
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
    const ss = this.slashes;
    ctx.lineCap = 'round';
    for (let i = 0; i < ss.count; i++) {
      const s = ss.items[i];
      const p = s.age / s.dur;
      const cx = cam.sx(s.x);
      const cy = cam.sy(s.y) - s.z * PX_PER_UNIT_Z;
      const sweep = 1.6;
      const a0 = s.ang - sweep / 2 + p * 0.5;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 4 * (1 - p) + 1;
      ctx.beginPath();
      ctx.arc(cx, cy, s.r * (0.8 + p * 0.4), a0, a0 + sweep * Math.min(1, p * 3 + 0.3));
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  /** Floating numbers + world labels (topmost world layer). */
  drawOverlay(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    const ls = this.labels;
    for (let i = 0; i < ls.count; i++) {
      const l = ls.items[i];
      const p = l.age / l.dur;
      // keep world labels (e.g. "중형보스 등장!" at a top-edge spawn) clear of the top HUD row and the screen edges
      const x = Math.min(LOGICAL_W - LABEL_MARGIN_X, Math.max(LABEL_MARGIN_X, cam.sx(l.x)));
      const y = Math.max(LABEL_MIN_Y, cam.sy(l.y) - l.z * PX_PER_UNIT_Z) - easeOut(Math.min(1, p * 4)) * 10;
      ctx.globalAlpha = p > 0.75 ? (1 - p) / 0.25 : 1;
      ctx.font = boldFont(l.size);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#120508';
      ctx.strokeText(l.text, x, y);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x, y);
    }
    const fl = this.floaters;
    for (let i = 0; i < fl.count; i++) {
      const f = fl.items[i];
      const p = f.age / f.dur;
      const rise = easeOut(p) * (f.kind === 1 ? 46 : 38);
      const x = cam.sx(f.x) + f.dx * p;
      const y = cam.sy(f.y) - f.z * PX_PER_UNIT_Z - rise;
      if (x < -60 || x > LOGICAL_W + 60) continue;
      const pop = f.pop < 0.12 ? 1 + (f.kind === 1 ? 0.6 : 0.35) * (1 - f.pop / 0.12) : 1;
      ctx.globalAlpha = p > 0.65 ? Math.max(0, (1 - p) / 0.35) : 1;
      ctx.font = boldFont(f.size * pop);
      ctx.lineWidth = f.kind === 1 ? 5 : 3.5;
      ctx.strokeStyle = f.kind === 1 ? '#4a2500' : '#0a0a0a';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
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
