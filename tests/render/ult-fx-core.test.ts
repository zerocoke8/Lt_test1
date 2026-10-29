// 기획 23차 궁극기 연출 강화 — the CORE (docs/ult-fx.md 5-1, items 1–5, 7, 8): the beats every alt is read into, the
// story / look registries the content tracks fill, today's tables left alone, the finisher's kick (mine only, the
// settings obeyed), the classic tower / 보스 레이드 never touching any of it, the per-cast budgets, the 「궁극기 연출 강화」
// switch; the cut-in's 착지 컷 strip / bright hole (item 6) and the sound director's alt rules (item 9).
// 기획 24차 (docs/ult-fx.md 8-6 CORE 1–6): the 충격 프레임 instead of the big glyph (mine only, the 1 s gate, the
// settings), the warnings over its dark cut (live and frozen frames), the burst table, the tail colour, and the
// 「글자 없음」 guard (no letter in the 궁극기 테스트 looks: source scan, a draw probe of all 30, the exorcist's seal).
// 기획 24차 검토 (docs/ult-fx.md 8-8 검토 후 고침): the frozen frames redraw the warnings while the record is up (not
// only under the cut) and group a warning that came up during the stop; the record covers the after-blow vignette
// (+ the stop); the classic / switch-off frozen frames are really seen; the star on an unclamped blow; a re-cast's
// stepped beats start again.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '../../src/data';
import { STAGE_CUES } from '../../src/audio/stages';
import { ALT_SOUND, type Ctl, Director, type SoundReq } from '../../src/audio/director';
import { recipeIds } from '../../src/audio/synth/recipes';
import { ULT_GROUP_A_IDS, ULT_GROUP_B_IDS, setUltAltFixture, ultAltBySkill, ultAltEntries, ultBeatOf, ultBeats, type UltAltDef, type UltCue } from '../../src/data/ultTest';
import { Camera, PX_PER_UNIT, PX_PER_UNIT_Z } from '../../src/render/camera';
import { createRenderer } from '../../src/render';
import { IMPACT } from '../../src/render/impact';
import { JUICE, Juice, ULT_FINISH } from '../../src/render/juice';
import { TELE_MOTIF, ZONE_DECOR } from '../../src/render/marks';
import { LAND, PREP } from '../../src/render/stagefx';
import { CUTIN, STRIP, ScreenFx } from '../../src/render/cutin';
import { Vfx } from '../../src/render/vfx';
import { FX_LOAD, ULT_FX } from '../../src/render/ultTest/settings';
import { ultTheme, ultThemeIds } from '../../src/render/ultTest/theme';
import { registerUltLooks, registerUltStories, touchdownAt, ultLook, ultLookKeys, ultStoryKeys, type UltStory } from '../../src/render/ultTest/stories';
import { decalCount } from '../../src/render/ultTest/decals';
import { IMPACT as FRAME, drawUltScreen, pushImpact, resetUltCore, tickUltReal, ultCoreCounts, ultImpactCut, ultImpactOf, ultScreenBusy } from '../../src/render/ultTest/core';
import { BREATH_MAX_REACH, FINISH_BLESS, FINISH_STRIKE, breathReach } from '../../src/render/ultTest/grammar';
import type { UltFxView } from '../../src/render/ultTest';
import { Fx, SkillFx } from '../../src/render/skillfx';
import { Pk } from '../../src/render/fxparts';
import { type GameEvent, type GameState, LOGICAL_H, LOGICAL_W, type PlayerSetup, type RenderUiState, type Telegraph, type UltAimMode } from '../../src/types';
import { HUMAN, HUMAN2, type TestGame, advance, drain, makeGame, spawnAt } from '../sim/helpers';

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

