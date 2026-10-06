// 기획 13차 효과음: sound id → how to synthesise it (docs/sfx.md 3장). Every id of the doc's tables has a row here;
// characters share role templates (탱커·근접·원거리·힐러·서포터) with a material overlay, plus one hand-made sound per
// renewed skill stage. Numbers follow the doc ("느낌 / 만드는 법"); designers retune by ear on the debug 효과음 board.

import type { Role } from '../../types';
import { CHARACTERS, PETS, GOEDAM_ROOMS, FIELD_EVENTS, BOSSES } from '../../data';
import { BOSS_VOICE, CHAR_VOICE, ROLE_PITCH, ZONES, type Material, type Voice } from './voices';
import { CHORD, bell, click, noise, seq, st, tone, type Layer, type LayerOpts, type Recipe } from './prims';

type Make = () => Recipe;
const RECIPES = new Map<string, Make>();
const def = (id: string, make: Make): void => {
  RECIPES.set(id, make);
};
const r = (L: Layer[], fx: Omit<Recipe, 'L'> = {}): Recipe => ({ L, ...fx });

// ─────────────────────────── shared pieces ───────────────────────────

/** Low sine drop + brown rumble ("쿵"). */
const boom = (f0: number, f1: number, d: number, o: LayerOpts = {}): Layer[] => [
  tone('sin', f0, f1, d, { ...o, a: 0.002 }),
  noise('brown', d * 0.8, { ...o, g: (o.g ?? 1) * 0.6, lp: [400, 120] }),
];
/** Band-passed pink sweep ("쉭 / 바람"). */
const whoosh = (f0: number, f1: number, d: number, o: LayerOpts = {}): Layer => noise('pink', d, { e: 'hump', ...o, bp: [f0, f1], q: 1.2 });
/** Bright noise crash. */
const crash = (d: number, o: LayerOpts = {}): Layer[] => [noise('white', d, { ...o, hp: [3000, 1500] }), noise('white', d * 0.4, { ...o, g: (o.g ?? 1) * 0.6, lp: [6000, 800] })];
/** Sine partials together ("금속 520/780/1310Hz"). */
const partials = (fs: number[], d: number, o: LayerOpts = {}): Layer[] => fs.map((f, i) => tone('sin', f, f * 0.995, d / (1 + i * 0.3), { ...o, g: (o.g ?? 1) / (1 + i * 0.4) }));
const ping = (f: number, d: number, o: LayerOpts = {}): Layer => tone('sin', f, f, d, o);
const chime = (f: number, o: LayerOpts = {}): Layer => bell(f, 0.6, { parts: [1, 2.01, 3.2], ...o });
const riser = (d: number, f0: number, f1: number, o: LayerOpts = {}): Layer[] => [
  noise('pink', d, { e: 'swell', ...o, bp: [f0 * 2, f1 * 3], q: 1.5 }),
  tone('saw', f0, f1, d, { e: 'swell', ...o, g: (o.g ?? 1) * 0.5 }),
];
const chord = (base: number, q: keyof typeof CHORD, d: number, o: LayerOpts & { w?: 'sin' | 'tri' | 'saw' | 'sq' } = {}): Layer[] =>
  CHORD[q].map(s => tone(o.w ?? 'tri', base * st(s), base * st(s), d, { a: 0.02, ...o, g: (o.g ?? 1) * 0.5 }));
const arp = (fs: number[], step: number, d: number, o: LayerOpts & { w?: 'sin' | 'tri' | 'sq' } = {}): Layer[] =>
  fs.map((f, i) => tone(o.w ?? 'tri', f, f, d, { ...o, t: (o.t ?? 0) + i * step }));
const kick = (t = 0, g = 1): Layer => tone('sin', 160, 42, 0.18, { t, g, a: 0.001 });
const snare = (t = 0, g = 1): Layer[] => [noise('white', 0.14, { t, g: g * 0.8, bp: [2200], q: 0.6 }), tone('tri', 210, 180, 0.08, { t, g: g * 0.5 })];
const heart = (t = 0, g = 1): Layer[] => [tone('sin', 62, 48, 0.12, { t, g }), tone('sin', 58, 45, 0.1, { t: t + 0.2, g: g * 0.7 })];
const glass = (n: number, t = 0, g = 1): Layer[] => [
  noise('white', 0.25, { t, g: g * 0.7, hp: [4000] }),
  ...seq(n, 0.018, (i, dt) => ping(2200 + ((i * 937) % 3000), 0.18, { t: t + dt, g: g * 0.35 })),
];
const coin = (t = 0, g = 1): Layer[] => partials([2637, 3520, 5274], 0.25, { t, g });
const sizzle = (d: number, o: LayerOpts = {}): Layer => noise('white', d, { ...o, hp: [5000], grain: 180 });
const whisper = (d: number, o: LayerOpts = {}): Layer[] => [noise('pink', d, { e: 'hump', trem: 7, ...o, bp: [1400, 2200], q: 4 }), noise('pink', d, { e: 'hump', trem: 5, ...o, g: (o.g ?? 1) * 0.6, bp: [700, 900], q: 5 })];
const steps = (n: number, gap: number, o: LayerOpts = {}): Layer[] => seq(n, gap, (_, dt) => [tone('sin', 90, 60, 0.08, { ...o, t: (o.t ?? 0) + dt }), noise('brown', 0.06, { ...o, t: (o.t ?? 0) + dt, g: (o.g ?? 1) * 0.5, lp: [800] })]);
const ringer = (d: number, o: LayerOpts = {}): Layer[] => [tone('sq', 440, 440, d, { e: 'flat', trem: 18, ...o, g: (o.g ?? 1) * 0.5 }), tone('sq', 480, 480, d, { e: 'flat', trem: 18, ...o, g: (o.g ?? 1) * 0.5 })];
const zap = (n: number, o: LayerOpts = {}): Layer[] => seq(n, 0.07, (_, dt) => noise('white', 0.04, { ...o, t: (o.t ?? 0) + dt, bp: [3000], q: 0.5, grain: 400 }));
const drip = (t = 0, g = 1): Layer => tone('sin', 700, 1500, 0.07, { t, g });
const chain = (n: number, o: LayerOpts & { gap?: number; accel?: number } = {}): Layer[] => {
  const out: Layer[] = [];
  let t = o.t ?? 0;
  let gap = o.gap ?? 0.05;
  for (let i = 0; i < n; i++) {
    out.push(noise('white', 0.025, { t, g: (o.g ?? 1) * (0.6 + 0.4 * ((i * 7) % 3) / 2), bp: [3000 + ((i * 1300) % 3000)], q: 3 }));
    t += gap;
    gap *= o.accel ?? 1;
  }
  return out;
};

// ─────────────────────────── role templates × material overlay ───────────────────────────

/** A short material accent (normal skills, ult ticks, 기본 공격 colour). */
function matAccent(m: Material, v: Voice, o: LayerOpts = {}): Layer[] {
  const f = v.base;
  switch (m) {
    case 'steel':
      return partials([520, 780, 1310], 0.35, o);
    case 'holy':
      return [bell(f * 8, 0.6, { ...o, g: (o.g ?? 1) * 0.6 })];
    case 'chain':
      return chain(5, { ...o, gap: 0.03 });
    case 'blade':
      return [ping(2400, 0.25, o), ping(3100, 0.2, { ...o, g: (o.g ?? 1) * 0.6 })];
    case 'blood':
      return [...boom(90, 40, 0.25, o), noise('brown', 0.2, { ...o, lp: [600] })];
    case 'shadow':
      return [noise('pink', 0.25, { ...o, e: 'swell', bp: [600, 2400] })];
    case 'wind':
      return [whoosh(800, 3000, 0.25, o)];
    case 'magic':
      return [tone('sin', f * 4, f * 6, 0.35, { ...o, fm: [2.01, 3, 0.5] })];
    case 'powder':
      return [noise('white', 0.12, { ...o, lp: [5000, 800] }), tone('sin', 110, 60, 0.12, o)];
    case 'medical':
      return [tone('sq', 880, 880, 0.07, { ...o, g: (o.g ?? 1) * 0.4 }), tone('sq', 1318, 1318, 0.07, { ...o, t: (o.t ?? 0) + 0.09, g: (o.g ?? 1) * 0.4 })];
    case 'talisman':
      return [noise('pink', 0.15, { ...o, bp: [2500, 4000], q: 2 }), ...click((o.t ?? 0) + 0.12, 1800, o.g ?? 1)];
    case 'music':
      return [tone('tri', f * 2, f * 2, 0.4, o), tone('tri', f * 3, f * 3, 0.3, { ...o, g: (o.g ?? 1) * 0.4 })];
    case 'time':
      return [...click(o.t ?? 0, 3000, o.g ?? 1), ...click((o.t ?? 0) + 0.12, 2200, o.g ?? 1)];
    default:
      return [tone('saw', 220, 225, 0.4, { ...o, vib: [6, 0.3], g: (o.g ?? 1) * 0.6 })];
  }
}

/** Drag landing body by role (docs/sfx.md 3-1 drag._role). */
function roleBody(role: Role, k = 1): Layer[] {
  switch (role) {
    case 'tank':
      return [...boom(120 * k, 45 * k, 0.5), noise('brown', 0.4, { lp: [500, 150] })];
    case 'melee':
      return [kick(0), whoosh(5000, 1200, 0.22, { t: 0.02 })];
    case 'ranged':
      return [...click(0, 3000), tone('sin', 600 * k, 420 * k, 0.12)];
    case 'healer':
      return [tone('sin', 523 * k, 523 * k, 0.6, { a: 0.04 }), tone('sin', 784 * k, 784 * k, 0.5, { a: 0.06, g: 0.5 })];
    default:
      return [tone('tri', 330 * k, 320 * k, 0.4, { a: 0.003 }), tone('tri', 660 * k, 650 * k, 0.25, { g: 0.4 })];
  }
}

