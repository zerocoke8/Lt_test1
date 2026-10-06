// 기획 13차 스킬 리뉴얼 연출: every renewed beat has its storyboard + Impact entry, the screen budget (2-2) holds, the cut-in
// timing matches the data (0.5 s, first hit at 0.45 s), other players never stop / shake my screen, styled warnings and
// zone decor bind, PullLerp slides, the head icons stop at two — and a real run of all 15 characters draws cleanly.
import { describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter } from '../../src/data';
import { DEFAULT_TUNABLES, ULT_CUTIN } from '../../src/config';
import { createGame } from '../../src/sim';
import { Camera } from '../../src/render/camera';
import { CUTIN, CUTIN_DIM, CUTIN_SEC, CUTIN_SHORT_SEC, MINI_BANNER_SEC } from '../../src/render/cutin';
import { IMPACT, impactOf, type ImpactSpec } from '../../src/render/impact';
import { FREEZE_MAX_SEC, JUICE_DEFAULTS } from '../../src/render/juice';
import { drawStyledTelegraph, drawZoneDecor } from '../../src/render/marks';
import { LAND, PREP, type StageHost, type StageInfo } from '../../src/render/stagefx';
import { SkillFx } from '../../src/render/skillfx';
import { MAX_HEAD_ICONS, StatusFx } from '../../src/render/statusfx';
import { PULL_MIN, newMemo, syncMemo, type UnitMemo } from '../../src/render/units';
import { Vfx } from '../../src/render/vfx';
import type { Entity, GameEvent, GameState, StatusId } from '../../src/types';

function fakeCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const gradient = { addColorStop() {} };
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 10 });
      if (prop === 'fillText') return (t: string) => texts.push(t);
      return () => undefined;
    },
    set(target, prop, value) {
      if ((prop === 'globalAlpha' || prop === 'lineWidth') && !Number.isFinite(value as number)) throw new Error(`${String(prop)}=${value}`);
      target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

/** Every `skillId:stage` of the 15 renewed drag skills and ults. */
function allStages(): { key: string; slot: 'drag' | 'ult'; id: string }[] {
  const out: { key: string; slot: 'drag' | 'ult'; id: string }[] = [];
  for (const c of CHARACTERS) {
    for (const [sk, slot] of [[c.drag, 'drag'], [c.ult, 'ult']] as const) {
      for (const a of sk.actions) {
        const key = `${sk.id}:${a.stage}`;
        if (a.stage && !out.some(o => o.key === key)) out.push({ key, slot, id: c.id });
      }
    }
  }
  return out;
}

describe('every renewed beat has its picture and its kick', () => {
  it('each stage has a LAND storyboard and an Impact entry (a missing one fails here)', () => {
    const stages = allStages();
    expect(stages.length).toBeGreaterThan(80);
    for (const s of stages) {
      expect(LAND[s.key], `LAND ${s.key}`).toBeTypeOf('function');
      expect(IMPACT[s.key], `IMPACT ${s.key}`).toBeDefined();
    }
    // nothing stale either: every table key is a real stage (or the paper dolls' burst)
    const keys = new Set(stages.map(s => s.key));
    for (const k of [...Object.keys(LAND), ...Object.keys(PREP), ...Object.keys(IMPACT)]) {
      expect(keys.has(k) || k.startsWith('paper_doll'), k).toBe(true);
    }
  });

  it('the 2-2 budget: drags — one stopping beat ≤ 90 ms, shake ≤ 7, no screen flash; ults — stop ≤ the single-freeze cap, finale flash 0.3–0.4', () => {
    for (const c of CHARACTERS) {
      const drag = [...new Set(c.drag.actions.map(a => `${c.drag.id}:${a.stage}`))].map(k => IMPACT[k]);
      expect(drag.filter(s => s.stop > 0).length, `${c.id} drag big beats`).toBe(1);
      for (const s of drag) {
        expect(s.stop).toBeLessThanOrEqual(90);
        expect(s.shake).toBeLessThanOrEqual(7);
        expect(s.screen ?? 0).toBe(0);
      }
      const ult = [...new Set(c.ult.actions.map(a => `${c.ult.id}:${a.stage}`))].map(k => IMPACT[k]);
      for (const s of ult) {
        expect(s.stop / 1000).toBeLessThanOrEqual(FREEZE_MAX_SEC);
        expect(s.shake).toBeLessThanOrEqual(10);
        if (s.screen) expect(s.screen).toBeGreaterThanOrEqual(0.3);
        expect(s.screen ?? 0).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it("multi-hit beats stop only on their big hit (blade storm ×8 shakes small; judgement's third ring is the big one)", () => {
    const out: ImpactSpec = { stop: 0, shake: 0, flash: 0 };
    expect(impactOf('bard_u:beat', 0, 3, 2, out)?.screen).toBe(0);
    expect(impactOf('bard_u:beat', 2, 3, 2, out)?.screen).toBeGreaterThan(0);
    expect(impactOf('cleric_u:judgement', 0, 1, 1, out)?.stop).toBe(0);
    expect(impactOf('cleric_u:judgement', 0, 1, 3, out)?.stop).toBeGreaterThan(0);
    expect(impactOf('guardian_d:wall', 0, 8, 3, out)).toBeNull();
  });
});

/** A host that records what the storyboards ask for (no Vfx). */
function recordingHost(memos: Map<number, UnitMemo>): StageHost & { calls: number } {
  const v = new Vfx();
  const h = v as unknown as StageHost & { calls: number };
  (v as unknown as { memosRef: Map<number, UnitMemo> }).memosRef = memos;
  return h;
}

function unit(id: number, team: 'ally' | 'enemy', x: number, y: number, statuses: { id: StatusId; data?: object }[] = []): Entity {
  return {
    id,
    kind: team === 'ally' ? 'character' : 'monster',
    team,
    defId: team === 'ally' ? 'blade' : 'slime',
    tier: team === 'ally' ? 'character' : 'normal',
    pos: { x, y },
    radius: 0.45,
    facing: 0,
    hp: 100,
    maxHp: 100,
    shield: 0,
    statuses: statuses.map(s => ({ id: s.id, remaining: 2, total: 3, value: 2, sourcePlayer: 0, ...(s.data ? { data: s.data } : null) })),
    targetId: null,
    targetHeldFor: 0,
    ownerPlayer: team === 'ally' ? 0 : null,
    partyIndex: team === 'ally' ? 0 : null,
    anim: 'idle',
    animTime: 0,
    invulnTime: 0,
    expiresIn: null,
    enraged: false,
  } as Entity;
}

describe('storyboards', () => {
  it('every PREP / LAND runs for every action, draws without errors and cleans itself up', () => {
    const cam = new Camera();
    cam.setArena(36, 12);
    cam.snap(12);
    const { ctx } = fakeCtx();
    const memos = new Map<number, UnitMemo>([
      [1, newMemo(unit(1, 'ally', 11, 6), 1)],
      [2, newMemo(unit(2, 'enemy', 13, 6), 1)],
      [3, newMemo(unit(3, 'enemy', 14, 5.5), 1)],
    ]);
    const host = recordingHost(memos);
    for (const c of CHARACTERS) {
      for (const [sk, slot] of [[c.drag, 'drag'], [c.ult, 'ult']] as const) {
        const fx = new SkillFx();
        sk.actions.forEach((a, i) => {
          const s: StageInfo = {
            skillId: sk.id,
            stage: a.stage!,
            slot,
            x: 13 + (a.offset?.x ?? 0),
            y: 6 + (a.offset?.y ?? 0),
            area: a.area,
            ox: 11,
            oy: 6,
            src: 1,
            follow: a.follow ? 2 : -1,
            color: c.color,
            k: 1,
            local: true,
            wait: slot === 'drag' && !a.delay ? 0.12 : 0,
            delay: a.delay ?? 0,
            hit: 0,
            hits: a.hits ?? 1,
            targets: 2,
            actionIndex: i,
            face: 1,
            dashTravel: 0.16,
            action: a,
          };
          PREP[`${sk.id}:${a.stage}`]?.(fx, host, s);
          for (let hit = 0; hit < (a.hits ?? 1); hit++) LAND[`${sk.id}:${a.stage}`](fx, host, { ...s, hit });
        });
        expect(fx.pool.count, `${sk.id} spawns something`).toBeGreaterThan(0);
        expect(fx.pool.count, `${sk.id} stays inside the pool`).toBeLessThanOrEqual(fx.pool.capacity);
        for (let t = 0; t < 12; t += 1 / 30) {
          fx.update(1 / 30, host, memos);
          fx.drawGround(ctx, cam, memos, t);
          fx.drawAir(ctx, cam, memos, t);
        }
        expect(fx.pool.count, `${sk.id} cleans up`).toBe(0);
      }
    }
  });
});

// ─────────────────────────── cut-in ───────────────────────────

function ultCtx(local: number): { state: GameState; memos: Map<number, UnitMemo>; localPlayer: number } {
  const me = unit(1, 'ally', 10, 6);
  const state = { entities: [me], players: [{ name: '나' }, { name: 'BOT 1' }], telegraphs: [], zones: [] } as unknown as GameState;
  return { state, memos: new Map([[1, newMemo(me, 1)]]), localPlayer: local };
}
const ULT: GameEvent = { type: 'ultCast', player: 0, entityId: 1, defId: 'berserker', skillId: 'berserker_u', name: '혈귀 강림' };

describe('ult cut-in', () => {
  it('lasts the data guard (0.5 s, the first hit at 0.45 s): the world dims 40 %, then comes back', () => {
    expect(CUTIN_SEC).toBe(ULT_CUTIN.guard);
    const v = new Vfx();
    v.handle(ULT, ultCtx(0));
    const ci = v.screen.cutin;
    expect(ci.active && !ci.short).toBe(true);
    expect(ci.variant).toBe('rage');
    v.updateReal(0.2);
    expect(ci.dim()).toBeCloseTo(CUTIN_DIM, 5);
    v.updateReal(ULT_CUTIN.firstHit - 0.2 + 0.03);
    expect(ci.dim()).toBeLessThan(CUTIN_DIM);
    v.updateReal(0.1);
    expect(ci.active).toBe(false);
    expect(ci.dim()).toBe(0);
    const { ctx, texts } = fakeCtx();
    const cam = new Camera();
    v.handle(ULT, ultCtx(0));
    v.updateReal(0.2);
    v.screen.drawTop(ctx, cam, 0);
    expect(texts).toContain('혈귀 강림');
  });

  it('"컷인 짧게": a 0.25 s banner, no dimming; the data timing is the same', () => {
    CUTIN.short = true;
    try {
      const v = new Vfx();
      v.handle(ULT, ultCtx(0));
      expect(v.screen.cutin.dur).toBe(CUTIN_SHORT_SEC);
      v.updateReal(0.1);
      expect(v.screen.cutin.dim()).toBe(0);
      v.updateReal(0.2);
      expect(v.screen.cutin.active).toBe(false);
    } finally {
      CUTIN.short = false;
    }
  });

  it("another player's ult: only the corner banner (no dim, no band), gone after 0.9 s", () => {
    const v = new Vfx();
    v.handle(ULT, ultCtx(1));
    expect(v.screen.cutin.active).toBe(false);
    expect(v.screen.worldActive()).toBe(false);
    const { ctx, texts } = fakeCtx();
    v.updateReal(0.1);
    v.screen.drawTop(ctx, new Camera(), 0);
    expect(texts).toContain('혈귀 강림'); // the skill name only (리뷰: 25 px), the portrait colour says whose
    v.updateReal(MINI_BANNER_SEC);
    const after = fakeCtx();
    v.screen.drawTop(after.ctx, new Camera(), 0);
    expect(after.texts.length).toBe(0);
  });
});

// ─────────────────────────── kicks ───────────────────────────

describe('impact on the screen', () => {
  function stageEv(player: number, targets: number): GameEvent {
    return {
      type: 'skillStage',
      sourceId: 1,
      player,
      slot: 'drag',
      skillId: 'gunner_d',
      stage: 'slug',
      actionIndex: 2,
      center: { x: 10, y: 6 },
      area: getCharacter('gunner').drag.actions[2].area,
      team: 'ally',
      hit: 0,
      hits: 1,
      targets,
    };
  }

  it("my big beat stops and shakes (75 ms at the default); another player's never touches my screen", () => {
    const mine = new Vfx();
    const c = ultCtx(0);
    mine.handle(stageEv(0, 3), c);
    mine.update(1 / 60, { ...c, camX: 10 });
    expect(mine.juice.freeze).toBeCloseTo(0.075 * (JUICE_DEFAULTS.hitStopMs / 75), 2);
    expect(mine.juice.amplitude()).toBeGreaterThan(0);
    const theirs = new Vfx();
    theirs.handle(stageEv(1, 3), c);
    theirs.update(1 / 60, { ...c, camX: 10 });
    expect(theirs.juice.freeze).toBe(0);
    expect(theirs.juice.amplitude()).toBe(0);
    // nothing hit: a shake only
    const empty = new Vfx();
    empty.handle(stageEv(0, 0), c);
    empty.update(1 / 60, { ...c, camX: 10 });
    expect(empty.juice.freeze).toBe(0);
  });
});

// ─────────────────────────── PullLerp / statuses ───────────────────────────

describe('PullLerp and status visuals', () => {
  it('a pulled enemy is drawn where it was, sliding to its new spot over ~0.2 s; a blink does not slide', () => {
    const e = unit(5, 'enemy', 10, 6);
    const m = newMemo(e, 1);
    e.pos = { x: 12.8, y: 6 };
    syncMemo(m, e, 2, 1 / 60);
    expect(m.pullX).toBeLessThan(-2);
    for (let i = 0; i < 12; i++) syncMemo(m, e, 3 + i, 1 / 60);
    expect(Math.abs(m.pullX)).toBeLessThan(0.2);
    // a normal step (< PULL_MIN) never slides
    e.pos = { x: 12.8 + PULL_MIN * 0.5, y: 6 };
    syncMemo(m, e, 20, 1 / 60);
    for (let i = 0; i < 30; i++) syncMemo(m, e, 21 + i, 1 / 60);
    expect(m.pullX).toBe(0);
    // a blink (noLerp) jumps
    m.noLerp = true;
    e.pos = { x: 16, y: 6 };
    syncMemo(m, e, 60, 1 / 60);
    expect(m.pullX).toBe(0);
  });

  it('at most two head icons per enemy, in priority order; Σ shows over a stopped one', () => {
    const fx = new StatusFx();
    const e = unit(7, 'enemy', 10, 6, [{ id: 'drain' }, { id: 'vulnerable' }, { id: 'stasis' }, { id: 'taunt' }, { id: 'atkDown' }]);
    fx.frame({ entities: [e] } as unknown as GameState);
    fx.onDamage(7, 120, null, true);
    const { ctx, texts } = fakeCtx();
    let disks = 0;
    const counting = new Proxy(ctx as unknown as object, {
      get(target, prop) {
        if (prop === 'arc') return () => disks++;
        return (target as Record<string | symbol, unknown>)[prop];
      },
    }) as CanvasRenderingContext2D;
    fx.drawHead(counting, e, 100, 100, 0);
    // stasis (clock: its own circle) + taunt ('!'): 2 backing disks + the clock face
    expect(disks).toBeLessThanOrEqual(MAX_HEAD_ICONS + 1);
    expect(texts).toContain('!');
    expect(texts).not.toContain('혼');
    expect(texts.some(t => t.startsWith('Σ'))).toBe(true);
  });
});

// ─────────────────────────── a real run ───────────────────────────

describe('all 15 renewed characters in a real run', () => {
  it('drags and ults of every character draw cleanly; warnings and fields get their styles; pools stay capped', () => {
    const cam = new Camera();
    const { ctx } = fakeCtx();
    const v = new Vfx();
    let styledTele = 0;
    let decoZone = 0;
    const stagesSeen = new Set<string>();
    for (let g0 = 0; g0 < CHARACTERS.length; g0 += 3) {
      const chars = CHARACTERS.slice(g0, g0 + 3).map(c => c.id);
      const game = createGame({
        seed: 31 + g0,
        players: [{ name: '나', isBot: false, characters: chars, pets: ['frog_bomb', 'fairy_heal', 'cat_void'] }],
        tunables: { ...DEFAULT_TUNABLES, instantCooldowns: true, invincible: true },
      });
      cam.setArena(game.state.plan.arena.width, game.state.plan.arena.height);
      const memos = new Map<number, UnitMemo>();
      let stamp = 0;
      const frame = (): void => {
        game.step(1 / 30);
        const s = game.state;
        stamp++;
        for (const e of s.entities) {
          const m = memos.get(e.id);
          if (m) syncMemo(m, e, stamp, 1 / 30);
          else memos.set(e.id, newMemo(e, stamp));
        }
        for (const [id, m] of memos) if (m.stamp !== stamp) memos.delete(id);
        const c = { state: s, memos, localPlayer: 0, camX: cam.x };
        v.status.frame(s);
        for (const ev of game.drainEvents()) {
          if (ev.type === 'skillStage') stagesSeen.add(`${ev.skillId}:${ev.stage}`);
          v.handle(ev, c);
        }
        v.update(1 / 30, c);
        v.updateReal(1 / 30);
        v.drawGround(ctx, cam, 0);
        v.drawGhosts(ctx, cam, 0);
        v.drawAir(ctx, cam, 0);
        v.screen.drawWorld(ctx, cam, () => false);
        v.drawOverlay(ctx, cam);
        v.drawScreen(ctx, cam, 0);
        for (const t of s.telegraphs) {
          const st = v.marks.tele(t.id);
          if (st) (styledTele++, drawStyledTelegraph(ctx, cam, t, st, 0));
        }
        for (const z of s.zones) {
          const st = v.marks.zone(z.id);
          if (st) (decoZone++, drawZoneDecor(ctx, cam, z, st, 0));
        }
        for (const e of s.entities) if (e.statuses.length) (v.status.drawGround(ctx, cam, e, 0, 0, 0), v.status.drawHead(ctx, e, 0, 0, 0));
        expect(v.particles.count).toBeLessThanOrEqual(v.particles.capacity);
        expect(v.sfx.pool.count).toBeLessThanOrEqual(v.sfx.pool.capacity);
      };
      for (let i = 0; i < 30 * 15 && !game.state.entities.some(e => e.team === 'enemy'); i++) frame();
      for (let k = 0; k < 3; k++) {
        const foe = game.state.entities.find(e => e.team === 'enemy' && e.hp > 0);
        const p = game.state.players[0];
        if (p.activeIndex !== k) game.dispatch({ type: 'swap', player: 0, partyIndex: k, pos: foe ? { ...foe.pos } : { x: 12, y: 6 } });
        for (let i = 0; i < 30 * 1.5; i++) frame();
        game.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
        game.dispatch({ type: 'ult', player: 0 });
        for (let i = 0; i < 30 * 5; i++) frame();
      }
    }
    expect(styledTele).toBeGreaterThan(0);
    expect(decoZone).toBeGreaterThan(0);
    // a good share of the renewed beats actually landed and went through their storyboards
    expect(stagesSeen.size).toBeGreaterThan(60);
  }, 60_000);
});