/** speed = sim seconds per rendered 1/30 s frame (the debug 게임 속도: 2 = the sim runs twice as fast as the screen). */
function run(chars: string[], mode: UltAimMode, localPlayer = 0, players?: PlayerSetup[], speed = 1): Run {
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
      advance(tg, speed / 30);
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
    expect(ultTheme('guardian').burst.spikes).toBe(6);
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
  /** 기획 24차: `impact` = the char id of my impact frame (ultImpactOf) the first time it is up, `cut` = its dark cut seen, `on` / `off` = the frames it came up / went. */
  function castProbe(localPlayer: number): { r: Run; stops: number[]; zoom: boolean; flashes: number[]; dims: number; impact: string | null; cut: boolean; on: number; off: number; shakes: number[]; lines: boolean } {
    setUltAltFixture('guardian', { aim: PROBE });
    tickUltReal(5); // past the 1 s dark-cut gate of an earlier test's finisher
    const stop = vi.spyOn(Juice.prototype, 'finisherStop');
    const zoomAt = vi.spyOn(Juice.prototype, 'zoomAt');
    const shake = vi.spyOn(Juice.prototype, 'shake');
    const flash = vi.spyOn(ScreenFx.prototype, 'flash');
    const dim = vi.spyOn(ScreenFx.prototype, 'focusDim');
    const r = run(['guardian', 'cleric', 'mage'], 'aim', localPlayer);
    r.cast(0, 'aim');
    let impact: string | null = null;
    let cut = false;
    let lines = false;
    let on = -1;
    let off = -1;
    shake.mockClear();
    for (let i = 0; i < 75; i++) {
      r.frame();
      const now = ultImpactOf();
      impact ??= now;
      if (now && on < 0) on = i;
      if (!now && on >= 0 && off < 0) off = i;
      cut ||= ultCoreCounts().cut;
      lines ||= ultCoreCounts().lines;
    }
    return {
      r,
      stops: stop.mock.results.map(x => x.value as number),
      zoom: zoomAt.mock.results.some(x => x.value === true),
      flashes: flash.mock.calls.map(c => c[0]),
      dims: dim.mock.calls.length,
      impact,
      cut,
      on,
      off,
      shakes: shake.mock.calls.map(c => c[0]),
      lines,
    };
  }

  it('my finisher: a 0.13 s stop (outside the budget), the zoom, the screen flash, the impact frame (dark cut + star, its record 0.74 s + the stop), speed lines, a 12 px shake; the breath before it', () => {
    const k = castProbe(0);
    expect(k.stops.length).toBe(1);
    expect(k.stops[0]).toBeCloseTo(ULT_FINISH.stopSec, 3);
    expect(k.zoom).toBe(true);
    expect(k.flashes.some(a => Math.abs(a - 0.42) < 1e-9)).toBe(true);
    expect(k.impact).toBe('guardian');
    expect(k.cut).toBe(true);
    // the record goes FRAME.busy s + the stop (기획 24차 검토: the after-blow vignette runs on the world clock, held
    // through the stop) after the blow (real clock: 1/30 s a frame)
    const busy = FRAME.busy + k.stops[0];
    expect(k.off - k.on).toBeGreaterThanOrEqual(Math.floor(busy * 30));
    expect(k.off - k.on).toBeLessThanOrEqual(Math.ceil(busy * 30) + 1);
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
    expect(off.impact).toBe('guardian'); // the star stays …
    expect(off.cut).toBe(false); // … the dark cut goes with the stop (8-2-2)
  });

  it('기획 24차 검토: the after-blow vignette (world clock, held by the stop) ends inside the record — the warnings stay over it to its last frame (hit-stop 75 and 150 ms)', () => {
    for (const ms of [75, 150]) {
      vi.restoreAllMocks();
      vi.stubGlobal('document', { createElement: () => fakeCanvas() });
      resetUltCore();
      JUICE.hitStopMs = ms;
      setUltAltFixture('guardian', { aim: PROBE });
      tickUltReal(5);
      const r = run(['guardian', 'cleric', 'mage'], 'aim');
      const vig = r.vfx.screen as unknown as { vigT: number; vigDur: number };
      r.cast(0, 'aim');
      let blow = -1;
      let tail = 0;
      for (let i = 0; i < 75; i++) {
        r.frame();
        if (blow < 0 && ultImpactOf()) blow = i;
        if (blow < 0 || i === blow) continue;
        if (vig.vigDur > 0 && vig.vigT < vig.vigDur) {
          tail++;
          expect(ultScreenBusy(), `${ms} ms: frame blow + ${i - blow} (vignette ${vig.vigT.toFixed(3)} / ${vig.vigDur})`).toBe(true);
        }
      }
      expect(blow, `${ms} ms`).toBeGreaterThan(0);
      expect(tail, `${ms} ms: the tail vignette ran`).toBeGreaterThan(10);
    }
  });

  it('the shake setting at 0: no zoom, no speed lines (the impact frame still lands, dark cut and all)', () => {
    JUICE.shake = 0;
    const k = castProbe(0);
    expect(k.zoom).toBe(false);
    expect(k.lines).toBe(false);
    expect(k.impact).toBe('guardian');
    expect(k.cut).toBe(true);
  });

  it("another player's / a bot's finisher: no stop, no shake, no zoom, no dim, no impact frame (기획 24차: not even a small mark)", () => {
    const k = castProbe(1);
    expect(k.stops.length).toBe(0);
    expect(k.zoom).toBe(false);
    expect(k.dims).toBe(0);
    expect(k.impact).toBeNull();
    expect(k.cut).toBe(false);
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

  it('reduced motion (device setting): no speed lines; the impact frame without its dark cut and streaks, the star without its slam, the rings at half', async () => {
    vi.resetModules();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true, addEventListener() {} }), devicePixelRatio: 1 });
    const core = await import('../../src/render/ultTest/core');
    core.resetUltCore();
    core.pushSpeedLines(10, 5, undefined, 28, '#ffffff', 0.5);
    expect(core.ultCoreCounts().lines).toBe(false);
    core.tickUltReal(5);
    core.pushImpact(12, 9, 176, 'chrono', ultTheme('chrono'), '#eef0ff', 0.65, 1);
    expect(core.ultCoreCounts().impact).toBe(true);
    expect(core.ultCoreCounts().cut).toBe(false);
    const at0 = impactDraw(core, 0);
    expect(at0.cuts).toEqual([]);
    expect(at0.starR).toBeCloseTo(176, 0); // no 1.6× slam: it just appears
    const at1 = impactDraw(core, 0.1);
    expect(at1.flare).toBe(false);
    expect(at1.rings.length).toBe(2);
    for (const g of at1.rings) expect(g.alpha).toBeLessThanOrEqual(0.5 + 1e-9);
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
    expect(ultCoreCounts()).toEqual({ locks: 0, sights: 0, impact: false, cut: false, lines: false, pending: 0 });
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
  it('no story, no finisher, no lock-on / sight line / impact frame, no floor mark (the 22차 reticle is back)', () => {
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
        locks = Math.max(locks, c.locks + c.sights + (c.impact ? 1 : 0));
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

// ─────────────────────────── 10. 기획 23차 검토: the core fixes ───────────────────────────

/**
 * A recording canvas: where (after the transform) every ellipse of radius rx = `probeRx` lands, and their order against
 * the impact frame's dark cut (기획 24차: a fillRect in the `ink` colour — the 23차 glyph's text before); `frozen` = the
 * held picture's offset when drawFrozen put it down this frame (the 9-argument drawImage). 기획 24차 검토: 'later' in
 * `order` = a later part of a multi-part enemy cast drawn as one (render/index.ts LATER_DASH [10, 7]).
 */
interface RecLog {
  hits: { x: number; y: number }[];
  order: string[];
  frozen: { x: number; y: number } | null;
}
function recCanvas(probeRx: number, ink: string, log: RecLog): HTMLCanvasElement {
  type M = [number, number, number, number, number, number];
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const mul = (n: M) => {
    const [a, b, c, d, e, f] = m;
    m = [a * n[0] + c * n[1], b * n[0] + d * n[1], a * n[2] + c * n[3], b * n[2] + d * n[3], a * n[4] + c * n[5] + e, b * n[4] + d * n[5] + f];
  };
  const store: Record<string | symbol, unknown> = {
    save: () => stack.push([...m] as M),
    restore: () => {
      const p = stack.pop();
      if (p) m = p;
    },
    translate: (x: number, y: number) => mul([1, 0, 0, 1, x, y]),
    scale: (x: number, y: number) => mul([x, 0, 0, y, 0, 0]),
    rotate: (r: number) => mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      m = [a, b, c, d, e, f];
    },
    resetTransform: () => {
      m = [1, 0, 0, 1, 0, 0];
    },
    ellipse: (x: number, y: number, rx: number) => {
      if (Math.abs(rx - probeRx) > 0.01) return;
      log.hits.push({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
      log.order.push('warn');
    },
    fillRect: () => {
      if (store.fillStyle === ink && Number(store.globalAlpha ?? 1) > 0) log.order.push('cut');
    },
    drawImage: (...a: unknown[]) => {
      // drawFrozen: the held picture put down whole (sx, sy 0, the logical screen size) at the shake offset
      if (a.length === 9 && a[1] === 0 && a[2] === 0 && a[7] === LOGICAL_W && a[8] === LOGICAL_H) log.frozen = { x: a[5] as number, y: a[6] as number };
    },
    setLineDash: (d: number[]) => {
      if (d.length === 2 && d[0] === 10 && d[1] === 7) log.order.push('later');
    },
  };
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => gradient;
      if (p === 'measureText') return (s: string) => ({ width: String(s ?? '').length * 9 });
      if (p === 'getTransform') return () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] });
      return () => undefined;
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
  return { width: 300, height: 150, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

describe('10. 기획 23차 검토: the wind-up on the sim clock, the lock-on, the warnings over the screen layer, the breath hole, the touchdown', () => {
  /** guardian_ua (its finisher 성채 전개 on the aimed spot) cast once: the order of the breath and the blow, the dim after it, the held lock-on. */
  function watchCast(o: { speed?: number; stopAt?: number; stopSec?: number }) {
    const order: string[] = [];
    const realDim = ScreenFx.prototype.focusDim;
    const realCancel = ScreenFx.prototype.cancelFocus;
    vi.spyOn(ScreenFx.prototype, 'focusDim').mockImplementation(function (this: ScreenFx, ...a: Parameters<ScreenFx['focusDim']>) {
      order.push('dim');
      realDim.apply(this, a);
    });
    vi.spyOn(ScreenFx.prototype, 'cancelFocus').mockImplementation(function (this: ScreenFx) {
      order.push('blow');
      realCancel.apply(this);
    });
    const speed = o.speed ?? 1;
    const r = run(['guardian', 'cleric', 'mage'], 'aim', 0, undefined, speed);
    r.cast(0, 'aim', { x: 12, y: 4 });
    const fin = ultBeats('guardian_ua')!.finisherAt;
    let blowFrame = -1;
    let stopped = false;
    let heldLocks = 0;
    let afterAlpha = 0;
    let locksLate = -1;
    for (let i = 0; i < 110; i++) {
      r.frame();
      const t = (i * speed) / 30;
      if (o.stopAt !== undefined && !stopped && t >= o.stopAt) {
        stopped = r.vfx.juice.hitStop(o.stopSec ?? 0.18, { cap: 0.2, ignoreBudget: true }) > 0;
      }
      if (blowFrame < 0 && ultImpactOf()) blowFrame = i;
      if (blowFrame < 0 && t > fin - 0.4) heldLocks = Math.max(heldLocks, ultCoreCounts().locks);
      if (blowFrame >= 0 && i > blowFrame) afterAlpha = Math.max(afterAlpha, r.vfx.screen.focusAlpha());
      // the finisher's own 0.13 s stop + the 0.2 s burst, and a little slack
      if (blowFrame >= 0 && i === blowFrame + 14) locksLate = ultCoreCounts().locks;
    }
    return { order, blowFrame, stopped, heldLocks, afterAlpha, locksLate };
  }

  it('a hit-stop just before the blow: the breath still comes before it, never after (no 35 % dark after the climax); the held lock-on bursts with the blow', () => {
    const fin = ultBeats('guardian_ua')!.finisherAt;
    const k = watchCast({ stopAt: fin - 0.3, stopSec: 0.18 });
    expect(k.stopped).toBe(true);
    expect(k.blowFrame).toBeGreaterThan(0);
    expect(k.order.filter(x => x === 'dim').length).toBeLessThanOrEqual(1);
    expect(k.order.lastIndexOf('dim')).toBeLessThan(k.order.indexOf('blow'));
    expect(k.afterAlpha).toBe(0);
    expect(k.heldLocks).toBe(1);
    expect(k.locksLate).toBe(0);
  });

  it('the debug 게임 속도 2×: the wind-up still leads the blow (the breath before it, nothing dark after it)', () => {
    const k = watchCast({ speed: 2 });
    expect(k.blowFrame).toBeGreaterThan(0);
    expect(k.order).toEqual(['dim', 'blow']);
    expect(k.afterAlpha).toBe(0);
  });

  /**
   * guardian_ua aimed at (12, 4) with one enemy warning (a probe circle at (4, 8)) up the whole time, drawn by a recording
   * renderer: per frame after the blow, the warnings' positions and their order against the dark cut. `inject(i, held)`
   * may add warnings / events before frame i (held = the frame before it was a frozen one).
   */
  function warnProbe(ms: number, inject?: (i: number, prevHeld: boolean, state: GameState, evs: GameEvent[]) => void) {
    const R_PROBE = 2.345;
    const INK = ultTheme('guardian').burst.ink;
    const log: RecLog = { hits: [], order: [], frozen: null };
    JUICE.hitStopMs = ms;
    resetUltCore();
    tickUltReal(5); // past the 1 s dark-cut gate of an earlier test's finisher
    vi.stubGlobal('document', { createElement: () => recCanvas(R_PROBE * PX_PER_UNIT, INK, log) });
    const tg = makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: ['guardian', 'cleric', 'mage'], ultMode: 'aim' }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } });
    advance(tg, 0.5);
    const r = createRenderer(recCanvas(R_PROBE * PX_PER_UNIT, INK, log));
    const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false, ultAim: null };
    r.render(tg.w.state, [{ type: 'floorStart', floor: 1, kind: 'boss' }], 1 / 30, ui);
    const tele: Telegraph = { id: 987654, team: 'enemy', center: { x: 4, y: 8 }, origin: { x: 4, y: 8 }, area: { shape: 'circle', radius: R_PROBE }, remaining: 5, total: 6 };
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
    drain(tg);
    tg.events.length = 0;
    expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 12, y: 4 } } }).ok).toBe(true);
    let evs: GameEvent[] = tg.game.drainEvents();
    let blow = -1;
    let redrawn = 0;
    let cutFrames = 0;
    let frozenCut = 0;
    let frozenAfterCut = 0;
    let prevHeld = false;
    const heldOrders: string[][] = [];
    /** The world copy of the last live frame (the held picture is that frame's world, unshaken and zoomed). */
    let world = null as { x: number; y: number } | null;
    for (let i = 0; i < 90; i++) {
      tele.remaining = 5;
      if (!tg.w.state.telegraphs.includes(tele)) tg.w.state.telegraphs.push(tele);
      log.hits.length = 0;
      log.order.length = 0;
      log.frozen = null;
      if (blow >= 0) inject?.(i, prevHeld, tg.w.state, evs);
      r.render(tg.w.state, evs, 1 / 30, ui);
      const held = (log as RecLog).frozen; // (read after the render: TS keeps the `= null` above)
      if (blow < 0 && ultImpactOf()) blow = i;
      if (blow >= 0) {
        for (const h of log.hits) expect(Math.hypot(h.x - log.hits[0].x, h.y - log.hits[0].y), `frame ${i} (blow + ${i - blow})`).toBeLessThanOrEqual(0.5);
        if (log.hits.length > 1) redrawn++;
        if (log.order.includes('cut') && log.order.includes('warn')) {
          cutFrames++;
          expect(log.order.lastIndexOf('warn'), `frame ${i}: the warning over the dark cut`).toBeGreaterThan(log.order.lastIndexOf('cut'));
        }
        if (held && ultScreenBusy()) {
          // a held frame while the record is up (under the dark cut, or after it with the star / streaks on — 기획 24차
          // 검토): the warning drawn again on the held picture (its shake offset + the zoom)
          if (log.order.includes('cut')) frozenCut++;
          else frozenAfterCut++;
          heldOrders.push([...log.order]);
          expect(log.hits.length, `${ms} ms frame ${i}: the frozen frame's warning`).toBeGreaterThan(0);
          expect(world).not.toBeNull();
          const want = { x: world!.x + held.x, y: world!.y + held.y };
          for (const h of log.hits) expect(Math.hypot(h.x - want.x, h.y - want.y), `frame ${i}: on the held picture`).toBeLessThanOrEqual(0.5);
        }
      }
      if (!held && log.hits.length) world = log.hits[0];
      prevHeld = !!held;
      advance(tg, 1 / 30);
      evs = tg.events.splice(0);
    }
    expect(blow).toBeGreaterThan(0);
    expect(redrawn).toBeGreaterThan(3); // the redraw really ran (impact frame / speed lines up)
    expect(cutFrames).toBeGreaterThanOrEqual(2); // the blow's live frame + the held ones
    return { frozenCut, frozenAfterCut, heldOrders };
  }

  it('my finisher: the enemy warnings drawn again over the screen layer sit exactly on the world copy (shake, zoom) and over the impact frame — 기획 24차: in the frozen frames too (검토: every held frame while the record is up, the star after the cut included)', () => {
    const at75 = warnProbe(75);
    expect(at75.frozenCut).toBeGreaterThanOrEqual(1);
    // the hit-stop setting 150 ms: a 0.16 s stop outlasts the 0.11 s cut — its last held frames carry the star alone
    const at150 = warnProbe(150);
    expect(at150.frozenCut).toBeGreaterThanOrEqual(1);
    expect(at150.frozenAfterCut).toBeGreaterThanOrEqual(1);
  });

  it('기획 24차 검토: a multi-part enemy cast that comes up during the stop is drawn in its sequence on the held frame (the next part solid, the later ones dashed) — not every part as the next one', () => {
    let injectedAt = -1;
    const R2 = 1.75;
    const probe = warnProbe(75, (i, prevHeld, state, evs) => {
      if (injectedAt >= 0 || !prevHeld) return;
      injectedAt = i;
      const boss = state.bossId ?? null;
      for (const [k, x] of [
        [0, 6],
        [1, 9],
      ] as const) {
        const center = { x, y: 9 };
        const area = { shape: 'circle', radius: R2 } as const;
        state.telegraphs.push({ id: 990001 + k, team: 'enemy', center, origin: center, area, remaining: 1 + 0.5 * k, total: 2 });
        evs.push({ type: 'skillCast', sourceId: boss, player: null, slot: 'monster', skillId: 'probe_multi', name: '', center, area, team: 'enemy', delay: 1 + 0.5 * k });
      }
    });
    expect(injectedAt).toBeGreaterThan(0);
    // the frame it came up in was a held one, and it drew the later part dashed
    expect(probe.heldOrders.some(o => o.includes('later'))).toBe(true);
  });

  it('기획 24차: the frozen frames of a classic floor and of the switch off draw no warning again (only the 궁극기 테스트 impact record does) — 검토: with a stop of their own, so the held frames are really there', () => {
    const R_PROBE = 2.345;
    for (const boost of [false, true]) {
      ULT_FX.boost = boost;
      resetUltCore();
      tickUltReal(5);
      const log: RecLog = { hits: [], order: [], frozen: null };
      vi.stubGlobal('document', { createElement: () => recCanvas(R_PROBE * PX_PER_UNIT, ultTheme('guardian').burst.ink, log) });
      const classic = boost; // the classic tower with the switch on, the 궁극기 테스트 with it off
      const tg = classic
        ? makeGame({ seed: 4, players: [{ ...HUMAN, characters: ['guardian', 'cleric', 'mage'] }], tunables: { invincible: true }, startFloor: 5 })
        : makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: ['guardian', 'cleric', 'mage'], ultMode: 'aim' }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } });
      advance(tg, 0.5);
      const spy = vi.spyOn(Vfx.prototype, 'update');
      const r = createRenderer(recCanvas(R_PROBE * PX_PER_UNIT, ultTheme('guardian').burst.ink, log));
      const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false, ultAim: null };
      r.render(tg.w.state, tg.events.splice(0), 1 / 30, ui);
      const vfx = spy.mock.contexts[0] as Vfx;
      spy.mockRestore();
      const tele: Telegraph = { id: 987655, team: 'enemy', center: { x: 4, y: 8 }, origin: { x: 4, y: 8 }, area: { shape: 'circle', radius: R_PROBE }, remaining: 5, total: 6 };
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
      drain(tg);
      tg.events.length = 0;
      expect(tg.game.dispatch(classic ? { type: 'ult', player: 0 } : { type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 12, y: 4 } } }).ok).toBe(true);
      let evs: GameEvent[] = tg.game.drainEvents();
      let held = 0;
      for (let i = 0; i < 90; i++) {
        tele.remaining = 5;
        if (!tg.w.state.telegraphs.includes(tele)) tg.w.state.telegraphs.push(tele);
        // 기획 24차 검토: a stop of their own (neither run's ult stops the world by itself) — the held frames are really seen
        if (i === 20 || i === 50) vfx.juice.hitStop(0.12, { cap: 0.2, ignoreBudget: true });
        log.hits.length = 0;
        log.order.length = 0;
        log.frozen = null;
        r.render(tg.w.state, evs, 1 / 30, ui);
        if ((log as RecLog).frozen) {
          held++;
          expect(log.hits, `${classic ? 'classic' : 'switch off'} frame ${i}`).toEqual([]);
        }
        expect(log.order, `frame ${i}`).not.toContain('cut');
        advance(tg, 1 / 30);
        evs = tg.events.splice(0);
      }
      expect(held, classic ? 'classic' : 'switch off').toBeGreaterThanOrEqual(4);
    }
  });

  it('the breath: none for a footprint reaching over 6 cells by its half diagonal (가디언 드래그 성벽 5 × 13); a band gets a hole in its own shape, a circle a round one', () => {
    expect(breathReach({ shape: 'rect', dir: 'right', anchor: 'start', length: 5, width: 13 })).toBeGreaterThan(BREATH_MAX_REACH);
    expect(breathReach({ shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 4 })).toBeGreaterThan(BREATH_MAX_REACH);
    expect(breathReach({ shape: 'rect', dir: 'right', anchor: 'center', length: 9, width: 3 })).toBeLessThanOrEqual(BREATH_MAX_REACH);
    const dim = vi.spyOn(ScreenFx.prototype, 'focusDim');
    const cast = (chars: string[], mode: 'aim' | 'drag', point: { x: number; y: number }) => {
      dim.mockClear();
      resetUltCore();
      const r = run(chars, mode);
      r.cast(0, mode, point);
      for (let i = 0; i < 80; i++) r.frame();
      return dim.mock.calls.map(c => c[7] ?? null);
    };
    expect(cast(['guardian', 'cleric', 'mage'], 'drag', { x: 12, y: 6 })).toEqual([]);
    const band = cast(['blade', 'cleric', 'mage'], 'drag', { x: 12, y: 6 });
    expect(band.length).toBe(1);
    expect(band[0]?.area).toMatchObject({ shape: 'rect', length: 9 + 0.8, width: 3 + 0.8 });
    expect(cast(['guardian', 'cleric', 'mage'], 'aim', { x: 12, y: 4 })).toEqual([null]);
  });

  it('블레이드 드래그: the touchdown crater lands where the blade stands (its dash part rushed it on), not at the drop point', () => {
    const ring = vi.spyOn(Vfx.prototype, 'ring');
    const r = run(['blade', 'cleric', 'mage'], 'drag');
    const drop = { x: 8, y: 6 };
    r.cast(0, 'drag', drop);
    let crater: { x: number; y: number } | null = null;
    let blade: { x: number; y: number } | null = null;
    for (let i = 0; i < 20 && !crater; i++) {
      r.frame();
      const c = ring.mock.calls.find(a => a[2] === 0.3 && a[3] === 2.2 && a[4] === 0.4 && a[6] === 7);
      if (c) {
        crater = { x: c[0], y: c[1] };
        const me = r.tg.w.state.entities.find(e => e.kind === 'character' && e.ownerPlayer === 0 && e.defId === 'blade')!;
        blade = { x: me.pos.x, y: me.pos.y };
      }
    }
    expect(crater).not.toBeNull();
    expect(Math.hypot(crater!.x - drop.x, crater!.y - drop.y)).toBeGreaterThan(1);
    expect(Math.hypot(crater!.x - blade!.x, crater!.y - blade!.y)).toBeLessThan(1);
  });
});

