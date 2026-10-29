// 기획 23차 궁극기 연출 강화 — the CORE (docs/ult-fx.md 5-1, items 1–5, 7, 8): the beats every alt is read into, the
// story / look registries the content tracks fill, today's tables left alone, the finisher's kick (mine only, the
// settings obeyed), the classic tower / 보스 레이드 never touching any of it, the per-cast budgets, the 「궁극기 연출 강화」
// switch; the cut-in's 착지 컷 strip / bright hole (item 6) and the sound director's alt rules (item 9).
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '../../src/data';
import { STAGE_CUES } from '../../src/audio/stages';
import { ALT_SOUND, type Ctl, Director, type SoundReq } from '../../src/audio/director';
import { recipeIds } from '../../src/audio/synth/recipes';
import { ULT_GROUP_A_IDS, ULT_GROUP_B_IDS, setUltAltFixture, ultAltBySkill, ultAltEntries, ultBeatOf, ultBeats, type UltAltDef, type UltCue } from '../../src/data/ultTest';
import { Camera } from '../../src/render/camera';
import { createRenderer } from '../../src/render';
import { IMPACT } from '../../src/render/impact';
import { JUICE, Juice, ULT_FINISH } from '../../src/render/juice';
import { TELE_MOTIF, ZONE_DECOR } from '../../src/render/marks';
import { LAND, PREP } from '../../src/render/stagefx';
import { CUTIN, STRIP, ScreenFx } from '../../src/render/cutin';
import { Vfx } from '../../src/render/vfx';
import { ULT_FX } from '../../src/render/ultTest/settings';
import { ultTheme, ultThemeIds } from '../../src/render/ultTest/theme';
import { registerUltLooks, registerUltStories, touchdownAt, ultLook, ultLookKeys, ultStoryKeys, type UltStory } from '../../src/render/ultTest/stories';
import { decalCount } from '../../src/render/ultTest/decals';
import { resetUltCore, ultCoreCounts, ultStampText } from '../../src/render/ultTest/core';
import type { GameEvent, PlayerSetup, RenderUiState, UltAimMode } from '../../src/types';
import { HUMAN, HUMAN2, type TestGame, advance, drain, makeGame } from '../sim/helpers';

// ─────────────────────────── harness ───────────────────────────

function fakeCanvas(): HTMLCanvasElement {
  const store: Record<string | symbol, unknown> = {};
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => gradient;
      if (p === 'measureText') return (s: string) => ({ width: String(s ?? '').length * 9 });
      if (p === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return () => undefined;
    },
    set(t, p, v) {
      if ((p === 'globalAlpha' || p === 'lineWidth') && !Number.isFinite(v as number)) throw new Error(`${String(p)}=${String(v)}`);
      t[p] = v;
      return true;
    },
  });
  return { width: 300, height: 150, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

/** A test alt (guardian's 조준 replaced): an opener on the point at 0.45 s, the finale 1.2 s on the point. */
const PROBE: UltAltDef = {
  id: 'guardian_ua',
  name: '시험 궁극기',
  slot: 'ult',
  description: '시험',
  castTime: 0.5,
  finale: 'boom',
  actions: [
    { stage: 'tap', center: 'point', delay: 0.45, telegraphLead: 0, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] },
    { stage: 'boom', center: 'point', delay: 1.2, telegraphLead: 0.4, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 2 }] },
  ],
};

/** A solo 궁극기 테스트 run against a fixed boss; the game is driven through a real renderer (fake canvas, a fake DOM so the hit-stop holds). */
interface Run {
  tg: TestGame;
  vfx: Vfx;
  frame(evs?: GameEvent[]): void;
  cast(player: number, mode: 'aim' | 'drag', point?: { x: number; y: number }): void;
  ui: RenderUiState;
}

function run(chars: string[], mode: UltAimMode, localPlayer = 0, players?: PlayerSetup[]): Run {
  const tg = makeGame({
    seed: 4,
    mode: 'ultTest',
    players: players ?? [{ ...HUMAN, characters: chars, ultMode: mode }],
    tunables: { invincible: true },
    bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 },
  });
  advance(tg, 0.5);
  const spy = vi.spyOn(Vfx.prototype, 'handle');
  const r = createRenderer(fakeCanvas());
  const ui: RenderUiState = { localPlayer, dragPreview: null, freezeCamera: false, ultAim: null };
  r.render(tg.w.state, [{ type: 'floorStart', floor: 1, kind: 'boss' }], 1 / 30, ui);
  const vfx = spy.mock.contexts[0] as Vfx;
  spy.mockRestore();
  let first: GameEvent[] | null = null;
  return {
    tg,
    vfx,
    ui,
    frame(evs?: GameEvent[]) {
      if (first) {
        r.render(tg.w.state, first, 1 / 30, ui);
        first = null;
        return;
      }
      advance(tg, 1 / 30);
      r.render(tg.w.state, evs ?? tg.events.splice(0), 1 / 30, ui);
    },
    cast(player: number, m: 'aim' | 'drag', point = { x: 12, y: 3.5 }) {
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player } });
      drain(tg);
      tg.events.length = 0;
      expect(tg.game.dispatch({ type: 'ult', player, aim: { mode: m, point } }).ok).toBe(true);
      first = tg.game.drainEvents();
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fakeCanvas() });
  resetUltCore();
  ULT_FX.boost = true;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ULT_FX.boost = true;
  JUICE.hitStopMs = 75;
  JUICE.shake = 1;
  for (const c of CHARACTERS) setUltAltFixture(c.id, null);
});

