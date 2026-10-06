// Adversarial review (3차): drag-skill footprints at the arena edges / corners / outside drops, with stacked radius
// rewards, on both arena sizes. "Preview = hit test" (R27/R28) is checked against what the UI would actually show:
// the preview is built at game.clampToArena(finger point) exactly like src/ui/drag.ts, the drop is sent RAW (the
// sim clamps), and the drawn dash end (render/preview previewDashEnd) must be where the caster really stops.
import { describe, expect, it } from 'vitest';
import { CHARACTERS, getMonster } from '../../src/data';
import { hitsArea, areaExtent } from '../../src/sim/geometry';
import { charCtx } from '../../src/sim/ctx';
import { createUnit } from '../../src/sim/entities';
import { castSkill } from '../../src/sim/skills';
import { previewDashEnd, previewDrawParts } from '../../src/render/preview';
import { cleanState } from '../../server/snapshot';
import type { AreaShape, GameEvent, PreviewPart, SkillAction, Vec2 } from '../../src/types';
import type { SimEntity } from '../../src/sim/world';
import { active, advance, clearEvents, HUMAN, makeGame, quietFloor, spawnAt, type TestGame } from '../sim/helpers';

const DROPS: Vec2[] = [
  { x: -3, y: -5 }, // far outside top-left → clamps to the corner
  { x: 0.2, y: 6 },
  { x: 2.1, y: 0.7 },
  { x: 99, y: 6.3 }, // far right → clamps to the right wall
  { x: 33.7, y: 11.6 }, // near bottom-right (normal floor) / outside (boss floor)
  { x: 12, y: 13 }, // below the arena
];
const RADIUS_STACKS = [0, 2]; // number of dragrad_epic (+50% each) on the card

function setup(id: string, floor: number, stacks: number): TestGame {
  const first = id === 'guardian' ? 'paladin' : 'guardian';
  const tg = makeGame({ players: [{ ...HUMAN, characters: [first, id, 'cleric'] }], startFloor: floor });
  quietFloor(tg);
  const s = tg.game.state;
  s.players[0].party[1].normalCooldownRemaining = 99;
  for (let i = 0; i < stacks; i++) s.players[0].rewards.push({ rewardId: 'dragrad_epic', partyIndex: 1 });
  // boss (floor 5) stays, but never acts or moves
  for (const e of tg.w.state.entities) if (e.tier === 'boss') {
    e.rt.stationary = true;
    e.rt.skillCds = e.rt.skillCds.map(() => 999);
    e.hp = e.maxHp = e.rt.base.maxHp = 1e12;
  }
  return tg;
}

function enemyGrid(tg: TestGame): SimEntity[] {
  const a = tg.game.state.plan.arena;
  const out: SimEntity[] = [];
  for (let x = 0.5; x <= a.width - 0.5 + 1e-9; x += 0.85) {
    for (let y = 0.5; y <= a.height - 0.5 + 1e-9; y += 0.85) {
      const m = spawnAt(tg, 'slime', { x, y });
      m.rt.stationary = true;
      m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
      out.push(m);
    }
  }
  return out;
}

function partCenter(drop: Vec2, p: PreviewPart): Vec2 {
  return { x: drop.x + p.offset.x, y: drop.y + p.offset.y };
}

/**
 * Seconds to watch a drag skill: past its last damaging beat (at least 1.5 s), never as long as the 종이 인형 live (their
 * burst is not part of the preview).
 */
function watchWindow(actions: readonly SkillAction[]): number {
  const last = Math.max(0, ...actions.filter(a => !a.zone && a.effects.some(e => e.kind === 'damage')).map(a => a.delay ?? 0));
  return Math.max(1.5, last + 0.3);
}

/** Part filter: damaging parts that land within the window (기획 13차: slow / tether walls deal no damage). */
function damagingWithin(actions: readonly SkillAction[], window: number): (p: PreviewPart, i: number) => boolean {
  return (p, i) => actions[i].effects.some(e => e.kind === 'damage') && p.delay <= window - 0.2;
}