describe('11. 기획 23차 검토: 크로노 조준 「시간 재개」 once per cast', () => {
  it('on a boss with two adds (their stasis ends at 1.6 s and 2.33 s): ult.chrono.resume plays once, with the 2.27 s finale; the switch off: as 22차', () => {
    const resumes = (boost: boolean) => {
      ULT_FX.boost = boost;
      const tg = makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: ['chrono', 'guardian', 'mage'], ultMode: 'aim' }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } });
      advance(tg, 0.5);
      for (const p of [{ x: 11, y: 5 }, { x: 13, y: 5 }]) {
        const m = spawnAt(tg, 'golem', p);
        m.hp = 1e7;
        m.maxHp = 1e7;
      }
      const d = new Director();
      d.route([], tg.w.state, { localPlayer: 0, gameSpeed: 1, now: 10 });
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
      drain(tg);
      tg.events.length = 0;
      expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 12, y: 4 } } }).ok).toBe(true);
      const frames: number[] = [];
      let stasisEnds = 0;
      let stop = -1;
      for (let i = 0; i < 100; i++) {
        if (i > 0) advance(tg, 1 / 30);
        const evs = i > 0 ? tg.events.splice(0) : tg.game.drainEvents();
        stasisEnds += evs.filter(e => e.type === 'stasisEnd').length;
        if (stop < 0 && evs.some(e => e.type === 'skillStage' && e.skillId === 'chrono_ua' && e.stage === 'stop')) stop = i;
        for (const s of d.route(evs, tg.w.state, { localPlayer: 0, gameSpeed: 1, now: 10 + i / 30 }).sounds) if (s.id === 'ult.chrono.resume') frames.push(i);
      }
      return { frames, stasisEnds, stop };
    };
    const on = resumes(true);
    expect(on.stasisEnds).toBeGreaterThanOrEqual(3); // the boss + both adds
    expect(on.stop).toBeGreaterThan(0);
    expect(on.frames).toEqual([on.stop]);
    const off = resumes(false);
    expect(off.frames.length).toBeGreaterThanOrEqual(1); // 22차: from the stasis ends (untouched)
  });
});