/** Two-lane FNV over a string (the snapshot of today's tables). */
function hashOf(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ s.charCodeAt(i), 0x5bd1e995) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16);
}

const ALL_ALTS = () => ultAltEntries().flatMap(([, set]) => [set.aim, set.drag].filter((d): d is UltAltDef => !!d));

// ─────────────────────────── 1. beats ───────────────────────────

describe('1. beats (src/data/ultTest/beats.ts)', () => {
  it('every alt: a role for every part, exactly one finisher, the first effect ≥ 0.45 s, finale names an enemy stage, the path resolves to the same beats', () => {
    const alts = ALL_ALTS();
    expect(alts.length).toBe(30);
    for (const def of alts) {
      const b = ultBeats(def.id)!;
      expect(b, def.id).not.toBeNull();
      expect(b.def).toBe(def);
      expect(b.beats.length, def.id).toBe(def.actions.length);
      for (const beat of b.beats) expect(['opener', 'build', 'finisher', 'twin', 'after', 'zone', 'support'], `${def.id} ${beat.actionIndex}`).toContain(beat.role);
      expect(b.beats.filter(x => x.role === 'finisher').length, `${def.id} finishers`).toBe(1);
      expect(b.beats[b.finisher].role).toBe('finisher');
      expect(b.finisherAt).toBe(b.beats[b.finisher].end);
      expect(b.firstAt, def.id).toBeGreaterThanOrEqual(0.45 - 1e-9);
      if (def.finale) expect(def.actions.some(a => a.stage === def.finale && a.affects === 'enemies'), `${def.id} finale ${def.finale}`).toBe(true);
      // twins share the finisher's stage
      for (const beat of b.beats) if (beat.role === 'twin') expect(beat.stage).toBe(b.beats[b.finisher].stage);
      // seq / seqN within a stage
      for (const beat of b.beats) expect(beat.seq).toBeLessThan(beat.seqN);
      expect(ultBeats(`${def.id}_path`)).toBe(b);
      if (b.path) {
        expect(b.path.role).toBe('path');
        expect(ultBeatOf(`${def.id}_path`, 3)).toBe(b.path);
      }
      expect(ultBeatOf(def.id, b.finisher)).toBe(b.beats[b.finisher]);
    }
    // today's ults and unknown ids have none
    for (const c of CHARACTERS) expect(ultBeats(c.ult.id)).toBeNull();
    expect(ultBeats('nope_ua')).toBeNull();
  });

  it('a fixture gets fresh beats (cached per def object), the finale picks the finisher, a later beat is an encore', () => {
    const before = ultBeats('guardian_ua');
    const undo = setUltAltFixture('guardian', { aim: { ...PROBE, actions: [...PROBE.actions, { stage: 'echo', center: 'point', delay: 3, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] }] } });
    const b = ultBeats('guardian_ua')!;
    expect(b).not.toBe(before);
    expect(b.beats.map(x => x.role)).toEqual(['opener', 'finisher', 'after']);
    expect(b.finisherAt).toBeCloseTo(1.2, 9);
    expect(b.finisherKind).toBe('strike');
    expect(b.onPoint).toBe(true);
    undo();
    expect(ultBeats('guardian_ua')).toBe(before);
    // allies-only finale → a blessing
    setUltAltFixture('guardian', { aim: { ...PROBE, finale: 'heal', actions: [...PROBE.actions, { stage: 'heal', center: 'point', delay: 1.5, area: { shape: 'circle', radius: 3 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.1 }] }] } });
    expect(ultBeats('guardian_ua')!.finisherKind).toBe('bless');
  });
});

// ─────────────────────────── 2. registries ───────────────────────────

describe('2. the story / look registries (render/ultTest/stories.ts)', () => {
  it('every registered story key is a real `<alt>:<stage>` / `<alt>_path:<stage>`; every alias exists in PREP / LAND; every look key is an alt', () => {
    for (const key of ultStoryKeys()) {
      const cut = key.lastIndexOf(':');
      const id = key.slice(0, cut);
      const stage = key.slice(cut + 1);
      const path = id.endsWith('_path');
      const alt = ultAltBySkill(path ? id.slice(0, -5) : id);
      expect(alt, key).not.toBeNull();
      const stages = path ? [alt!.def.move?.path?.stage ?? 'path'] : alt!.def.actions.map(a => a.stage ?? '');
      expect(stages, key).toContain(stage);
    }
    for (const key of ultLookKeys()) expect(ultAltBySkill(key), key).not.toBeNull();
    // the theme table covers the roster
    for (const c of CHARACTERS) expect(ultThemeIds(), c.id).toContain(c.id);
    expect(ultTheme('guardian').glyph).toBe('城');
  });

  it('every alias key of every registered story exists today', async () => {
    const { ultStory } = await import('../../src/render/ultTest/stories');
    for (const key of ultStoryKeys()) {
      const st = ultStory(key)!;
      const al = st.alias ? (Array.isArray(st.alias) ? st.alias : [st.alias]) : [];
      for (const a of al as { key: string }[]) expect(PREP[a.key] ?? LAND[a.key], `${key} → ${a.key}`).toBeTypeOf('function');
    }
  });

  it('a key registered twice throws (stories and looks); the undo takes it back out', () => {
    const undo = registerUltStories({ 'zz_probe_ua:x': {} });
    expect(() => registerUltStories({ 'zz_probe_ua:x': {} })).toThrow();
    undo();
    expect(ultStoryKeys()).not.toContain('zz_probe_ua:x');
    const undoLook = registerUltLooks({ zz_probe_ud: {} });
    expect(() => registerUltLooks({ zz_probe_ud: {} })).toThrow();
    undoLook();
    expect(ultLookKeys()).not.toContain('zz_probe_ud');
  });

  it('a registered story runs: its prep at the cast, its land at each hit (the router reads the registry)', () => {
    setUltAltFixture('guardian', { aim: PROBE });
    const prep = vi.fn();
    // the info object is reused: read it while the call runs
    const seen: { role: string; charId: string; mode: string; toFinish: number }[] = [];
    const land = vi.fn((_fx: unknown, _h: unknown, s: { role: string; charId: string; mode: string; toFinish: number }) => {
      seen.push({ role: s.role, charId: s.charId, mode: s.mode, toFinish: s.toFinish });
    });
    const undo = registerUltStories({ 'guardian_ua:tap': { prep, land, impact: { shake: 3, flash: 0.5 } } });
    try {
      const r = run(['guardian', 'cleric', 'mage'], 'aim');
      r.cast(0, 'aim');
      for (let i = 0; i < 60; i++) r.frame();
      expect(prep).toHaveBeenCalledTimes(1);
      expect(land).toHaveBeenCalledTimes(1);
      const s = seen[0];
      expect(s.role).toBe('opener');
      expect(s.charId).toBe('guardian');
      expect(s.mode).toBe('aim');
      expect(s.toFinish).toBeCloseTo(1.2 - 0.45, 6);
    } finally {
      undo();
    }
  });
});

