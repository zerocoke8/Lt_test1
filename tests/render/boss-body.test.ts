// 기획 20차 보스 형태 — the moving-boss draw path (src/render/bosses/body.ts · stage.ts · fieldMarks.ts and the renderer):
// every moving boss has a body (its look's, or the fallback blob) that draws every pose on both sides inside the budget
// (≤ 220 canvas calls, no text, no gradient / shadowBlur, finite numbers); the shared frame mirrors with hysteresis and
// walks a stride; a moving boss in a real raid frame is drawn by the body path while a fixed one keeps its set piece;
// and the telegraph extras of the new part kinds (charge, arrive, sweep, mark, safe ring) draw from a real fight.
import { describe, expect, it } from 'vitest';
import { cleanState } from '../../server/snapshot';
import { BOSSES, getBoss } from '../../src/data';
import { chargeAt, relocateTo, safeRing, spokes } from '../../src/data/bosses';
import { createRenderer } from '../../src/render';
import type { BossDrawOpts } from '../../src/render/boss';
import { BOSS_ZONE_LOOKS, bossLook } from '../../src/render/bosses';
import { asSetPiece, bodyBox, bossBody, bossFormOf, drawBossBody, drawBossBodyGround, drawBossOverhead, isMovingBoss, newBodyAnim, pickPose, stepBodyAnim } from '../../src/render/bosses/body';
import { drawArriveMotif, drawChargeMotif, drawMarkBadge, drawSafeVeil, drawXrayGhost } from '../../src/render/bosses/fieldMarks';
import { BossStage } from '../../src/render/bosses/stage';
import type { BossPose } from '../../src/render/bosses/types';
import { Camera } from '../../src/render/camera';
import { unitCtx } from '../../src/sim/ctx';
import { startAction } from '../../src/sim/skills';
import type { GameEvent, RenderUiState, SkillAction, Telegraph } from '../../src/types';
import { active, advance } from '../sim/helpers';
import { bossOf, raidGame } from '../sim/bossRaidHelpers';

interface Rec {
  ctx: CanvasRenderingContext2D;
  calls: Map<string, number>;
  total: number;
  texts: string[];
  sets: Set<string>;
  bad: string[];
  reset(): void;
}

/** A recording 2D context: counts calls, remembers what was set, flags non-finite numbers. */
function recorder(): Rec {
  const store: Record<string | symbol, unknown> = {};
  const rec: Rec = {
    ctx: null as unknown as CanvasRenderingContext2D,
    calls: new Map(),
    total: 0,
    texts: [],
    sets: new Set(),
    bad: [],
    reset() {
      this.calls.clear();
      this.total = 0;
      this.texts.length = 0;
    },
  };
  rec.ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const name = String(prop);
      if (name === 'measureText') return (t: string) => ({ width: t.length * 10 });
      return (...args: unknown[]) => {
        rec.calls.set(name, (rec.calls.get(name) ?? 0) + 1);
        rec.total++;
        if (name === 'fillText' || name === 'strokeText') rec.texts.push(String(args[0]));
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) rec.bad.push(`${name}(${args.join(',')})`);
        return name === 'createLinearGradient' || name === 'createRadialGradient' ? { addColorStop() {} } : undefined;
      };
    },
    set(target, prop, value) {
      rec.sets.add(String(prop));
      if (typeof value === 'number' && !Number.isFinite(value)) rec.bad.push(`${String(prop)}=${value}`);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return rec;
}

const BASE: BossDrawOpts = { color: '#888888', time: 0, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };
const POSES: BossPose[] = ['idle', 'walk', 'windup', 'attack', 'groggy'];
const MOVING = BOSSES.filter(b => (b.form ?? 'fixed') !== 'fixed').map(b => b.id);
const FIXED = BOSSES.filter(b => (b.form ?? 'fixed') === 'fixed').map(b => b.id);
/** Canvas calls one frame of one body may make (docs/bosses.md 5-1), plus the shared frame around it. */
const BODY_BUDGET = 220;
const FRAME_BUDGET = 40;