function defRoles(): void {
  for (const role of ['tank', 'melee', 'ranged', 'healer', 'support'] as Role[]) {
    const k = ROLE_PITCH[role];
    def(`char.appear.${role}`, () => r([whoosh(500 * k, 2200 * k, 0.25), tone('sin', 200 * k, 90 * k, 0.12, { t: 0.12, g: 0.5 })]));
    def(`drag._role.${role}`, () => r(roleBody(role), { rev: 0.15 }));
    def(`ult._role.${role}`, () => r([...riser(0.45, 200 * k, 800 * k), ...boom(70, 30, 0.8, { t: 0.45 }), ...chord(220 * k, 'maj', 1.2, { t: 0.45, w: 'saw' })], { rev: 0.3 }));
    def(`dash.${role}`, () => r([whoosh(role === 'tank' ? 2500 : 5000, role === 'tank' ? 600 : 1200, role === 'tank' ? 0.35 : 0.2)]));
    def(`atk.swing.${role}`, () => r([whoosh(role === 'tank' ? 1800 : 3500, role === 'tank' ? 600 : 1500, role === 'tank' ? 0.14 : 0.1)]));
  }
}

function defCharacters(): void {
  for (const c of CHARACTERS) {
    const v = CHAR_VOICE[c.id];
    if (!v) continue;
    def(`normal.${c.id}`, () => r([...roleBody(v.role, 1.2), ...matAccent(v.mat, v, { t: 0.03, g: 0.7 })]));
    def(`ult.${c.id}.tick`, () => r(matAccent(v.mat, v, { g: 0.8 }).map(l => ({ ...l, d: Math.min(l.d, 0.15) }))));
    def(`atk.shot.${c.id}`, () => r(shotFor(v)));
  }
}

function shotFor(v: Voice): Layer[] {
  if (v.mat === 'wind') return [whoosh(2000, 5000, 0.1)];
  if (v.mat === 'powder') return [noise('white', 0.06, { lp: [6000, 1000] }), tone('sin', 140, 70, 0.06)];
  if (v.mat === 'magic') return [tone('sin', 300, 160, 0.15, { fm: [1.5, 2, 0] })];
  return [ping(v.base * 6, 0.1, { g: 0.7 }), ping(v.base * 9, 0.08, { g: 0.4 })];
}

// ─────────────────────────── 3-1 common ───────────────────────────

def('drag.crunch', () => r([noise('brown', 0.3, { grain: 90, lp: [2000] }), ...boom(80, 40, 0.3)]));
def('char.leave', () => r([noise('pink', 0.08, { bp: [900] }), tone('sin', 300, 180, 0.08, { g: 0.5 })]));

// ─────────────────────────── 3-2 per-character stages ───────────────────────────

const CUTIN_RISER = (f0: number, f1: number): Layer[] => riser(0.45, f0, f1, { g: 0.6 });

// 가디언 (강철, A1 55Hz, 장조)
def('drag.guardian.slam', () => r([...boom(120, 45, 0.5), ...partials([520, 780, 1310], 0.5, { g: 0.6 })], { rev: 0.2 }));
def('drag.guardian.charge', () => r(seq(6, 0.04, (i, t) => ping(1200 * st(i), 0.03, { t, g: 0.5 }))));
def('drag.guardian.wave', () => r([whoosh(300, 2400, 0.45), tone('sq', 220, 220, 0.25, { t: 0.05, e: 'flat', g: 0.4 })], { rev: 0.2 }));
def('drag.guardian.wall', () => r([tone('saw', 110, 110, 2, { e: 'flat', trem: 4, g: 0.6 }), tone('sin', 55, 55, 2, { e: 'flat' })], { loop: 2 }));
def('drag.guardian.shatter', () => r(seq(5, 0.03, (i, t) => ping(2000 + i * 700, 0.2, { t, g: 0.5 }))));
def('ult.guardian.cutin', () => r([...CUTIN_RISER(200, 800), ...[220, 277, 330].map(f => tone('saw', f, f * 2, 0.9, { t: 0.45, g: 0.35, a: 0.02 })), whoosh(800, 3000, 0.5, { t: 0.45 })], { rev: 0.3 }));
def('ult.guardian.rally', () => r([noise('pink', 0.5, { e: 'swell', lp: [2000, 200] }), ...seq(3, 0.06, (_, t) => ping(1600, 0.2, { t: t + 0.4, g: 0.4 }))]));
def('ult.guardian.citadel', () => r([...boom(70, 30, 1.2), ...crash(0.8, { g: 0.6 }), ...partials([260, 390], 1, { g: 0.5 })], { rev: 0.35, dist: 1.5 }));
def('ult.guardian.barrier', () => r([tone('sin', 110, 110, 2, { e: 'flat', trem: 2 }), tone('tri', 220, 220, 2, { e: 'flat', g: 0.3, vib: [3, 0.1] })], { loop: 2 }));

// 팔라딘 (신성 강철, D2 73Hz, 장조)
def('drag.paladin.brand', () => r([sizzle(0.35), tone('sin', 660, 880, 0.3, { g: 0.5 })]));
def('drag.paladin.blessing', () => r([chime(1320), chime(1760, { t: 0.1 })]));
def('drag.paladin.charge', () => r([tone('saw', 220, 660, 0.5, { e: 'swell', g: 0.5 }), ...seq(3, 0.15, (_, t) => ping(440, 0.06, { t, g: 0.4 }))]));
def('drag.paladin.pillar', () => r([...boom(90, 40, 0.6), ...[1047, 1319, 1568].map(f => bell(f, 0.9, { g: 0.4 })), noise('white', 0.06, { hp: [3000] }), ...seq(5, 0.1, (i, t) => ping(3000 + i * 400, 0.1, { t: t + 0.2, g: 0.15 }))], { rev: 0.3 }));
def('ult.paladin.cutin', () => r([...CUTIN_RISER(220, 880), ...chord(440, 'maj', 1.4, { t: 0.45, w: 'saw', g: 0.6 }), ...chord(880, 'maj', 1.4, { t: 0.45, w: 'sin', g: 0.4 })], { rev: 0.45 }));
def('ult.paladin.spear', () => r([noise('pink', 0.18, { bp: [3000, 800], q: 2 }), ...click(0.17, 2500)]));
def('ult.paladin.tribunal', () => r([...boom(60, 28, 1.4), ...crash(0.9), ...[523, 659, 784, 1047].map(f => bell(f, 1.5, { g: 0.35 }))], { rev: 0.55, dist: 1.3 }));

// 워든 (사슬, E1 41Hz, 단조)
def('drag.warden.hook', () => r([...boom(80, 40, 0.3), ...chain(8, { t: 0.05, gap: 0.05, accel: 0.85 }), noise('pink', 0.3, { t: 0.1, bp: [2500, 400] }), ...click(0.42, 1800)]));
def('drag.warden.crush', () => r([...boom(80, 35, 0.5), noise('brown', 0.35, { grain: 120, lp: [1500] })], { dist: 1.4 }));
def('drag.warden.fence', () => r([...chain(3, { gap: 0.03, g: 0.5 }), tone('sin', 82, 82, 0.4, { g: 0.6, trem: 6 })]));
def('drag.warden.drop', () => r(seq(4, 0.07, (i, t) => ping(1800 * st(-i * 3), 0.2, { t, g: 0.5 }))));
def('ult.warden.cutin', () => r([...riser(0.45, 82, 330, { g: 0.6 }), noise('pink', 0.9, { e: 'hump', bp: [1200, 3000], trem: 3 }), ...chain(10, { t: 0.2, gap: 0.04 }), ...chord(82, 'min', 1, { t: 0.45, w: 'saw' })], { rev: 0.3 }));
def('ult.warden.cage', () => r([...partials([180, 270, 405, 610], 1), ...boom(60, 30, 0.8), ...crash(0.5, { g: 0.6 })], { rev: 0.3, dist: 1.2 }));
def('ult.warden.prison', () => r([tone('sin', 82, 82, 2, { e: 'flat', trem: 3 }), ...seq(4, 0.5, (_, t) => ping(2400, 0.05, { t, g: 0.25 }))], { loop: 2 }));
def('ult.warden.release', () => r([...seq(6, 0.02, (i, t) => ping(1500 + i * 500, 0.3, { t, g: 0.4 })), whoosh(400, 2000, 0.3, { t: 0.05 }), ...boom(70, 30, 0.6, { t: 0.1 })], { rev: 0.3 }));

