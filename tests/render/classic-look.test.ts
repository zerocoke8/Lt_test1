// 기획 23차 궁극기 연출 강화 (docs/ult-fx.md 5-1): the classic tower, 원정 and 보스 레이드 LOOK the same as before the
// round. A seeded classic run (five floors, one per party of three — all 15 characters), one 원정 stage and one 보스 레이드
// floor, every character's today's drag and ult (plus a bot's), rendered into a recording fake canvas with Math.random
// replaced by a seeded LCG. Every canvas call (method + rounded args) and every context property set is folded into one
// hash; the hash was recorded on the untouched 22차 code before the 23차 core edits and must never change. A change in a
// classic picture (a new key in today's tables, an extra draw call, a moved random draw) shows up here.
//
// When the hash changes on purpose (a deliberate classic look change, decided in a 기획 round), print it with
// CLASSIC_LOOK_PRINT=1 npx vitest run tests/render/classic-look.test.ts and replace EXPECTED below.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRenderer } from '../../src/render';
import type { GameEvent, GameState, PlayerSetup, RenderUiState } from '../../src/types';
import { BOT1, HUMAN, advance, type TestGame, makeGame } from '../sim/helpers';

/** Recorded on the 22차 code (commit f303244) — see the header. */
const EXPECTED = '455258ec31c41b21';

/** Two-lane FNV-1a over the call stream (≈ 64 bits — collisions are not a concern here). */
class Hash {
  a = 0x811c9dc5;
  b = 0x01000193 ^ 0x5bd1e995;
  calls = 0;
  /** drawImage calls (the hit-stop's frozen frames copy the held picture). */
  images = 0;
  str(s: string): void {
    let a = this.a;
    let b = this.b;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
    }
    this.a = a;
    this.b = b;
  }
  /** Numbers are rounded to 1/100 (float noise in the last bits never reaches the hash). */
  val(v: unknown): void {
    if (typeof v === 'number') this.str(Number.isFinite(v) ? String(Math.round(v * 100)) : String(v));
    else if (typeof v === 'string') this.str(v);
    else if (typeof v === 'boolean') this.str(v ? 'T' : 'F');
    else if (v === null || v === undefined) this.str('_');
    else if (Array.isArray(v)) {
      this.str('[');
      for (const x of v) this.val(x);
      this.str(']');
    } else this.str('o'); // a gradient, an image (canvas) …
    this.str(',');
  }
  hex(): string {
    return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0');
  }
}