// ─────────────────────────── 3. today's tables ───────────────────────────

describe("3. today's tables are untouched", () => {
  it('no alt key in PREP / LAND / IMPACT / TELE_MOTIF / ZONE_DECOR / STAGE_CUES', () => {
    const alts = new Set(ALL_ALTS().map(d => d.id));
    const isAlt = (k: string) => {
      const id = k.split(':')[0];
      return alts.has(id) || alts.has(id.replace(/_path$/, '')) || /_u[ad](_path)?$/.test(id);
    };
    for (const table of [PREP, LAND, IMPACT, TELE_MOTIF, ZONE_DECOR]) for (const k of Object.keys(table)) expect(isAlt(k), k).toBe(false);
    for (const k of Object.keys(STAGE_CUES)) expect(CHARACTERS.map(c => c.id), k).toContain(k);
  });

  it('their keys and values are exactly the 22차 ones (a snapshot)', () => {
    const snap = JSON.stringify({
      prep: Object.keys(PREP).sort(),
      land: Object.keys(LAND).sort(),
      impact: IMPACT,
      motif: TELE_MOTIF,
      decor: ZONE_DECOR,
      cues: STAGE_CUES,
    });
    if (process.env.ULT_FX_PRINT) console.log(`tables ${hashOf(snap)}`);
    expect(hashOf(snap)).toBe(TABLES_22);
  });
});

/** Recorded on the 22차 tables (the same values the 22차 commit shipped). */
const TABLES_22 = 'f6a0e926f494f1ca';

// ─────────────────────────── 4. kicks ───────────────────────────