// 블레이드 (칼날, A3 220Hz, 장조)
def('drag.blade.dash', () => r([...click(0, 1500), whoosh(1200, 6000, 0.18, { t: 0.02 }), ...seq(4, 0.04, (i, t) => [ping(2400 * st(i), 0.18, { t: t + 0.05, g: 0.5 }), ping(3100 * st(i), 0.12, { t: t + 0.05, g: 0.3 })])]));
def('drag.blade.return', () => r([whoosh(6000, 1500, 0.18)]));
def('drag.blade.burst', () => r([noise('white', 0.25, { lp: [8000, 1500] }), ...boom(70, 35, 0.3), ping(1760, 0.7, { t: 0.1, g: 0.4 }), ...click(0.37, 2600, 0.6)], { rev: 0.2 }));
def('ult.blade.cutin', () => r([tone('sin', 880, 880, 0.8, { fm: [1.41, 0.5, 6], g: 0.6, a: 0.02 }), ...boom(110, 30, 0.6, { t: 0.4 }), whoosh(2000, 6000, 0.4, { t: 0.05, e: 'swell' })], { rev: 0.25 }));
def('ult.blade.hop', () => r([...click(0, 2600), ping(1500, 0.18, { t: 0.01, g: 0.6 }), ping(2250, 0.12, { t: 0.01, g: 0.3 })]));
def('ult.blade.storm', () => r([noise('white', 0.08, { hp: [3000], grain: 300 }), tone('sin', 140, 120, 0.12, { g: 0.4 })]));
def('ult.blade.issen', () => r([noise('white', 0.3, { bp: [3000, 8000], q: 1.5 }), ...boom(50, 30, 0.5), ping(2500, 1.2, { t: 0.05, g: 0.5 })], { rev: 0.4 }));

// 버서커 (피·대지, D2 73Hz, 단조)
def('drag.berserker.slam', () => r([whoosh(400, 1500, 0.12), ...boom(60, 35, 0.5, { t: 0.12 }), noise('brown', 0.4, { t: 0.12, grain: 100, lp: [2500] })], { dist: 2 }));
def('drag.berserker.split', () => r([noise('pink', 0.15, { e: 'swell', bp: [500, 1500] }), ...seq(3, 0.06, (_, t) => noise('white', 0.08, { t: t + 0.15, lp: [3000, 600], grain: 200 })), ...boom(55, 30, 0.6, { t: 0.15 })], { dist: 1.5 }));
def('drag.berserker.quake', () => r([noise('pink', 0.3, { bp: [300, 2000] }), tone('sin', 90, 50, 0.4), sizzle(0.8, { t: 0.2, g: 0.4 })]));
def('ult.berserker.cutin', () => r([tone('saw', 110, 95, 1, { a: 0.05, g: 0.6 }), tone('saw', 116, 100, 1, { a: 0.05, g: 0.6 }), noise('pink', 1, { bp: [700], q: 3, g: 0.5, e: 'hump' })], { dist: 3, rev: 0.25 }));
def('ult.berserker.roar', () => r([...boom(45, 28, 0.8), noise('white', 0.15, { lp: [3000, 500] })], { dist: 1.8 }));
def('ult.berserker.frenzy', () => r(heart(0, 0.8), { loop: 0.75 }));
def('ult.berserker.finale', () => r([noise('pink', 0.6, { e: 'swell', bp: [400, 3000] }), ...seq(5, 0.12, (_, t) => tone('sin', 60, 45, 0.08, { t, g: 0.6 })), ...boom(50, 25, 1.2, { t: 0.6 }), ...crash(0.6, { t: 0.6 }), bell(98, 1.5, { t: 0.6, g: 0.4 })], { dist: 1.6, rev: 0.35 }));

// 섀도우 (그림자, C#3 138Hz, 감화음)
def('drag.shadow.clone', () => r([noise('pink', 0.2, { e: 'swell', bp: [500, 2500] }), ...seq(3, 0.08, (i, t) => tone('sin', 200 * st(i * 3), 90, 0.1, { t: t + 0.2 })), ...seq(3, 0.08, (_, t) => click(t + 0.24, 2000, 0.4))]));
def('drag.shadow.execute', () => r([noise('pink', 0.25, { e: 'swell', bp: [3000, 600] }), whoosh(4000, 1500, 0.1, { t: 0.25 }), whoosh(4000, 1500, 0.1, { t: 0.33 }), noise('white', 0.15, { t: 0.25, hp: [2000], grain: 300 }), bell(138.6, 1, { t: 0.3, g: 0.5 })], { rev: 0.25 }));
def('ult.shadow.cutin', () => r([...[220, 587, 1200].map(f => bell(f, 1.2, { g: 0.4 })), ...whisper(1, { g: 0.6 })], { rev: 0.4 }));
def('ult.shadow.dance', () => r([whoosh(3000, 1200, 0.1), noise('white', 0.05, { t: 0.05, hp: [3000] })]));
def('ult.shadow.moon', () => r([...heart(0, 0.6), tone('sin', 400, 1600, 0.35, { e: 'swell', g: 0.5 }), noise('white', 0.3, { t: 0.35, bp: [3000, 8000] }), ...boom(55, 30, 0.6, { t: 0.35 }), ...glass(10, 0.4, 0.6)], { rev: 0.4 }));

// 레인저 (바람, G3 196Hz, 서스)
def('drag.ranger.draw', () => r([whoosh(500, 2000, 0.15), ...boom(100, 50, 0.15), tone('saw', 140, 220, 0.25, { t: 0.05, g: 0.3, e: 'lin' })]));
def('drag.ranger.volley', () => r([tone('tri', 520, 500, 0.12, { a: 0.001 }), noise('white', 0.12, { t: 0.02, hp: [3000], e: 'lin' })]));
def('drag.ranger.pierce', () => r([tone('saw', 300, 1400, 0.25, { e: 'swell', g: 0.4 }), noise('white', 0.06, { t: 0.25, hp: [2000] }), ...boom(80, 40, 0.4, { t: 0.25 }), ping(2400, 0.5, { t: 0.26, g: 0.4 }), ...partials([2093, 3136], 0.3, { t: 0.3, g: 0.4 })], { rev: 0.2 }));
def('ult.ranger.cutin', () => r([...[1200, 1900, 2700].map((f, i) => ping(f, 0.8, { t: 0.45 + i * 0.03, g: 0.4, a: 0.01 })), noise('pink', 0.45, { e: 'swell', bp: [3000, 600] }), ...chord(196, 'sus', 0.9, { t: 0.45 })], { rev: 0.3 }));
def('ult.ranger.barrage', () => r([tone('tri', 520, 500, 0.08, { a: 0.001 }), noise('white', 0.05, { hp: [3000] })]));
def('ult.ranger.rain', () => r([tone('sin', 400, 2000, 0.3, { e: 'swell', g: 0.4 }), ...seq(5, 0.1, (_, t) => [...click(t + 0.3, 2500, 0.5), noise('white', 0.04, { t: t + 0.3, hp: [3000], g: 0.4 })])]));
def('ult.ranger.skyshot', () => r([ping(3200, 0.25, { e: 'swell', g: 0.4 }), noise('white', 0.4, { t: 0.3, lp: [4000, 300] }), tone('sin', 55, 35, 0.6, { t: 0.3 }), ...partials([2093, 3136], 0.4, { t: 0.32, g: 0.5 }), whoosh(2000, 800, 0.4, { t: 0.6, g: 0.3 })], { rev: 0.35 }));

// 메이지 (마법 불·얼음, E3 165Hz, 단조)
def('drag.mage.sigil', () => r([tone('sin', 110, 110, 0.6, { vib: [8, 0.2], e: 'hump' }), tone('sin', 165, 165, 0.6, { vib: [8, 0.2], e: 'hump', g: 0.7 })]));
def('drag.mage.meteor', () => r([noise('pink', 0.15, { lp: [3000, 500] }), tone('sin', 200, 80, 0.15), ...click(0.01, 1500, 0.4)]));
def('drag.mage.bigmeteor', () => r([tone('sin', 1200, 300, 0.75, { e: 'lin', g: 0.4 }), noise('white', 0.6, { t: 0.75, lp: [3000, 200] }), tone('sin', 45, 30, 0.8, { t: 0.75 })], { dist: 2, rev: 0.25 }));
def('drag.mage.lava', () => r([noise('brown', 1.5, { e: 'flat', lp: [500] }), ...seq(5, 0.3, (i, t) => tone('sin', 200 + i * 40, 500, 0.06, { t: t + 0.05, g: 0.4 }))], { loop: 1.5 }));
def('ult.mage.cutin', () => r([...CUTIN_RISER(165, 660), ...[880, 1320, 1760].map((f, i) => bell(f, 1.2, { t: 0.45 + i * 0.05, g: 0.45 }))], { rev: 0.45 }));
def('ult.mage.blizzard', () => r([noise('pink', 2, { e: 'flat', bp: [600, 900], q: 1.5, trem: 0.5 })], { loop: 2 }));
def('ult.mage.tick', () => r(click(0, 3000, 0.8)));
def('ult.mage.freeze', () => r([noise('white', 0.4, { hp: [3000], grain: 250 }), ping(2500, 0.6, { t: 0.2, g: 0.5 })]));
def('ult.mage.shatter', () => r([noise('white', 0.3, { hp: [2500] }), ...glass(12, 0, 0.8), ...boom(60, 30, 0.5), ...seq(6, 0.08, (i, t) => ping(3500 + i * 300, 0.1, { t: t + 0.3, g: 0.15 }))], { rev: 0.35 }));