describe('12. 기획 23차 검토: a file with a built-in run-up is asked for early, part by part (메딕 충전 · 버서커 용암 분출)', () => {
  /** One real cast heard by the director: each request's id, when it sounds (s after the release: frame + delay), rate, dB. */
  function heard(chars: string[], mode: 'aim' | 'drag', point: { x: number; y: number }, re: RegExp, lp = 0): { t: number; id: string; rate: number; db: number; far: boolean }[] {
    const tg = makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: chars, ultMode: mode }, { ...HUMAN2, characters: ['guardian', 'cleric', 'mage'], ultMode: mode }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } });
    advance(tg, 0.5);
    const d = new Director();
    d.route([], tg.w.state, { localPlayer: lp, gameSpeed: 1, now: 10 });
    tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
    drain(tg);
    tg.events.length = 0;
    expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode, point } }).ok).toBe(true);
    const out: { t: number; id: string; rate: number; db: number; far: boolean }[] = [];
    for (let i = 0; i < 75; i++) {
      if (i > 0) advance(tg, 1 / 30);
      const evs = i > 0 ? tg.events.splice(0) : tg.game.drainEvents();
      for (const s of d.route(evs, tg.w.state, { localPlayer: lp, gameSpeed: 1, now: 10 + i / 30 }).sounds) {
        if (re.test(s.id)) out.push({ t: i / 30 + (s.delay ?? 0), id: s.id, rate: s.rate ?? 1, db: s.db ?? 0, far: !!s.far });
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }
  const times = (h: { t: number }[]) => h.map(x => Math.round(x.t * 100) / 100);

  it('메딕: both charge zaps are asked for 0.15 s before their part (조준 1 / 1.4 s, 드래그 0.85 / 1.2 s), the defib finisher as before', () => {
    const ua = heard(['medic', 'guardian', 'mage'], 'aim', { x: 12, y: 4 }, /^drag\.medic\.defib$/);
    expect(times(ua)).toEqual([0.85, 1.25, 1.75]);
    expect(ua.slice(0, 2).map(x => x.db)).toEqual([-10, -10]);
    const ud = heard(['medic', 'guardian', 'mage'], 'drag', { x: 15, y: 6 }, /^drag\.medic\.defib$/);
    expect(times(ud)).toEqual([0.7, 1.05, 1.45]);
  });

  it('버서커 드래그: the two geyser thuds 0.12 s early, a step up each, then the ★ quake on the blow (no thud after it); others hear the same', () => {
    for (const lp of [0, 1]) {
      const h = heard(['berserker', 'guardian', 'mage'], 'drag', { x: 15, y: 6 }, /^drag\.berserker\.(slam|quake)$/, lp).filter(x => x.t > 1);
      expect(h.map(x => x.id), `lp ${lp}`).toEqual(['drag.berserker.slam', 'drag.berserker.slam', 'drag.berserker.quake']);
      expect(times(h), `lp ${lp}`).toEqual([1.13, 1.26, 1.5]);
      expect(h[1].rate).toBeCloseTo(Math.pow(2, 2 / 12), 6);
      expect(h[2].rate).toBeCloseTo(Math.pow(2, 4 / 12), 6);
      for (const x of h) expect(x.far, `lp ${lp}`).toBe(lp === 1);
    }
  });
});