const sortedKeys = (m: Map<number, number>) => [...m.keys()].sort((a, b) => a - b);

function expectedHits(
  parts: PreviewPart[],
  drop: Vec2,
  units: SimEntity[],
  affects: 'enemies' | 'allies',
  keep: (p: PreviewPart, i: number) => boolean = () => true,
): Map<number, number> {
  const want = new Map<number, number>();
  for (const e of units) {
    let n = 0;
    for (const [i, p] of parts.entries()) {
      if (p.affects !== affects || !keep(p, i)) continue;
      const c = partCenter(drop, p);
      if (hitsArea(p.area, c, c, e.pos, e.radius)) n++;
    }
    if (n > 0) want.set(e.id, n);
  }
  return want;
}

describe('R27/R28 at the edges: every enemy-hitting drag skill, 6 drops (inside, edge, corner, far outside) × 0/2 radius rewards × both arenas', () => {
  const enemyChars = CHARACTERS.filter(c => c.drag.actions.some(a => a.affects === 'enemies'));
  for (const def of enemyChars) {
    for (const floor of [1, 5]) {
      it(`${def.id} on floor ${floor}`, () => {
        for (const stacks of RADIUS_STACKS) {
          for (const raw of DROPS) {
            const tg = setup(def.id, floor, stacks);
            const s = tg.game.state;
            const enemies = enemyGrid(tg);
            const boss = s.entities.filter(e => e.tier === 'boss') as SimEntity[];
            // what the UI shows: preview at the clamped finger point
            const pos = tg.game.clampToArena(raw);
            const parts = tg.game.previewParts(0, 'swap', 1);
            const partActions = def.drag.actions.filter(a => a.center !== 'woundedAlly');
            const window = watchWindow(def.drag.actions);
            const want = expectedHits(parts, pos, [...enemies, ...boss], 'enemies', damagingWithin(partActions, window));
            const dashPreview = previewDashEnd({ pos, area: parts[0].area, parts }, s.plan.arena);
            clearEvents(tg);
            expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: raw }).ok).toBe(true);
            const me = active(tg);
            const label = `${def.id} f${floor} r+${stacks * 50}% drop ${JSON.stringify(raw)}`;
            // drawn dash end = real end (R28 clamp)
            if (dashPreview) {
              expect(me.pos.x, label).toBeCloseTo(dashPreview.to.x, 6);
              expect(me.pos.y, label).toBeCloseTo(dashPreview.to.y, 6);
            } else {
              expect(me.pos, label).toEqual(pos);
            }
            me.rt.base.atk = 0; // no basic attacks muddying the count (the instant parts already resolved)
            const first = tg.game.drainEvents();
            // skillCast events (telegraph/vfx source) = the preview parts' centers and areas
            const casts = first.filter((e): e is Extract<GameEvent, { type: 'skillCast' }> => e.type === 'skillCast' && e.slot === 'drag');
            // 기획 13차: a rush back (charge) telegraphs its real path from the dash end; the preview draws the band it sweeps
            for (const p of parts.filter((q, i) => q.affects !== 'self' && !partActions[i].charge)) {
              const c = partCenter(pos, p);
              expect(
                casts.some(e => Math.abs(e.center.x - c.x) < 1e-9 && Math.abs(e.center.y - c.y) < 1e-9 && JSON.stringify(e.area) === JSON.stringify(p.area)),
                `${label}: a skillCast for part at ${JSON.stringify(c)}`,
              ).toBe(true);
            }
            const count = new Map<number, number>();
            const add = (evs: GameEvent[]) => {
              for (const ev of evs) if (ev.type === 'damage' && ev.targetTeam === 'enemy' && ev.amount > 0) count.set(ev.targetId, (count.get(ev.targetId) ?? 0) + 1);
            };
            add(first);
            for (let i = 0; i < Math.round(window * 30); i++) {
              for (const e of enemies) e.statuses.length = 0;
              for (const e of boss) e.statuses.length = 0;
              advance(tg, 1 / 30);
              add(tg.events.splice(0));
            }
            // 기획 13차: multi-beat skills hit a unit several times (volleys, zones) — every previewed unit is hit, nothing else
            expect(sortedKeys(count), label).toEqual(sortedKeys(want));
          }
        }
      });
    }
  }
});

