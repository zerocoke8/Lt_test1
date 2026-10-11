// 기획 19차 보스 레이드 — the boss art registry (src/render/bosses): every boss with data draws through drawBossArt in
// every pose (phase 1–3, enraged, wind-up, groggy 0 / 0.5 / 1 / standing up, retreating) for 30 frames each without
// throwing, without shadowBlur / gradients; a registered look stays inside the budget (≤ 360 canvas calls a frame,
// ≤ 2 texts, finite numbers) and keeps its face out of the HUD boss box. Plus the pieces around it: the kit parts, the
// warning motifs, the self-cast ring of the renderer (rule M1) and the character slide (rule M3).
import { describe, expect, it } from 'vitest';
import { BOSSES, RAID_BOSS_IDS } from '../../src/data';
import { createRenderer } from '../../src/render';
import { type BossDrawOpts, drawBossArt } from '../../src/render/boss';
import { BOSS_LOOKS, BOSS_TELE_MOTIF, MINION_LOOKS, bossLook } from '../../src/render/bosses';
import * as kit from '../../src/render/bosses/kit';
import { drawTeleMotif } from '../../src/render/bosses/teleMotif';
import { Camera } from '../../src/render/camera';
import { TeleSequencer } from '../../src/render/teleseq';
import { newMemo, syncMemo } from '../../src/render/units';
import { cleanState } from '../../server/snapshot';
import { unitCtx } from '../../src/sim/ctx';
import { startAction } from '../../src/sim/skills';
import type { AreaShape, Entity, GameEvent, Telegraph } from '../../src/types';
import { advance } from '../sim/helpers';
import { bossOf, raidGame } from '../sim/bossRaidHelpers';

interface Rec {
  ctx: CanvasRenderingContext2D;
  /** method name → calls since the last reset */
  calls: Map<string, number>;
  total: number;
  texts: string[];
  sets: Set<string>;
  strokes: Set<string>;
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
    strokes: new Set(),
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
      const name = String(prop);
      rec.sets.add(name);
      if (name === 'strokeStyle') rec.strokes.add(String(value));
      if (typeof value === 'number' && !Number.isFinite(value)) rec.bad.push(`${name}=${value}`);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return rec;
}

const BASE: BossDrawOpts = { color: '#888888', time: 0, enraged: false, flash: 0, retreat: 0, lookX: 8, lookY: 7, charge: 0, shake: 0, phase: 1, phaseFlash: 0, groggy: 0, groggyWake: 0, groggyNear: 0 };

const POSES: Record<string, Partial<BossDrawOpts>> = {
  'phase 1': {},
  'phase 2': { phase: 2 },
  'phase 3': { phase: 3 },
  'phase flash': { phase: 2, phaseFlash: 0.8 },
  enraged: { enraged: true, shake: 0.6 },
  'wind-up': { charge: 0.8 },
  attack: { flash: 1, charge: 1 },
  'no target': { lookX: null, lookY: null },
  'groggy near': { groggyNear: 2 },
  'groggy 0.5': { groggy: 0.5 },
  'groggy 1': { groggy: 1 },
  'groggy 1, phase 2, enraged': { groggy: 1, phase: 2, enraged: true },
  'standing up': { groggy: 0.4, groggyWake: 0.5 },
  retreating: { retreat: 0.5 },
  gone: { retreat: 1 },
};

const FRAMES = 30;
const MAX_CALLS = 360;
const MAX_TEXTS = 2;