/** A recording 2D context: every method call and property set goes into the hash (a baked canvas records too). */
function recordingCanvas(h: Hash, w = 300, hgt = 150): HTMLCanvasElement {
  const store: Record<string | symbol, unknown> = {};
  const gradient = {
    addColorStop(o: number, c: string) {
      h.str('g');
      h.val(o);
      h.val(c);
    },
  };
  const fns = new Map<string, (...args: unknown[]) => unknown>();
  const ctx: CanvasRenderingContext2D = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const name = String(prop);
      let fn = fns.get(name);
      if (!fn) {
        fn = (...args: unknown[]) => {
          h.calls++;
          if (name === 'drawImage') h.images++;
          h.str(name);
          for (const a of args) h.val(a);
          if (name === 'createLinearGradient' || name === 'createRadialGradient' || name === 'createConicGradient') return gradient;
          if (name === 'measureText') return { width: String(args[0] ?? '').length * 9 };
          if (name === 'getTransform') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
          if (name === 'getImageData') return { data: new Uint8ClampedArray(4) };
          if (name === 'getLineDash') return [];
          return undefined;
        };
        fns.set(name, fn);
      }
      return fn;
    },
    set(target, prop, value) {
      h.str('=' + String(prop));
      h.val(value);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { width: w, height: hgt, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return canvas;
}

/** Seeded LCG for Math.random (render effects scatter with it). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const UI: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false, ultAim: null };
const DT = 1 / 30;

/** What the run covered (so a broken scenario cannot pass with a trivially stable hash). */
const seen = { drag: 0, ult: 0, botSkill: 0, chars: new Set<string>() };

/** One frame: the tick's events into the renderer. */
function frame(tg: TestGame, r: ReturnType<typeof createRenderer>, ui: RenderUiState = UI): void {
  advance(tg, DT);
  const evs: GameEvent[] = tg.events.splice(0);
  for (const e of evs) {
    if (e.type !== 'skillCast') continue;
    if (e.player === 0 && e.slot === 'drag') seen.drag++;
    if (e.player === 0 && e.slot === 'ult') {
      seen.ult++;
      seen.chars.add(e.skillId);
    }
    if (e.player === 1) seen.botSkill++;
  }
  r.render(tg.w.state, evs, DT, ui);
}

function frames(tg: TestGame, r: ReturnType<typeof createRenderer>, n: number): void {
  for (let i = 0; i < n; i++) frame(tg, r);
}

/** The drop point of a drag: the nearest enemy to the field centre (a deterministic pick), else the centre. */
function dropPoint(s: GameState): { x: number; y: number } {
  const cx = s.plan.arena.width / 2;
  const cy = s.plan.arena.height / 2;
  let best = { x: cx, y: cy };
  let bd = Infinity;
  for (const e of s.entities) {
    if (e.team !== 'enemy' || e.hp <= 0) continue;
    const d = (e.pos.x - cx) ** 2 + (e.pos.y - cy) ** 2;
    if (d < bd) {
      bd = d;
      best = { x: Math.min(s.plan.arena.width - 1, Math.max(1, e.pos.x - 1.5)), y: e.pos.y };
    }
  }
  return best;
}

/** Each party member in turn: drag it onto the field (its drag skill), then its ult; a little of the fight between. */
function playParty(tg: TestGame, r: ReturnType<typeof createRenderer>, order: readonly number[]): void {
  for (const k of order) {
    tg.game.dispatch({ type: 'debug', action: { kind: 'resetCooldowns' } });
    if (tg.w.state.players[0].activeIndex !== k) {
      tg.game.dispatch({ type: 'swap', player: 0, partyIndex: k, pos: dropPoint(tg.w.state) });
      // the drag preview of the next card (the ghost under the finger) for a few frames first
      frames(tg, r, 36);
    }
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
    tg.game.dispatch({ type: 'ult', player: 0 });
    frames(tg, r, 66);
  }
}

function game(players: PlayerSetup[], extra: Parameters<typeof makeGame>[0]): TestGame {
  return makeGame({ seed: 23, players, tunables: { invincible: true, monsterHpMult: 30, ...(extra?.tunables ?? {}) }, ...extra });
}

const PARTIES: [string, string, string][] = [
  ['guardian', 'blade', 'mage'],
  ['ranger', 'cleric', 'berserker'],
  ['paladin', 'warden', 'shadow'],
  ['gunner', 'medic', 'exorcist'],
  ['bard', 'chrono', 'puppeteer'],
];
/** Classic floors for the five parties: lobby, a boss floor, office, ward boss, rooftop. */
const FLOORS = [2, 5, 8, 15, 18];

function runAll(): { hash: string; calls: number; images: number } {
  const h = new Hash();
  seen.drag = seen.ult = seen.botSkill = 0;
  seen.chars.clear();
  const rnd = lcg(0x23c1a55);
  const spy = vi.spyOn(Math, 'random').mockImplementation(rnd);
  // a DOM-less document whose canvases record too: the baked ground / boss stage / cut-in band and the hit-stop's
  // frozen frames run exactly like in the browser
  vi.stubGlobal('document', { createElement: () => recordingCanvas(h) });
  try {
    // classic: five floors, each with a party of three (all 15 characters) and a bot that casts its own skills
    PARTIES.forEach((chars, i) => {
      const tg = game([{ ...HUMAN, characters: chars }, { ...BOT1 }], { startFloor: FLOORS[i] });
      const r = createRenderer(recordingCanvas(h));
      frames(tg, r, 15);
      // one drag-preview frame of each kind (swap ghost, pet) — today's preview looks
      const pos = dropPoint(tg.w.state);
      r.render(tg.w.state, [], DT, { ...UI, freezeCamera: true, dragPreview: { kind: 'swap', index: 1, pos, area: tg.game.previewArea(0, 'swap', 1), valid: true, color: '#4cc9f0' } });
      r.render(tg.w.state, [], DT, { ...UI, freezeCamera: true, dragPreview: { kind: 'pet', index: 0, pos, area: tg.game.previewArea(0, 'pet', 0), valid: false, color: '#fff' } });
      playParty(tg, r, [1, 2, 0]);
    });
    // 원정: one normal stage
    {
      const tg = game([{ ...HUMAN, characters: ['berserker', 'medic', 'bard'] }], { expedition: { stage: 4 } });
      const r = createRenderer(recordingCanvas(h));
      frames(tg, r, 15);
      playParty(tg, r, [1, 2]);
    }
    // 보스 레이드: one floor (a moving boss) with a bot
    {
      const tg = game([{ ...HUMAN, characters: ['chrono', 'shadow', 'gunner'] }, { ...BOT1 }], { mode: 'bossRaid', bossRaid: { onlyBoss: 'washer_drum', hpMult: 30 } });
      const r = createRenderer(recordingCanvas(h));
      frames(tg, r, 15);
      playParty(tg, r, [1, 2, 0]);
    }
  } finally {
    spy.mockRestore();
    vi.unstubAllGlobals();
  }
  return { hash: h.hex(), calls: h.calls, images: h.images };
}

describe('classic look (기획 23차: the classic tower / 원정 / 보스 레이드 pictures never change)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('the recorded draw-call hash of a seeded classic run, a 원정 stage and a 보스 레이드 floor is unchanged', () => {
    const a = runAll();
    if (process.env.CLASSIC_LOOK_PRINT) console.log(`classic-look hash ${a.hash} (${a.calls} calls, ${a.images} images, drags ${seen.drag}, ults ${seen.ult} of ${seen.chars.size} ids, bot casts ${seen.botSkill})`);
    // the run is big enough to mean something: every character's ult, the drags, a bot's skills, hit-stop frames
    expect(a.calls).toBeGreaterThan(200_000);
    expect(seen.chars.size).toBe(15);
    expect(seen.drag).toBeGreaterThanOrEqual(15);
    expect(seen.botSkill).toBeGreaterThan(0);
    expect(a.images).toBeGreaterThan(0);
    // stable: the same run twice gives the same hash (no clock, no leftover module state)
    const b = runAll();
    expect(b.hash).toBe(a.hash);
    expect(a.hash).toBe(EXPECTED);
  }, 60_000);
});
