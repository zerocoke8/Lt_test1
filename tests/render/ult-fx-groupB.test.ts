// 기획 23차 궁극기 연출 강화 — 그룹 B (거너 · 클레릭 · 메딕 · 퇴마사 · 바드 · 크로노 · 퍼펫티어)의 이야기 (docs/ult-fx.md 3장
// B1–B14, 5-1 GROUP): every alt has a story for its finale stage; every story / look this track owns is registered (and
// nothing else of group B); all 14 casts render 200 frames without throwing with the sound director attached; the stops
// obey 2-2 (at most one contact stop per alt, ≤ 55 ms, ≥ 0.5 s before the finisher; an encore ≤ 100 ms) and a drag alt
// with a contact stop within 0.8 s of its touchdown has no touchdown stop; each cast stays in its budget; the 22차
// accents only run with 「궁극기 연출 강화」 off.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTERS } from '../../src/data';
import { Director } from '../../src/audio/director';
import { ULT_GROUP_B_IDS, setUltAltFixture, ultAlt, ultBeats, type UltAltDef, type UltBeat } from '../../src/data/ultTest';
import { createRenderer } from '../../src/render';
import { Vfx } from '../../src/render/vfx';
import { ScreenFx } from '../../src/render/cutin';
import { FallObj, Fx } from '../../src/render/skillfx';
import { FX_LOAD, ULT_FX } from '../../src/render/ultTest/settings';
import { touchdownAt, ultLook, ultLookKeys, ultStory, ultStoryKeys, type UltBeatInfo } from '../../src/render/ultTest/stories';
import { decalCount } from '../../src/render/ultTest/decals';
import { BREATH_MAX_REACH, breathReach } from '../../src/render/ultTest/grammar';
import { resetUltCore, ultStampText } from '../../src/render/ultTest/core';
import { ultFxModules, type UltFxView } from '../../src/render/ultTest';
import type { ImpactSpec } from '../../src/render/impact';
import type { GameEvent, RenderUiState, UltAimMode } from '../../src/types';
import { HUMAN, advance, drain, makeGame } from '../sim/helpers';

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

/** A solo 궁극기 테스트 run against a fixed boss, rendered (fake canvas) and heard (the director) frame by frame. */
function run(chars: string[], mode: UltAimMode, director = false) {
  const tg = makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: chars, ultMode: mode }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } });
  advance(tg, 0.5);
  const spy = vi.spyOn(Vfx.prototype, 'handle');
  const r = createRenderer(fakeCanvas());
  const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false, ultAim: null };
  r.render(tg.w.state, [{ type: 'floorStart', floor: 1, kind: 'boss' }], 1 / 30, ui);
  const vfx = spy.mock.contexts[0] as Vfx;
  spy.mockRestore();
  const d = director ? new Director() : null;
  let now = 10;
  let first: GameEvent[] | null = null;
  const feed = (evs: GameEvent[]) => {
    r.render(tg.w.state, evs, 1 / 30, ui);
    if (d) d.route(evs, tg.w.state, { localPlayer: 0, gameSpeed: 1, now: (now += 1 / 30) });
  };
  return {
    tg,
    vfx,
    frame() {
      if (first) {
        feed(first);
        first = null;
        return;
      }
      advance(tg, 1 / 30);
      feed(tg.events.splice(0));
    },
    cast(m: 'aim' | 'drag', point = { x: 12, y: 3.5 }) {
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
      drain(tg);
      tg.events.length = 0;
      expect(tg.game.dispatch({ type: 'ult', player: 0, aim: { mode: m, point } }).ok).toBe(true);
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
  for (const c of CHARACTERS) setUltAltFixture(c.id, null);
});

const GLYPH: Record<string, string> = { gunner: '爆', cleric: '聖', medic: '救', exorcist: '滅', bard: '響', chrono: '止', puppeteer: '幕' };
const FX_FALL: number = Fx.Fall;
const FALL_BELL: number = FallObj.Bell;
const ALTS = (): UltAltDef[] => ULT_GROUP_B_IDS.flatMap(id => [ultAlt(id, 'aim')!, ultAlt(id, 'drag')!]);
const party = (id: string) => [id, id === 'cleric' ? 'guardian' : 'cleric', id === 'bard' ? 'mage' : 'bard'];

// ─────────────────────────── the registry ───────────────────────────