// 거너 (화약, F2 87Hz, 단조)
def('drag.gunner.pump', () => r([...boom(100, 50, 0.15), ...click(0.05, 3000), ...click(0.13, 2600), ...click(0.35, 3000), ...click(0.43, 2600)]));
def('drag.gunner.blast', () => r([noise('white', 0.25, { lp: [5000, 800] }), tone('sin', 90, 50, 0.25), ...seq(2, 0.09, (_, t) => ping(4200, 0.08, { t: t + 0.3, g: 0.2 }))], { dist: 1.3 }));
def('drag.gunner.slug', () => r([...click(0, 2800), tone('sin', 2000, 2000, 0.28, { e: 'swell', g: 0.15 }), noise('white', 0.35, { t: 0.3, lp: [6000, 400] }), tone('sin', 60, 30, 0.5, { t: 0.3 }), tone('sin', 120, 40, 0.3, { t: 0.3, g: 0.6 }), noise('brown', 0.2, { t: 0.4, lp: [800], g: 0.4 })], { dist: 1.6 }));
def('ult.gunner.cutin', () => r([...click(0, 1500), ...seq(2, 0.12, (_, t) => tone('sin', 1000, 1000, 0.08, { t: t + 0.05, g: 0.4 })), noise('white', 0.15, { t: 0.4, lp: [4000, 800] }), noise('pink', 0.6, { t: 0.45, bp: [1500, 4000], e: 'hump' }), ...chord(87.3, 'min', 0.8, { t: 0.45, w: 'saw' })], { rev: 0.25 }));
def('ult.gunner.shells', () => r([tone('sin', 1500, 600, 0.25, { e: 'lin', g: 0.3 }), noise('white', 0.2, { t: 0.25, lp: [3000, 500] }), tone('sin', 80, 40, 0.2, { t: 0.25 })]));
def('ult.gunner.heavy', () => r([tone('sin', 1800, 300, 0.46, { e: 'lin', g: 0.4 }), noise('white', 0.9, { t: 0.46, lp: [2000, 150] }), tone('sin', 40, 25, 1, { t: 0.46 }), noise('white', 0.6, { t: 0.7, hp: [2000], grain: 40, g: 0.4 })], { dist: 2, rev: 0.3 }));

// 클레릭 (신성한 빛, C4 262Hz, 장조)
def('drag.cleric.descend', () => r([tone('sin', 1800, 900, 0.4, { g: 0.5 }), ...chord(523, 'maj', 1, { a: 0.08, w: 'sin' })], { rev: 0.35 }));
def('drag.cleric.sanctuary', () => r([chime(1320, { g: 0.6 })]));
def('drag.cleric.bell', () => r([noise('pink', 0.4, { e: 'swell', bp: [500, 2000] }), bell(523, 1.2, { t: 0.4, parts: [1, 2, 2.7] }), ping(2600, 0.3, { t: 0.42, g: 0.3 })], { rev: 0.4 }));
def('ult.cleric.cutin', () => r([noise('pink', 0.45, { e: 'swell', bp: [800, 3000] }), ...chord(523, 'maj', 1.4, { t: 0.3, a: 0.2, w: 'saw', g: 0.6 })], { rev: 0.5 }));
def('ult.cleric.grace', () => r([noise('pink', 0.6, { lp: [6000, 1000], g: 0.6 }), ...chord(523, 'maj', 1.2, { w: 'sin' }), ...chord(1046, 'maj', 1, { w: 'sin', g: 0.4 })], { rev: 0.5 }));
def('ult.cleric.judgement', () => r([...boom(110, 55, 0.4), bell(220, 0.8, { g: 0.5 })], { rev: 0.25 }));

// 메딕 (의료, A4 440Hz, 장조)
def('drag.medic.firstaid', () => r([...boom(100, 50, 0.2), tone('sq', 880, 880, 0.08, { g: 0.3 }), tone('sq', 1318, 1318, 0.08, { t: 0.1, g: 0.3 }), ping(1760, 0.1, { t: 0.25, g: 0.4 }), ping(1760, 0.1, { t: 0.35, g: 0.4 })]));
def('drag.medic.syringe', () => r([noise('white', 0.08, { bp: [4000], q: 2 })]));
def('drag.medic.defib', () => r([tone('saw', 400, 2400, 0.15, { e: 'swell', g: 0.4 }), noise('white', 0.1, { t: 0.15, grain: 500 }), tone('sq', 80, 80, 0.12, { t: 0.15, g: 0.5 }), tone('sq', 1000, 1000, 0.15, { t: 0.35, g: 0.25 })], { dist: 1.3 }));
def('ult.medic.cutin', () => r([...seq(4, 0.22, (i, t) => tone('tri', i % 2 ? 900 : 650, i % 2 ? 900 : 650, 0.22, { t, e: 'flat', g: 0.6 }))]));
def('ult.medic.golden', () => r([...heart(0, 1), chime(1318, { t: 0.3 }), chime(1760, { t: 0.4 }), whoosh(1000, 4000, 0.3, { t: 0.4 })], { rev: 0.3 }));
def('ult.medic.siren', () => r([tone('sq', 1000, 1000, 0.08, { g: 0.3 }), chime(1568, { t: 0.08, g: 0.6 })]));
def('char.revive', () => r([...arp([523, 659, 784, 1046], 0.07, 0.4, { w: 'tri' }), bell(1046, 0.8, { t: 0.28, g: 0.4 })], { rev: 0.3 }));

// 퇴마사 (부적·괴담, D3 147Hz, 감화음)
def('drag.exorcist.seal', () => r([...seq(8, 0.025, (_, t) => noise('pink', 0.04, { t, bp: [3000], q: 2, g: 0.6 })), ...click(0.22, 1200), noise('pink', 0.3, { t: 0.24, bp: [1500, 3000], q: 1.5 }), tone('sin', 147, 147, 0.6, { t: 0.2, trem: 5, g: 0.5 }), noise('pink', 0.3, { t: 0.5, bp: [2500, 1000], e: 'hump', g: 0.4 })]));
def('drag.exorcist.destroy', () => r([noise('pink', 0.15, { e: 'swell', bp: [500, 3000], q: 2 }), ...boom(80, 40, 0.5, { t: 0.15 }), noise('white', 0.6, { t: 0.2, hp: [2000], grain: 30, g: 0.4 }), whoosh(1000, 3000, 0.4, { t: 0.25, g: 0.4 }), chime(1568, { t: 0.4, g: 0.4 })], { dist: 1.3 }));
def('ult.exorcist.cutin', () => r([noise('pink', 0.25, { bp: [1500, 4000], q: 1.5 }), tone('sin', 70, 68, 1.5, { t: 0.2, a: 0.01 }), bell(140, 1.5, { t: 0.2, g: 0.6 })], { rev: 0.4 }));
def('ult.exorcist.greatseal', () => r([...boom(60, 30, 0.6), ...whisper(1.2, { t: 0.1 }), ...whisper(1, { t: 0.2, g: 0.6 })], { rev: 0.4 }));
def('ult.exorcist.storm', () => r([noise('pink', 1.5, { e: 'flat', bp: [2500, 3500], q: 1.5, trem: 12 })], { loop: 1.5 }));
def('ult.exorcist.destroy', () => r([kick(0, 1), ...boom(70, 30, 0.6), bell(110, 1.6, { g: 0.6, parts: [1, 1.48, 2.1, 2.9] }), noise('white', 0.8, { t: 0.1, hp: [2000], grain: 30, g: 0.4 })], { rev: 0.4 }));

// 바드 (음악, F4 349Hz, 장조)
def('drag.bard.beat1', () => r([tone('tri', 392, 392, 0.4), kick(0, 0.8), tone('tri', 523, 523, 0.3, { t: 0.05, g: 0.6 })]));
def('drag.bard.encore', () => r([chime(1046), chime(1568, { t: 0.1 })]));
def('drag.bard.beat2', () => r([tone('tri', 659, 659, 0.3), tone('tri', 784, 784, 0.3, { t: 0.03 })]));
def('drag.bard.forte', () => r([...[262, 330, 392, 523].map(f => tone('saw', f, f, 0.8, { g: 0.3, a: 0.01 })), ...crash(0.6, { g: 0.4 }), kick(0, 1)], { rev: 0.3 }));
def('ult.bard.cutin', () => r([...arp([523, 659, 784, 1046, 1318], 0.08, 0.5, { w: 'tri' }), whoosh(1000, 4000, 0.45, { e: 'swell' })], { rev: 0.35 }));
def('ult.bard.choir', () => r([...chord(262, 'maj', 1.4, { w: 'saw', a: 0.15, g: 0.7 }), chime(1568, { t: 0.2 })], { rev: 0.5 }));
def('ult.bard.beat', () => r([kick(0, 1), ...snare(0.15, 0.7)]));
def('ult.bard.beat.last', () => r([kick(0, 1), ...crash(0.8, { g: 0.6 }), tone('sin', 65.4, 65.4, 0.9, { a: 0.01 })], { rev: 0.3 }));

// 크로노 (시간, B3 247Hz, 서스)
def('drag.chrono.rift', () => r([...click(0, 3000), ...click(0.12, 2200), noise('white', 0.25, { hp: [4000] }), tone('sin', 1200, 400, 0.3, { g: 0.4 })]));
def('drag.chrono.wind', () => {
  const L: Layer[] = [];
  for (let t = 0; t < 0.45; t += 1 / (8 + 40 * t)) L.push(...click(t, 2600, 0.5));
  return r(L);
});
def('drag.chrono.rewind', () => r([noise('white', 0.35, { e: 'swell', hp: [3000] }), tone('sin', 400, 1200, 0.35, { e: 'swell', g: 0.3 })]));
def('drag.chrono.stop', () => r([bell(880, 1, { parts: [1, 1.5, 2.76] }), ...glass(6, 0.02, 0.5), ...seq(4, 0.06, (_, t) => click(t + 0.3, 3200, 0.4))], { rev: 0.3 }));
def('ult.chrono.cutin', () => {
  const L: Layer[] = [whoosh(800, 3000, 0.6, { t: 0.2 }), ...chord(247, 'sus', 0.9, { t: 0.45, w: 'saw' })];
  for (let t = 0; t < 0.45; t += 1 / (10 + 60 * t)) L.push(...click(t, 2800, 0.5));
  return r(L, { rev: 0.3 });
});
def('ult.chrono.stasis', () => r([tone('sin', 400, 60, 0.5, { e: 'lin', g: 0.4 }), bell(130.8, 2, { g: 0.8 })], { rev: 0.5 }));
def('ult.chrono.tock', () => r([...click(0, 440, 1), tone('sin', 60, 50, 0.15)]));
def('ult.chrono.resume', () => r([...click(0, 3000, 1.5), ...glass(14, 0.02, 0.9), ...boom(60, 30, 0.6)], { rev: 0.35 }));