function cam(): Camera {
  const c = new Camera();
  c.setArena(24, 12);
  c.snap(null);
  return c;
}

describe('which bosses are bodies', () => {
  it('bossFormOf / isMovingBoss follow the data: 14 moving, 6 fixed; unknown ids and monsters are fixed', () => {
    expect(MOVING).toHaveLength(14);
    expect(FIXED).toHaveLength(6);
    for (const id of MOVING) expect(isMovingBoss(id), id).toBe(true);
    for (const id of FIXED) expect(isMovingBoss(id), id).toBe(false);
    expect(bossFormOf('goblin')).toBe('fixed');
    expect(bossFormOf('no_such_boss')).toBe('fixed');
    expect(bossFormOf('toString')).toBe('fixed');
  });

  it('every moving boss has a body sized like its hit circle (the fallback blob until its zone file draws one)', () => {
    for (const id of MOVING) {
      const def = getBoss(id);
      const body = bossBody(id);
      expect(typeof body.draw, id).toBe('function');
      // about the hit circle wide (a low or thin body may differ), never taller than 3.6 cells
      expect(body.w, `${id} width`).toBeGreaterThanOrEqual(def.radius * 0.9);
      expect(body.w, `${id} width`).toBeLessThanOrEqual(def.radius * 2.6);
      expect(body.h, `${id} height`).toBeGreaterThan(0.5);
      expect(body.h, `${id} height`).toBeLessThanOrEqual(3.6);
      expect(bodyBox(id).w).toBeGreaterThan(40);
      const look = bossLook(id);
      if (look?.body) expect(bossBody(id), `${id}: the look's body is used`).toBe(look.body);
    }
  });
});

