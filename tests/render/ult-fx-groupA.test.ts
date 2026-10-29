// 기획 23차 궁극기 연출 강화 — 그룹 A (가디언 · 팔라딘 · 워든 · 블레이드 · 버서커 · 섀도우 · 레인저 · 메이지) looks
// (src/render/ultTest/groupA.ts, docs/ult-fx.md 3장 A1–A16, 5-1 GROUP):
//  - every alt has a story for its finale stage (기획 24차: naming no glyph — the core's impact frame instead), every
//    story / look the tables list is registered, every alias is one of today's storyboards;
//  - the hand feel rules: at most one contact stop before the finisher (≤ 55 ms, ≥ 0.5 s before it), encores ≤ 100 ms,
//    a dragged alt with a contact stop within 0.8 s of its touchdown sets touchdownStop 0 (착지 흔들만);
//  - all 8 × 2 casts render 200 frames without throwing (mine and another player's) with the sound director attached,
//    each within the per-cast budget, and the 22차 accents stay quiet while 「궁극기 연출 강화」 is on;
//  - 기획 24차 (docs/ult-fx.md 8-3 A12′–A14′): the three redesigned show my impact frame on my climax only, the shadow's
//    clones stand while its body is hidden, the moon / the hawk hang under the boss bar.
//  - 기획 24차 검토 (8-8 검토 후 고침): 레인저 드래그's wings under the boss bar (any drop, a roaming boss too); 섀도우
//    드래그's clones never above the screen / behind the top HUD on the top-row boss, each cut dashing from where its
//    clone stood; the per-cast maps let go of every key (a cast's last part, a floor change).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Director } from '../../src/audio/director';
import { ultBeats, type UltAltDef } from '../../src/data/ultTest';
import { GROUP_A } from '../../src/data/ultTest/groupA';
import { createRenderer } from '../../src/render';
import { JUICE, Juice } from '../../src/render/juice';
import { LAND, PREP } from '../../src/render/stagefx';
import { Vfx } from '../../src/render/vfx';
import { GROUND_TOP, PX_PER_UNIT, PX_PER_UNIT_Y, PX_PER_UNIT_Z } from '../../src/render/camera';
import { Fx, SkillFx } from '../../src/render/skillfx';
import { ULT_FX } from '../../src/render/ultTest/settings';
import { TOUCHDOWN, touchdownAt, ultLook, ultLookKeys, ultStory, ultStoryKeys, type UltBeatInfo } from '../../src/render/ultTest/stories';
import { resetUltCore, ultImpactOf } from '../../src/render/ultTest/core';
import { ultCastKeysA } from '../../src/render/ultTest/groupA';
import { activeEntity } from '../../src/sim/world';
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
  'shadow_ud:clone', 'shadow_ud:dance', 'shadow_ud:moon',
  'ranger_ua:mark', 'ranger_ua:rain', 'ranger_ua:skyshot',
  'ranger_ud:volley', 'ranger_ud:pin', 'ranger_ud:pierce',
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