// 퍼펫티어 (실·괴담, E4 330Hz, 감화음)
def('drag.puppeteer.toss', () => r([whoosh(1500, 3500, 0.1), noise('pink', 0.08, { t: 0.1, bp: [1500] }), ...click(0.12, 900), tone('saw', 220, 210, 0.2, { t: 0.14, g: 0.2, vib: [7, 0.3] })]));
def('drag.puppeteer.thread', () => r([tone('saw', 220, 218, 0.6, { vib: [6, 0.3], g: 0.6, a: 0.001 })]));
def('drag.puppeteer.scratch', () => r([noise('pink', 0.08, { bp: [2000], q: 3, g: 0.5 })]));
def('doll.burst', () => r([noise('white', 0.15, { bp: [2500], q: 1, grain: 200 }), tone('sin', 300, 80, 0.15), ...click(0.12, 3000, 0.3), ...seq(3, 0.07, (i, t) => tone('tri', 900 + i * 60, 800, 0.05, { t: t + 0.2, g: 0.15 }))]));
def('ult.puppeteer.cutin', () => r([noise('brown', 0.5, { lp: [800, 300], e: 'hump' }), ...arp([1318, 1568, 1760, 1568, 1318], 0.09, 0.4, { w: 'sin', g: 0.6 })], { rev: 0.35 }));
def('ult.puppeteer.open', () => r([noise('brown', 0.4, { lp: [1200], e: 'hump' }), tone('saw', 392, 392, 0.2, { t: 0.2, g: 0.4 }), tone('saw', 523, 523, 0.4, { t: 0.4, g: 0.4 }), ...seq(4, 0.08, (i, t) => tone('sin', 400 + i * 80, 200, 0.08, { t: t + 0.5, g: 0.5 }))], { rev: 0.25 }));
def('ult.puppeteer.charm', () => r(seq(4, 0.06, (_, t) => ping(1760, 0.2, { t, g: 0.5 }))));
def('ult.puppeteer.curtaincall', () => r([noise('white', 0.08, { bp: [3000] }), ...boom(70, 35, 0.6, { t: 0.05 }), noise('white', 1, { t: 0.3, bp: [1800], grain: 60, g: 0.35 })], { rev: 0.3 }));

// ─────────────────────────── 3-3 attacks · hits ───────────────────────────

def('atk.shot.turret', () => r([tone('sq', 900, 600, 0.08, { g: 0.4 })]));
def('hit.basic', () => r([noise('pink', 0.06, { lp: [2500, 600] }), tone('sin', 160, 90, 0.06, { g: 0.6 })]));
def('hit.skill', () => r([noise('pink', 0.09, { lp: [3000, 500] }), tone('sin', 130, 60, 0.1)]));
def('hit.multi', () => r([noise('pink', 0.16, { lp: [3500, 400], grain: 120 }), tone('sin', 120, 50, 0.15)]));
def('hit.crit', () => r(partials([2093, 3136], 0.25)));
def('hit.weak', () => r(coin(0, 1)));
def('hit.boss', () => r([tone('sin', 90, 50, 0.15), noise('brown', 0.12, { lp: [800] })]));
def('hurt.char', () => r([noise('pink', 0.08, { lp: [1500, 400] }), tone('sin', 120, 70, 0.08)]));
def('hurt.shield', () => r([ping(1800, 0.12), ping(2700, 0.08, { g: 0.5 })]));
def('hurt.lowhp', () => r(heart(0, 1)));

// ─────────────────────────── 3-4 heal · status ───────────────────────────

def('heal.tick', () => r([chime(1568, { g: 0.6 })]));
def('heal.big', () => r(arp([1046, 1318, 1568], 0.06, 0.4, { w: 'sin' }), { rev: 0.25 }));
def('heal.drain', () => r([noise('pink', 0.4, { e: 'swell', bp: [400, 1500], q: 3 })], { reverse: true }));
def('bench.heal', () => r([ping(1046, 0.2), ping(1568, 0.2, { t: 0.06 })]));
def('bench.buff', () => r([bell(1760, 0.4, { g: 0.6 })]));
def('fx.shield', () => r([tone('sin', 440, 880, 0.15, { g: 0.5 }), ...seq(3, 0.03, (i, t) => ping(3000 + i * 500, 0.08, { t: t + 0.1, g: 0.2 }))]));
def('fx.stun', () => r([tone('sin', 300, 150, 0.1), ...seq(3, 0.09, (_, t) => tone('sin', 3200, 3600, 0.05, { t: t + 0.12, g: 0.3 }))]));
def('fx.frost', () => r([noise('white', 0.2, { hp: [5000], grain: 200 })]));
def('fx.curse', () => r([tone('tri', 150, 140, 0.35, { vib: [9, 0.6], g: 0.6 })], { echo: [0.12, 0.35, 0.5] }));
def('fx.buff', () => r(arp([660, 880, 1046], 0.05, 0.15, { w: 'tri' })));
def('fx.cleanse', () => r([noise('white', 0.3, { hp: [2000, 7000], e: 'swell' }), ping(2600, 0.15, { t: 0.25, g: 0.3 })]));
def('fx.knock', () => r(boom(100, 50, 0.2)));
def('fx.pull', () => r([noise('pink', 0.3, { e: 'swell', lp: [2500, 300] })]));
def('fx.taunt', () => r([tone('sq', 220, 220, 0.22, { e: 'flat', g: 0.4 })]));
def('fx.tether', () => r(chain(4, { gap: 0.035 })));
def('fx.charm', () => r([ping(1760, 0.25), ping(2637, 0.15, { t: 0.03, g: 0.4 })]));
def('fx.summon', () => r([...click(0, 900), tone('sin', 400, 600, 0.06, { g: 0.4 })]));
def('ui.cdcut', () => r(seq(3, 0.05, (i, t) => click(t, 1800 + i * 500, 0.6))));
def('char.down', () => r([tone('saw', 440, 110, 0.8, { e: 'lin', g: 0.35 }), bell(220, 1.2, { t: 0.1, g: 0.5, parts: [1, 1.19, 2.4] }), ...whisper(0.8, { t: 0.2, g: 0.5 })], { rev: 0.35 }));
def('char.down.far', () => r([tone('saw', 440, 110, 0.6, { e: 'lin', g: 0.35 }), bell(220, 0.8, { t: 0.1, g: 0.4, parts: [1, 1.19, 2.4] })], { rev: 0.25 }));
def('char.revive.all', () => r([...chord(523, 'maj', 1.2, { w: 'sin' }), ...chord(1046, 'maj', 1, { w: 'sin', t: 0.15, g: 0.5 })], { rev: 0.35 }));
def('run.out', () => r([...chord(110, 'dim', 2.5, { w: 'saw', a: 0.2 }), bell(87, 2.5, { t: 0.4, g: 0.6 }), bell(82, 2.5, { t: 1.4, g: 0.5 })], { rev: 0.7 }));
def('player.out', () => r([bell(196, 1.2, { g: 0.6 })], { rev: 0.4 }));

// ─────────────────────────── 3-5 pets ───────────────────────────

const ribbit = (t = 0, k = 1): Layer => tone('sq', 300 * k, 220 * k, 0.12, { t, trem: 40, g: 0.5 });
def('pet.frog_bomb', () => r([ribbit(0), tone('sin', 1500, 500, 0.4, { t: 0.1, e: 'lin', g: 0.3 })]));
def('pet.frog_bomb.impact', () => r([noise('white', 0.3, { lp: [4000, 400] }), tone('sin', 80, 40, 0.3), noise('white', 0.4, { t: 0.15, hp: [2500], grain: 50, g: 0.3 })], { dist: 1.5 }));
def('pet.fairy_heal', () => r(seq(8, 0.04, (i, t) => ping(1568 * st(i * 1.5), 0.15, { t, g: 0.4 })), { rev: 0.3 }));
def('pet.turtle_guard', () => r([...click(0, 700, 1.2), tone('sin', 440, 880, 0.2, { t: 0.08, g: 0.5 }), ping(2600, 0.15, { t: 0.2, g: 0.3 })]));
def('pet.owl_frost', () => r([tone('sin', 420, 380, 0.18, { a: 0.03 }), tone('sin', 420, 370, 0.25, { t: 0.25, a: 0.03 }), chime(2093, { t: 0.45, g: 0.5 }), noise('white', 0.2, { t: 0.45, hp: [5000], grain: 200, g: 0.4 })]));
def('pet.golem_turret', () => r([...click(0, 1200), ...click(0.1, 1200), tone('saw', 300, 900, 0.3, { t: 0.15, g: 0.25 })]));
def('pet.cat_void', () => r([tone('tri', 700, 500, 0.3, { vib: [5, 1], g: 0.5 }), noise('pink', 0.4, { t: 0.2, e: 'swell', lp: [3000, 200] }), ...boom(70, 35, 0.4, { t: 0.6 })]));
def('pet.drum_raccoon', () => r([...seq(3, 0.14, (_, t) => [kick(t, 0.8), noise('pink', 0.08, { t, bp: [300], g: 0.6 })])]));
def('pet.rabbit_time', () => r([...click(0, 2800), tone('sin', 200, 600, 0.2, { t: 0.05, vib: [20, 2], g: 0.5 }), ...seq(5, 0.04, (i, t) => ping(2500 + i * 300, 0.06, { t: t + 0.25, g: 0.25 }))]));