// ─────────────────────────── 13. 기획 24차: the impact frame (충격 프레임) ───────────────────────────

/** What one drawUltScreen call put down: dark fills over the screen, the star's size, the streaks, the rings, any text. */
interface ScreenRec {
  cuts: { style: string; alpha: number }[];
  /** Half the widest span of the star's white fill (= its outer radius for an even point count), 0 = none. */
  starR: number;
  flare: boolean;
  rings: { style: string; alpha: number; r: number }[];
  texts: string[];
}

/** A context recording the screen layer's calls (paths, fills, strokes, arcs, texts). */
function screenCtx(): { ctx: CanvasRenderingContext2D; rec: ScreenRec } {
  const rec: ScreenRec = { cuts: [], starR: 0, flare: false, rings: [], texts: [] };
  let pts: { x: number; y: number }[] = [];
  let arcs: number[] = [];
  const store: Record<string | symbol, unknown> = {};
  const alpha = () => Number(store.globalAlpha ?? 1);
  Object.assign(store, {
    beginPath: () => {
      pts = [];
      arcs = [];
    },
    moveTo: (x: number, y: number) => pts.push({ x, y }),
    lineTo: (x: number, y: number) => pts.push({ x, y }),
    arc: (_x: number, _y: number, r: number) => arcs.push(r),
    fillRect: (_x: number, _y: number, w: number, h: number) => {
      if (alpha() > 0 && w >= 1280 && h >= 720) rec.cuts.push({ style: String(store.fillStyle), alpha: alpha() });
    },
    fill: () => {
      if (pts.length >= 4) {
        const xs = pts.map(p => p.x);
        if (Math.max(...xs) - Math.min(...xs) > 800) rec.flare = true;
      }
      if (store.fillStyle === '#ffffff' && pts.length >= 4 && arcs.length === 0) {
        let d = 0;
        for (const a of pts) for (const b of pts) d = Math.max(d, Math.hypot(a.x - b.x, a.y - b.y));
        // the streaks are white too: a star is never wider than 2 × rMax × slam × grow
        if (d <= 2 * FRAME.rMax * FRAME.slamFrom * FRAME.grow) rec.starR = Math.max(rec.starR, d / 2);
      }
    },
    stroke: () => {
      if (arcs.length) rec.rings.push({ style: String(store.strokeStyle), alpha: alpha(), r: arcs[0] });
    },
    fillText: (t: string) => rec.texts.push(String(t)),
    strokeText: (t: string) => rec.texts.push(String(t)),
  });
  const ctx = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'measureText') return (s: string) => ({ width: String(s ?? '').length * 9 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rec };
}

const SCREEN_CAM = new Camera();
/** A 궁극기 테스트 screen-layer view (no sights / lines unless a run's host is given). */
function screenView(host?: Vfx, state?: GameState, localPlayer = 0): UltFxView {
  return { cam: SCREEN_CAM, localPlayer, host: host ?? ({} as Vfx), state: state ?? ({ mode: 'ultTest' } as GameState), fx: host?.sfx };
}

type CoreClock = { drawUltScreen: typeof drawUltScreen; tickUltReal: typeof tickUltReal };
const CORE_NOW: CoreClock = { drawUltScreen, tickUltReal };

/** Move the real clock dt on, then draw the screen layer once into a recording context. */
function impactDraw(core: CoreClock, dt: number, view?: UltFxView): ScreenRec {
  core.tickUltReal(dt);
  const { ctx, rec } = screenCtx();
  core.drawUltScreen(ctx, view ?? screenView());
  return rec;
}

describe('12b. 기획 24차 검토: a re-cast (the 「충전」 button) within the step counters’ 3 s hears its stepped beats again', () => {
  /** One caster casting its alt twice, `gap` s apart (charged by the debug 「충전」 action); the requests for `id` per cast. */
  function twice(chars: string[], mode: 'aim' | 'drag', id: string, gap: number, lp = 0): [number, number] {
    const tg = makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: chars, ultMode: mode }, { ...HUMAN2, characters: ['guardian', 'cleric', 'mage'], ultMode: mode }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } });
    advance(tg, 0.5);
    const d = new Director();
    d.route([], tg.w.state, { localPlayer: lp, gameSpeed: 1, now: 10 });
    const point = mode === 'drag' ? { x: 15, y: 6 } : { x: 12, y: 4 };
    const n: [number, number] = [0, 0];
    const per = Math.round(gap * 30);
    for (let c = 0; c < 2; c++) {
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
      drain(tg);
      tg.events.length = 0;
      expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode, point } }).ok, `${chars[0]} ${mode} cast ${c}`).toBe(true);
      for (let i = 0; i < (c === 0 ? per : 90); i++) {
        if (i > 0) advance(tg, 1 / 30);
        const evs = i > 0 ? tg.events.splice(0) : tg.game.drainEvents();
        const now = 10 + (c * per + i) / 30;
        for (const s of d.route(evs, tg.w.state, { localPlayer: lp, gameSpeed: 1, now }).sounds) if (s.id === id) n[c]++;
      }
    }
    return n;
  }

  it('섀도우 드래그 six cuts, 레인저 조준 three rains, 레인저 드래그 its twangs, 크로노 드래그 two echoes: as many on a cast 2.3 s after the last as on the first', () => {
    for (const [chars, mode, id] of [
      [['shadow', 'cleric', 'mage'], 'drag', 'ult.shadow.dance'],
      [['ranger', 'cleric', 'mage'], 'aim', 'ult.ranger.rain'],
      [['ranger', 'cleric', 'mage'], 'drag', 'drag.ranger.volley'],
      [['chrono', 'cleric', 'mage'], 'drag', 'ult.chrono.tock'],
    ] as const) {
      const [first, second] = twice([...chars], mode, id, 2.3);
      expect(first, `${chars[0]} ${mode} ${id}: the first cast`).toBeGreaterThan(1);
      expect(second, `${chars[0]} ${mode} ${id}: the re-cast`).toBe(first);
    }
  });
});