/** docs/ult-fx.md 3장 B1–B14: every beat this track tells. */
const STORY_KEYS = [
  'gunner_ua:shells',
  'gunner_ua:heavy',
  'gunner_ud:blast1',
  'gunner_ud:slug',
  'cleric_ua:grace',
  'cleric_ua:judgement',
  'cleric_ua:descend',
  'cleric_ud:descend',
  'cleric_ud:sanctuary',
  'cleric_ud:judgement',
  'cleric_ud:bell',
  'medic_ua:golden',
  'medic_ua:siren',
  'medic_ua:charge',
  'medic_ua:defib',
  'medic_ua:firstaid',
  'medic_ud_path:path',
  'medic_ud:firstaid',
  'medic_ud:golden',
  'medic_ud:charge',
  'medic_ud:defib',
  'exorcist_ua:greatseal',
  'exorcist_ua:storm',
  'exorcist_ua:seal',
  'exorcist_ua:destroy',
  'exorcist_ud:greatseal',
  'exorcist_ud:storm',
  'exorcist_ud:seal',
  'exorcist_ud:destroy',
  'bard_ua:choir',
  'bard_ua:encore',
  'bard_ua:beat',
  'bard_ua:forte',
  'bard_ud:beat1',
  'bard_ud:choir',
  'bard_ud:encore',
  'bard_ud:beat2',
  'bard_ud:forte',
  'chrono_ua:stasis',
  'chrono_ua:mire',
  'chrono_ua:rift',
  'chrono_ua:stop',
  'chrono_ud:rift',
  'chrono_ud:rewind',
  'chrono_ud:stasis',
  'chrono_ud:stop',
  'puppeteer_ua:open',
  'puppeteer_ua:charm',
  'puppeteer_ua:toss',
  'puppeteer_ua:thread',
  'puppeteer_ua:curtaincall',
  'puppeteer_ud:open',
  'puppeteer_ud:toss',
  'puppeteer_ud:thread',
  'puppeteer_ud:yank',
  'puppeteer_ud:curtaincall',
];
const LOOK_KEYS = ['gunner_ud', 'cleric_ud', 'medic_ud', 'exorcist_ud', 'bard_ud', 'chrono_ud', 'puppeteer_ud', 'bard_ua'];
const B_ALT = new Set(ULT_GROUP_B_IDS.flatMap(id => [`${id}_ua`, `${id}_ud`]));

describe('group B stories and looks (render/ultTest/groupB.ts)', () => {
  it('every alt has a story for its finale stage, with its glyph (the 2-3 character table)', () => {
    for (const def of ALTS()) {
      const st = ultStory(`${def.id}:${def.finale}`);
      expect(st, `${def.id}:${def.finale}`).toBeDefined();
      expect(st!.finisher?.glyph, def.id).toBe(GLYPH[ultBeats(def.id)!.charId]);
    }
  });

  it('every story / look of the tables is registered, and only those of group B (every stage of every alt is told)', () => {
    const mine = ultStoryKeys().filter(k => B_ALT.has(k.split(':')[0].replace(/_path$/, '')));
    expect([...mine].sort()).toEqual([...STORY_KEYS].sort());
    const looks = ultLookKeys().filter(k => B_ALT.has(k));
    expect([...looks].sort()).toEqual([...LOOK_KEYS].sort());
    // every staged part of every alt has its story (nothing falls back to the role default by accident)
    for (const def of ALTS()) {
      for (const a of def.actions) if (a.stage) expect(STORY_KEYS, `${def.id}:${a.stage}`).toContain(`${def.id}:${a.stage}`);
      if (def.move?.path) expect(STORY_KEYS).toContain(`${def.id}_path:${def.move.path.stage ?? 'path'}`);
    }
  });

  it('the drag looks: a contact stop within 0.8 s of the touchdown → no touchdown stop (2-2 「착지 흔들만」)', () => {
    for (const id of ULT_GROUP_B_IDS) {
      const def = ultAlt(id, 'drag')!;
      const look = ultLook(def.id);
      const td = touchdownAt(look, def.move?.kind ?? 'blink');
      const stops = contactStops(def);
      const near = stops.some(x => x.at - td <= 0.8 + 1e-9);
      if (near) expect(look?.touchdownStop, def.id).toBe(0);
      else expect(look?.touchdownStop ?? 50, def.id).toBeGreaterThan(0);
    }
    // the spec's 「착지 흔들만」 list (B2, B8, B10, B12, B14) and the two with a real touchdown stop (B4, B6)
    for (const id of ['gunner_ud', 'exorcist_ud', 'bard_ud', 'chrono_ud', 'puppeteer_ud']) expect(ultLook(id)?.touchdownStop, id).toBe(0);
    for (const id of ['cleric_ud', 'medic_ud']) expect(ultLook(id)?.touchdownStop ?? 50, id).toBe(50);
  });
});

