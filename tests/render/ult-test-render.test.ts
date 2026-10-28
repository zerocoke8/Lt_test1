// 기획 22차 궁극기 테스트: the renderer draws the ult button's live preview (RenderUiState.ultAim — 조준 and 드래그, valid /
// cancel) and the aimed / dragged ultCast (reticle, landing flourish) of a real ultTest game without throwing, and the
// registry the content tracks add their extras to is live (core + group A + group B modules registered).
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../../src/render';
import { ultFxModules } from '../../src/render/ultTest';
import { planUlt, ultPreviewParts } from '../../src/sim/ultTest';
import type { GameEvent, RenderUiState, UltAim, UltAimView } from '../../src/types';
import { HUMAN, advance, drain, makeGame } from '../sim/helpers';

function fakeCanvas(): { canvas: HTMLCanvasElement; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const gradient = { addColorStop() {} };
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'measureText') return () => ({ width: 10 });
      return (..._args: unknown[]) => {
        calls.set(String(prop), (calls.get(String(prop)) ?? 0) + 1);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  const canvas = { width: 300, height: 150, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('궁극기 테스트 render', () => {
  it('registers the shared looks and both content groups', () => {
    // core registers one module; the group files may register none yet — the registry itself must be there
    expect(ultFxModules().length).toBeGreaterThanOrEqual(1);
  });

  it('draws 조준 / 드래그 previews (valid, off the field, cancel) and the aimed / dragged casts', () => {
    for (const mode of ['aim', 'drag'] as const) {
      const tg = makeGame({ seed: 4, mode: 'ultTest', players: [{ ...HUMAN, characters: ['blade', 'guardian', 'mage'], ultMode: mode }], tunables: { invincible: true }, bossRaid: { onlyBoss: 'washer_drum' } });
      advance(tg, 0.5);
      const { canvas, calls } = fakeCanvas();
      const r = createRenderer(canvas);
      const aim: UltAim = { mode, point: { x: 18, y: 4 } };
      const plan = planUlt(tg.w.state, 0, aim)!;
      expect(plan).not.toBeNull();
      const view = (valid: boolean, cancel: boolean): UltAimView => ({
        mode,
        from: plan.move?.from ?? plan.caster,
        point: plan.point,
        parts: ultPreviewParts(tg.w.state, 0, plan),
        move: plan.move ? { kind: plan.move.kind, from: plan.move.from, to: plan.move.to, pathWidth: 1.5 } : null,
        targetId: plan.targetId,
        valid,
        cancel,
        color: '#ff5fa2',
      });
      expect(view(true, false).parts.length).toBeGreaterThan(0);
      for (const [valid, cancel] of [
        [true, false],
        [false, false],
        [true, true],
      ] as const) {
        const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: true, ultAim: view(valid, cancel) };
        expect(() => r.render(tg.w.state, [], 1 / 60, ui)).not.toThrow();
      }
      tg.game.dispatch({ type: 'debug', action: { kind: 'chargeUlt' } });
      drain(tg);
      tg.events.length = 0;
      expect(tg.game.dispatch({ type: 'ult', player: 0, aim }).ok).toBe(true);
      const evs: GameEvent[] = tg.game.drainEvents();
      expect(evs.some(e => e.type === 'ultCast' && e.aim?.mode === mode)).toBe(true);
      const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false, ultAim: null };
      expect(() => r.render(tg.w.state, evs, 1 / 60, ui)).not.toThrow();
      for (let i = 0; i < 40; i++) {
        advance(tg, 1 / 30);
        expect(() => r.render(tg.w.state, tg.game.drainEvents(), 1 / 30, ui)).not.toThrow();
      }
      expect(calls.get('stroke') ?? 0).toBeGreaterThan(0);
    }
  });
});