/** A 궁극기 테스트 floor against a fixed boss (기획 24차 검토: or `boss`), drawn by a real renderer (fake canvas) and heard by the director. */
function run(chars: string[], mode: UltAimMode, localPlayer = 0, two = false, boss = 'elevator_keeper'): Run {
  const tg = makeGame({
    seed: 4,
    mode: 'ultTest',
    players: two ? [{ ...HUMAN, characters: chars, ultMode: mode }, { ...HUMAN2, characters: ['cleric', 'bard', 'medic'], ultMode: mode }] : [{ ...HUMAN, characters: chars, ultMode: mode }],
    tunables: { invincible: true },
    bossRaid: { onlyBoss: boss, hpMult: 50 },
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
  it('every alt has a story for its finale stage; no story names a glyph (기획 24차: no letters)', () => {
    for (const def of ALTS) {
      expect(def.finale, def.id).toBeTruthy();
      const story = ultStory(`${def.id}:${def.finale}`);
      expect(story, `${def.id}:${def.finale}`).toBeDefined();
    }
    for (const key of STORIES) {
      const fin = ultStory(key)?.finisher;
      if (fin) expect(Object.keys(fin), key).not.toContain('glyph');
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

// ─────────────────────────── 기획 24차: the three redesigned (docs/ult-fx.md 8-3 A12′–A14′) ───────────────────────────

describe('기획 24차: 섀도우 드래그 · 레인저 조준 / 드래그', () => {
  const REDONE = [
    ['shadow', 'drag'],
    ['ranger', 'aim'],
    ['ranger', 'drag'],
  ] as const;

  it('my climax shows my impact frame (the character’s own star) on the blow; another player’s never', () => {
    for (const [id, mode] of REDONE) {
      const fin = ultBeats(alt(id, mode).id)!.finisherAt;
      for (const lp of [0, 1]) {
        resetUltCore();
        const r = run(teammates(id), mode, lp, lp === 1);
        r.cast(0, mode);
        const seen = new Set<string>();
        let firstAt = -1;
        let t = -1 / 30; // the first frame shows the cast itself
        for (let i = 0; i < 90; i++) {
          r.frame();
          t += 1 / 30;
          const c = ultImpactOf();
          if (!c) continue;
          seen.add(c);
          if (firstAt < 0) firstAt = t;
        }
        const tag = `${id} ${mode} lp ${lp}`;
        expect([...seen], tag).toEqual(lp === 0 ? [id] : []);
        if (lp === 0) expect(Math.abs(firstAt - fin), `${tag}: first at ${firstAt}`).toBeLessThan(0.1);
      }
    }
  });

  it('섀도우 드래그: the clones (afterimages) stand while its body is hidden through the cuts; the body is back before the moon', () => {
    resetUltCore();
    const r = run(teammates('shadow'), 'drag');
    r.cast(0, 'drag');
    const id = activeEntity(r.tg.w, r.tg.w.state.players[0])!.id;
    const ghosts = (r.vfx as unknown as { ghosts: { count: number; items: { mode: number }[] } }).ghosts;
    const clones = () => {
      let n = 0;
      for (let i = 0; i < ghosts.count; i++) if (ghosts.items[i].mode === 2) n++;
      return n;
    };
    let t = -1 / 30;
    let through = 0;
    for (let i = 0; i < 50; i++) {
      r.frame();
      t += 1 / 30;
      if (t >= 0.65 && t <= 1.05) {
        // the six cuts (0.6 → 1 s): hidden, and the clones drawn in its place
        expect(r.vfx.hidden(id), `hidden at ${t.toFixed(2)}`).toBe(true);
        expect(clones(), `clones at ${t.toFixed(2)}`).toBeGreaterThan(0);
        through++;
      }
      if (t >= 1.4) expect(r.vfx.hidden(id), `back at ${t.toFixed(2)}`).toBe(false);
    }
    expect(through).toBeGreaterThan(10);
  });

  it('the moon and the hawk’s wings hang under the boss bar (top ≥ logical y 110), even over the top-row boss', () => {
    /**
     * The highest logical y a sky picture reaches: its anchor (+ offset) up its height, then up its own size — the moon's
     * crescent is its radius (기획 24차 검토: the moon grew 60 → 92; its faint glow, 1.5 × the radius, may tuck under the
     * bar); a wing's outline (fxparts.ts wings: four quadratic feathers) peaks at 0.47 × its span (+ the 2.5 px stroke),
     * well under the 100 px the data leaves for it.
     */
    const top = (f: { y: number; oy: number; z: number; r: number; kind: number }) =>
      GROUND_TOP + (f.y + f.oy) * PX_PER_UNIT_Y - f.z * PX_PER_UNIT_Z - (f.kind === Fx.Moon ? f.r : f.r * PX_PER_UNIT * 0.47 + 1.25);
    for (const [id, mode, kind, want] of [
      ['shadow', 'drag', Fx.Moon, 1],
      ['ranger', 'aim', Fx.Wings, 4],
    ] as const) {
      resetUltCore();
      const r = run(teammates(id), mode);
      r.cast(0, mode);
      const seen = new Set<unknown>();
      for (let i = 0; i < 60; i++) {
        r.frame();
        const pool = r.vfx.sfx.pool;
        for (let j = 0; j < pool.count; j++) {
          const f = pool.items[j];
          if (f.kind !== kind || seen.has(f)) continue;
          seen.add(f);
          expect(top(f), `${id} ${mode}: top ${top(f).toFixed(1)}`).toBeGreaterThanOrEqual(110 - 1e-6);
        }
      }
      // the moon; the hawk's three wings + its gold beat
      expect(seen.size, `${id} ${mode}`).toBe(want);
    }
  });

  it('기획 24차 검토 2: 레인저 드래그 — every pair of wings (the hover hawk, the three ★ wings, the gold hawk) keeps its top under the boss bar, dropped anywhere and against a roaming boss', () => {
    const top = (f: { y: number; oy: number; z: number; r: number }) => GROUND_TOP + (f.y + f.oy) * PX_PER_UNIT_Y - f.z * PX_PER_UNIT_Z - (f.r * PX_PER_UNIT * 0.47 + 1.25);
    for (const [boss, x, y] of [
      ['elevator_keeper', 12, 3.5],
      ['elevator_keeper', 12, 0],
      ['elevator_keeper', 8, 3],
      ['washer_drum', 12, 0],
    ] as const) {
      resetUltCore();
      const r = run(teammates('ranger'), 'drag', 0, false, boss);
      r.cast(0, 'drag', { x, y });
      const seen = new Set<unknown>();
      for (let i = 0; i < 70; i++) {
        r.frame();
        const pool = r.vfx.sfx.pool;
        for (let j = 0; j < pool.count; j++) {
          const f = pool.items[j];
          if (f.kind !== Fx.Wings || seen.has(f)) continue;
          seen.add(f);
          expect(top(f), `${boss} drop ${x}, ${y}: wings r ${f.r} top ${top(f).toFixed(1)}`).toBeGreaterThanOrEqual(110 - 1e-6);
        }
      }
      // the hover hawk, the three ★ wings, the gold hawk rising behind the ranger
      expect(seen.size, `${boss} drop ${x}, ${y}`).toBe(5);
    }
  });

  it('기획 24차 검토 2: 섀도우 드래그 on the top-row boss — no clone stands above logical y 120 (its 1.6× body off the screen / behind the top HUD: they stood at −14…85), and each cut dashes from where its clone stood', () => {
    const ghost = vi.spyOn(Vfx.prototype, 'afterimage');
    try {
      for (const [x, y] of [
        [15, 5],
        [12, 3.5],
        [8, 6],
      ] as const) {
        resetUltCore();
        const r = run(teammates('shadow'), 'drag');
        const boss = r.tg.w.state.entities.find(e => e.id === r.tg.w.state.bossId)!;
        ghost.mockClear();
        r.cast(0, 'drag', { x, y });
        for (let i = 0; i < 60; i++) r.frame();
        const calls = ghost.mock.calls.map(c => ({ x: c[1], y: c[2], sc: c[4] ?? 1 }));
        // the six that cut: the first six 1.6× copies (the moon's four come at 1.5 s)
        const clones = calls.filter(c => c.sc === 1.6).slice(0, 6);
        const dash = calls.filter(c => c.sc === 1.3);
        expect(clones.length, `${x}, ${y}`).toBe(6);
        for (const c of clones) {
          const feet = GROUND_TOP + c.y * PX_PER_UNIT_Y;
          expect(feet, `${x}, ${y}: a clone's feet`).toBeGreaterThanOrEqual(120);
          // its cut runs from it through the target (a fixed boss) to the mirror point — the dash's last ghost
          const ex = 2 * boss.pos.x - c.x;
          const ey = 2 * boss.pos.y - c.y;
          expect(dash.some(d => Math.hypot(d.x - ex, d.y - ey) < 0.05), `${x}, ${y}: a dash from the clone at ${c.x.toFixed(2)}, ${c.y.toFixed(2)}`).toBe(true);
        }
      }
    } finally {
      ghost.mockRestore();
    }
  });

  it('기획 24차 검토: the per-cast maps (섀도우 드래그 angles / sides / cuts, 레인저 조준 rain spots) let go of a cast at its last part, and of a cast cut short at the floor change', () => {
    resetUltCore();
    expect(ultCastKeysA()).toBe(0);
    // four whole 섀도우 드래그 casts in a row (the same caster): nothing left after each
    const r = run(teammates('shadow'), 'drag');
    for (let n = 0; n < 4; n++) {
      r.cast(0, 'drag');
      let mid = 0;
      for (let i = 0; i < 75; i++) {
        r.frame();
        if (i === 20) mid = ultCastKeysA();
      }
      expect(mid, `cast ${n}: mid-way`).toBeGreaterThan(0);
      expect(ultCastKeysA(), `cast ${n}: after its moon`).toBe(0);
    }
    // 레인저 조준 cut short (0.9 s in: its rings' spots kept for their lands) — the floor change (resetUltCore) drops them
    const g = run(teammates('ranger'), 'aim');
    g.cast(0, 'aim');
    for (let i = 0; i < 27; i++) g.frame();
    expect(ultCastKeysA()).toBeGreaterThan(0);
    resetUltCore();
    expect(ultCastKeysA()).toBe(0);
  });

  it('기획 24차 검토: on the top-row boss (엘리베이터, y −1.2) the cuts / X / slashes of 섀도우 드래그 and the big star of 레인저 드래그 sit on its visible front (logical y ≥ 140 — under the boss bar, no longer behind it at 60–90), inside its body', () => {
    const add = vi.spyOn(SkillFx.prototype, 'add');
    try {
      for (const [id, kinds, minR] of [
        ['shadow', [Fx.Slash, Fx.XSlash], 0],
        ['ranger', [Fx.Star], 100],
      ] as const) {
        resetUltCore();
        const r = run(teammates(id), 'drag');
        const boss = r.tg.w.state.entities.find(e => e.id === r.tg.w.state.bossId)!;
        expect(boss.pos.y).toBeLessThan(0); // the top row: its middle is behind the boss bar
        add.mockClear();
        r.cast(0, 'drag');
        for (let i = 0; i < 60; i++) r.frame();
        const seen = add.mock.results.map(x => x.value as { kind: number; x: number; y: number; oy: number; z: number; r: number; k: number }).filter(f => (kinds as readonly number[]).includes(f.kind) && f.r >= minR && f.k === 1);
        expect(seen.length, id).toBeGreaterThan(0);
        for (const f of seen) {
          const sy = GROUND_TOP + (f.y + f.oy) * PX_PER_UNIT_Y - f.z * PX_PER_UNIT_Z;
          expect(sy, `${id} kind ${f.kind} r ${f.r}`).toBeGreaterThanOrEqual(140);
          expect(f.y + f.oy, `${id} kind ${f.kind}`).toBeLessThanOrEqual(boss.pos.y + boss.radius + 1e-6);
        }
      }
    } finally {
      add.mockRestore();
    }
  });

  it('「궁극기 연출 강화」 off: the three run 200 frames clean on the 22차 look (none of the 24차 pictures, no impact frame)', () => {
    const add = vi.spyOn(SkillFx.prototype, 'add');
    try {
      for (const [id, mode] of REDONE) {
        ULT_FX.boost = false;
        resetUltCore();
        add.mockClear();
        const r = run(teammates(id), mode);
        r.cast(0, mode);
        expect(() => {
          for (let i = 0; i < 200; i++) r.frame();
        }, `${id} ${mode}`).not.toThrow();
        expect(ultImpactOf(), `${id} ${mode}`).toBeNull();
        // the moon, the hawk's wings and the branded cuts are the stories' (on only)
        const kinds = new Set(add.mock.calls.map(c => c[0]));
        for (const k of [Fx.Moon, Fx.Wings, Fx.Brand]) expect(kinds.has(k), `${id} ${mode} ${k}`).toBe(false);
      }
    } finally {
      add.mockRestore();
      ULT_FX.boost = true;
    }
  });
});