// ─────────────────────────── stops (2-2) ───────────────────────────

/** Each beat × hit of an alt with the impact its story asks for (the router's info, as far as the stories read it). */
function impacts(def: UltAltDef): { beat: UltBeat; hit: number; at: number; spec: Partial<ImpactSpec> | null }[] {
  const b = ultBeats(def.id)!;
  const out: { beat: UltBeat; hit: number; at: number; spec: Partial<ImpactSpec> | null }[] = [];
  const list = b.path ? [...b.beats, b.path] : b.beats;
  for (const beat of list) {
    const story = ultStory(`${def.id}${beat.actionIndex < 0 ? '_path' : ''}:${beat.stage}`);
    const imp = story?.impact;
    for (let hit = 0; hit < beat.hits; hit++) {
      const at = beat.at + hit * beat.hitInterval;
      const s = {
        role: beat.role,
        seq: beat.seq,
        seqN: beat.seqN,
        hit,
        hits: beat.hits,
        beat,
        beats: b,
        action: beat.actionIndex >= 0 ? def.actions[beat.actionIndex] : null,
        toFinish: Math.max(0, b.finisherAt - at),
        local: true,
        k: 1,
      } as unknown as UltBeatInfo;
      out.push({ beat, hit, at, spec: typeof imp === 'function' ? imp(s) : (imp ?? null) });
    }
  }
  return out;
}

function contactStops(def: UltAltDef): { at: number; ms: number; role: string }[] {
  return impacts(def)
    .filter(x => x.beat.role !== 'finisher' && (x.spec?.stop ?? 0) > 0)
    .map(x => ({ at: x.at, ms: x.spec!.stop!, role: x.beat.role }));
}

describe('stops (docs/ult-fx.md 2-2)', () => {
  it('per alt at most one contact stop, ≤ 55 ms, landing ≥ 0.5 s before the finisher; an encore ≤ 100 ms', () => {
    for (const def of ALTS()) {
      const b = ultBeats(def.id)!;
      const stops = contactStops(def);
      const contact = stops.filter(x => x.role !== 'after');
      expect(contact.length, `${def.id}: ${JSON.stringify(stops)}`).toBeLessThanOrEqual(1);
      for (const x of contact) {
        expect(x.ms, def.id).toBeLessThanOrEqual(55);
        expect(b.finisherAt - x.at, def.id).toBeGreaterThanOrEqual(0.5 - 1e-9);
      }
      for (const x of stops.filter(y => y.role === 'after')) expect(x.ms, def.id).toBeLessThanOrEqual(100);
    }
  });

  it('the stops the spec gives (3장 손맛)', () => {
    const at = (id: string) => contactStops(ultAlt(id.split('_')[0], id.endsWith('ua') ? 'aim' : 'drag')!).map(x => [x.at, x.ms]);
    expect(at('gunner_ua')).toEqual([[0.5, 35]]);
    expect(at('gunner_ud')).toEqual([[0.45, 40]]);
    expect(at('cleric_ua')).toEqual([[0.95, 45]]);
    expect(at('cleric_ud')).toEqual([]);
    expect(at('medic_ua')).toEqual([]);
    expect(at('medic_ud')).toEqual([]);
    expect(at('exorcist_ua')).toEqual([[0.45, 45]]);
    expect(at('exorcist_ud')).toEqual([[0.45, 45]]);
    expect(at('bard_ua')).toEqual([]);
    expect(at('bard_ud')).toEqual([[0.45, 40]]);
    expect(at('chrono_ua')).toEqual([[0.45, 50]]);
    expect(at('chrono_ud')).toEqual([[0.45, 40]]);
    expect(at('puppeteer_ua')).toEqual([[0.45, 40]]);
    expect(at('puppeteer_ud')).toEqual([[0.45, 40]]);
  });
});

// ─────────────────────────── the 14 casts ───────────────────────────