describe('R27 ally parts (bard band, paladin circle, cleric spring) touch exactly the previewed allies, edges included', () => {
  const allyChars: [string, (e: SimEntity, healed: Set<number>) => boolean][] = [
    ['bard', e => e.statuses.some(s => s.id === 'haste')],
    ['paladin', e => e.statuses.some(s => s.id === 'defUp')],
    ['cleric', (e, healed) => healed.has(e.id)],
  ];
  for (const [id, touched] of allyChars) {
    it(id, () => {
      for (const stacks of RADIUS_STACKS) {
        for (const raw of DROPS) {
          const tg = makeGame({ players: [{ ...HUMAN, characters: [id === 'cleric' ? 'guardian' : 'cleric', id, 'mage'] }] });
          quietFloor(tg);
          const s = tg.game.state;
          for (let i = 0; i < stacks; i++) s.players[0].rewards.push({ rewardId: 'dragrad_epic', partyIndex: 1 });
          const a = s.plan.arena;
          const turrets: SimEntity[] = [];
          for (let x = 0.5; x <= a.width - 0.5 + 1e-9; x += 0.85) {
            for (let y = 0.5; y <= a.height - 0.5 + 1e-9; y += 0.85) {
              const t = createUnit(tg.w, getMonster('turret'), { x, y }, 'ally', { kind: 'summon', ownerPlayer: 0, expiresIn: null, hpMult: 1, atkMult: 0 });
              t.rt.stationary = true;
              t.hp = t.maxHp * 0.5;
              turrets.push(t);
            }
          }
          const pos = tg.game.clampToArena(raw);
          const parts = tg.game.previewParts(0, 'swap', 1);
          const want = new Set(expectedHits(parts, pos, turrets, 'allies').keys());
          clearEvents(tg);
          expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: raw }).ok).toBe(true);
          // 기획 13차: the bard's side bands land at 0.3 s (the cleric's parts are instant; its 1 %/s aura would add heals)
          if (id === 'bard') advance(tg, 0.5);
          const healed = new Set([...tg.game.drainEvents(), ...tg.events.splice(0)].flatMap(e => (e.type === 'heal' ? [e.targetId] : [])));
          const got = new Set(turrets.filter(t => touched(t, healed)).map(t => t.id));
          expect([...got].sort((x, y) => x - y), `${id} r+${stacks * 50}% ${JSON.stringify(raw)}`).toEqual([...want].sort((x, y) => x - y));
          // the drawn parts (render) are the same footprint
          const drawn = previewDrawParts({ pos, area: parts[0].area, parts });
          expect(drawn.every(d => d.allies || d.enemies)).toBe(true);
        }
      }
    });
  }
});

describe('knockback / pull near walls', () => {
  it('gunner shoved against the left wall: knocked-back units stay inside the arena (no one leaves the field)', () => {
    const tg = setup('gunner', 1, 2);
    const ms = [0.6, 1.2, 2, 3].map(x => {
      const m = spawnAt(tg, 'golem', { x, y: 6 });
      m.hp = m.maxHp = m.rt.base.maxHp = 1e9;
      return m;
    });
    tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { x: 4, y: 6 } });
    advance(tg, 1); // 기획 13차: two blasts and the slug (0.15 / 0.45 / 0.85 s)
    for (const m of ms) {
      expect(m.pos.x).toBeGreaterThanOrEqual(m.radius - 1e-9);
      expect(m.hp).toBeLessThan(1e9);
    }
  });
});