describe('13. 기획 24차 충격 프레임: the impact frame (core: its record, drawing, gate and settings; the burst table, the tail colour)', () => {
  const THEME = ultTheme('chrono'); // 12 even points (jag 0): its size reads exactly
  const R = 176; // a 3-cell footprint × PX_PER_UNIT × rK
  // 기획 24차 검토: a blow low enough (y 9) that its star keeps its full size (a higher one shrinks to clear the tip slot)
  const push = (cut = 0.65, burst = 1) => pushImpact(12, 9, R, 'chrono', THEME, '#eef0ff', cut, burst);
  beforeEach(() => {
    tickUltReal(5); // past the 1 s gate of an earlier finisher
    FX_LOAD.low = false;
  });
  afterEach(() => {
    FX_LOAD.low = false;
  });

  it('the dark cut (the ink, 0.65 → 0 by 0.11 s), the star slamming 1.6× → 1×, holding, its points growing as it fades; the streaks, two rings; the record 0.74 s; no letter', () => {
    push();
    expect(ultImpactOf()).toBe('chrono');
    expect(ultImpactCut()).toBe(true);
    expect(ultScreenBusy()).toBe(true);
    const a = impactDraw(CORE_NOW, 0);
    expect(a.cuts).toEqual([{ style: THEME.burst.ink, alpha: FRAME.cutAlpha }]);
    expect(a.starR).toBeCloseTo(R * FRAME.slamFrom, 0);
    expect(a.texts).toEqual([]);
    const b = impactDraw(CORE_NOW, 0.1);
    expect(b.cuts.length).toBe(1);
    expect(b.cuts[0].alpha).toBeGreaterThan(0);
    expect(b.cuts[0].alpha).toBeLessThan(0.2);
    expect(b.starR).toBeCloseTo(R, 0);
    expect(b.flare).toBe(true);
    expect(b.rings.map(g => g.style).sort()).toEqual(['#eef0ff', '#ffffff']);
    tickUltReal(0.02);
    expect(ultImpactCut()).toBe(false);
    const c = impactDraw(CORE_NOW, 0.18);
    expect(c.cuts).toEqual([]);
    expect(c.starR).toBeGreaterThan(R * 1.1);
    const d = impactDraw(CORE_NOW, 0.1); // 0.4 s: the picture is gone, the record stays
    expect(d.starR + d.rings.length + d.cuts.length).toBe(0);
    expect(d.flare).toBe(false);
    tickUltReal(0.33);
    expect(ultImpactOf()).toBe('chrono');
    expect(ultScreenBusy()).toBe(true);
    tickUltReal(0.02);
    expect(ultImpactOf()).toBeNull();
    expect(ultScreenBusy()).toBe(false);
    expect(ultCoreCounts().impact).toBe(false);
  });

  it('a star sits on the blow, kept inside x 100–1180 / y 305–620 (its centre) — 기획 24차 검토', () => {
    for (const [x, y, free] of [
      // the clamps (a blow high up, off to a side, far below)
      [12, 6, false],
      [-30, 6, false],
      [12, -20, false],
      [60, 40, false],
      // 기획 24차 검토 2: blows low enough that nothing clamps — the centre IS the blow at height z (y 9 → 388.4 px)
      [12, 9, true],
      [5, 11, true],
    ] as const) {
      resetUltCore();
      tickUltReal(5);
      pushImpact(x, y, R, 'chrono', THEME, '#eef0ff', 0, 1);
      const { ctx } = screenCtx();
      const seen: { x: number; y: number }[] = [];
      // the star's own path (the white fill of more than four points; chrono: 12 even points, jag 0)
      let pts: { x: number; y: number }[] = [];
      let starPts: { x: number; y: number }[] = [];
      const c = ctx as unknown as Record<string, unknown>;
      const mv = c.moveTo as (x: number, y: number) => void;
      const ln = c.lineTo as (x: number, y: number) => void;
      const bp = c.beginPath as () => void;
      const fl = c.fill as () => void;
      c.beginPath = () => {
        pts = [];
        bp();
      };
      c.moveTo = (px: number, py: number) => {
        seen.push({ x: px, y: py });
        pts.push({ x: px, y: py });
        mv(px, py);
      };
      c.lineTo = (px: number, py: number) => {
        pts.push({ x: px, y: py });
        ln(px, py);
      };
      c.fill = () => {
        if (c.fillStyle === '#ffffff' && pts.length > 4 && Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)) < 800) starPts = pts;
        fl();
      };
      tickUltReal(0.1);
      drawUltScreen(ctx, screenView());
      // the flat streak starts at its left tip: cx − flareW / 2 × (0.85 + 0.15 k)
      const tip = seen[0];
      const k = 1 - (0.1 - FRAME.flareAt) / FRAME.flareSec;
      const cx = tip.x + (FRAME.flareW / 2) * (0.85 + 0.15 * k);
      const rawX = SCREEN_CAM.sx(x);
      const rawY = SCREEN_CAM.sy(y) - FRAME.z * PX_PER_UNIT_Z;
      const wantX = Math.max(FRAME.x0, Math.min(FRAME.x1, rawX));
      const wantY = Math.max(FRAME.y0, Math.min(FRAME.y1, rawY));
      if (free) {
        expect(rawX, `${x}, ${y}: inside x0–x1`).toBeGreaterThan(FRAME.x0);
        expect(rawX, `${x}, ${y}: inside x0–x1`).toBeLessThan(FRAME.x1);
        expect(rawY, `${x}, ${y}: inside y0–y1`).toBeGreaterThan(FRAME.y0);
        expect(rawY, `${x}, ${y}: inside y0–y1`).toBeLessThan(FRAME.y1);
      }
      expect(cx, `${x}, ${y}`).toBeCloseTo(wantX, 6);
      expect(tip.y, `${x}, ${y}`).toBeCloseTo(wantY, 6);
      // the star itself is centred there too (held at 1× at 0.1 s)
      expect(starPts.length, `${x}, ${y}: the star`).toBeGreaterThan(4);
      const sx = starPts.reduce((a, p) => a + p.x, 0) / starPts.length;
      const sy = (Math.min(...starPts.map(p => p.y)) + Math.max(...starPts.map(p => p.y))) / 2;
      expect(sx, `${x}, ${y}: the star's x`).toBeCloseTo(wantX, 3);
      expect(sy, `${x}, ${y}: the star's y`).toBeCloseTo(wantY, 3);
    }
  });

  it('기획 24차 검토: the star never rises into the boss bar / the pattern-tip slot (outline ≥ y 185 through the slam and the fade); a high blow’s star shrinks to fit (≥ rMin), a low one keeps its size', () => {
    // the tip slot under the boss bar, measured on the 844×390 phone (logical y 100–177 with its 「⚙ …」 line)
    expect(FRAME.top).toBeGreaterThanOrEqual(177 + 6);
    expect(FRAME.y0).toBe(FRAME.top + FRAME.rMin);
    /** The star's own path this frame (the white fill of more than four points), as its points. */
    const starAt = (t: number): { x: number; y: number }[] => {
      const { ctx } = screenCtx();
      let pts: { x: number; y: number }[] = [];
      let best: { x: number; y: number }[] = [];
      const c = ctx as unknown as Record<string, unknown>;
      const mv = c.moveTo as (x: number, y: number) => void;
      const ln = c.lineTo as (x: number, y: number) => void;
      const bp = c.beginPath as () => void;
      const fl = c.fill as () => void;
      c.beginPath = () => {
        pts = [];
        bp();
      };
      c.moveTo = (x: number, y: number) => {
        pts.push({ x, y });
        mv(x, y);
      };
      c.lineTo = (x: number, y: number) => {
        pts.push({ x, y });
        ln(x, y);
      };
      c.fill = () => {
        if (c.fillStyle === '#ffffff' && pts.length > 4) best = pts;
        fl();
      };
      tickUltReal(t);
      drawUltScreen(ctx, screenView());
      return best;
    };
    // the elevator's blow (a fixed boss on the top row: y −1.2) — and a blow just over the slot's edge; then a low one
    for (const [y, full] of [
      [-1.2, false],
      [3.5, false],
      [11, true],
    ] as const) {
      resetUltCore();
      tickUltReal(5);
      pushImpact(12, y, FRAME.rMax, 'chrono', THEME, '#eef0ff', 0.65, 1);
      let maxR = 0;
      let dt = 0;
      for (const t of [0, 0.02, 0.04, 0.07, 0.15, 0.2, 0.27, 0.33, 0.37]) {
        const pts = starAt(t - dt);
        dt = t;
        if (!pts.length) continue;
        const top = Math.min(...pts.map(p => p.y));
        expect(top, `y ${y} at ${t}`).toBeGreaterThanOrEqual(FRAME.top - 1e-6);
        if (t >= 0.07 && t <= 0.15) {
          const cy = (Math.min(...pts.map(p => p.y)) + Math.max(...pts.map(p => p.y))) / 2;
          maxR = Math.max(maxR, Math.max(...pts.map(p => p.y)) - cy);
        }
      }
      // held (1×): a full-size star low down; up high at least rMin (it shrank, it did not vanish)
      if (full) expect(maxR, `y ${y}`).toBeCloseTo(FRAME.rMax, 0);
      else {
        expect(maxR, `y ${y}`).toBeGreaterThanOrEqual(FRAME.rMin - 1);
        expect(maxR, `y ${y}`).toBeLessThan(FRAME.rMax);
      }
    }
  });

  it('the 1 s gate (the real clock, like the finisher stop): a second finisher of mine within 1 s gets no dark cut — the star still comes; after the gap it cuts again', () => {
    push();
    expect(ultImpactCut()).toBe(true);
    tickUltReal(0.5);
    push();
    expect(ultImpactOf()).toBe('chrono');
    expect(ultImpactCut()).toBe(false);
    const a = impactDraw(CORE_NOW, 0);
    expect(a.cuts).toEqual([]);
    expect(a.starR).toBeGreaterThan(R);
    tickUltReal(0.55); // 1.05 s after the first cut
    push();
    expect(ultImpactCut()).toBe(true);
  });

  it('the hit-stop setting 0: no dark cut (the star, the streaks and the rings stay)', () => {
    JUICE.hitStopMs = 0;
    push();
    expect(ultImpactCut()).toBe(false);
    const a = impactDraw(CORE_NOW, 0.1);
    expect(a.cuts).toEqual([]);
    expect(a.flare).toBe(true);
    expect(a.rings.length).toBe(2);
    expect(a.starR).toBeCloseTo(R, 0);
  });

  it('a struggling phone (FX_LOAD.low, read at the push): no streaks, no second ring — the cut, the star and the first ring stay', () => {
    FX_LOAD.low = true;
    push();
    FX_LOAD.low = false;
    const a = impactDraw(CORE_NOW, 0.1);
    expect(a.flare).toBe(false);
    expect(a.rings.map(g => g.style)).toEqual(['#eef0ff']);
    expect(a.cuts.length).toBe(1);
    expect(a.starR).toBeCloseTo(R, 0);
  });

  it('the grammar: strike = dark cut 0.65 + star 1×, blessing = no cut + star 0.8×; a real 축복 finisher (allies only) draws its star at 0.8× of a strike and never cuts', () => {
    expect([FINISH_STRIKE.impact, FINISH_STRIKE.burst, FINISH_STRIKE.tailColor]).toEqual([FRAME.cutAlpha, 1, '']);
    expect([FINISH_BLESS.impact, FINISH_BLESS.burst]).toEqual([0, 0.8]);
    const BLESS: UltAltDef = { ...PROBE, finale: 'heal', actions: [...PROBE.actions, { stage: 'heal', center: 'point', delay: 1.5, area: { shape: 'circle', radius: 3 }, affects: 'allies', effects: [{ kind: 'heal', amount: 0.1 }] }] };
    const sizes: number[] = [];
    for (const def of [PROBE, BLESS]) {
      resetUltCore();
      tickUltReal(5);
      setUltAltFixture('guardian', { aim: def });
      expect(ultBeats('guardian_ua')!.finisherKind).toBe(def === PROBE ? 'strike' : 'bless');
      const r = run(['guardian', 'cleric', 'mage'], 'aim');
      r.cast(0, 'aim', { x: 12, y: 9 }); // low on the screen: the star keeps its full size (기획 24차 검토)
      let star = 0;
      let cut = false;
      let who: string | null = null;
      for (let i = 0; i < 75; i++) {
        r.frame();
        who ??= ultImpactOf();
        cut ||= ultImpactCut();
        star = Math.max(star, impactDraw(CORE_NOW, 0, screenView(r.vfx, r.tg.w.state)).starR);
      }
      expect(who, def.finale).toBe('guardian');
      expect(cut, def.finale).toBe(def === PROBE);
      sizes.push(star);
    }
    // guardian's points are ragged by ≤ 5 %
    expect(sizes[0]).toBeGreaterThan(R * FRAME.slamFrom * 0.94);
    expect(sizes[1] / sizes[0]).toBeGreaterThan(0.8 * 0.94);
    expect(sizes[1] / sizes[0]).toBeLessThan(0.8 / 0.94);
  });

  it('the burst table (8-2-2): all 15 characters, ≥ 2 points, a dark ink (luminance < 0.1); no hanja anywhere in a theme; the rest of the 2-3 table as it was', () => {
    const BURST: Record<string, [number, number, number, string]> = {
      guardian: [6, 0.05, 0, '#070a14'],
      paladin: [4, 0.05, 0, '#0d0a02'],
      warden: [8, 0.1, 0.39, '#080a05'],
      blade: [2, 0, -0.5, '#000000'],
      berserker: [12, 0.3, 0, '#140402'],
      shadow: [5, 0.15, 0, '#05030f'],
      ranger: [4, 0.05, 0.785, '#000000'],
      mage: [6, 0, 0.52, '#03080c'],
      gunner: [10, 0.3, 0, '#0c0703'],
      cleric: [8, 0.05, 0, '#0c0a02'],
      medic: [4, 0, 0, '#020a0b'],
      exorcist: [8, 0.2, 0.39, '#0c0203'],
      bard: [10, 0.15, 0, '#0c020d'],
      chrono: [12, 0, 0, '#04050c'],
      puppeteer: [6, 0.2, 0.52, '#0c0208'],
    };
    // screen colour, vignette colour · alpha, spark, decal · colour, ember (2-3, unchanged by 기획 24차)
    const REST: Record<string, [string, string, number, Pk, string, string, Pk]> = {
      guardian: ['#dbe9ff', '#cfe8ff', 0.3, Pk.Glass, 'crater', '#cfe0ff', Pk.Glass],
      paladin: ['#fff3b0', '#fff3b0', 0.3, Pk.Gold, 'sigil', '#ffd166', Pk.Gold],
      warden: ['#e8f0d0', '#c9d6a3', 0.3, Pk.Square, 'crater', '#c9d6a3', Pk.Square],
      blade: ['#ffe3ec', '#000000', 0.5, Pk.Petal, 'gash', '#ffe3ec', Pk.Petal],
      berserker: ['#ffd0c2', '#ff3b1f', 0.25, Pk.Ember, 'crater', '#5c4033', Pk.Ember],
      shadow: ['#e6dcff', '#0b0820', 0.45, Pk.Ink, 'ink', '#1b1c3d', Pk.Ink],
      ranger: ['#fff6d0', '#000000', 0.35, Pk.Feather, 'crater', '#c9ffe9', Pk.Feather],
      mage: ['#e0f7ff', '#bfefff', 0.35, Pk.Glass, 'frost', '#bdeeff', Pk.Glass],
      gunner: ['#ffe2b8', '#000000', 0.35, Pk.Square, 'scorch', '#3a2e26', Pk.Ember],
      cleric: ['#fffbe6', '#fffbe6', 0.3, Pk.Feather, 'sigil', '#ffe08a', Pk.Gold],
      medic: ['#d9fbff', '#bdf6ff', 0.3, Pk.Square, 'sigil', '#2ec4b6', Pk.Gold],
      exorcist: ['#ffd6d6', '#3a0a0c', 0.45, Pk.Paper, 'ink', '#2a1a1a', Pk.Ember],
      bard: ['#ffe6ff', '#e056fd', 0.35, Pk.Note, 'petals', '#e056fd', Pk.Note],
      chrono: ['#eef0ff', '#eef0ff', 0.35, Pk.Glass, 'sigil', '#cfd5ff', Pk.Glass],
      puppeteer: ['#ffd6ea', '#2a0a1a', 0.45, Pk.Petal, 'petals', '#ffb3d9', Pk.Petal],
    };
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    expect([...ultThemeIds()].sort()).toEqual(Object.keys(BURST).sort());
    for (const id of [...ultThemeIds(), 'nobody']) {
      const th = ultTheme(id);
      expect(th.burst.spikes, id).toBeGreaterThanOrEqual(2);
      expect(lum(th.burst.ink), id).toBeLessThan(0.1);
      expect(JSON.stringify(th), id).not.toMatch(HANJA);
      expect('glyph' in th, id).toBe(false);
      if (id === 'nobody') continue;
      const b = th.burst;
      expect([b.spikes, b.jag, b.tilt, b.ink], id).toEqual(BURST[id]);
      expect([th.screenColor, th.vignetteColor, th.vignette, th.spark, th.decal, th.decalColor, th.ember], id).toEqual(REST[id]);
    }
    expect(ultTheme('nobody').burst).toEqual({ spikes: 8, jag: 0.1, tilt: 0, ink: '#05060a' });
  });

  it("the tail colour: a finisher's tailColor tints the edge after the blow (else the theme's vignette colour)", () => {
    const tails = (story: UltStory | null) => {
      resetUltCore();
      setUltAltFixture('guardian', { aim: PROBE });
      const undo = story ? registerUltStories({ 'guardian_ua:boom': story }) : () => undefined;
      const vig = vi.spyOn(ScreenFx.prototype, 'vignette');
      try {
        const r = run(['guardian', 'cleric', 'mage'], 'aim');
        r.cast(0, 'aim');
        for (let i = 0; i < 75; i++) r.frame();
        return vig.mock.calls.filter(c => c[1] === 0.4 && c[2] === 0.6).map(c => c[0]);
      } finally {
        vig.mockRestore();
        undo();
      }
    };
    expect(tails({ finisher: { tailColor: '#1c2259' } })).toEqual(['#1c2259']);
    expect(tails(null)).toEqual([ultTheme('guardian').vignetteColor]);
  });
});