describe('a body draws every pose on both sides inside the budget', () => {
  it.each(MOVING)('%s: 5 poses × 2 sides × calm / enraged / phase 2 — ≤ 220 calls, no text, no gradient, finite numbers', id => {
    const rec = recorder();
    const c = cam();
    const def = getBoss(id);
    const body = bossBody(id);
    let frames = 0;
    for (const pose of POSES) {
      for (const facing of [0, Math.PI]) {
        for (const extra of [{}, { enraged: true }, { phase: 2, flash: 1, phaseFlash: 1 }] as Partial<BossDrawOpts>[]) {
          const a = newBodyAnim(12, 6, facing);
          for (let f = 0; f < 12; f++) {
            rec.reset();
            const o: BossDrawOpts = { ...BASE, color: def.color, time: f * 0.11, ...extra, groggy: pose === 'groggy' ? Math.min(1, f / 6) : 0 };
            stepBodyAnim(a, 12 + f * 0.05 * Math.cos(facing), 6, facing, 1 / 30);
            drawBossBody(rec.ctx, c, a, { defId: id, x: 12 + f * 0.05 * Math.cos(facing), y: 6, facing, pose, p: f / 11, rise: 1 }, o);
            expect(a.side).toBe(facing === 0 ? 1 : -1);
            expect(rec.total, `${id} ${pose} frame ${f}`).toBeLessThanOrEqual(BODY_BUDGET + FRAME_BUDGET);
            expect(rec.total).toBeGreaterThan(4);
            expect(rec.texts, `${id}: no text on a body (it would mirror)`).toEqual([]);
            frames++;
          }
        }
      }
    }
    expect(frames).toBe(5 * 2 * 3 * 12);
    expect(rec.bad).toEqual([]);
    expect(rec.sets.has('shadowBlur')).toBe(false);
    expect(rec.calls.has('createLinearGradient') || rec.calls.has('createRadialGradient')).toBe(false);
    // the body's own draw alone, in its box
    rec.reset();
    body.draw(rec.ctx, { fx: 400, fy: 400, w: body.w * 53, h: body.h * 53, s: 1, pose: 'windup', p: 0.5, stride: 0.3, time: 1, facing: 0 }, { ...BASE, color: def.color });
    expect(rec.total).toBeLessThanOrEqual(BODY_BUDGET);
  });

  it.each(MOVING)('%s: rising in, sinking away (retreat) and the ground ring / ▼ draw without a throw', id => {
    const rec = recorder();
    const c = cam();
    const a = newBodyAnim(12, 6, 0);
    for (const rise of [0, 0.3, 1]) drawBossBody(rec.ctx, c, a, { defId: id, x: 12, y: 6, facing: 0, pose: 'idle', p: 0, rise }, { ...BASE, color: getBoss(id).color });
    for (const retreat of [0.2, 0.6, 0.99]) drawBossBody(rec.ctx, c, a, { defId: id, x: 12, y: 6, facing: 0, pose: 'idle', p: 0, rise: 1 }, { ...BASE, retreat });
    rec.reset();
    drawBossBody(rec.ctx, c, a, { defId: id, x: 12, y: 6, facing: 0, pose: 'idle', p: 0, rise: 1 }, { ...BASE, retreat: 1 });
    expect(rec.total, 'fully retreated: nothing is drawn').toBe(0);
    drawBossBodyGround(rec.ctx, c, id, 12, 6, getBoss(id).radius, 0.7, 1, 2);
    drawBossOverhead(rec.ctx, c, id, 12, 6, true, 1, 1);
    drawBossOverhead(rec.ctx, c, id, 12, 6, false, 1, 1);
    expect(rec.total).toBeGreaterThan(5);
    expect(rec.total).toBeLessThanOrEqual(60);
    expect(rec.bad).toEqual([]);
    expect(rec.texts).toEqual([]);
  });

  it('asSetPiece(body) is a BossLook.draw: it draws the body for the sheet tools (idle, wind-up, groggy), nothing when retreated', () => {
    const rec = recorder();
    const c = cam();
    const draw = asSetPiece(bossBody('washer_drum'));
    for (const o of [{}, { charge: 1 }, { groggy: 1 }, { enraged: true, phase: 2 }] as Partial<BossDrawOpts>[]) {
      rec.reset();
      draw(rec.ctx, c, 12, 6.5, 1.6, { ...BASE, ...o });
      expect(rec.total).toBeGreaterThan(4);
      rec.reset();
      draw(rec.ctx, c, 12, -1.2, 3, { ...BASE, ...o }); // the old set-piece spot still works
      expect(rec.total).toBeGreaterThan(4);
    }
    rec.reset();
    draw(rec.ctx, c, 12, 6.5, 1.6, { ...BASE, retreat: 1 });
    expect(rec.total).toBe(0);
    expect(rec.bad).toEqual([]);
  });
});

describe('the shared frame', () => {
  it('pickPose: groggy wins, then cast → windup, attack, move → walk, else idle', () => {
    expect(pickPose('cast', 0.5)).toBe('groggy');
    expect(pickPose('stunned', 0)).toBe('groggy');
    expect(pickPose('cast', 0)).toBe('windup');
    expect(pickPose('attack', 0)).toBe('attack');
    expect(pickPose('move', 0)).toBe('walk');
    expect(pickPose('idle', 0)).toBe('idle');
    expect(pickPose('appear', 0)).toBe('idle');
  });

  it('mirrors to the side it faces, not again within 0.25 s, and never while it faces almost straight up / down', () => {
    const a = newBodyAnim(12, 6, 0);
    expect(a.side).toBe(1);
    stepBodyAnim(a, 12, 6, Math.PI, 1 / 30);
    expect(a.side).toBe(-1);
    stepBodyAnim(a, 12, 6, 0, 1 / 30); // back at once: held
    expect(a.side).toBe(-1);
    for (let i = 0; i < 9; i++) stepBodyAnim(a, 12, 6, 0, 1 / 30);
    expect(a.side).toBe(1);
    for (let i = 0; i < 30; i++) stepBodyAnim(a, 12, 6, Math.PI / 2 + 0.05, 1 / 30); // facing down, a hair to the left
    expect(a.side).toBe(1);
  });

  it('the stride advances with the cells walked (one cycle per 1.3 cells); a jump (relocate, rush) is no stride but lights the ▼', () => {
    const a = newBodyAnim(12, 6, 0);
    for (let i = 1; i <= 13; i++) stepBodyAnim(a, 12 + i * 0.05, 6, 0, 1 / 30);
    expect(a.stride).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 90; i++) stepBodyAnim(a, 12.65, 6, 0, 1 / 30);
    expect(a.sinceArrive).toBeGreaterThan(3);
    const before = a.stride;
    stepBodyAnim(a, 20, 6, 0, 1 / 30);
    expect(a.stride).toBe(before);
    expect(a.sinceArrive).toBe(0);
  });
});