describe('4. the finisher kick: mine only, the settings obeyed', () => {
  function castProbe(localPlayer: number): { r: Run; stops: number[]; zoom: boolean; flashes: number[]; dims: number; glyph: string | null; shakes: number[]; lines: boolean } {
    setUltAltFixture('guardian', { aim: PROBE });
    const stop = vi.spyOn(Juice.prototype, 'finisherStop');
    const zoomAt = vi.spyOn(Juice.prototype, 'zoomAt');
    const shake = vi.spyOn(Juice.prototype, 'shake');
    const flash = vi.spyOn(ScreenFx.prototype, 'flash');
    const dim = vi.spyOn(ScreenFx.prototype, 'focusDim');
    const r = run(['guardian', 'cleric', 'mage'], 'aim', localPlayer);
    r.cast(0, 'aim');
    let glyph: string | null = null;
    let lines = false;
    shake.mockClear();
    for (let i = 0; i < 75; i++) {
      r.frame();
      glyph ??= ultStampText();
      lines ||= ultCoreCounts().lines;
    }
    return {
      r,
      stops: stop.mock.results.map(x => x.value as number),
      zoom: zoomAt.mock.results.some(x => x.value === true),
      flashes: flash.mock.calls.map(c => c[0]),
      dims: dim.mock.calls.length,
      glyph,
      shakes: shake.mock.calls.map(c => c[0]),
      lines,
    };
  }

  it('my finisher: a 0.13 s stop (outside the budget), the zoom, the screen flash, the glyph, speed lines, a 12 px shake; the breath before it', () => {
    const k = castProbe(0);
    expect(k.stops.length).toBe(1);
    expect(k.stops[0]).toBeCloseTo(ULT_FINISH.stopSec, 3);
    expect(k.zoom).toBe(true);
    expect(k.flashes.some(a => Math.abs(a - 0.42) < 1e-9)).toBe(true);
    expect(k.glyph).toBe('城');
    expect(k.lines).toBe(true);
    expect(k.shakes).toContain(12);
    expect(k.dims).toBe(1);
    // my opener kicks too (role default: shake 4)
    expect(k.shakes.some(s => s === 4 || s === 2)).toBe(true);
  });

  it('the hit-stop setting at 150 ms: longer, never past 0.16 s; at 0: no stop at all', () => {
    JUICE.hitStopMs = 150;
    const k = castProbe(0);
    expect(k.stops[0]).toBeGreaterThan(0.13);
    expect(k.stops[0]).toBeLessThanOrEqual(ULT_FINISH.stopCap + 1e-9);
    vi.restoreAllMocks();
    vi.stubGlobal('document', { createElement: () => fakeCanvas() });
    resetUltCore();
    JUICE.hitStopMs = 0;
    const off = castProbe(0);
    expect(off.stops.every(s => s === 0)).toBe(true);
    expect(off.glyph).toBe('城'); // the picture stays
  });

  it('the shake setting at 0: no zoom, no speed lines (the glyph still lands)', () => {
    JUICE.shake = 0;
    const k = castProbe(0);
    expect(k.zoom).toBe(false);
    expect(k.lines).toBe(false);
    expect(k.glyph).toBe('城');
  });

  it("another player's / a bot's finisher: no stop, no shake, no zoom, no dim, no screen glyph (a small one over the spot)", () => {
    const k = castProbe(1);
    expect(k.stops.length).toBe(0);
    expect(k.zoom).toBe(false);
    expect(k.dims).toBe(0);
    expect(k.glyph).toBeNull();
    expect(k.lines).toBe(false);
    expect(k.shakes.filter(s => s >= 4)).toEqual([]);
    // the screen flash only at half
    for (const a of k.flashes) expect(a).toBeLessThanOrEqual(0.21 + 1e-9);
  });

  it('a second finisher of mine within 1 s stays inside the per-second budget; after the gap the next one passes it again', () => {
    const j = new Juice({ hitStopMs: 75, shake: 1 }, () => false);
    expect(j.finisherStop(0.13)).toBeCloseTo(0.13, 6);
    j.update(0.5);
    const second = j.finisherStop(0.13);
    expect(second).toBeLessThan(0.05); // only what is left of the 0.16 s budget
    j.update(1.2);
    expect(j.finisherStop(0.13)).toBeCloseTo(0.13, 6);
  });

  it('the zoom holds on the world clock and eases back over 0.28 s; reduced motion / shake 0 → none', () => {
    const j = new Juice({ hitStopMs: 75, shake: 1 }, () => false);
    const z = { x: 0, y: 0, s: 1 };
    j.zoomPunch(0.05, 400, 300);
    expect(j.zoomAt(z)).toBe(true);
    expect(z.s).toBeCloseTo(1.05, 9);
    j.update(0.5); // the real clock alone never eases it (it holds through a stop)
    expect(j.zoomAt(z)).toBe(true);
    expect(z.s).toBeCloseTo(1.05, 9);
    j.tickZoom(0.14);
    expect(j.zoomAt(z)).toBe(true);
    expect(z.s).toBeLessThan(1.05);
    j.tickZoom(0.2);
    expect(j.zoomAt(z)).toBe(false);
    const reduced = new Juice({ hitStopMs: 75, shake: 1 }, () => true);
    reduced.zoomPunch(0.05, 400, 300);
    expect(reduced.zoomAt(z)).toBe(false);
    reduced.shake(12, 0.4);
    expect(reduced.amplitude()).toBeCloseTo(12 * 0.3, 6);
    const still = new Juice({ hitStopMs: 75, shake: 0 }, () => false);
    still.zoomPunch(0.05, 400, 300);
    expect(still.zoomAt(z)).toBe(false);
  });

  it('reduced motion (device setting): no speed lines, the glyph appears without its slam', async () => {
    vi.resetModules();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener() {} }), devicePixelRatio: 1 });
    const core = await import('../../src/render/ultTest/core');
    core.resetUltCore();
    core.pushSpeedLines(10, 5, undefined, 28, '#ffffff', 0.5);
    expect(core.ultCoreCounts().lines).toBe(false);
    core.pushGlyph(10, 5, 0, '城', '#ffffff', true, 150, 0.35);
    expect(core.ultCoreCounts().stamp).toBe(true);
    expect(core.ultCoreCounts().slam).toBe(false);
    core.resetUltCore();
  });
});

// ─────────────────────────── 5. classic isolation ───────────────────────────

describe('5. the classic tower / 보스 레이드 never reach the 23차 paths', () => {
  it('10 s of a classic floor and a 보스 레이드 floor with drags and ults: no router call, no zoom, no lock / glyph / decal', () => {
    const prep = vi.spyOn(Vfx.prototype as unknown as { ultPrep: () => void }, 'ultPrep');
    const land = vi.spyOn(Vfx.prototype as unknown as { ultLand: () => void }, 'ultLand');
    const zoomAt = vi.spyOn(Juice.prototype, 'zoomAt');
    const dim = vi.spyOn(ScreenFx.prototype, 'focusDim');
    for (const opts of [{ startFloor: 5 }, { mode: 'bossRaid' as const, bossRaid: { onlyBoss: 'washer_drum', hpMult: 30 } }]) {
      const tg = makeGame({ seed: 9, players: [{ ...HUMAN, characters: ['guardian', 'mage', 'cleric'] }], tunables: { invincible: true }, ...opts });
      const spy = vi.spyOn(Vfx.prototype, 'handle');
      const r = createRenderer(fakeCanvas());
      const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false, ultAim: null };
      r.render(tg.w.state, tg.events.splice(0), 1 / 30, ui);
      const vfx = spy.mock.contexts[0] as Vfx;
      spy.mockRestore();
      for (let i = 0; i < 300; i++) {
        if (i % 60 === 10) {
          tg.game.dispatch({ type: 'debug', action: { kind: 'resetCooldowns' } });
          tg.game.dispatch({ type: 'swap', player: 0, partyIndex: (Math.floor(i / 60) % 2) + 1, pos: { x: 12, y: 6 } });
        }
        if (i % 60 === 30) {
          tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
          tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 12, y: 4 } } }); // aim is ignored outside 궁극기 테스트
        }
        advance(tg, 1 / 30);
        r.render(tg.w.state, tg.events.splice(0), 1 / 30, ui);
      }
      const cut = vfx.screen.cutin;
      expect(cut.focus).toBeNull();
      expect(cut.landAt).toBe(-1);
    }
    expect(prep).not.toHaveBeenCalled();
    expect(land).not.toHaveBeenCalled();
    expect(zoomAt.mock.results.every(x => x.value === false)).toBe(true);
    expect(dim).not.toHaveBeenCalled();
    expect(ultCoreCounts()).toEqual({ locks: 0, sights: 0, stamp: false, slam: false, smallStamps: 0, lines: false, pending: 0 });
    expect(decalCount()).toBe(0);
  });
});

