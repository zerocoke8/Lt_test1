// Solo draw smoothing: the local sim moves units 30×/s while the screen draws 60×/s, so without this every other
// frame shows no movement (stutter). TickSmoother hands the renderer a shallow view of the state whose unit and
// projectile positions sit between the previous and the current tick (≤ 1 tick ≈ 33 ms behind). The sim's own state
// is never touched (determinism); multiplayer does its own interpolation in RemoteGame.

import type { GameState, Vec2 } from '../types';
import { TICK_RATE } from '../config';

/** Moves longer than this in one tick are teleports (floor start, blink): shown at once. */
const TELEPORT_DIST = 2.5;

interface Pair {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export class TickSmoother {
  private lastTick = -1;
  private tickAt = 0;
  private readonly ents = new Map<number, Pair>();
  private readonly projs = new Map<number, Pair>();

  /** Forget everything (new run). */
  reset(): void {
    this.lastTick = -1;
    this.ents.clear();
    this.projs.clear();
  }

  /**
   * State to draw at `now` (performance ms) for a sim running at `speed` (tunables.gameSpeed). Returns `state` itself
   * when nothing needs moving, otherwise a shallow copy with copied entities/projectiles at blended positions.
   */
  view(state: GameState, now: number, speed: number): GameState {
    if (state.tick !== this.lastTick) {
      if (state.tick < this.lastTick) this.reset();
      this.record(this.ents, state.entities);
      this.record(this.projs, state.projectiles);
      this.lastTick = state.tick;
      this.tickAt = now;
    }
    const tickMs = 1000 / TICK_RATE / Math.max(0.05, speed);
    const a = Math.max(0, Math.min(1, (now - this.tickAt) / tickMs));
    if (a >= 1) return state;
    let changed = false;
    const entities = state.entities.map(e => {
      const p = this.at(this.ents, e.id, a);
      if (!p) return e;
      changed = true;
      return { ...e, pos: p };
    });
    const projectiles = state.projectiles.map(pr => {
      const p = this.at(this.projs, pr.id, a);
      if (!p) return pr;
      changed = true;
      return { ...pr, pos: p };
    });
    return changed ? { ...state, entities, projectiles } : state;
  }

  private record(map: Map<number, Pair>, list: readonly { id: number; pos: Vec2 }[]): void {
    const seen = new Set<number>();
    for (const o of list) {
      seen.add(o.id);
      const pr = map.get(o.id);
      if (pr) {
        pr.ax = pr.bx;
        pr.ay = pr.by;
        pr.bx = o.pos.x;
        pr.by = o.pos.y;
      } else map.set(o.id, { ax: o.pos.x, ay: o.pos.y, bx: o.pos.x, by: o.pos.y });
    }
    for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
  }

  /** Blended position, or null when the unit did not move this tick (or teleported). */
  private at(map: Map<number, Pair>, id: number, a: number): Vec2 | null {
    const pr = map.get(id);
    if (!pr) return null;
    const dx = pr.bx - pr.ax;
    const dy = pr.by - pr.ay;
    if ((dx === 0 && dy === 0) || dx * dx + dy * dy > TELEPORT_DIST * TELEPORT_DIST) return null;
    return { x: pr.ax + dx * a, y: pr.ay + dy * a };
  }
}