describe('every boss draws in every pose', () => {
  const cam = new Camera();
  cam.setArena(24, 12);
  // bosses with data, plus looks that landed before their data
  const ids = [...new Set([...BOSSES.map(b => b.id), ...Object.keys(BOSS_LOOKS)])];

  it('covers the classic four and whatever is registered', () => {
    expect(ids.length).toBeGreaterThanOrEqual(4);
    for (const id of ids) expect(RAID_BOSS_IDS).toContain(id);
  });

  for (const id of ids) {
    it(`${id}: ${Object.keys(POSES).length} poses × ${FRAMES} frames — no throw, no shadowBlur / gradient, finite numbers`, () => {
      const rec = recorder();
      for (const [name, pose] of Object.entries(POSES)) {
        for (let f = 0; f < FRAMES; f++) {
          const o: BossDrawOpts = { ...BASE, ...pose, time: 3.7 + f / 30 + name.length };
          expect(() => drawBossArt(rec.ctx, cam, id, 12, -1.2, 3, o), `${id} ${name}`).not.toThrow();
        }
      }
      expect(rec.sets.has('shadowBlur'), 'shadowBlur').toBe(false);
      // (the classic doors use gradients; new looks may not — checked with the budget below)
      expect(rec.bad.slice(0, 5)).toEqual([]);
    });

    const look = bossLook(id);
    if (!look) continue;
    it(`${id}: its look stays inside the budget (≤ ${MAX_CALLS} calls and ≤ ${MAX_TEXTS} texts a frame, props included)`, () => {
      const rec = recorder();
      let gradients = 0;
      for (const [name, pose] of Object.entries(POSES)) {
        for (let f = 0; f < FRAMES; f++) {
          const o: BossDrawOpts = { ...BASE, ...pose, time: 11.3 + f / 30 };
          gradients += (rec.calls.get('createLinearGradient') ?? 0) + (rec.calls.get('createRadialGradient') ?? 0);
          rec.reset();
          look.draw(rec.ctx, cam, 12, -1.2, 3, o);
          if (o.groggy > 0) look.props?.(rec.ctx, cam, 12, -1.2, 3, o);
          expect(rec.total, `${id} ${name} frame ${f}: canvas calls`).toBeLessThanOrEqual(MAX_CALLS);
          expect(rec.texts.length, `${id} ${name} frame ${f}: texts`).toBeLessThanOrEqual(MAX_TEXTS);
          if (o.retreat >= 1) expect(rec.calls.get('fill') ?? 0, `${id} draws nothing once gone`).toBe(0);
        }
      }
      gradients += (rec.calls.get('createLinearGradient') ?? 0) + (rec.calls.get('createRadialGradient') ?? 0);
      expect(gradients, `${id}: no gradients`).toBe(0);
      // where the groggy stars circle: on screen, under the HUD boss box
      const by = cam.sy(-1.2) + kit.BOSS_DROP;
      for (const g of [0, 0.5, 1]) {
        const y = look.headY ? look.headY(by, 3 * 53.33, g) : by;
        expect(y, `${id} headY`).toBeGreaterThan(60);
        expect(y, `${id} headY`).toBeLessThan(330);
      }
    });
  }

  it('an id without a look falls back to the watcher (a boss can exist before its art)', () => {
    const rec = recorder();
    expect(() => drawBossArt(rec.ctx, cam, 'not_yet_drawn', 12, -1.2, 3, { ...BASE, time: 1 })).not.toThrow();
    expect(rec.total).toBeGreaterThan(50);
  });

  it('summon looks draw in both facings, idle and attacking', () => {
    const rec = recorder();
    for (const [key, draw] of Object.entries(MINION_LOOKS)) {
      for (const s of [-1, 1]) for (const act of [0, 1]) for (const flash of [false, true]) draw(rec.ctx, '#cccccc', flash, 300, 400, 40, 48, s, 2.5, 0.7, act);
      expect(rec.sets.has('shadowBlur'), key).toBe(false);
    }
    expect(rec.bad).toEqual([]);
  });
});