// ─────────────────────────── 7. budgets ───────────────────────────

describe('7. budgets', () => {
  it('each of the 30 casts (mine): ≤ 150 live particles and ≤ 40 skill effects of its own (vs the same run without it), ≤ 6 floor marks', () => {
    const over: string[] = [];
    for (const id of [...ULT_GROUP_A_IDS, ...ULT_GROUP_B_IDS]) {
      for (const mode of ['aim', 'drag'] as const) {
        const chars = [id, id === 'cleric' ? 'guardian' : 'cleric', id === 'bard' ? 'mage' : 'bard'];
        const peaks: { p: number; s: number }[][] = [];
        let marks = 0;
        for (const withCast of [false, true]) {
          let seed = 0x5eed;
          vi.spyOn(Math, 'random').mockImplementation(() => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
          });
          resetUltCore();
          const r = run(chars, mode);
          if (withCast) r.cast(0, mode);
          const line: { p: number; s: number }[] = [];
          for (let i = 0; i < 200; i++) {
            r.frame();
            line.push({ p: r.vfx.particles.count, s: r.vfx.sfx.pool.count });
            if (withCast) marks = Math.max(marks, decalCount());
          }
          peaks.push(line);
          vi.mocked(Math.random).mockRestore();
        }
        const base = { p: Math.max(...peaks[0].map(x => x.p)), s: Math.max(...peaks[0].map(x => x.s)) };
        const own = { p: Math.max(...peaks[1].map(x => x.p)) - base.p, s: Math.max(...peaks[1].map(x => x.s)) - base.s };
        if (own.p > 150 || own.s > 40 || marks > 6) over.push(`${id} ${mode}: particles ${own.p}, effects ${own.s}, marks ${marks}`);
      }
    }
    expect(over).toEqual([]);
  }, 60_000);

  it('three seats casting at once (multi): nothing throws, my lock-on and the others’ soft ones coexist', () => {
    const players: PlayerSetup[] = [
      { ...HUMAN, characters: ['guardian', 'cleric', 'mage'], ultMode: 'aim' },
      { ...HUMAN2, characters: ['ranger', 'cleric', 'berserker'], ultMode: 'drag' },
      { ...HUMAN, name: '셋', characters: ['mage', 'bard', 'chrono'], ultMode: 'aim' },
    ];
    const r = run([], 'aim', 0, players);
    r.cast(0, 'aim', { x: 12, y: 4 });
    const first: GameEvent[] = [];
    // the other two in the same frame
    for (const [p, m] of [
      [1, 'drag'],
      [2, 'aim'],
    ] as const) {
      r.tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: p } });
      expect(r.tg.game.dispatch({ type: 'ult', player: p, aim: { mode: m, point: { x: 10 + p, y: 5 } } }).ok).toBe(true);
    }
    first.push(...r.tg.game.drainEvents());
    expect(() => {
      r.frame();
      r.frame(first);
      for (let i = 0; i < 200; i++) r.frame();
    }).not.toThrow();
  });
});

// ─────────────────────────── 8. the switch ───────────────────────────

describe('8. 「궁극기 연출 강화」 off → the 22차 looks', () => {
  it('no story, no finisher, no lock-on / sight line / glyph, no floor mark (the 22차 reticle is back)', () => {
    ULT_FX.boost = false;
    setUltAltFixture('guardian', { aim: PROBE });
    const prep = vi.fn();
    const land = vi.fn();
    const undo = registerUltStories({ 'guardian_ua:tap': { prep, land }, 'guardian_ua:boom': { prep, land } } as Record<string, UltStory>);
    const stop = vi.spyOn(Juice.prototype, 'finisherStop');
    try {
      const r = run(['guardian', 'cleric', 'mage'], 'aim');
      r.cast(0, 'aim');
      let locks = 0;
      for (let i = 0; i < 75; i++) {
        r.frame();
        const c = ultCoreCounts();
        locks = Math.max(locks, c.locks + c.sights + (c.stamp ? 1 : 0));
      }
      expect(prep).not.toHaveBeenCalled();
      expect(land).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
      expect(locks).toBe(0);
      expect(decalCount()).toBe(0);
    } finally {
      undo();
    }
  });

  it('a dragged alt with the switch off: no shared move / touchdown (the 22차 flourish), on: the touchdown kicks', () => {
    for (const boost of [false, true]) {
      ULT_FX.boost = boost;
      resetUltCore();
      const hit = vi.spyOn(Juice.prototype, 'hitStop');
      const r = run(['guardian', 'cleric', 'mage'], 'drag');
      r.cast(0, 'drag', { x: 15, y: 6 });
      let marks = 0;
      for (let i = 0; i < 20; i++) {
        r.frame();
        marks = Math.max(marks, decalCount());
      }
      // the dash's gash + the touchdown crater
      if (boost) expect(marks).toBeGreaterThanOrEqual(2);
      else expect(marks).toBe(0);
      hit.mockRestore();
    }
  });
});