// ─────────────────────────── 3-6 monsters ───────────────────────────

def('mon.spawnWarn', () => r([noise('brown', 0.4, { lp: [200], e: 'hump' })]));
def('mon.spawn', () => r([noise('pink', 0.1, { lp: [600] }), tone('sin', 90, 60, 0.1, { g: 0.6 })]));
def('mon.windup', () => r([tone('saw', 110, 160, 0.45, { vib: [10, 0.4], e: 'swell', g: 0.5 })]));
def('mon.impact.circle', () => r(boom(90, 40, 0.35)));
def('mon.impact.line', () => r([whoosh(3000, 800, 0.15), ...boom(80, 40, 0.3, { t: 0.1 })]));
def('mon.impact.cone', () => r([noise('pink', 0.25, { bp: [1500, 600], grain: 150 })]));
def('mon.impact.ring', () => r(boom(70, 35, 0.35)));
def('mon.interrupt', () => r([...glass(9, 0, 1), ping(1320, 0.4, { g: 0.4 })], { rev: 0.2 }));
def('mon.charge', () => r([tone('saw', 1800, 1500, 0.15, { g: 0.2 }), noise('brown', 0.25, { t: 0.1, lp: [600], grain: 40 })]));
def('mon.blink', () => r([whoosh(800, 3000, 0.2)], { reverse: true }));
def('mon.heal', () => r([ping(1200, 0.08, { g: 0.5 })]));
def('mon.death', () => r([noise('pink', 0.12, { lp: [3000, 300] }), tone('sin', 200, 70, 0.12)]));
def('mon.death.phone', () => r([...ringer(0.25), noise('pink', 0.12, { t: 0.25, lp: [3000, 300] })]));
def('mon.death.copy', () => r([noise('white', 0.18, { bp: [3000], q: 1, grain: 250 })]));
def('mon.death.mannequin', () => r(seq(3, 0.05, (i, t) => click(t, 900 + i * 200, 0.8))));
def('mon.death.eye', () => r([noise('pink', 0.15, { lp: [1200, 300] }), tone('sin', 140, 60, 0.1)]));
def('mon.death.vending', () => r([...partials([600, 1100, 1650], 0.25), noise('pink', 0.1, { lp: [2000] })]));
def('mon.death.umbrella', () => r([noise('pink', 0.25, { bp: [800, 1600], trem: 30 })]));
def('mon.death.multi', () => r([noise('pink', 0.25, { lp: [3000, 300], grain: 60 }), tone('sin', 160, 50, 0.2)]));
def('mid.spawn', () => r([...[110, 117, 156].map(f => tone('saw', f, f, 0.9, { g: 0.35, a: 0.05 })), ...boom(60, 30, 0.8), noise('white', 0.5, { e: 'swell', hp: [3000] })], { rev: 0.3 }));
def('mid.windup', () => r([tone('saw', 70, 110, 0.6, { vib: [8, 0.5], e: 'swell', g: 0.6 })]));
def('mid.death', () => r([...boom(70, 30, 0.6), ...coin(0.15, 0.8)], { rev: 0.2 }));
def('copy.pop', () => r([noise('white', 0.08, { bp: [2500], q: 0.8 }), tone('sin', 300, 500, 0.05, { g: 0.4 })]));

// ─────────────────────────── 3-7 bosses · groggy ───────────────────────────

/** Common minor chord + the boss motif (intro) / 5 semitones lower + heartbeat (phase). */
function defBosses(): void {
  for (const b of BOSSES) {
    const v = BOSS_VOICE[b.id] ?? { base: 82, motif: [0, -1] };
    const motif = (k: number, t0: number): Layer[] => v.motif.map((s, i) => tone('saw', v.base * 2 * k * st(s), v.base * 2 * k * st(s), 0.35, { t: t0 + i * 0.22, g: 0.5, a: 0.01 }));
    def(`boss.intro.${b.id}`, () => r([...chord(v.base, 'min', 2, { w: 'saw', a: 0.1 }), ...motif(1, 0.3), ...bossMotifExtra(b.id)], { rev: 0.5 }));
    def(`boss.phase.${b.id}`, () => r([...crash(0.6), ...partials([300, 450, 710], 0.6, { g: 0.5 }), noise('pink', 0.5, { t: 0.1, e: 'swell', bp: [400, 2000] }), ...motif(st(-5), 0.6), ...heart(1.4, 0.8), ...heart(1.9, 0.8)], { rev: 0.4 }));
  }
}

function bossMotifExtra(id: string): Layer[] {
  switch (id) {
    case 'elevator_keeper':
      return [bell(660, 0.8, { t: 0.1 }), bell(523 * st(0.4), 0.8, { t: 0.45 }), tone('saw', 140, 120, 0.8, { t: 1, vib: [3, 1], g: 0.2 })];
    case 'overtime_lord':
      return [tone('sq', 120, 120, 1.2, { e: 'flat', trem: 50, g: 0.15 }), ...boom(90, 40, 0.4, { t: 1.2 })];
    case 'surgeon_director':
      return [tone('sin', 1000, 1000, 1, { e: 'flat', t: 0.2, g: 0.25 }), noise('white', 0.3, { t: 1.2, bp: [5000], q: 4, g: 0.3 })];
    default:
      return [tone('sin', 55, 55, 1.6, { trem: 3 }), tone('sin', 57, 57, 1.6), noise('pink', 0.15, { t: 0.9, lp: [1200] }), ...whisper(0.8, { t: 1, g: 0.5 })];
  }
}

/** boss.windup.<kind> / boss.impact.<kind> (docs/sfx.md 3-7). */
export const BOSS_KINDS = ['doors', 'countdown', 'papers', 'stamp', 'summon', 'blades', 'gas', 'slice', 'burst', 'beam', 'tentacle', 'ring'] as const;
const BOSS_WINDUP: Record<(typeof BOSS_KINDS)[number], () => Layer[]> = {
  doors: () => [bell(1318, 0.4), bell(1046, 0.5, { t: 0.25 }), noise('pink', 0.6, { t: 0.4, bp: [400, 900], e: 'hump' })],
  countdown: () => seq(6, 0.1, (i, t) => tone('sq', 1200, 1200, 0.05, { t: t * (1 - i * 0.08), g: 0.3 })),
  papers: () => [noise('white', 0.6, { bp: [3000], q: 1, grain: 80, e: 'hump' })],
  stamp: () => [tone('sin', 80, 140, 0.5, { e: 'swell' }), noise('brown', 0.5, { e: 'swell', lp: [400] })],
  summon: () => [...ringer(0.4), tone('sq', 1500, 1500, 0.1, { t: 0.5, g: 0.3 }), noise('pink', 0.12, { t: 0.65, lp: [1200] })],
  blades: () => [...seq(3, 0.1, (_, t) => [...click(t, 3500), ping(2800, 0.15, { t, g: 0.3 })])],
  gas: () => [noise('white', 0.7, { hp: [2500], e: 'hump' })],
  slice: () => [tone('sin', 2000, 4000, 0.4, { e: 'swell', g: 0.3 }), noise('white', 0.4, { e: 'swell', bp: [3000] })],
  burst: () => [noise('pink', 0.7, { e: 'swell', lp: [3000, 200] })],
  beam: () => [tone('saw', 200, 1200, 0.7, { e: 'swell', g: 0.4 }), noise('white', 0.7, { e: 'swell', bp: [1000, 4000], g: 0.3 })],
  tentacle: () => [noise('brown', 0.5, { lp: [600], trem: 6, e: 'hump' })],
  ring: () => [bell(82, 1.2, { parts: [1, 1.48, 2.1] })],
};
const BOSS_IMPACT: Record<(typeof BOSS_KINDS)[number], () => Layer[]> = {
  doors: () => [noise('pink', 0.2, { bp: [600, 200] }), ...boom(80, 35, 0.5, { t: 0.15 }), ...partials([200, 300], 0.4, { t: 0.15, g: 0.5 })],
  countdown: () => [...click(0, 1200, 1.5), ...boom(100, 40, 0.3)],
  papers: () => [whoosh(3000, 800, 0.3), noise('white', 0.2, { bp: [3000], grain: 200 })],
  stamp: () => [...boom(110, 40, 0.4), noise('brown', 0.2, { lp: [1500] })],
  summon: () => [noise('pink', 0.12, { lp: [800] }), tone('sin', 120, 60, 0.15)],
  blades: () => [whoosh(4000, 1500, 0.15), ...click(0.12, 3000)],
  gas: () => [noise('white', 0.8, { hp: [2000, 800], e: 'hump' })],
  slice: () => [noise('white', 0.25, { bp: [5000, 1500], q: 1.5 }), tone('sin', 70, 40, 0.3)],
  burst: () => [...boom(60, 28, 0.8), ...crash(0.4, { g: 0.5 })],
  beam: () => [noise('white', 0.6, { lp: [8000, 2000] }), tone('saw', 120, 100, 0.6, { g: 0.4 })],
  tentacle: () => [noise('pink', 0.2, { lp: [1500, 300] }), tone('sin', 140, 60, 0.15)],
  ring: () => [bell(65, 1.5, { parts: [1, 1.48, 2.1, 2.9] }), ...boom(55, 30, 0.6)],
};
for (const k of BOSS_KINDS) {
  def(`boss.windup.${k}`, () => r(BOSS_WINDUP[k]()));
  def(`boss.impact.${k}`, () => r(BOSS_IMPACT[k](), { rev: 0.25, dist: 1.2 }));
}
def('boss.enrage', () => r(seq(2, 0.45, (_, t) => tone('saw', 600, 900, 0.4, { t, e: 'hump', g: 0.5 }))));
def('enrage.heart', () => r(heart(0, 0.8), { loop: 0.7 }));
def('boss.retreat', () => r([...chord(110, 'min', 1.2, { w: 'saw' }), ...boom(60, 28, 1)], { reverse: true, rev: 0.6 }));
def('groggy.fill', () => r([bell(523, 0.35, { parts: [1, 2, 3] })]));
def('groggy.break', () => r([...glass(12, 0, 1), bell(98, 1.8, { parts: [1, 1.48, 2.1, 2.9], g: 0.8 }), tone('sin', 120, 30, 0.9, { g: 0.9 })], { rev: 0.4 }));
def('groggy.stars', () => r(seq(4, 0.25, (i, t) => ping(2000 + ((i * 377) % 1000), 0.12, { t, g: 0.4 })), { loop: 1 }));
def('groggy.recover', () => r([tone('saw', 70, 90, 0.7, { vib: [12, 0.5], g: 0.5, e: 'hump' }), whoosh(400, 1500, 0.6)], { dist: 1.5 }));