describe('kit parts', () => {
  const cam = new Camera();
  it('anchor / lookDir reuse one object each (nothing allocated per frame) and follow shake, retreat and the target', () => {
    const a1 = kit.anchor(cam, 12, -1.2, { ...BASE });
    const cy = a1.cy;
    expect(a1.cx).toBeCloseTo(640, 6);
    expect(cy).toBeCloseTo(cam.sy(-1.2) + kit.BOSS_DROP, 6);
    const a2 = kit.anchor(cam, 12, -1.2, { ...BASE, retreat: 0.5 });
    expect(a2).toBe(a1);
    expect(a2.cy).toBeCloseTo(cy - 130, 6);
    expect(a2.alpha).toBe(0.5);
    const l1 = kit.lookDir(cam, 640, 200, { ...BASE, lookX: 12, lookY: 10 });
    expect(l1.lx).toBeCloseTo(0, 6);
    expect(l1.ly).toBeCloseTo(1, 6);
    expect(kit.lookDir(cam, 640, 200, { ...BASE, lookX: null, lookY: null })).toBe(l1);
    expect(l1.ly).toBe(0.3);
  });

  it('every part draws with finite numbers; blink / strobe / swayAngle are pure functions of time', () => {
    const rec = recorder();
    const c = rec.ctx;
    const o = { ...BASE, time: 2.2, enraged: true, flash: 0.5, phase: 2 };
    kit.enrageHaze(c, 640, 200, 180, 100, o, 1);
    kit.enrageHaze(c, 640, 200, 180, 100, { ...BASE, charge: 0.5 }, 1);
    kit.glowEllipse(c, 640, 200, 60, 40, '#ffffff', 0.5);
    kit.wash(c, 1, o);
    kit.bigEye(c, 640, 180, 26, 0.2, 0.4, true, 1, 0.6);
    kit.bigEye(c, 640, 180, 26, 0, 0, false, 1, 0);
    kit.smallEye(c, 600, 180, 8, 0.2, 0.4, 1, '#ff5d5d');
    kit.dizzySwirl(c, 640, 180, 20, 14, 2.2, 1);
    kit.hand(c, 500, 220, -1, 18, 2.2);
    kit.hand(c, 780, 220, 1, 18, 2.2, '#ead0d0', 1);
    for (const item of ['stamp', 'paper', 'mug', 'phone', 'pen', 'folder'] as const) kit.heldItem(c, item, 640, 300, 1, 2.2);
    kit.limb(c, 500, 150, 560, 260, 20, 10, '#888888');
    kit.plaque(c, 640, 260, 92, 30, '고장', '#ffd60a', '#1b1b1b', 1, 0.1);
    kit.dripRow(c, 560, 200, 160, 6, 60, 2.2, '#8ecae6', 0.8);
    kit.spikes(c, 560, 200, 160, 9, 14, '#f8f9fa');
    kit.cracks(c, 640, 200, 60, 5, 3, '#ffffff', 0.8);
    kit.stack(c, 760, 300, 22, 8, 5, '#ffffff', '#333333', 1);
    expect(rec.bad).toEqual([]);
    expect(rec.texts).toEqual(['고장']);
    expect(rec.sets.has('shadowBlur')).toBe(false);
    expect(kit.tinted('#8fb3c7', { ...BASE })).toBe('#8fb3c7');
    expect(kit.tinted('#8fb3c7', { ...BASE, phase: 2 })).not.toBe('#8fb3c7');
    for (const t of [0, 0.4, 3.3, 17.9]) {
      expect(kit.blink(t, 3)).toBe(kit.blink(t, 3));
      expect(kit.blink(t, 3)).toBeGreaterThanOrEqual(0);
      expect(kit.blink(t, 3)).toBeLessThanOrEqual(1);
      expect(kit.eyeOpen(t, 1)).toBeGreaterThanOrEqual(0.08);
      expect([0, 1]).toContain(kit.strobe(t, 12, 5));
      expect(Math.abs(kit.swayAngle(t, 2, 0.3, 1))).toBeLessThanOrEqual(0.3);
    }
  });
});

describe('warning motifs', () => {
  const cam = new Camera();
  const tele = (area: AreaShape, x = 12, y = 6): Telegraph => ({ id: 9, team: 'enemy', center: { x, y }, origin: { x: 12, y: -1.2 }, area, remaining: 0.8, total: 1.4 });
  const areas: AreaShape[] = [
    { shape: 'circle', radius: 2.4 },
    { shape: 'ring', inner: 1.6, outer: 4.5 },
    { shape: 'ring', inner: 8, outer: 12 },
    { shape: 'rect', dir: 'right', length: 24, width: 2.5 },
    { shape: 'rect', dir: 'down', length: 13, width: 2 },
    { shape: 'fan', radius: 14, angle: 40 },
    { shape: 'cross', length: 5, width: 1.4, diagonal: true },
    { shape: 'single' },
  ];

  it('each motif draws on every footprint shape, strong and as a later part, and restores the context', () => {
    const rec = recorder();
    for (const motif of ['pull', 'push', 'linger', 'spawn'] as const) {
      for (const area of areas) {
        for (const later of [false, true]) {
          const before = rec.total;
          drawTeleMotif(rec.ctx, cam, tele(area), area, motif, 'syn_skill', 1.3, later);
          expect(rec.total, `${motif} on ${area.shape}`).toBeGreaterThan(before);
          expect((rec.ctx as unknown as { globalAlpha: number }).globalAlpha).toBe(1);
        }
      }
    }
    expect(rec.calls.get('save') ?? 0).toBe(rec.calls.get('restore') ?? 0);
    expect(rec.bad).toEqual([]);
    expect(rec.sets.has('shadowBlur')).toBe(false);
  });

  it('no classic skill has a motif row (their warnings are drawn as before)', () => {
    for (const id of Object.keys(BOSS_TELE_MOTIF)) expect(/^(ek|ol|sd|boss)_/.test(id), id).toBe(false);
  });

  it('TeleSequencer.skillOf: a warning knows its skill from the cast of the frame it appeared; unknown otherwise', () => {
    const seq = new TeleSequencer();
    const cast = (skillId: string, x: number, shape: AreaShape): GameEvent => ({ type: 'skillCast', sourceId: 50, player: null, slot: 'monster', skillId, name: '시험', center: { x, y: 6 }, area: shape, team: 'enemy', delay: 1.2 });
    const a = { ...tele({ shape: 'ring', inner: 1.6, outer: 4.5 }, 10), id: 1 };
    const b = { ...tele({ shape: 'circle', radius: 1.8 }, 10), id: 2 };
    const late = { ...tele({ shape: 'single' }, 4), id: 3 };
    seq.noteEvent(cast('cm_grab', 10, a.area));
    seq.noteEvent(cast('cm_grab', 10, b.area));
    seq.track([a, b]);
    expect(seq.skillOf(a)).toBe('cm_grab');
    expect(seq.skillOf(b)).toBe('cm_grab');
    seq.track([a, b, late]); // came up later than its cast (telegraphLead): no skill
    expect(seq.skillOf(late)).toBeUndefined();
    expect(seq.skillOf(a)).toBe('cm_grab');
    seq.reset();
    expect(seq.skillOf(a)).toBeUndefined();
  });
});