// ─────────────────────────── 6. the cut-in: 착지 컷 strip / bright hole ───────────────────────────

/** A context that keeps the texts it was asked to fill (the strip's name). */
function textCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'fillText') return (s: string) => texts.push(String(s));
      if (p === 'measureText') return (s: string) => ({ width: String(s ?? '').length * 9 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

describe('6. the cut-in: the 착지 컷 strip (드래그), the bright hole (조준)', () => {
  it('my dragged alt: the forced small banner (22차: short, forced, shown as short) becomes the strip after the touchdown; its dim leaves the landing bright', () => {
    const r = run(['guardian', 'cleric', 'mage'], 'drag');
    r.cast(0, 'drag', { x: 15, y: 6 });
    r.frame();
    const cut = r.vfx.screen.cutin;
    expect(cut.short && cut.forced).toBe(true);
    expect(cut.shown[cut.shown.length - 1].kind).toBe('short');
    expect(cut.landAt).toBeGreaterThan(0);
    expect(cut.landAt).toBeLessThanOrEqual(STRIP.wipeTo - STRIP.minSec + 1e-9);
    expect(cut.focus).not.toBeNull();
    const me = r.tg.w.state.entities.find(e => e.kind === 'character' && e.ownerPlayer === 0)!;
    expect(Math.hypot(cut.focus!.x - me.pos.x, cut.focus!.y - me.pos.y)).toBeLessThan(1e-6); // where it landed
    expect(cut.focus!.r).toBeGreaterThanOrEqual(2.4 - 1e-9);
    expect(cut.focus!.r).toBeLessThanOrEqual(5.4 + 1e-9);
    // no dim before the strip, STRIP.dim while it is up (the world layer runs), nothing after the wipe
    const landAt = cut.landAt;
    let before = 0;
    let peak = 0;
    let named = false;
    let world = false;
    for (let i = 0; i < 20; i++) {
      const age = cut.active ? cut.age : 99;
      const d = cut.dim();
      if (age < landAt) before = Math.max(before, d);
      peak = Math.max(peak, d);
      if (cut.active && age > landAt + STRIP.slide && age < STRIP.wipeFrom) {
        world ||= r.vfx.screen.worldActive();
        const { ctx, texts } = textCtx();
        r.vfx.screen.drawTop(ctx, new Camera(), 0);
        named ||= texts.includes(cut.name) && texts.some(t => t.endsWith('· 궁극기'));
      }
      r.frame();
    }
    expect(before).toBe(0);
    expect(peak).toBeCloseTo(STRIP.dim, 6);
    expect(named).toBe(true);
    expect(world).toBe(true);
    expect(cut.active).toBe(false);
    expect(cut.landAt).toBe(-1);
    expect(cut.focus).toBeNull();
  });

  it('「컷인 짧게」: no strip — the 22차 small banner (landAt −1, no focus)', () => {
    CUTIN.short = true;
    try {
      const r = run(['guardian', 'cleric', 'mage'], 'drag');
      r.cast(0, 'drag', { x: 15, y: 6 });
      r.frame();
      const cut = r.vfx.screen.cutin;
      expect(cut.short).toBe(true);
      expect(cut.forced).toBe(false);
      expect(cut.landAt).toBe(-1);
      expect(cut.focus).toBeNull();
      expect(cut.dim()).toBe(0);
    } finally {
      CUTIN.short = false;
    }
  });

  it('조준: the band dims the world but for the aimed spot (focus set during the band, null after); the switch off: no focus, no strip', () => {
    setUltAltFixture('guardian', { aim: PROBE });
    const r = run(['guardian', 'cleric', 'mage'], 'aim');
    r.cast(0, 'aim', { x: 12, y: 4 });
    r.frame();
    const cut = r.vfx.screen.cutin;
    expect(cut.short).toBe(false);
    expect(cut.landAt).toBe(-1);
    expect(cut.focus).not.toBeNull();
    // the opener on the point (r 2) + 0.5, within 1.2–4.5
    expect(cut.focus!.r).toBeCloseTo(2.5, 6);
    expect(ultCoreCounts().locks).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) r.frame();
    expect(cut.active).toBe(false);
    expect(cut.focus).toBeNull();
    ULT_FX.boost = false;
    const off = run(['guardian', 'cleric', 'mage'], 'aim');
    off.cast(0, 'aim', { x: 12, y: 4 });
    off.frame();
    expect(off.vfx.screen.cutin.active && !off.vfx.screen.cutin.short).toBe(true);
    expect(off.vfx.screen.cutin.focus).toBeNull();
    const drag = run(['guardian', 'cleric', 'mage'], 'drag');
    drag.cast(0, 'drag', { x: 15, y: 6 });
    drag.frame();
    expect(drag.vfx.screen.cutin.forced).toBe(true);
    expect(drag.vfx.screen.cutin.landAt).toBe(-1);
  });

  it("another player's / a bot's ult: no strip, no hole (the corner banner)", () => {
    const r = run(['guardian', 'cleric', 'mage'], 'drag', 1);
    r.cast(0, 'drag', { x: 15, y: 6 });
    r.frame();
    const cut = r.vfx.screen.cutin;
    expect(cut.active).toBe(false);
    expect(cut.landAt).toBe(-1);
    expect(cut.focus).toBeNull();
  });
});

// ─────────────────────────── 9. the sound director ───────────────────────────

/** Guardian's 조준 replaced: two cue-less beats, a silenced one, a row one, the finale with two lead cues + a land cue. */
const SOUND_AIM: UltAltDef = {
  id: 'guardian_ua',
  name: '소리 시험',
  slot: 'ult',
  description: '시험',
  castTime: 0.5,
  finale: 'boom',
  sfx: { boom: [{ id: 'drag.guardian.charge', lead: 0.5 }, { id: 'drag.guardian.slam', lead: 0.12 }, { id: 'drag.guardian.wave' }], hush: null },
  actions: [
    { stage: 'tap', center: 'point', delay: 0.45, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.2 }] },
    { stage: 'poke', center: 'point', delay: 0.7, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.2 }] },
    { stage: 'hush', center: 'point', delay: 0.8, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.2 }] },
    { stage: 'rally', center: 'point', delay: 0.9, area: { shape: 'circle', radius: 2 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.2 }] },
    { stage: 'boom', center: 'point', delay: 1.5, telegraphLead: 0.4, area: { shape: 'circle', radius: 3 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] },
  ],
};