// ─────────────────────────── 3-8 floors · ambience ───────────────────────────

const FLOOR_START: Record<(typeof ZONES)[number], () => Layer[]> = {
  lobby: () => [bell(784, 0.8, { parts: [1, 2, 3] }), ...arp([523, 659], 0.25, 0.4, { t: 0.4, w: 'sin', g: 0.4 })],
  office: () => [...seq(3, 0.07, (_, t) => noise('white', 0.03, { t, hp: [3000], g: 0.4 })), tone('sq', 120, 120, 0.4, { e: 'flat', trem: 50, g: 0.15 }), ...ringer(0.4, { t: 0.5, g: 0.3 })],
  ward: () => [tone('sin', 1000, 1000, 0.1, { g: 0.4 }), tone('sin', 1000, 1000, 0.1, { t: 0.5, g: 0.4 }), drip(0.8, 0.5)],
  rooftop: () => [whoosh(300, 1200, 1.2), tone('saw', 900, 700, 0.5, { t: 0.6, g: 0.1 })],
};
const AMB: Record<string, () => Layer[]> = {
  lobby: () => [...[262, 330, 392, 330].map((f, i) => tone('sin', f, f, 1.8, { t: i * 2, a: 0.2, e: 'hump', g: 0.4 })), noise('brown', 8, { e: 'flat', lp: [300] })],
  office: () => [tone('sq', 120, 120, 8, { e: 'flat', g: 0.06 }), ...seq(10, 0.7, (i, t) => click(t + (i % 3) * 0.1, 1500, 0.15))],
  ward: () => [tone('sin', 98, 98, 8, { e: 'flat', g: 0.5, trem: 0.25 }), drip(1.5, 0.4), drip(5.2, 0.3)],
  rooftop: () => [noise('pink', 8, { e: 'flat', bp: [400, 700], q: 0.7, trem: 0.15 })],
  boss: () => [tone('saw', 55, 55, 8, { e: 'flat', g: 0.3 }), tone('sin', 82, 82, 8, { e: 'flat', g: 0.4, trem: 0.3 })],
  goedam: () => [tone('sin', 65, 65, 8, { e: 'flat' }), tone('sin', 66.5, 66.5, 8, { e: 'flat' })],
};
for (const z of ZONES) def(`floor.start.${z}`, () => r(FLOOR_START[z](), { rev: 0.3 }));
for (const [k, L] of Object.entries(AMB)) def(`amb.${k}`, () => r(L(), { loop: 8 }));
def('zone.enter', () => r([noise('pink', 0.8, { e: 'swell', bp: [300, 2000] })], { rev: 0.3 }));
def('floor.clear', () => r([...arp([523, 659, 784, 1046], 0.08, 0.25, { w: 'sq', g: 0.4 }), ...seq(4, 0.05, (i, t) => ping(3000 + i * 400, 0.1, { t: t + 0.35, g: 0.2 }))]));
def('floor.clear.boss', () => r([...arp([523, 659, 784, 1046], 0.1, 0.4, { w: 'sq', g: 0.5 }), ...chord(523, 'maj', 1, { t: 0.4, w: 'saw' }), ...crash(0.8, { t: 0.4, g: 0.5 })], { rev: 0.3 }));
def('ui.timer.tick', () => r([ping(1000, 0.05)]));
def('ui.timer.hot', () => r([ping(1400, 0.06)]));

// ─────────────────────────── 3-9 괴담 rooms ───────────────────────────

const ROOM: Record<string, () => Layer[]> = {
  broken_vending: () => [...coin(0, 0.8), ...coin(0.15, 0.6), tone('saw', 60, 60, 1, { t: 0.3, e: 'flat', g: 0.25 })],
  elevator_whisper: () => [bell(660 * st(0.5), 0.8), ...whisper(1, { t: 0.4 })],
  ringing_phone: () => [...ringer(0.5), ...ringer(0.5, { t: 0.8 })],
  overtime_roster: () => [noise('white', 0.6, { bp: [3500], q: 3, grain: 40 }), ...seq(4, 0.5, (_, t) => click(t, 2000, 0.4))],
  copier: () => [tone('saw', 200, 600, 0.8, { e: 'hump', g: 0.3 }), noise('white', 0.4, { t: 0.6, bp: [3000], grain: 120 })],
  endless_corridor: () => steps(4, 0.45, { g: 0.8 }),
  red_blue_paper: () => [...seq(3, 0.09, (i, t) => tone('tri', 900 + i * 60, 800, 0.06, { t, g: 0.2 })), drip(0.6, 0.5)],
  night_rounds: () => [tone('sin', 1000, 1000, 0.1, { g: 0.3 }), tone('sin', 1000, 1000, 0.1, { t: 0.9, g: 0.3 }), noise('brown', 1.2, { t: 0.2, lp: [600], trem: 8, e: 'hump' })],
  iv_drip: () => [drip(0, 0.6), drip(0.5, 0.6), drip(1, 0.6)],
  sky_eye: () => [tone('sin', 55, 55, 1.5, { e: 'hump' }), noise('pink', 0.12, { t: 1, lp: [1200] })],
  red_mask: () => [tone('tri', 400, 380, 0.5, { vib: [5, 1], g: 0.3 }), ...steps(3, 0.35, { t: 0.5, g: 0.6 })],
  cursed_relic: () => [...chain(5, { gap: 0.04 }), noise('pink', 0.2, { t: 0.3, bp: [3000], q: 2 }), ...seq(2, 0.25, (_, t) => click(t + 0.6, 800, 0.6))],
};
for (const room of GOEDAM_ROOMS) def(`gd.room.${room.id}`, () => r((ROOM[room.id] ?? ROOM.sky_eye)(), { rev: 0.4 }));
def('gd.enter', () => r([...zap(3), tone('sin', 60, 60, 0.8, { t: 0.2, trem: 4 }), noise('pink', 0.6, { t: 0.2, e: 'swell', bp: [300, 2000] })], { rev: 0.4 }));
def('gd.pick', () => r([...click(0, 1500), tone('sin', 220, 200, 0.2, { g: 0.6 })]));
def('gd.pick.gamble', () => r([...click(0, 1500), ...seq(4, 0.05, (_, t) => click(t + 0.05, 1200, 0.5)), tone('sin', 220, 200, 0.2, { g: 0.5 })]));
def('gd.pick.cost', () => r([...click(0, 1500), bell(98, 0.9, { parts: [1, 1.48, 2.1], g: 0.7 })]));
def('gd.flicker', () => r(zap(3)));
def('gd.result.good', () => r([noise('pink', 0.5, { e: 'hump', lp: [3000] }), ...chord(523, 'maj', 1, { w: 'sin', t: 0.1 }), noise('pink', 0.5, { t: 0.8, bp: [600, 300], g: 0.3, e: 'hump' })], { rev: 0.4, peak: 0.8 }));
def('gd.result.bad', () => r([tone('saw', 233, 233, 0.35, { g: 0.4 }), tone('saw', 247, 247, 0.35, { g: 0.4 })], { rev: 0.3, peak: 0.5 }));
def('gd.result.neutral', () => r([bell(147, 1, { g: 0.6 }), whoosh(300, 900, 0.8, { t: 0.1, g: 0.5 })], { rev: 0.4 }));
def('gd.result.leave', () => r(steps(4, 0.3, { g: 0.7 }).map((l, i) => ({ ...l, g: l.g * (1 - i * 0.1) })), { rev: 0.3 }));
def('gd.trace.curse', () => r([tone('tri', 98, 98, 0.8, { g: 0.5 }), tone('tri', 138.6, 138.6, 0.8, { g: 0.5 })], { rev: 0.3 }));
def('gd.trace.bless', () => r([...arp([1046, 1318, 1568], 0.05, 0.4, { w: 'sin', g: 0.5 })], { rev: 0.3 }));
def('gd.trace.mixed', () => r([tone('tri', 98, 98, 0.5, { g: 0.3 }), ...arp([1046, 1318], 0.05, 0.3, { w: 'sin', g: 0.3 })]));
def('gd.trace.expire', () => r(arp([1568, 1318, 1046], 0.06, 0.3, { w: 'sin', g: 0.5 }), { reverse: true }));
def('gd.continue', () => r([...boom(80, 40, 0.3), ...click(0.2, 1500)]));