// ─────────────────────────── 14. 기획 24차: 「글자 없음」 — no letter in the 궁극기 테스트 looks ───────────────────────────

/** A CJK ideograph (a hanja such as 城 斬 封 滅); Hangul and the music sign ♬ are not. */
const HANJA = /[㐀-䶿一-鿿豈-﫿]/;

/** The code of a TypeScript source with its comments blanked (strings kept), line by line. */
function codeLines(src: string): string[] {
  let out = '';
  let i = 0;
  const n = src.length;
  /** Open template literals: the `${` depth inside each. */
  const tpl: number[] = [];
  let str: string | null = null;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (str) {
      out += c;
      if (c === '\\') {
        out += d ?? '';
        i += 2;
        continue;
      }
      if (str === '`' && c === '$' && d === '{') {
        out += d;
        tpl.push(0);
        str = null;
        i += 2;
        continue;
      }
      if (c === str || (c === '\n' && str !== '`')) str = null;
      i++;
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') str = c;
    else if (tpl.length && c === '{') tpl[tpl.length - 1]++;
    else if (tpl.length && c === '}') {
      if (tpl[tpl.length - 1] === 0) {
        tpl.pop();
        str = '`';
      } else tpl[tpl.length - 1]--;
    }
    out += c;
    i++;
  }
  return out.split('\n');
}