/** Guardian's 드래그 replaced: a dash with a path (its own '_path' cue), the finale cue-less. */
const SOUND_DRAG: UltAltDef = {
  id: 'guardian_ud',
  name: '소리 시험 드래그',
  slot: 'ult',
  description: '시험',
  castTime: 0.5,
  finale: 'zap',
  move: { kind: 'dash', maxRange: 8, path: { width: 2, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.3 }], stage: 'rally' } },
  sfx: { _path: { id: 'drag.blade.dash' } },
  actions: [{ stage: 'zap', center: 'point', delay: 0.9, telegraphLead: 0.3, area: { shape: 'circle', radius: 2.5 }, affects: 'enemies', effects: [{ kind: 'damage', amount: 1 }] }],
};

interface Heard extends SoundReq {
  frame: number;
}

/** A solo 궁극기 테스트 run (guardian on the field) cast once; every sound and bus control the director asks for. */
function listen(set: { aim?: UltAltDef; drag?: UltAltDef } | null, mode: 'aim' | 'drag', lp = 0, frames = 75): { heard: Heard[]; ctl: Ctl[]; tg: TestGame; d: Director; stages: GameEvent[] } {
  if (set) setUltAltFixture('guardian', set);
  const tg = makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: ['guardian', 'cleric', 'mage'], ultMode: mode }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } });
  advance(tg, 0.5);
  const d = new Director();
  const view = (t: number) => ({ localPlayer: lp, gameSpeed: 1, now: 10 + t });
  d.route([], tg.w.state, view(-1));
  tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
  drain(tg);
  tg.events.length = 0;
  expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode, point: mode === 'drag' ? { x: 15, y: 6 } : { x: 12, y: 4 } } }).ok).toBe(true);
  const heard: Heard[] = [];
  const ctl: Ctl[] = [];
  const stages: GameEvent[] = [];
  for (let i = 0; i < frames; i++) {
    if (i > 0) advance(tg, 1 / 30);
    const evs = i > 0 ? tg.events.splice(0) : tg.game.drainEvents();
    stages.push(...evs.filter(e => e.type === 'skillStage' && e.player === 0));
    const out = d.route(evs, tg.w.state, view(i / 30));
    for (const s of out.sounds) heard.push({ ...s, frame: i });
    ctl.push(...out.ctl);
  }
  return { heard, ctl, tg, d, stages };
}
/** The ult's own sounds (not its cut-in, not the boss / the HUD). */
const ults = (h: Heard[]) => h.filter(x => (/^(drag|ult|dash)\./.test(x.id) || x.id === 'mon.blink') && !x.id.endsWith('.cutin'));

