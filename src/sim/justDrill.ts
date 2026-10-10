// 기획 17차 debug 「저스트 연습」 (docs/just-swap.md): every DRILL.every s a weak telegraphed circle lands under the
// player's field character — a casterless enemy part (nothing can break it), so the 저스트 cue, stamp and card effects
// can be practised and captured on any floor. Toggled per player; off by default (no rng, no state on the wire).

import { getMonster } from '../data';
import { startAction } from './skills';
import { activeEntity, copy, type CastCtx, type World } from './world';

export const JUST_DRILL = { every: 3, radius: 1.2, delay: 1.2, amount: 0.5 } as const;

/** Turn p's drill on / off (the first circle comes 1 s after turning it on). */
export function toggleJustDrill(w: World, pi: number): void {
  const list = (w.justDrill ??= []);
  const i = list.findIndex(d => d.player === pi);
  if (i >= 0) list.splice(i, 1);
  else list.push({ player: pi, next: 1 });
}

export function tickJustDrill(w: World, dt: number): void {
  for (const d of w.justDrill ?? []) {
    d.next -= dt;
    if (d.next > 1e-9) continue;
    d.next += JUST_DRILL.every;
    const p = w.state.players[d.player];
    const e = p && !p.out ? activeEntity(w, p) : null;
    if (e) drillAt(w, e.pos);
  }
}

/** A weak monster-strength circle at `at` (a goblin's attack × floor multiplier × amount). */
function drillAt(w: World, at: { x: number; y: number }): void {
  const atk = getMonster('goblin').stats.atk * w.state.plan.statMult * w.tunables.monsterDmgMult;
  const ctx: CastCtx = {
    casterId: null,
    selfId: null,
    team: 'enemy',
    player: null,
    partyIndex: null,
    slot: 'monster',
    source: 'basic',
    skillId: 'just_drill',
    name: '저스트 연습',
    atk,
    critChance: 0,
    critMult: 1,
    dmgMult: 1,
    healMult: 1,
    shieldMult: 1,
    radiusMult: 1,
    point: copy(at),
    targetId: null,
    targetPos: null,
    allyTargetId: null,
    origin: copy(at),
    isDrag: false,
    summonMult: 1,
  };
  startAction(w, ctx, { center: 'point', area: { shape: 'circle', radius: JUST_DRILL.radius }, affects: 'enemies', effects: [{ kind: 'damage', amount: JUST_DRILL.amount }], delay: JUST_DRILL.delay });
}