describe('the renderer with the new rules', () => {
  function fakeCanvas(rec: Rec) {
    return { width: 300, height: 150, style: {}, getContext: () => rec.ctx } as unknown as HTMLCanvasElement;
  }

  it('M1: a boss self-cast telegraph is a yellow ring — the wire state draws without the red fill path', () => {
    const tg = raidGame('elevator_keeper', { hpMult: 100, tunables: { invincible: true } });
    advance(tg, 0.3);
    const b = bossOf(tg);
    startAction(tg.w, unitCtx(tg.w, b, 'syn_revive', '시험'), { center: 'self', area: { shape: 'circle', radius: 3.4 }, affects: 'self', delay: 2.5, effects: [{ kind: 'heal', amount: 0.06 }] });
    const state = cleanState(tg.w.state);
    expect(state.telegraphs).toHaveLength(1);
    expect(state.telegraphs[0].self).toBe(true);
    const rec = recorder();
    const r = createRenderer(fakeCanvas(rec));
    const ui = { localPlayer: 0, dragPreview: null, freezeCamera: false };
    r.render(state, tg.game.drainEvents(), 1 / 60, ui);
    rec.strokes.clear();
    r.render(state, [], 1 / 60, ui);
    expect(rec.strokes.has('#ffd60a')).toBe(true);
    expect(rec.strokes.has('#ff3b3b'), 'no red warning outline').toBe(false);
    expect(rec.bad).toEqual([]);
  });

  it('M3: a pulled or knocked-back character slides (0.2 s); walking, appearing and dashes do not', () => {
    const ch = (x: number, anim: Entity['anim'] = 'idle'): Entity => ({
      id: 7, kind: 'character', team: 'ally', defId: 'guardian', tier: 'character', pos: { x, y: 6 }, radius: 0.45, facing: 0, hp: 100, maxHp: 100, shield: 0,
      statuses: [], targetId: null, targetHeldFor: 0, ownerPlayer: 0, partyIndex: 0, anim, animTime: 0, invulnTime: 0, expiresIn: null, enraged: false,
    });
    const dt = 1 / 60;
    // a 2.5 pull in one frame
    let e = ch(15);
    const m = newMemo(e, 1);
    e = ch(12.5);
    syncMemo(m, e, 2, dt);
    expect(m.pullX).toBeGreaterThan(1.9);
    for (let i = 0; i < 14; i++) syncMemo(m, e, 3 + i, dt);
    expect(Math.abs(m.pullX)).toBeLessThan(0.3);
    for (let i = 0; i < 40; i++) syncMemo(m, e, 20 + i, dt);
    expect(m.pullX).toBe(0);
    // a 0.5 zone-tick pull slides too
    e = ch(12);
    syncMemo(m, e, 70, dt);
    expect(m.pullX).toBeCloseTo(0.5 * Math.exp(-14 * dt), 6);
    for (let i = 0; i < 60; i++) syncMemo(m, e, 71 + i, dt);
    // walking (5 units / s) never slides, at 60 and at 20 fps
    for (const step of [dt, 1 / 20]) {
      for (let i = 0; i < 20; i++) {
        e = ch(e.pos.x + 5 * step);
        syncMemo(m, e, 200 + i, step);
        expect(m.pullX).toBe(0);
      }
    }
    // a floor start re-places it with the appear pose: no slide; a dash (noLerp) neither
    e = ch(4, 'appear');
    syncMemo(m, e, 300, dt);
    expect(m.pullX).toBe(0);
    m.noLerp = true;
    e = ch(9);
    syncMemo(m, e, 301, dt);
    expect(m.pullX).toBe(0);
  });
});
