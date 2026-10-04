// Shapes in the renderer (3차 2): every footprint draws without errors, drawn polygons coincide with the hit test,
// preview parts are merged / numbered / dash-clamped as the player should see them.
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../../src/render';
import { Camera } from '../../src/render/camera';
import { previewDashEnd, previewDrawParts } from '../../src/render/preview';
import { pathArea } from '../../src/render/shapes';
import { DEFAULT_TUNABLES } from '../../src/config';
import { CHARACTERS } from '../../src/data';
import { hitsArea } from '../../src/sim/geometry';
import { createGameWithWorld } from '../../src/sim/game';
import { partsForActions } from '../../src/sim/preview';
import type { AreaShape, DragPreview, GameEvent, GameState, RenderUiState, Vec2 } from '../../src/types';

function recordingCtx() {
  const calls = new Map<string, number>();
  const sets = new Set<string>();
  const pts: Vec2[] = [];
  const gradient = { addColorStop() {} };
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'moveTo' || prop === 'lineTo') return (x: number, y: number) => {
        calls.set(String(prop), (calls.get(String(prop)) ?? 0) + 1);
        pts.push({ x, y });
      };
      return (..._a: unknown[]) => {
        calls.set(String(prop), (calls.get(String(prop)) ?? 0) + 1);
      };
    },
    set(target, prop, value) {
      sets.add(String(prop));
      target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, sets, pts };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/** Real sim state with a few of everything (snapshot copy, so freezing it never touches the sim). */
function simState(): GameState {
  const { game } = createGameWithWorld({
    seed: 3,
    players: [{ name: '나', isBot: false, characters: ['blade', 'mage', 'cleric'], pets: ['frog_bomb', 'owl_frost', 'cat_void'] }],
    tunables: { ...DEFAULT_TUNABLES, invincible: true },
  });
  for (let i = 0; i < 300; i++) game.step(1 / 30);
  return JSON.parse(JSON.stringify(game.state)) as GameState;
}

const SHAPES: AreaShape[] = [
  { shape: 'rect', dir: 'right', anchor: 'center', length: 7, width: 2 },
  { shape: 'rect', dir: 'right', length: 12, width: 1.2 },
  { shape: 'rect', dir: 'left', length: 5, width: 1 },
  { shape: 'rect', dir: 'up', length: 5, width: 1 },
  { shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 2.6 },
  { shape: 'cone', dir: 'right', radius: 4.5, angle: 100 },
  { shape: 'cone', dir: 'left', radius: 5, angle: 70 },
  { shape: 'cone', dir: 'up', radius: 3, angle: 60 },
  { shape: 'ring', inner: 1.2, outer: 4 },
  { shape: 'cross', length: 3.5, width: 1.3 },
  { shape: 'cross', diagonal: true, length: 3.5, width: 1.3 },
];

describe('drawn footprint = hit-test footprint', () => {
  it('every polygon vertex of rect / cone / cross lies on the hit-test boundary', () => {
    const cam = new Camera();
    cam.x = 12;
    const center = { x: 12, y: 6 };
    for (const area of SHAPES) {
      if (area.shape === 'ring') continue;
      const { ctx, pts } = recordingCtx();
      pathArea(ctx, cam, center, null, area, 1);
      expect(pts.length).toBeGreaterThanOrEqual(4);
      for (const p of pts) {
        const w = cam.toWorld(p);
        expect(hitsArea(area, center, center, w, 1e-6), JSON.stringify([area, w])).toBe(true);
        // and it is on the edge: pushing it 0.05 radially outward leaves the shape (cone arc / cross corners)
        const dx = w.x - center.x;
        const dy = w.y - center.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.1 && area.shape !== 'rect') expect(hitsArea(area, center, center, { x: w.x + (dx / d) * 0.05, y: w.y + (dy / d) * 0.05 }, 0)).toBe(false);
      }
    }
  });

  it('rect corners map to the exact world rectangle (anchor + direction)', () => {
    const cam = new Camera();
    cam.x = 12;
    const { ctx, pts } = recordingCtx();
    pathArea(ctx, cam, { x: 10, y: 6 }, null, { shape: 'rect', dir: 'right', length: 12, width: 1.2 }, 1);
    const w = pts.map(p => cam.toWorld(p));
    const xs = w.map(p => Math.round(p.x * 1000) / 1000);
    const ys = w.map(p => Math.round(p.y * 1000) / 1000);
    expect(Math.min(...xs)).toBeCloseTo(10);
    expect(Math.max(...xs)).toBeCloseTo(22);
    expect(Math.min(...ys)).toBeCloseTo(5.4);
    expect(Math.max(...ys)).toBeCloseTo(6.6);
    const { ctx: c2, pts: p2 } = recordingCtx();
    pathArea(c2, cam, { x: 10, y: 6 }, null, { shape: 'rect', dir: 'down', anchor: 'center', length: 12, width: 2.6 }, 1);
    const w2 = p2.map(p => cam.toWorld(p));
    expect(Math.min(...w2.map(p => p.y))).toBeCloseTo(0);
    expect(Math.max(...w2.map(p => p.y))).toBeCloseTo(12);
    expect(Math.min(...w2.map(p => p.x))).toBeCloseTo(8.7);
  });
});

