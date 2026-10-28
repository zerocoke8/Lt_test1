// 기획 22차 궁극기 테스트 (docs/ult-test.md): a tiny registry so the two content tracks can add small visuals to their
// characters' own 조준 / 드래그 ults (groupA.ts / groupB.ts) without touching the shared renderer — the same pattern as
// src/render/rewardFx. src/render/vfx.ts calls ultFxEvent for every event and drawUltFx once per frame on the ground
// layer; core.ts draws what every aimed / dragged ult shows (the aim reticle, the landing flourish).
//
// Most looks need nothing here: a skillStage of an alt ult is drawn by the stage tables (src/render/skillfx.ts keyed
// `skillId:stage`), else by the generic land effect in the caster's colour. Register a module only for extras.

import type { GameEvent, GameState } from '../../types';
import type { Camera } from '../camera';
import type { FxHost } from '../skillfx';

/** What an ult visual gets: the camera (world → screen; null during event intake), my player index, the effect pools. */
export interface UltFxView {
  cam: Camera | null;
  localPlayer: number;
  /** Rings, flashes, bursts, shake (the same pools the skill effects use). */
  host: FxHost;
  state: GameState;
}

export interface UltFxModule {
  /** One game event (every event, in order; return fast for the ones you do not draw). */
  onEvent?(ev: GameEvent, view: UltFxView): void;
  /** Every frame, ground layer (under units). now = renderer clock (s). */
  draw?(ctx: CanvasRenderingContext2D, state: GameState, view: UltFxView, now: number): void;
}

// `var` + a hoisted accessor on purpose: the group imports at the bottom run BEFORE this module's body (ESM order),
// and they call registerUltFx at top level — a `const` list would still be in its TDZ then.
// eslint-disable-next-line no-var
var MODULES: UltFxModule[] | undefined;

function modules(): UltFxModule[] {
  return (MODULES ??= []);
}

export function registerUltFx(m: UltFxModule): void {
  const list = modules();
  if (!list.includes(m)) list.push(m);
}

export function ultFxEvent(ev: GameEvent, view: UltFxView): void {
  // nothing of this mode outside it (the classic tower / raid / 원정 pay one compare per event)
  if (view.state.mode !== 'ultTest') return;
  for (const m of modules()) m.onEvent?.(ev, view);
}

export function drawUltFx(ctx: CanvasRenderingContext2D, view: UltFxView, now: number): void {
  if (view.state.mode !== 'ultTest') return;
  for (const m of modules()) if (m.draw) m.draw(ctx, view.state, view, now);
}

/** Registered modules (tests). */
export function ultFxModules(): readonly UltFxModule[] {
  return modules();
}

// the shared looks, then the content tracks' modules (each registers itself on import)
import './core';
import './groupA';
import './groupB';