describe('all 14 casts', () => {
  it('render 200 frames without throwing, with the sound director attached (and its finisher lands: the glyph is stamped)', () => {
    for (const id of ULT_GROUP_B_IDS) {
      for (const mode of ['aim', 'drag'] as const) {
        resetUltCore();
        const r = run(party(id), mode, true);
        r.cast(mode);
        const fin = vi.spyOn(Vfx.prototype as unknown as { ultLand: () => void }, 'ultLand');
        let glyph: string | null = null;
        expect(() => {
          for (let i = 0; i < 200; i++) {
            r.frame();
            glyph ??= ultStampText();
          }
        }, `${id} ${mode}`).not.toThrow();
        expect(fin.mock.calls.length, `${id} ${mode}: its beats reached the router`).toBeGreaterThan(0);
        expect(glyph, `${id} ${mode}: the finisher's glyph`).toBe(GLYPH[id]);
        fin.mockRestore();
      }
    }
  }, 60_000);

  it('every finisher gets its wind-up exactly once — also where parts share one footprint (render/vfx.ts routes every alt part)', () => {
    const fx = (r: ReturnType<typeof run>) => r.vfx.sfx.pool;
    for (const id of ULT_GROUP_B_IDS) {
      for (const mode of ['aim', 'drag'] as const) {
        resetUltCore();
        const dim = vi.spyOn(ScreenFx.prototype, 'focusDim');
        const vig = vi.spyOn(ScreenFx.prototype, 'vignette');
        const r = run(party(id), mode);
        r.cast(mode);
        let bell = 0;
        for (let i = 0; i < 90; i++) {
          r.frame();
          const pool = fx(r);
          let n = 0;
          for (let j = 0; j < pool.count; j++) if (pool.items[j].kind === FX_FALL && pool.items[j].n === FALL_BELL) n++;
          bell = Math.max(bell, n);
        }
        // the breath (focus dim at t − 0.12) once — none for a footprint reaching over 6 cells (2-2: the edge tint only;
        // 기획 23차 검토: a band by its half diagonal); the charge's edge tint (vignette) at least once
        const def = ultAlt(id, mode)!;
        const b = ultBeats(def.id)!;
        expect(dim.mock.calls.length, `${id} ${mode}: breath`).toBe(breathReach(def.actions[b.finisher].area) > BREATH_MAX_REACH ? 0 : 1);
        expect(vig.mock.calls.length, `${id} ${mode}: charge tint`).toBeGreaterThanOrEqual(1);
        if (id === 'cleric' && mode === 'drag') expect(bell, 'the bell falls (one)').toBe(1);
        dim.mockRestore();
        vig.mockRestore();
      }
    }
  }, 60_000);

  it('another player’s / a bot’s cast (k 0.55, low detail) renders too', () => {
    const tg = makeGame({
      seed: 4,
      mode: 'ultTest',
      players: [
        { ...HUMAN, characters: ['guardian', 'blade', 'mage'], ultMode: 'aim' },
        { ...HUMAN, name: '둘', characters: ['puppeteer', 'chrono', 'exorcist'], ultMode: 'drag' },
      ],
      tunables: { invincible: true },
      bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 },
    });
    advance(tg, 0.5);
    const r = createRenderer(fakeCanvas());
    const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false, ultAim: null };
    for (const point of [
      { x: 12, y: 3.5 },
      { x: 8, y: 6 },
    ]) {
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 1 } });
      expect(tg.game.dispatch({ type: 'ult', player: 1, aim: { mode: 'drag', point } }).ok).toBe(true);
      expect(() => {
        r.render(tg.w.state, tg.game.drainEvents(), 1 / 30, ui);
        for (let i = 0; i < 120; i++) {
          advance(tg, 1 / 30);
          r.render(tg.w.state, tg.events.splice(0), 1 / 30, ui);
        }
      }).not.toThrow();
    }
  });

  it('each cast (mine) stays in its budget: ≤ 120 live particles and ≤ 40 skill effects of its own, ≤ 6 floor marks', () => {
    const over: string[] = [];
    const peaks: string[] = [];
    for (const id of ULT_GROUP_B_IDS) {
      for (const mode of ['aim', 'drag'] as const) {
        const lines: { p: number; s: number }[][] = [];
        let marks = 0;
        for (const withCast of [false, true]) {
          let seed = 0x5eed;
          vi.spyOn(Math, 'random').mockImplementation(() => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
          });
          resetUltCore();
          const r = run(party(id), mode);
          if (withCast) r.cast(mode);
          const line: { p: number; s: number }[] = [];
          for (let i = 0; i < 200; i++) {
            r.frame();
            line.push({ p: r.vfx.particles.count, s: r.vfx.sfx.pool.count });
            if (withCast) marks = Math.max(marks, decalCount());
          }
          lines.push(line);
          vi.mocked(Math.random).mockRestore();
        }
        const base = { p: Math.max(...lines[0].map(x => x.p)), s: Math.max(...lines[0].map(x => x.s)) };
        const own = { p: Math.max(...lines[1].map(x => x.p)) - base.p, s: Math.max(...lines[1].map(x => x.s)) - base.s };
        peaks.push(`${id} ${mode}: ${own.p} / ${own.s} / ${marks}`);
        if (own.p > 120 || own.s > 40 || marks > 6) over.push(`${id} ${mode}: particles ${own.p}, effects ${own.s}, marks ${marks}`);
      }
    }
    if (process.env.ULT_FX_PRINT) console.log(peaks.join('\n'));
    expect(over).toEqual([]);
  }, 60_000);

  // 기획 23차 검토 (2-8): group B's own sprays (sparks, embers, notes, feathers …) were not halved on a struggling phone —
  // only the core's were. Counted here: the particles asked for by group B's own code (the direct caller of the host's
  // spray / implode is render/ultTest/groupB.ts; today's storyboards it reuses through alias / runStory are not its own).
  it('a struggling phone (FX_LOAD.low): group B’s own sprays halve (as group A’s and the core’s)', () => {
    const OWN = /[\\/]ultTest[\\/]groupB\.ts/;
    const sprays = (id: string, mode: 'aim' | 'drag', low: boolean): number => {
      Object.defineProperty(FX_LOAD, 'low', { get: () => low, set() {}, configurable: true });
      let seed = 0x5eed;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      });
      let sum = 0;
      const mine = () => OWN.test((new Error().stack ?? '').split('\n').slice(2).find(l => /[\\/]src[\\/]/.test(l)) ?? '');
      const spray = Vfx.prototype.spray;
      const implode = Vfx.prototype.implode;
      vi.spyOn(Vfx.prototype, 'spray').mockImplementation(function (this: Vfx, ...a: Parameters<Vfx['spray']>) {
        if (mine()) sum += a[3];
        return spray.apply(this, a);
      });
      vi.spyOn(Vfx.prototype, 'implode').mockImplementation(function (this: Vfx, ...a: Parameters<Vfx['implode']>) {
        if (mine()) sum += a[4];
        return implode.apply(this, a);
      });
      resetUltCore();
      const r = run(party(id), mode);
      r.cast(mode);
      for (let i = 0; i < 200; i++) r.frame();
      vi.restoreAllMocks();
      return sum;
    };
    const over: string[] = [];
    const seen: string[] = [];
    let all = 0;
    let allLow = 0;
    try {
      for (const id of ULT_GROUP_B_IDS) {
        for (const mode of ['aim', 'drag'] as const) {
          const normal = sprays(id, mode, false);
          const low = sprays(id, mode, true);
          all += normal;
          allLow += low;
          seen.push(`${id} ${mode}: ${normal} → ${low} (${(low / Math.max(1, normal)).toFixed(2)})`);
          if (low > normal * 0.7) over.push(seen[seen.length - 1]);
        }
      }
    } finally {
      Object.defineProperty(FX_LOAD, 'low', { value: false, writable: true, configurable: true, enumerable: true });
    }
    if (process.env.ULT_FX_PRINT) console.log(seen.join('\n'));
    expect(all).toBeGreaterThan(200); // the counter sees group B's own sprays
    expect(over).toEqual([]);
    expect(allLow).toBeLessThanOrEqual(all * 0.6);
  }, 120_000);
});