// ─────────────────────────── 3-10 돌발 괴담 ───────────────────────────

const FE_START: Record<string, () => Layer[]> = {
  lucky_toad: () => [ribbit(0), ribbit(0.18), ...coin(0.4)],
  possessed_printer: () => [tone('saw', 150, 450, 0.6, { e: 'hump', g: 0.3 }), noise('white', 0.3, { t: 0.5, bp: [3000], grain: 120 })],
  sleeping_patient: () => [tone('sin', 1000, 1000, 0.1, { g: 0.3 }), noise('pink', 1, { t: 0.2, bp: [500, 900], e: 'hump', g: 0.5 })],
  open_shaft: () => [tone('saw', 140, 110, 0.8, { vib: [3, 1], g: 0.2 }), noise('pink', 1, { e: 'swell', bp: [200, 1500] })],
  midnight_surge: () => [...[0, 0.5, 1].map(t => bell(392, 0.6, { t, g: 0.6 })), ...seq(4, 0.25, (_, t) => click(t + 1.3, 2400, 0.5))],
  dark_lamps: () => [tone('sq', 120, 60, 1, { trem: 30, g: 0.2, e: 'lin' })],
  sleepwalker: () => arp([1318, 1046, 880, 784], 0.25, 0.4, { w: 'sin', g: 0.6 }),
};
for (const fe of FIELD_EVENTS) {
  def(`fe.start.${fe.id}`, () => r((FE_START[fe.id] ?? FE_START.dark_lamps)(), { rev: 0.3 }));
  def(`fe.fail.${fe.id}`, () => r(fe.id === 'lucky_toad' ? [ribbit(0, 0.7), ribbit(0.15, 0.6), ribbit(0.3, 0.5)] : [noise('pink', 0.5, { lp: [3000, 300] }), tone('tri', 330, 330, 0.3, { t: 0.1 }), tone('tri', 262, 262, 0.5, { t: 0.4 })]));
}
def('fe.warn', () => r([...seq(4, 0.04, (i, t) => ping(2093 * st(i * 2), 0.3, { t, g: 0.4 })), bell(196, 1, { t: 0.1, g: 0.6 })], { rev: 0.3 }));
def('fe.lamp', () => r([...click(0, 1000), bell(784, 0.5, { t: 0.02, g: 0.6 })]));
def('fe.fall', () => r([tone('sin', 1500, 300, 0.5, { e: 'lin', g: 0.3 }), ...boom(80, 40, 0.3, { t: 0.5, g: 0.6 })], { rev: 0.4 }));
def('fe.tally', () => r([noise('white', 0.05, { bp: [3000] }), ping(1200, 0.08, { t: 0.04, g: 0.6 })]));
def('fe.startle', () => r([tone('tri', 700, 500, 0.3, { vib: [7, 1], g: 0.3 })], { peak: 0.5 }));
def('fe.monitor', () => r([tone('sin', 1000, 1000, 0.1)]));
def('fe.toad.hop', () => r([tone('sin', 200, 600, 0.15, { vib: [25, 2] })]));
def('fe.print', () => r([noise('white', 0.15, { bp: [2500], q: 0.8, grain: 300 })]));
def('fe.urgent', () => r([ping(2093, 0.06, { g: 0.6 }), ping(2093, 0.06, { t: 0.12, g: 0.6 })]));
def('fe.success', () => r([...seq(8, 0.04, (_, t) => coin(t, 0.6)), ...chord(523, 'maj', 0.8, { t: 0.2, w: 'sq', g: 0.4 })], { rev: 0.3 }));

// ─────────────────────────── 3-11 UI · meta ───────────────────────────

def('ui.tap', () => r([...click(0, 2400, 0.6), ping(1200, 0.04, { g: 0.5 })]));
def('ui.tap.soft', () => r([ping(1200, 0.03, { g: 0.5 })]));
def('ui.confirm', () => r([ping(880, 0.08), ping(1320, 0.1, { t: 0.07 })]));
def('ui.back', () => r([ping(660, 0.08), ping(440, 0.1, { t: 0.07 })]));
def('ui.start', () => r([tone('tri', 523, 523, 0.12), tone('tri', 784, 784, 0.25, { t: 0.1 }), whoosh(800, 3000, 0.35, { t: 0.05, g: 0.5 })]));
def('ui.select', () => r([ping(660, 0.07)]));
def('ui.select.off', () => r([ping(440, 0.06, { g: 0.7 })]));
def('ui.refuse', () => r([tone('sq', 150, 150, 0.07, { e: 'flat', g: 0.4 }), tone('sq', 150, 150, 0.07, { t: 0.1, e: 'flat', g: 0.4 })]));
def('ui.warn', () => r([tone('sq', 150, 150, 0.1, { e: 'flat', g: 0.4 })]));
def('ui.toast.good', () => r([ping(1046, 0.12), ping(1318, 0.15, { t: 0.06 })]));
def('ui.toast.warn', () => r([tone('tri', 330, 300, 0.1)]));
def('ui.toast.info', () => r([ping(1500, 0.04, { g: 0.6 })]));
def('ui.card.lift', () => r([noise('pink', 0.06, { bp: [3000], q: 1.5, g: 0.5 }), ping(660, 0.06, { t: 0.02 })]));
def('ui.pet.lift', () => r([noise('pink', 0.06, { bp: [3000], q: 1.5, g: 0.5 }), ping(660, 0.06, { t: 0.02 }), ping(1320, 0.04, { t: 0.07, g: 0.5 })]));
def('ui.card.cancel', () => r([tone('sin', 440, 330, 0.12)]));
def('ui.cardReady', () => r([ping(1318, 0.1)]));
def('ui.sheet.open', () => r([noise('pink', 0.12, { bp: [2500, 4000], q: 1.2, e: 'hump' })]));
def('ui.pause.open', () => r([noise('pink', 0.25, { lp: [3000, 400] })]));
def('ui.pause.close', () => r([noise('pink', 0.25, { lp: [400, 3000] })]));
def('ui.ult.press', () => r([...click(0, 1200, 1), ...boom(90, 45, 0.2)]));
def('ui.ult.denied', () => r([tone('sq', 120, 110, 0.15, { e: 'flat', g: 0.3 })]));
def('ult.ready', () => r([tone('sin', 880, 1760, 0.2), bell(1760, 0.6, { t: 0.18, g: 0.5 })]));
def('ult.remind', () => r([ping(2093, 0.08, { g: 0.6 })]));
def('ui.reward.pulse', () => r([bell(1568, 0.4, { g: 0.6 })]));
def('reward.open', () => r([...seq(3, 0.09, (_, t) => noise('pink', 0.06, { t, bp: [3000], q: 1.5 })), chime(1318, { t: 0.3 })]));
def('reward.pick.common', () => r([...click(0, 2000), chime(1046, { t: 0.03 })]));
def('reward.pick.rare', () => r([...chord(784, 'maj', 0.6, { w: 'sin' }), ...seq(4, 0.04, (i, t) => ping(2600 + i * 300, 0.1, { t, g: 0.2 }))], { rev: 0.3 }));
def('reward.pick.epic', () => r([whoosh(500, 3000, 0.5), ...chord(523, 'maj', 1, { t: 0.2, w: 'saw', a: 0.1 }), ...coin(0.5)], { rev: 0.4 }));
def('relic.get', () => r([bell(392, 1.5, { g: 0.8 }), ...seq(5, 0.05, (i, t) => ping(3000 + i * 300, 0.1, { t: t + 0.1, g: 0.2 }))], { rev: 0.4 }));
def('relic.proc', () => r([chime(2093, { g: 0.6 })]));
def('result.best', () => r([ping(1568, 0.12)]));
def('run.victory', () => r([...arp([523, 659, 784, 1046], 0.15, 0.5, { w: 'sq', g: 0.4 }), ...chord(523, 'maj', 1.4, { t: 0.6, w: 'saw' }), ...crash(1, { t: 0.6, g: 0.4 })], { rev: 0.4 }));
def('run.defeat', () => r([...arp([392, 330, 262, 196], 0.18, 0.5, { w: 'tri' }), bell(98, 1.6, { t: 0.7, g: 0.6 }), bell(87, 1.6, { t: 1.2, g: 0.5 })], { rev: 0.5 }));
def('net.playerJoin', () => r([ping(660, 0.06), ping(990, 0.08, { t: 0.06 })]));
def('net.playerLeave', () => r([ping(990, 0.06), ping(660, 0.08, { t: 0.06 })]));
def('net.lost', () => r([tone('tri', 660, 660, 0.12), tone('tri', 440, 440, 0.18, { t: 0.12 })]));
def('net.reconnect', () => r([tone('tri', 440, 440, 0.12), tone('tri', 660, 660, 0.18, { t: 0.12 })]));
def('net.botTakeover', () => r(seq(3, 0.07, (i, t) => tone('sq', 800 + i * 200, 800 + i * 200, 0.05, { t, g: 0.3 }))));

// ─────────────────────────── pets / roles / characters / bosses from data ───────────────────────────

defRoles();
defCharacters();
defBosses();
for (const p of PETS) if (!RECIPES.has(`pet.${p.id}`)) def(`pet.${p.id}`, () => r([...click(0, 1200), chime(1046, { t: 0.04 })]));

/** Every id with a synth recipe. */
export function recipeIds(): string[] {
  return [...RECIPES.keys()];
}

export function hasRecipe(id: string): boolean {
  return RECIPES.has(id);
}

/** The recipe for id (null = none; the caller falls back to the group default). */
export function recipeFor(id: string): Recipe | null {
  const make = RECIPES.get(id);
  return make ? make() : null;
}