describe('delayed parts land at the drop point even after the caster left the field', () => {
  for (const id of ['mage', 'shadow']) {
    it(id, () => {
      const tg = makeGame({ players: [{ ...HUMAN, characters: ['guardian', id, 'cleric'] }], tunables: { appearLockTime: 0, swapCooldownMult: 0 } });
      quietFloor(tg);
      const enemies = enemyGrid(tg);
      const drop = { x: 15, y: 6 };
      const parts = tg.game.previewParts(0, 'swap', 1);
      const want = expectedHits(parts, drop, enemies, 'enemies');
      clearEvents(tg);
      tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: drop });
      active(tg).rt.base.atk = 0;
      const count = new Map<number, number>();
      const add = (evs: GameEvent[]) => {
        for (const ev of evs) if (ev.type === 'damage' && ev.targetTeam === 'enemy' && ev.amount > 0) count.set(ev.targetId, (count.get(ev.targetId) ?? 0) + 1);
      };
      add(tg.game.drainEvents());
      advance(tg, 2 / 30);
      add(tg.events.splice(0));
      // caster leaves right after the first part: cleric comes in far away (its parts are ally-only)
      expect(tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 2, pos: { x: 30, y: 2 } }).ok).toBe(true);
      active(tg).rt.base.atk = 0;
      add(tg.game.drainEvents());
      for (let i = 0; i < 40; i++) {
        for (const e of enemies) e.statuses.length = 0;
        advance(tg, 1 / 30);
        add(tg.events.splice(0));
      }
      expect(Object.fromEntries(count)).toEqual(Object.fromEntries(want));
    });
  }
});

describe('echo_seal: second pass = same footprint (radius rewards included), telegraphed where it lands', () => {
  for (const def of CHARACTERS.filter(c => c.drag.actions.some(a => a.affects === 'enemies'))) {
    it(def.id, () => {
      const tg = setup(def.id, 1, 1);
      tg.game.state.players[0].relics.push('echo_seal');
      const enemies = enemyGrid(tg);
      const drop = tg.game.clampToArena({ x: 34.8, y: 1 });
      const parts = tg.game.previewParts(0, 'swap', 1);
      const partActions = def.drag.actions.filter(a => a.center !== 'woundedAlly');
      const window = watchWindow(def.drag.actions);
      const want = expectedHits(parts, drop, enemies, 'enemies', damagingWithin(partActions, window));
      clearEvents(tg);
      tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: drop });
      active(tg).rt.base.atk = 0;
      const echoTgs = tg.game.state.telegraphs.filter(t => Math.abs(t.total - 1) < 1e-9);
      for (const p of parts.filter(q => q.affects === 'enemies')) {
        const c = partCenter(drop, p);
        expect(echoTgs.some(t => t.center.x === c.x && t.center.y === c.y && JSON.stringify(t.area) === JSON.stringify(p.area)), `${def.id} echo telegraph`).toBe(true);
      }
      const count = new Map<number, number>();
      const add = (evs: GameEvent[]) => {
        for (const ev of evs) if (ev.type === 'damage' && ev.targetTeam === 'enemy' && ev.amount > 0) count.set(ev.targetId, (count.get(ev.targetId) ?? 0) + 1);
      };
      add(tg.game.drainEvents());
      // the echo comes 1 s later: watch the window again after it
      for (let i = 0; i < Math.round((window + 1) * 30); i++) {
        for (const e of enemies) e.statuses.length = 0;
        advance(tg, 1 / 30);
        add(tg.events.splice(0));
      }
      // same footprint twice: the same units, each hit at least as often as one pass would (×2 for the instant parts)
      expect(sortedKeys(count)).toEqual(sortedKeys(want));
      const firstPart = parts.findIndex((p, i) => p.affects === 'enemies' && p.delay === 0 && !partActions[i].charge && partActions[i].effects.some(e => e.kind === 'damage'));
      if (firstPart >= 0) {
        const once = expectedHits([parts[firstPart]], drop, enemies, 'enemies');
        for (const id of once.keys()) expect(count.get(id) ?? 0, `${def.id} unit ${id}`).toBeGreaterThanOrEqual(2);
      }
    });
  }
});