// ─────────────────────────── the switch ───────────────────────────

describe('「궁극기 연출 강화」 off → the 22차 accents of group B', () => {
  it('the accent module draws only with the switch off', () => {
    const calls: string[] = [];
    const host = {
      burst: () => calls.push('burst'),
      ring: () => calls.push('ring'),
      flash: () => calls.push('flash'),
      shake: () => calls.push('shake'),
    };
    const tg = makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: ['gunner', 'cleric', 'bard'], ultMode: 'aim' }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'elevator_keeper', hpMult: 50 } });
    const view: UltFxView = { cam: null, localPlayer: 0, host, state: tg.w.state };
    const ev: GameEvent = {
      type: 'skillStage',
      sourceId: 1,
      player: 0,
      slot: 'ult',
      skillId: 'gunner_ua',
      stage: 'heavy',
      actionIndex: 5,
      center: { x: 12, y: 4 },
      area: { shape: 'circle', radius: 3 },
      team: 'ally',
      hit: 0,
      hits: 1,
      targets: 1,
    };
    for (const m of ultFxModules()) m.onEvent?.(ev, view);
    expect(calls).toEqual([]);
    ULT_FX.boost = false;
    for (const m of ultFxModules()) m.onEvent?.(ev, view);
    expect(calls).toContain('burst');
    expect(calls).toContain('shake');
  });
});