describe('9. the sound director: the alt rules (「궁극기 연출 강화」 on)', () => {
  it("an alt's own sfx wins (null = silent), two lead cues of one stage both play; a cue-less beat → drag._role.<role> −4 dB once per cast; the finisher's breath and the music dip", () => {
    const { heard, ctl } = listen({ aim: SOUND_AIM }, 'aim');
    const u = ults(heard);
    // cue-less 'tap' and 'poke' → one role sound, −4 dB; 'hush' silent; 'rally' from the guardian's ult row
    expect(u.filter(x => x.id === 'drag._role.tank').map(x => x.db)).toEqual([ALT_SOUND.roleDb]);
    expect(u.filter(x => x.id === 'ult.guardian.rally').length).toBe(1);
    // the finale: both lead cues scheduled from its cast (0.5 / 0.12 s early), its land cue when it lands
    const charge = u.find(x => x.id === 'drag.guardian.charge')!;
    const slam = u.find(x => x.id === 'drag.guardian.slam')!;
    expect(charge.frame).toBe(0);
    expect(charge.delay).toBeCloseTo(1.5 - 0.5, 6);
    expect(slam.delay).toBeCloseTo(1.5 - 0.12, 6);
    expect(u.filter(x => x.id === 'drag.guardian.wave').length).toBe(1);
    // no role default for a finisher with cues
    expect(u.some(x => x.id === 'ult._role.tank')).toBe(false);
    // my finisher: the effect bus −10 dB 0.18 s before it; the music −10 dB from 0.2 s before it (it lands after 1.2 s)
    const sfxDuck = ctl.find(x => x.kind === 'duck' && x.target === 'sfx' && x.db === ALT_SOUND.duck[0]) as Extract<Ctl, { kind: 'duck' }>;
    expect(sfxDuck.at).toBeCloseTo(1.5 - 0.18, 6);
    expect(sfxDuck.hold).toBeCloseTo(ALT_SOUND.duck[1], 6);
    const bgDuck = ctl.find(x => x.kind === 'duck' && x.target === 'bg' && x.db === ALT_SOUND.bgDb) as Extract<Ctl, { kind: 'duck' }>;
    expect(bgDuck.at).toBeCloseTo(1.5 - 0.2, 6);
    expect(bgDuck.hold).toBeCloseTo(ALT_SOUND.bgHold, 6);
  });

  it("other players hear only the finale stage's cues (far)", () => {
    const u = ults(listen({ aim: SOUND_AIM }, 'aim', 1).heard);
    expect(new Set(u.map(x => x.id))).toEqual(new Set(['drag.guardian.charge', 'drag.guardian.slam', 'drag.guardian.wave']));
    for (const x of u) expect(x.far, x.id).toBe(true);
  });

  it("my dash: dash.<role> now and the touchdown drag._role.<role> −2 dB at the real arrival; the path's '_path' cue; a cue-less finisher → ult._role 0.5 s early (others hear it too); a crowd → drag.crunch", () => {
    const { heard, d, tg, stages } = listen({ drag: SOUND_DRAG }, 'drag');
    const u = ults(heard);
    expect(u.find(x => x.id === 'dash.tank')?.frame).toBe(0);
    const touch = u.filter(x => x.id === 'drag._role.tank' && x.db === ALT_SOUND.touchDb);
    expect(touch.length).toBe(1);
    expect(touch[0].delay).toBeCloseTo(touchdownAt(ultLook('guardian_ud'), 'dash'), 6);
    expect(u.filter(x => x.id === 'drag.blade.dash').length).toBe(1); // the path beat's own cue
    expect(u.some(x => x.id === 'ult.guardian.rally')).toBe(false); // '_path' wins over the row
    const fin = u.filter(x => x.id === 'ult._role.tank');
    expect(fin.length).toBe(1);
    expect(fin[0].frame).toBe(0);
    expect(fin[0].delay).toBeCloseTo(0.9 - ALT_SOUND.roleLead, 6);
    // the finisher's last hit on 3 enemies (its own skillStage, sent again with more targets)
    const zap = stages.find(e => e.type === 'skillStage' && e.stage === 'zap') as Extract<GameEvent, { type: 'skillStage' }>;
    expect(zap).toBeTruthy();
    const more = d.route([{ ...zap, targets: 3 }], tg.w.state, { localPlayer: 0, gameSpeed: 1, now: 20 });
    expect(more.sounds).toContainEqual(expect.objectContaining({ id: 'drag.crunch', db: ALT_SOUND.crunchDb }));
    // others: the finisher's role sound only
    const far = ults(listen({ drag: SOUND_DRAG }, 'drag', 1).heard);
    expect(far.map(x => x.id)).toEqual(['ult._role.tank']);
    expect(far[0].far).toBe(true);
  });

  it("my blink: mon.blink −3 dB and the touchdown; '_path: null' keeps the path silent", () => {
    const blink: UltAltDef = { ...SOUND_DRAG, move: { ...SOUND_DRAG.move!, kind: 'blink' }, sfx: { _path: null } };
    const u = ults(listen({ drag: blink }, 'drag').heard);
    expect(u.filter(x => x.id === 'mon.blink').map(x => x.db)).toEqual([ALT_SOUND.blinkDb]);
    const touch = u.filter(x => x.id === 'drag._role.tank' && x.db === ALT_SOUND.touchDb);
    expect(touch.length).toBe(1);
    expect(touch[0].delay).toBeCloseTo(touchdownAt(ultLook('guardian_ud'), 'blink'), 6);
    expect(u.some(x => x.id === 'drag.blade.dash' || x.id === 'ult.guardian.rally')).toBe(false);
    expect(u.some(x => x.id === 'drag._role.tank' && x.db === ALT_SOUND.roleDb)).toBe(false);
  });

  it('the switch off: the 22차 paths (the path silent, no touchdown sound, the cue-less stage → ult._role when it lands)', () => {
    ULT_FX.boost = false;
    const u = ults(listen({ drag: SOUND_DRAG }, 'drag').heard);
    expect(u.some(x => x.id === 'drag.blade.dash')).toBe(false);
    expect(u.some(x => x.db === ALT_SOUND.touchDb || x.db === ALT_SOUND.roleDb)).toBe(false);
    const fin = u.filter(x => x.id === 'ult._role.tank');
    expect(fin.length).toBe(1);
    expect(fin[0].frame).toBeGreaterThan(20); // at the 0.9 s landing, not scheduled from the cast
    expect(fin[0].delay ?? 0).toBe(0);
  });

  it("every id in every alt's sfx exists (a sound file or a synth recipe)", () => {
    const synth = new Set(recipeIds());
    const ok = (id: string) => synth.has(id) || existsSync(`src/audio/files/${id}.mp3`);
    for (const def of [...ALL_ALTS(), SOUND_AIM, SOUND_DRAG]) {
      for (const [stage, v] of Object.entries(def.sfx ?? {})) {
        const list = v == null ? [] : Array.isArray(v) ? v : [v];
        for (const cue of list as UltCue[]) for (const id of [cue.id, cue.tick, cue.end, cue.last].filter(Boolean) as string[]) expect(ok(id), `${def.id} ${stage} ${id}`).toBe(true);
      }
    }
    for (const r of ['tank', 'melee', 'ranged', 'healer', 'support']) for (const id of [`dash.${r}`, `drag._role.${r}`, `ult._role.${r}`]) expect(ok(id), id).toBe(true);
    for (const id of ['mon.blink', 'drag.crunch']) expect(ok(id), id).toBe(true);
  });
});