describe('preview parts as drawn', () => {
  const at = (id: string, pos = { x: 10, y: 6 }): Pick<DragPreview, 'pos' | 'area' | 'parts'> => {
    const parts = partsForActions(CHARACTERS.find(c => c.id === id)!.drag.actions, 1);
    return { pos, area: parts[0].area, parts };
  };
  it('self parts are hidden, identical ally+enemy bands merge (바드), delayed multi-hits are numbered', () => {
    expect(previewDrawParts(at('guardian'))).toHaveLength(1);
    const bard = previewDrawParts(at('bard'));
    expect(bard).toHaveLength(1);
    expect(bard[0].enemies && bard[0].allies).toBe(true);
    expect(previewDrawParts(at('mage')).map(p => p.order)).toEqual([1, 2, 3, 4, 5]);
    expect(previewDrawParts(at('shadow')).map(p => p.order)).toEqual([1, 2, 3]);
    expect(previewDrawParts(at('paladin')).map(p => p.order)).toEqual([0, 0]);
    expect(previewDrawParts(at('ranger'))[0].center).toEqual({ x: 10, y: 6 });
    expect(previewDrawParts(at('shadow'))[2].center).toEqual({ x: 14.4, y: 6 });
  });
  it('dash end is clamped into the arena like the sim', () => {
    expect(previewDashEnd(at('blade'), { width: 36, height: 12 })).toEqual({ from: { x: 10, y: 6 }, to: { x: 16, y: 6 } });
    expect(previewDashEnd(at('blade', { x: 33, y: 6 }), { width: 36, height: 12 })!.to).toEqual({ x: 35.5, y: 6 });
    expect(previewDashEnd(at('ranger'), { width: 36, height: 12 })).toBeNull();
  });
});

describe('renderer draws every shape (preview, telegraph, zone, cast, dash)', () => {
  it('no throw, no state mutation, no shadowBlur', () => {
    const { ctx, calls, sets } = recordingCtx();
    const canvas = { width: 300, height: 150, style: {}, getContext: () => ctx };
    const r = createRenderer(canvas as unknown as HTMLCanvasElement);
    const base = simState();
    const me = base.entities.find(e => e.kind === 'character')!;
    let id = 90000;
    base.telegraphs = SHAPES.map(area => ({ id: id++, team: 'ally' as const, center: { x: 12, y: 6 }, origin: { x: 12, y: 6 }, area, remaining: 0.3, total: 0.6 }));
    base.telegraphs.push(...SHAPES.map(area => ({ id: id++, team: 'enemy' as const, center: { x: 8, y: 4 }, origin: { x: 8, y: 4 }, area, remaining: 0.1, total: 1 })));
    base.zones = SHAPES.map(area => ({ id: id++, team: 'ally' as const, ownerPlayer: 0, center: { x: 14, y: 7 }, radius: 3, area, remaining: 2, total: 4, kind: 'damage' as const }));
    const s = deepFreeze(base);
    const evs: GameEvent[] = [
      ...SHAPES.map(area => ({ type: 'skillCast' as const, sourceId: me.id, player: 0, slot: 'drag' as const, skillId: 'x', name: '테스트', center: { x: 12, y: 6 }, area, team: 'ally' as const })),
      ...SHAPES.map(area => ({ type: 'skillCast' as const, sourceId: null, player: null, slot: 'monster' as const, skillId: 'y', name: '?', center: { x: 12, y: 6 }, area, team: 'enemy' as const })),
      { type: 'dash', entityId: me.id, from: { x: me.pos.x - 6, y: me.pos.y }, to: { ...me.pos }, duration: 0.18 },
      { type: 'dash', entityId: 424242, from: { x: 1, y: 1 }, to: { x: 5, y: 1 }, duration: 0.18 },
    ];
    deepFreeze(evs);
    const previews: DragPreview[] = [];
    for (const c of CHARACTERS) {
      const parts = partsForActions(c.drag.actions, 1.3);
      previews.push({ kind: 'swap', pos: { x: 12, y: 6 }, area: parts[0].area, parts, valid: true, color: c.color });
      previews.push({ kind: 'swap', pos: { x: 35, y: 11 }, area: parts[0].area, parts, valid: false, color: c.color });
    }
    deepFreeze(previews);
    for (let i = 0; i < 120; i++) {
      const ui: RenderUiState = { localPlayer: 0, dragPreview: i % 5 === 4 ? null : previews[i % previews.length], freezeCamera: i % 2 === 0 };
      expect(() => r.render(s, i === 1 ? evs : [], 1 / 60, ui)).not.toThrow();
    }
    // telegraphs vanish (impact bursts for every shape)
    expect(() => r.render(deepFreeze({ ...simState(), telegraphs: [] }), [], 1 / 60, { localPlayer: 0, dragPreview: null, freezeCamera: false })).not.toThrow();
    expect(sets.has('shadowBlur')).toBe(false);
    expect(calls.get('lineTo') ?? 0).toBeGreaterThan(100);
    expect(calls.get('fillText') ?? 0).toBeGreaterThan(0);
  });
});