describe('stage, zone looks and field marks', () => {
  it('BossStage: seats of a relocating boss and the route of a patrol / path boss are drawn from the data; a classic boss has nothing', () => {
    const c = cam();
    for (const [id, want] of [['dead_monitor', true], ['coffee_machine', true], ['inverted_moon', true], ['elevator_keeper', false], ['abyss_watcher', false]] as const) {
      const rec = recorder();
      const st = new BossStage();
      st.ensure(id, 1, 24, 12, 1);
      expect(st.active, id).toBe(want || !!bossLook(id)?.stage);
      st.update(1);
      st.draw(rec.ctx, c, 24, 12, { ...BASE }, 0);
      if (want) expect(rec.total, id).toBeGreaterThan(3);
      else if (!bossLook(id)?.stage) expect(rec.total, id).toBe(0);
      expect(rec.bad).toEqual([]);
      expect(['dark', 'light']).toContain(st.tone);
    }
    const none = new BossStage();
    none.ensure(undefined, 1, 24, 12, 1);
    expect(none.active).toBe(false);
  });

  it('zone looks are colour rows; a stage look, when a zone file adds one, has a tone and a bake', () => {
    for (const [key, lk] of Object.entries(BOSS_ZONE_LOOKS)) {
      expect(lk.fill, key).toMatch(/^#[0-9a-f]{6}$/i);
      if (lk.edge != null) expect(lk.edge, key).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const b of BOSSES) {
      const st = bossLook(b.id)?.stage;
      if (!st) continue;
      expect(['dark', 'light']).toContain(st.tone);
      expect(typeof st.bake).toBe('function');
    }
  });

  it('the mark badge, the X-ray ghost and the three telegraph extras draw with finite numbers and no text', () => {
    const rec = recorder();
    const c = cam();
    const tele = (extra: Partial<Telegraph>): Telegraph => ({ id: 1, team: 'enemy', center: { x: 18, y: 6 }, origin: { x: 4, y: 6 }, area: { shape: 'line', length: 15, width: 3 }, remaining: 0.6, total: 1.3, ...extra });
    drawMarkBadge(rec.ctx, 400, 300, 0.7, 1);
    drawMarkBadge(rec.ctx, 400, 300, 0.1, 1);
    drawXrayGhost(rec.ctx, 400, 300, 48, 70, '#4cc9f0', 1);
    drawChargeMotif(rec.ctx, c, tele({ motif: 'charge' }), 1);
    drawArriveMotif(rec.ctx, c, tele({ motif: 'arrive', area: { shape: 'circle', radius: 3 } }), 1.7, 150, 140, 1);
    drawSafeVeil(rec.ctx, c, tele({ area: safeRing(3.2), center: { x: 5, y: 6 } }), 24, 12, 1);
    // 기획 20차 점검: the three rooftop veils (ink / moon / storm) — each its own picture, more calls than the plain one
    const plain = rec.total;
    for (const look of ['ink', 'moon', 'storm'] as const) {
      const before = rec.total;
      drawSafeVeil(rec.ctx, c, tele({ area: safeRing(3.2), center: { x: 5, y: 6 }, remaining: 0.2 }), 24, 12, 1.3, look);
      expect(rec.total - before, look).toBeGreaterThan(12);
    }
    expect(rec.total).toBeGreaterThan(plain);
    expect(rec.total).toBeGreaterThan(30);
    expect(rec.bad).toEqual([]);
    expect(rec.texts).toEqual([]);
  });
});

describe('the renderer draws a moving boss as a body, a fixed boss as its set piece', () => {
  const UI: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false } as RenderUiState;
  function fakeCanvas(rec: Rec): HTMLCanvasElement {
    return { width: 300, height: 150, style: {}, getContext: () => rec.ctx } as unknown as HTMLCanvasElement;
  }
  const HIT: SkillAction['effects'] = [{ kind: 'damage', amount: 1 }];

  it.each(['washer_drum', 'dead_monitor', 'inverted_moon', 'shredder_maw', 'karaoke_room', 'overtime_lord'])('%s: 60 frames of a real fight (wind-ups, hits, groggy, the kill and the retreat) render without a throw', id => {
    const tg = raidGame(id, { hpMult: 3, tunables: { invincible: true } });
    const rec = recorder();
    const r = createRenderer(fakeCanvas(rec));
    let events: GameEvent[] = tg.game.drainEvents();
    for (let f = 0; f < 60; f++) {
      if (f === 30) tg.game.dispatch({ type: 'debug', action: { kind: 'forceGroggy' } });
      advance(tg, 0.25);
      events = tg.events.splice(0);
      r.render(cleanState(tg.w.state), events, 1 / 30, UI);
    }
    expect(rec.bad).toEqual([]);
    expect(rec.sets.has('shadowBlur')).toBe(false);
  });

  it('every new warning kind in one frame: a rush, a seat to arrive on, a beam step, a mark and a safe ring — on the wire copy', () => {
    const tg = raidGame('endless_meeting', { hpMult: 50, tunables: { invincible: true, bossGroggyThreshold: 0 } });
    advance(tg, 1.2);
    const b = bossOf(tg);
    b.rt.skillCds = b.rt.skillCds.map(() => 9999);
    b.targetId = active(tg).id;
    const ctx = unitCtx(tg.w, b, 'syn_all', '시험');
    const parts: SkillAction[] = [
      relocateTo({ radius: 2.8, delay: 1.3, effects: HIT }),
      ...spokes({ pivot: { x: 12, y: 6 }, from: 0, step: 30, count: 3, arms: 1, length: 22, width: 1.8, first: 0.5, gap: 0.3, lead: 0.9, effects: HIT }),
      { center: 'target', area: { shape: 'single' }, affects: 'enemies', bound: true, delay: 3, effects: HIT },
      { center: 'arena', offset: { x: 5, y: 6 }, area: safeRing(3.2), affects: 'enemies', delay: 2.6, effects: HIT },
    ];
    for (const a of parts) startAction(tg.w, ctx, a);
    // a rush needs a body that can run: the same frame is drawn for a roaming boss below
    const run = raidGame('washer_drum', { hpMult: 50, tunables: { invincible: true, bossGroggyThreshold: 0 } });
    advance(run, 1.2);
    const rb = bossOf(run);
    rb.rt.skillCds = rb.rt.skillCds.map(() => 9999);
    rb.targetId = active(run).id;
    startAction(run.w, unitCtx(run.w, rb, 'syn_run', '시험'), chargeAt({ distance: 30, width: 3, delay: 1.3, effects: HIT, trail: { radius: 0.6, spacing: 1, duration: 5, tickInterval: 0.5, effects: HIT, look: 'graphite' } }));
    const kinds = new Set<string>();
    for (const g of [tg, run]) {
      const rec = recorder();
      const r = createRenderer(fakeCanvas(rec));
      for (let f = 0; f < 60; f++) {
        advance(g, 1 / 30);
        const wire = cleanState(g.w.state);
        for (const t of wire.telegraphs) kinds.add(t.motif ?? (t.mark != null ? 'mark' : t.area.shape));
        r.render(wire, g.events.splice(0), 1 / 30, UI);
      }
      expect(rec.bad).toEqual([]);
    }
    for (const k of ['charge', 'arrive', 'sweep', 'mark', 'ring']) expect(kinds.has(k), `a ${k} warning was on screen`).toBe(true);
    expect(run.w.state.zones.some(z => z.look === 'graphite')).toBe(true);
  });
});