describe('14. 기획 24차 「글자 없음」: no letter in the 궁극기 테스트 looks', () => {
  it('source: no glyphFx / ultGlyph / fillText / strokeText and no hanja string in the code of src/render/ultTest/*.ts', () => {
    const dir = 'src/render/ultTest';
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter(x => x.endsWith('.ts')).sort()) {
      const lines = codeLines(readFileSync(`${dir}/${f}`, 'utf8'));
      lines.forEach((line, i) => {
        if (/\b(glyphFx|ultGlyph|fillText|strokeText)\b/.test(line) || HANJA.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('the comment stripper keeps strings and code, drops comments', () => {
    const src = "const a = '城'; // 滅\n/* 封\n印 */ glyphFx(x, `a${'斬'}b`);\nconst u = 'http://x'; // fillText";
    expect(codeLines(src)).toEqual(["const a = '城'; ", '', " glyphFx(x, `a${'斬'}b`);", "const u = 'http://x'; "]);
  });

  it('a draw probe: every one of the 30 alts × 「궁극기 연출 강화」 on / off × mine / a bot’s — 6 s after the cast no Fx.Glyph is added and the screen layer writes no text', () => {
    const add = vi.spyOn(SkillFx.prototype, 'add');
    const bad: string[] = [];
    let probes = 0;
    try {
      for (const id of [...ULT_GROUP_A_IDS, ...ULT_GROUP_B_IDS]) {
        for (const mode of ['aim', 'drag'] as const) {
          for (const boost of [true, false]) {
            for (const lp of [0, 1]) {
              ULT_FX.boost = boost;
              resetUltCore();
              add.mockClear();
              const r = run([id, id === 'cleric' ? 'guardian' : 'cleric', id === 'bard' ? 'mage' : 'bard'], mode, lp);
              r.cast(0, mode);
              const texts = new Set<string>();
              for (let i = 0; i < 180; i++) {
                r.frame();
                for (const t of impactDraw(CORE_NOW, 0, screenView(r.vfx, r.tg.w.state, lp)).texts) texts.add(t);
              }
              const glyphs = add.mock.calls.filter(c => c[0] === Fx.Glyph).length;
              const tag = `${id} ${mode} ${boost ? 'on' : 'off'} ${lp === 0 ? 'mine' : 'bot'}`;
              if (glyphs > 0) bad.push(`${tag}: ${glyphs} Fx.Glyph`);
              if (texts.size) bad.push(`${tag}: screen text ${[...texts].join(' ')}`);
              probes++;
            }
          }
        }
      }
      // the control (8-2-4, out of scope): today's exorcist drag skill swapped in during the 궁극기 테스트 still stamps its
      // 印 — the probe does see an Fx.Glyph when there is one
      resetUltCore();
      add.mockClear();
      const today = run(['cleric', 'exorcist', 'bard'], 'aim');
      today.tg.game.dispatch({ type: 'debug', action: { kind: 'resetCooldowns' } });
      expect(today.tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 12, y: 6 } }).ok).toBe(true);
      today.frame(today.tg.game.drainEvents());
      for (let i = 0; i < 40; i++) today.frame();
      expect(add.mock.calls.filter(c => c[0] === Fx.Glyph).length).toBe(1);
    } finally {
      add.mockRestore();
      ULT_FX.boost = true;
    }
    expect(probes).toBe(120);
    expect(bad).toEqual([]);
  }, 300_000);

  it("the cut-in: my exorcist_ua with the switch on leaves out the red 封 seal (noSeal); the switch off and the classic exorcist ult keep it", () => {
    const sealed = (tg: TestGame, cast: () => void): { noSeal: boolean; texts: string[] } => {
      const spy = vi.spyOn(Vfx.prototype, 'handle');
      const r = createRenderer(fakeCanvas());
      const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false, ultAim: null };
      r.render(tg.w.state, tg.events.splice(0), 1 / 30, ui);
      const vfx = spy.mock.contexts[0] as Vfx;
      spy.mockRestore();
      cast();
      r.render(tg.w.state, tg.game.drainEvents(), 1 / 30, ui);
      const cut = vfx.screen.cutin;
      expect(cut.active).toBe(true);
      // no DOM: the band paints straight into this context (no cached picture)
      vi.unstubAllGlobals();
      const { ctx, texts } = textCtx();
      cut.draw(ctx, 0);
      vi.stubGlobal('document', { createElement: () => fakeCanvas() });
      return { noSeal: cut.noSeal, texts };
    };
    const ultGame = () => {
      const tg = makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: ['exorcist', 'guardian', 'mage'], ultMode: 'aim' }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } });
      advance(tg, 0.5);
      return tg;
    };
    const castAim = (tg: TestGame) => () => {
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
      drain(tg);
      tg.events.length = 0;
      expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: 'aim', point: { x: 12, y: 4 } } }).ok).toBe(true);
    };
    const on = ultGame();
    const mine = sealed(on, castAim(on));
    expect(mine.noSeal).toBe(true);
    expect(mine.texts.some(t => t.includes('封'))).toBe(false);
    expect(mine.texts.length).toBeGreaterThan(0); // the band's name / sub line are UI text and stay
    ULT_FX.boost = false;
    const offGame = ultGame();
    const off = sealed(offGame, castAim(offGame));
    expect(off.noSeal).toBe(false);
    expect(off.texts).toContain('封');
    ULT_FX.boost = true;
    const classic = makeGame({ seed: 4, players: [{ ...HUMAN, characters: ['exorcist', 'guardian', 'mage'] }], tunables: { invincible: true }, startFloor: 5 });
    advance(classic, 0.5);
    const today = sealed(classic, () => {
      classic.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
      drain(classic);
      classic.events.length = 0;
      expect(classic.game.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    });
    expect(today.noSeal).toBe(false);
    expect(today.texts).toContain('封');
  });
});
