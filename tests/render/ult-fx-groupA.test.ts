// 기획 23차 궁극기 연출 강화 — 그룹 A (가디언 · 팔라딘 · 워든 · 블레이드 · 버서커 · 섀도우 · 레인저 · 메이지) looks
// (src/render/ultTest/groupA.ts, docs/ult-fx.md 3장 A1–A16, 5-1 GROUP):
//  - every alt has a story for its finale stage (with the character's glyph), every story / look the tables list is
//    registered, every alias is one of today's storyboards;
//  - the hand feel rules: at most one contact stop before the finisher (≤ 55 ms, ≥ 0.5 s before it), encores ≤ 100 ms,
//    a dragged alt with a contact stop within 0.8 s of its touchdown sets touchdownStop 0 (착지 흔들만);
//  - all 8 × 2 casts render 200 frames without throwing (mine and another player's) with the sound director attached,
//    each within the per-cast budget, and the 22차 accents stay quiet while 「궁극기 연출 강화」 is on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Director } from '../../src/audio/director';
import { ultBeats, type UltAltDef } from '../../src/data/ultTest';
import { GROUP_A } from '../../src/data/ultTest/groupA';
import { createRenderer } from '../../src/render';
import { JUICE, Juice } from '../../src/render/juice';
import { LAND, PREP } from '../../src/render/stagefx';
import { Vfx } from '../../src/render/vfx';
import { ULT_FX } from '../../src/render/ultTest/settings';
import { ultTheme } from '../../src/render/ultTest/theme';
import { TOUCHDOWN, touchdownAt, ultLook, ultLookKeys, ultStory, ultStoryKeys, type UltBeatInfo } from '../../src/render/ultTest/stories';
import { resetUltCore } from '../../src/render/ultTest/core';
import { decalCount } from '../../src/render/ultTest/decals';
import { ultFxEvent } from '../../src/render/ultTest';
import type { GameEvent, RenderUiState, UltAimMode } from '../../src/types';
import { HUMAN, HUMAN2, type TestGame, advance, drain, makeGame } from '../sim/helpers';

const IDS = ['guardian', 'paladin', 'warden', 'blade', 'berserker', 'shadow', 'ranger', 'mage'] as const;
const MODES = ['aim', 'drag'] as const;
const alt = (id: string, mode: 'aim' | 'drag'): UltAltDef => GROUP_A[id][mode]!;
const ALTS = IDS.flatMap(id => MODES.map(m => alt(id, m)));

/** Every story / look the 3장 tables describe (A1–A16). */
const STORIES = [
  'guardian_ua:rally', 'guardian_ua:aegis', 'guardian_ua:citadel', 'guardian_ua:barrier', 'guardian_ua:wave',
  'guardian_ud_path:rally', 'guardian_ud:slam', 'guardian_ud:aegis', 'guardian_ud:citadel', 'guardian_ud:barrier', 'guardian_ud:wave',
  'paladin_ua:sanctuary', 'paladin_ua:spear', 'paladin_ua:tribunal',
  'paladin_ud_path:blessing', 'paladin_ud:brand', 'paladin_ud:blessing', 'paladin_ud:tribunal', 'paladin_ud:core',
  'warden_ua:chainstorm', 'warden_ua:hook', 'warden_ua:cage', 'warden_ua:prison', 'warden_ua:release',
  'warden_ud_path:chainstorm', 'warden_ud:hook', 'warden_ud:chainstorm', 'warden_ud:cage', 'warden_ud:prison', 'warden_ud:release',
  'blade_ua:storm', 'blade_ua:issen',
  'blade_ud:dash', 'blade_ud:return', 'blade_ud:issen',
  'berserker_ua:split', 'berserker_ua:frenzy', 'berserker_ua:roar', 'berserker_ua:quake', 'berserker_ua:finale',
  'berserker_ud:slam', 'berserker_ud:frenzy', 'berserker_ud:split', 'berserker_ud:quake',
  'shadow_ua:dance', 'shadow_ua:moon',
  'shadow_ud:clone', 'shadow_ud:vanish', 'shadow_ud:execute', 'shadow_ud:moon',
  'ranger_ua:barrage', 'ranger_ua:rain', 'ranger_ua:skyshot',
  'ranger_ud:volley', 'ranger_ud:pierce',
  'mage_ua:blizzard', 'mage_ua:hail', 'mage_ua:freeze', 'mage_ua:shatter',
  'mage_ud:freeze', 'mage_ud:shatter', 'mage_ud:blizzard',
] as const;
const LOOKS = ['blade_ua', 'berserker_ua', 'shadow_ua', 'mage_ua', 'guardian_ud', 'paladin_ud', 'warden_ud', 'blade_ud', 'berserker_ud', 'shadow_ud', 'ranger_ud', 'mage_ud'] as const;
/** 3장's 「착지 흔들만」 drag alts (a contact stop lands within 0.8 s of the touchdown). */
const SHAKE_ONLY = ['guardian_ud', 'paladin_ud', 'blade_ud', 'shadow_ud', 'mage_ud'] as const;

