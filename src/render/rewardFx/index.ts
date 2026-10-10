// 기획 17차 floor-reward visuals (docs/floor-rewards.md): a tiny registry so each content track draws its own rewards
// (lines, mines, fog, rings, coin faces, grudge marks …) without touching the shared renderer. src/render/vfx.ts calls
// rewardFxEvent for every event it handles and drawRewardFx once per frame on the ground layer; nothing else.
// Modules register at import time (src/render/rewardFx/{swap,combat,rules}.ts, imported below).

import type { GameEvent, GameState } from '../../types';
import type { Camera } from '../camera';
import type { FxHost } from '../skillfx';

/** What a reward visual gets: the camera (world → screen), my player index, and the shared effect primitives. */
export interface RewardFxView {
  cam: Camera | null;
  localPlayer: number;
  /** Rings, flashes, bursts, shake (the same pools the skill effects use). */
  host: FxHost;
  state: GameState;
}

export interface RewardFxModule {
  /** One game event (every event, in order; return fast for the ones you do not draw). */
  onEvent?(ev: GameEvent, view: RewardFxView): void;
  /** Every frame, ground layer (under units). now = renderer clock (s). */
  draw?(ctx: CanvasRenderingContext2D, state: GameState, view: RewardFxView, now: number): void;
}

// `var` + a hoisted accessor on purpose: the track imports at the bottom run BEFORE this module's body (ESM order),
// and they call registerRewardFx at top level — a `const` list would still be in its TDZ then.
// eslint-disable-next-line no-var
var MODULES: RewardFxModule[] | undefined;

function modules(): RewardFxModule[] {
  return (MODULES ??= []);
}

export function registerRewardFx(m: RewardFxModule): void {
  const list = modules();
  if (!list.includes(m)) list.push(m);
}

export function rewardFxEvent(ev: GameEvent, view: RewardFxView): void {
  for (const m of modules()) m.onEvent?.(ev, view);
}

export function drawRewardFx(ctx: CanvasRenderingContext2D, view: RewardFxView, now: number): void {
  for (const m of modules()) if (m.draw) m.draw(ctx, view.state, view, now);
}

/** Registered modules (tests). */
export function rewardFxModules(): readonly RewardFxModule[] {
  return modules();
}

// the tracks' modules (each registers itself on import)
import './swap';
import './combat';
import './rules';