// FINDING (Low, cosmetic) — fixed: src/sim/players.ts doSwap's echo_seal telegraph loop telegraphed the self-only
// parts too (가디언/워든 보호막 'single', 크로노 쿨 감소 'single'): a stray ally circle the drag preview never showed.
// The loop now skips `part.affects === 'self'`.
describe('echo_seal telegraphs = the drawn drag preview (no extra self-only circles)', () => {
  for (const id of ['guardian', 'warden', 'chrono']) {
    it(`${id}: echo telegraphs exactly the drawn parts (no self-only part)`, () => {
      const tg = setup(id, 1, 0);
      tg.game.state.players[0].relics.push('echo_seal');
      const drop = { x: 15, y: 6 };
      const parts = tg.game.previewParts(0, 'swap', 1);
      tg.game.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: drop });
      const echoTgs = tg.game.state.telegraphs.filter(t => Math.abs(t.total - 1) < 1e-9);
      const drawn = previewDrawParts({ pos: drop, area: parts[0].area, parts });
      expect(echoTgs.length).toBe(drawn.length);
    });
  }
});

describe('non-circle persistent zones (Zone.area) tick exactly on their footprint and survive the snapshot', () => {
  const shapes: AreaShape[] = [
    { shape: 'ring', inner: 1.5, outer: 3.5 },
    { shape: 'cross', length: 3, width: 1 },
    { shape: 'cross', diagonal: true, length: 3, width: 1 },
    { shape: 'cone', dir: 'up', radius: 4, angle: 90 },
    { shape: 'rect', dir: 'left', anchor: 'center', length: 8, width: 1.5 },
  ];
  for (const area of shapes) {
    it(JSON.stringify(area), () => {
      const tg = setup('ranger', 1, 0);
      const caster = active(tg);
      const enemies = enemyGrid(tg);
      const ctx = charCtx(tg.w, caster, 'drag', { id: 'review_zone', name: '리뷰' });
      ctx.point = { x: 18, y: 6 };
      ctx.radiusMult = 1.5; // rewards scale zones too
      const action: SkillAction = { center: 'point', area, affects: 'enemies', effects: [{ kind: 'damage', amount: 0.01 }], zone: { duration: 1.6, tickInterval: 0.5 } };
      clearEvents(tg);
      castSkill(tg.w, ctx, [action]);
      const z = tg.game.state.zones[0];
      const scaled = z.area!;
      expect(z.radius).toBeCloseTo(areaExtent(scaled));
      const wire = cleanState(tg.game.state).zones[0];
      expect(wire.area?.shape).toBe(area.shape);
      const count = new Map<number, number>();
      const add = (evs: GameEvent[]) => {
        for (const ev of evs) if (ev.type === 'damage' && ev.targetTeam === 'enemy' && ev.amount > 0) count.set(ev.targetId, (count.get(ev.targetId) ?? 0) + 1);
      };
      add(tg.game.drainEvents());
      caster.rt.base.atk = 0; // the zone ctx keeps its own atk snapshot; the caster's basic attacks must not count
      tg.game.state.players[0].party[0].normalCooldownRemaining = 999;
      for (let i = 0; i < 60; i++) {
        advance(tg, 1 / 30);
        add(tg.events.splice(0).filter(e => e.type === 'damage'));
      }
      const hitIds = new Set(enemies.filter(e => hitsArea(scaled, z.center, z.center, e.pos, e.radius)).map(e => e.id));
      expect(hitIds.size).toBeGreaterThan(3);
      for (const e of enemies) {
        const n = count.get(e.id) ?? 0;
        if (hitIds.has(e.id)) expect(n, `inside ${e.pos.x},${e.pos.y}`).toBe(4); // t = 0, .5, 1, 1.5
        else expect(n, `outside ${e.pos.x},${e.pos.y}`).toBe(0);
      }
    });
  }
});