// ─────────────────────────── harness (the core test's, + the sound director) ───────────────────────────

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

interface Run {
  tg: TestGame;
  vfx: Vfx;
  frame(): void;
  cast(player: number, mode: 'aim' | 'drag', point?: { x: number; y: number }): void;
}

/** A 궁극기 테스트 floor against a fixed boss, drawn by a real renderer (fake canvas) and heard by the director. */
function run(chars: string[], mode: UltAimMode, localPlayer = 0, two = false): Run {
  const tg = makeGame({
    seed: 4,
    mode: 'ultTest',
    players: two ? [{ ...HUMAN, characters: chars, ultMode: mode }, { ...HUMAN2, characters: ['cleric', 'bard', 'medic'], ultMode: mode }] : [{ ...HUMAN, characters: chars, ultMode: mode }],
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
  const d = new Director();
  let t = 0;
  d.route([], tg.w.state, { localPlayer, gameSpeed: 1, now: 10 });
  let first: GameEvent[] | null = null;
  const show = (evs: GameEvent[]) => {
    r.render(tg.w.state, evs, 1 / 30, ui);
    d.route(evs, tg.w.state, { localPlayer, gameSpeed: 1, now: 10 + (t += 1 / 30) });
  };
  return {
    tg,
    vfx,
    frame() {
      if (first) {
        show(first);
        first = null;
        return;
      }
      advance(tg, 1 / 30);
      show(tg.events.splice(0));
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
});

const teammates = (id: string) => [id, id === 'mage' ? 'cleric' : 'mage', 'bard'];

// ─────────────────────────── registries ───────────────────────────

describe('group A stories and looks (registered at import)', () => {
  it('every alt has a story for its finale stage, stamped with its character glyph', () => {
    for (const def of ALTS) {
      expect(def.finale, def.id).toBeTruthy();
      const story = ultStory(`${def.id}:${def.finale}`);
      expect(story, `${def.id}:${def.finale}`).toBeDefined();
      const charId = def.id.slice(0, -3);
      expect(story!.finisher?.glyph, def.id).toBe(ultTheme(charId).glyph);
    }
  });

  it('every story / look the tables list is registered, nothing else of group A; every alias is one of today’s storyboards', () => {
    const mine = ultStoryKeys().filter(k => IDS.some(id => k.startsWith(`${id}_u`)));
    expect([...mine].sort()).toEqual([...STORIES].sort());
    const looks = ultLookKeys().filter(k => IDS.some(id => k.startsWith(`${id}_u`)));
    expect([...looks].sort()).toEqual([...LOOKS].sort());
    for (const key of STORIES) {
      const st = ultStory(key)!;
      const al = st.alias ? (Array.isArray(st.alias) ? st.alias : [st.alias]) : [];
      for (const a of al as { key: string }[]) expect(PREP[a.key] ?? LAND[a.key], `${key} → ${a.key}`).toBeTypeOf('function');
      // every key is a real stage of its alt (or its path)
      const [id, stage] = key.split(':');
      const def = ALTS.find(d => d.id === id.replace(/_path$/, ''))!;
      if (id.endsWith('_path')) expect(def.move?.path?.stage, key).toBe(stage);
      else expect(def.actions.some(a => a.stage === stage), key).toBe(true);
    }
    // every stage of every alt has a story (nothing falls back to the role default by accident)
    for (const def of ALTS) for (const a of def.actions) expect(STORIES, `${def.id}:${a.stage}`).toContain(`${def.id}:${a.stage}`);
  });
});

// ─────────────────────────── hand feel ───────────────────────────

/** The stop (ms) the story asks for on each hit of each beat, by role. */
function stopsOf(def: UltAltDef): { at: number; role: string; stop: number; stage: string }[] {
  const b = ultBeats(def.id)!;
  const out: { at: number; role: string; stop: number; stage: string }[] = [];
  for (const beat of b.beats) {
    if (beat.role === 'finisher') continue;
    const story = ultStory(`${def.id}:${beat.stage}`);
    const imp = story?.impact;
    for (let hit = 0; hit < beat.hits; hit++) {
      const s = { role: beat.role, seq: beat.seq, seqN: beat.seqN, hit, hits: beat.hits, area: def.actions[beat.actionIndex].area } as unknown as UltBeatInfo;
      const spec = imp === undefined || imp === null ? null : typeof imp === 'function' ? imp(s) : imp;
      const stop = spec?.stop ?? 0;
      if (stop > 0) out.push({ at: beat.at + hit * beat.hitInterval, role: beat.role, stop, stage: beat.stage });
    }
  }
  return out;
}

describe('the hand feel (docs/ult-fx.md 2-2)', () => {
  it('at most one contact stop before the finisher (≤ 55 ms, ≥ 0.5 s before it); encores ≤ 100 ms', () => {
    for (const def of ALTS) {
      const b = ultBeats(def.id)!;
      const stops = stopsOf(def);
      const contact = stops.filter(x => x.role !== 'after');
      expect(contact.length, `${def.id} ${JSON.stringify(contact)}`).toBeLessThanOrEqual(1);
      for (const x of contact) {
        expect(x.stop, def.id).toBeLessThanOrEqual(55);
        expect(b.finisherAt - x.at, `${def.id} ${x.stage}`).toBeGreaterThanOrEqual(0.5 - 1e-6);
      }
      for (const x of stops.filter(y => y.role === 'after')) expect(x.stop, def.id).toBeLessThanOrEqual(100);
    }
  });

  it('a dragged alt with a contact stop within 0.8 s of its touchdown only shakes there (touchdownStop 0)', () => {
    for (const id of IDS) {
      const def = alt(id, 'drag');
      const look = ultLook(def.id);
      const td = touchdownAt(look, def.move?.kind ?? 'blink');
      const near = stopsOf(def).some(x => x.role !== 'after' && x.at - td < 0.8);
      if (td < TOUCHDOWN.none && near) expect(look?.touchdownStop, def.id).toBe(0);
      expect(SHAKE_ONLY.includes(def.id as (typeof SHAKE_ONLY)[number]), def.id).toBe(td < TOUCHDOWN.none && near);
    }
    // 버서커 드래그: the leap lands on its 0.45 s slam (no shared touchdown), the strip runs while it hangs in the air
    expect(touchdownAt(ultLook('berserker_ud'), 'blink')).toBeGreaterThanOrEqual(TOUCHDOWN.none);
    expect(ultLook('berserker_ud')?.stripFrom).toBeCloseTo(0.08, 9);
  });

  it('조준 lock-on: a small one for the alts that strike from the caster toward the aim (블레이드 · 버서커 · 메이지); 섀도우 the full one (its ★ falls on the aimed point)', () => {
    for (const id of ['blade', 'berserker', 'mage']) expect(ultLook(`${id}_ua`)?.lock, id).toBe('small');
    // 기획 23차 검토: the crescent falls on the aimed point, so the lock-on holds there until it lands
    expect(ultLook('shadow_ua')?.lock).toBe('point');
    const moon = ultBeats('shadow_ua')!;
    expect(moon.onPoint).toBe(true);
    expect(moon.beats[moon.finisher].center).toBe('point');
  });
});

// ─────────────────────────── cast for real ───────────────────────────

describe('all 8 × 2 casts render (fake canvas) with the director attached', () => {
  it('mine and another player’s: 200 frames each, no throw; my climax stops once, another player’s never', () => {
    for (const id of IDS) {
      for (const mode of MODES) {
        for (const lp of [0, 1]) {
          resetUltCore();
          const fin = vi.spyOn(Juice.prototype, 'finisherStop');
          const r = run(teammates(id), mode, lp, lp === 1);
          r.cast(0, mode);
          expect(() => {
            for (let i = 0; i < 200; i++) r.frame();
          }, `${id} ${mode} lp ${lp}`).not.toThrow();
          // my climax: one 0.13 s stop; another player's: none
          expect(fin.mock.calls.length, `${id} ${mode} lp ${lp}`).toBe(lp === 0 ? 1 : 0);
          fin.mockRestore();
        }
      }
    }
  }, 60_000);

  it('each cast (mine) stays inside the budget: ≤ 150 live particles and ≤ 40 effects of its own, ≤ 6 floor marks', () => {
    const over: string[] = [];
    const seen: string[] = [];
    for (const id of IDS) {
      for (const mode of MODES) {
        const peaks: { p: number; s: number }[] = [];
        const lines: { p: number; s: number }[][] = [];
        let marks = 0;
        for (const withCast of [false, true]) {
          let seed = 0x5eed;
          vi.spyOn(Math, 'random').mockImplementation(() => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
          });
          resetUltCore();
          const r = run(teammates(id), mode);
          if (withCast) r.cast(0, mode);
          let p = 0;
          let s = 0;
          const line: { p: number; s: number }[] = [];
          for (let i = 0; i < 200; i++) {
            r.frame();
            line.push({ p: r.vfx.particles.count, s: r.vfx.sfx.pool.count });
            p = Math.max(p, r.vfx.particles.count);
            s = Math.max(s, r.vfx.sfx.pool.count);
            if (withCast) marks = Math.max(marks, decalCount());
          }
          peaks.push({ p, s });
          lines.push(line);
          vi.mocked(Math.random).mockRestore();
        }
        // the cast's own: the higher of (its peak − the twin's peak) and the largest frame-by-frame difference
        const step = lines[1].map((x, i) => ({ p: x.p - lines[0][i].p, s: x.s - lines[0][i].s }));
        const own = { p: Math.max(peaks[1].p - peaks[0].p, ...step.map(x => x.p)), s: Math.max(peaks[1].s - peaks[0].s, ...step.map(x => x.s)) };
        seen.push(`${id} ${mode}: particles ${own.p}, effects ${own.s}, marks ${marks}`);
        if (own.p > 150 || own.s > 40 || marks > 6) over.push(seen[seen.length - 1]);
      }
    }
    if (process.env.ULT_FX_PRINT) console.log(seen.join('\n'));
    expect(over).toEqual([]);
  }, 60_000);

  it('the 22차 accents: quiet while 「궁극기 연출 강화」 is on, back when it is off', () => {
    const host = { ring: vi.fn(), burst: vi.fn(), flash: vi.fn(), shake: vi.fn() };
    const view = { cam: null, localPlayer: 0, host, state: { mode: 'ultTest', entities: [] } } as unknown as Parameters<typeof ultFxEvent>[1];
    const ev = {
      type: 'skillStage',
      team: 'ally',
      slot: 'ult',
      skillId: 'guardian_ua',
      stage: 'citadel',
      actionIndex: 2,
      center: { x: 8, y: 6 },
      area: { shape: 'circle', radius: 3.5 },
      hit: 0,
      hits: 1,
      targets: 1,
      player: 0,
      sourceId: null,
    } as unknown as GameEvent;
    ultFxEvent(ev, view);
    expect(host.ring).not.toHaveBeenCalled();
    expect(host.shake).not.toHaveBeenCalled();
    ULT_FX.boost = false;
    ultFxEvent(ev, view);
    // the citadel's 22차 slam: a ring out to its footprint + 0.5, a white core ring of 1.6, my small shake
    expect(host.ring.mock.calls.some(c => Math.abs(c[3] - 4) < 1e-9)).toBe(true);
    expect(host.ring.mock.calls.some(c => Math.abs(c[3] - 1.6) < 1e-9 && c[5] === '#ffffff')).toBe(true);
    expect(host.shake).toHaveBeenCalledWith(6);
  });
});
