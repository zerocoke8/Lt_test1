// Cast readability layer: per-skill flavour (castfx/skillfx), skill vs basic damage numbers, swing-synced hits,
// and the optional event fields the sim fills for it (damage source/skillName, skillCast delay/hits).
import { describe, expect, it } from 'vitest';
import { CHARACTERS, getCharacter } from '../../src/data';
import { DEFAULT_TUNABLES } from '../../src/config';
import { createGame } from '../../src/sim';
import { Camera } from '../../src/render/camera';
import { castFx, type CastInfo, type SkillCastEvent } from '../../src/render/castfx';
import { type FxHost, SkillFx } from '../../src/render/skillfx';
import { Vfx, actionFor } from '../../src/render/vfx';
import { newMemo } from '../../src/render/units';
import type { Entity, GameEvent, GameState, SkillAction, SkillDef } from '../../src/types';

function fakeCtx(): { ctx: CanvasRenderingContext2D; sets: Set<string>; texts: { text: string; x: number; y: number }[] } {
  const sets = new Set<string>();
  const texts: { text: string; x: number; y: number }[] = [];
  const gradient = { addColorStop() {} };
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 10 });
      if (prop === 'fillText') return (text: string, x: number, y: number) => texts.push({ text, x, y });
      return () => undefined;
    },
    set(target, prop, value) {
      sets.add(String(prop));
      if ((prop === 'globalAlpha' || prop === 'lineWidth') && !Number.isFinite(value as number)) throw new Error(`${String(prop)}=${value}`);
      target[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, sets, texts };
}

const host: FxHost = { burst() {}, ring() {}, flash() {}, shake() {} };

function castEvents(skill: SkillDef, slot: 'normal' | 'drag' | 'ult', x: number, y: number): { ev: SkillCastEvent; action: SkillAction }[] {
  return skill.actions.map(a => ({
    action: a,
    ev: {
      type: 'skillCast',
      sourceId: 1,
      player: 0,
      slot,
      skillId: skill.id,
      name: skill.name,
      center: { x: x + (a.offset?.x ?? 0), y: y + (a.offset?.y ?? 0) },
      area: a.area,
      team: 'ally',
      ...(a.delay ? { delay: a.delay } : null),
      ...(a.hits && a.hits > 1 ? { hits: a.hits, hitInterval: a.hitInterval ?? 0.2 } : null),
    },
  }));
}

describe('per-skill flavour', () => {
  it('every character skill spawns its own effects, draws without errors and cleans itself up', () => {
    const fx = new SkillFx();
    const cam = new Camera();
    cam.setArena(36, 12);
    cam.snap(12);
    const { ctx, sets } = fakeCtx();
    const memos = new Map([[1, { x: 12, y: 6 } as never]]);
    for (const c of CHARACTERS) {
      for (const [skill, slot] of [[c.normal, 'normal'], [c.drag, 'drag'], [c.ult, 'ult']] as const) {
        const before = fx.pool.count;
        for (const { ev, action } of castEvents(skill, slot, 12, 6)) {
          const info: CastInfo = { ev, action, ox: 11, oy: 6, src: 1, face: 1, color: c.color, k: 1, local: true, dashTravel: 0.18 };
          castFx(fx, host, info);
        }
        expect(fx.pool.count, `${skill.id} spawns something`).toBeGreaterThan(before);
      }
    }
    // play everything out (meteors, flurries, 5 s of blizzard snow)
    for (let t = 0; t < 7; t += 1 / 30) {
      fx.update(1 / 30, host, memos);
      fx.drawGround(ctx, cam, memos, t);
      fx.drawAir(ctx, cam, memos, t);
    }
    expect(fx.pool.count).toBe(0);
    expect(sets.has('shadowBlur')).toBe(false);
  });

  it('maps a skillCast to its data action by order (meteor 3 of 5, guardian ult shield part)', () => {
    expect(actionFor('mage_d', 'drag', 2)).toBe(getCharacter('mage').drag.actions[2]);
    expect(actionFor('guardian_u', 'ult', 1)?.affects).toBe('allies');
    expect(actionFor('frog_bomb', 'pet', 0)?.delay).toBeGreaterThan(0);
    expect(actionFor('nope_x', 'monster', 0)).toBeNull();
  });
});

function unit(id: number, team: 'ally' | 'enemy', x: number): Entity {
  return {
    id,
    kind: team === 'ally' ? 'character' : 'monster',
    team,
    defId: team === 'ally' ? 'blade' : 'slime',
    tier: team === 'ally' ? 'character' : 'normal',
    pos: { x, y: 6 },
    radius: 0.45,
    facing: 0,
    hp: 100,
    maxHp: 100,
    shield: 0,
    statuses: [],
    targetId: null,
    targetHeldFor: 0,
    ownerPlayer: team === 'ally' ? 0 : null,
    partyIndex: team === 'ally' ? 0 : null,
    anim: 'idle',
    animTime: 0,
    invulnTime: 0,
    expiresIn: null,
    enraged: false,
  };
}

describe('damage numbers and hit timing', () => {
  const me = unit(1, 'ally', 10);
  const mob = unit(2, 'enemy', 11);
  const state = { entities: [me, mob], players: [], telegraphs: [] } as unknown as GameState;
  const ctx = () => ({ state, memos: new Map([[1, newMemo(me, 1)], [2, newMemo(mob, 1)]]), localPlayer: 0 });
  const hit = (extra: Partial<Extract<GameEvent, { type: 'damage' }>>): GameEvent => ({
    type: 'damage',
    targetId: 2,
    amount: 40,
    crit: false,
    pos: { x: 11, y: 6 },
    targetTeam: 'enemy',
    absorbed: 0,
    ...extra,
  });

  it('skill hits are a different, bigger kind than basic hits; no tiny name under the number (the callout names it)', () => {
    const v = new Vfx();
    const c = ctx();
    v.handle(hit({ source: 'basic' }), c);
    v.handle(hit({ source: 'drag', skillName: '질풍 돌파', targetId: 1, targetTeam: 'enemy' }), c);
    v.handle(hit({ source: 'drag', skillName: '질풍 돌파' }), c);
    v.handle(hit({ source: 'passive' }), c);
    const kinds = v.floaters.items.slice(0, v.floaters.count).map(f => [f.kind, f.size, f.label] as const);
    const basic = kinds.find(k => k[0] === 0)!;
    const skills = kinds.filter(k => k[0] === 4);
    expect(skills.length).toBe(2);
    expect(skills.every(s => s[1] > basic[1])).toBe(true);
    expect(skills.every(s => s[2] === '')).toBe(true);
    expect(kinds.some(k => k[0] === 5)).toBe(true); // DoT / passive: small and warm
  });

  it('hits on one target add up (a crit turns the sum into a crit); other numbers there stack above, not on it', () => {
    const v = new Vfx();
    const c = ctx();
    v.handle(hit({ source: 'basic', amount: 13 }), c);
    v.handle(hit({ source: 'basic', amount: 100, crit: true }), c);
    const live = () => v.floaters.items.slice(0, v.floaters.count);
    expect(live().length).toBe(1);
    expect(live()[0].text).toBe('113!');
    expect(live()[0].kind).toBe(1);
    v.handle(hit({ source: 'drag', skillName: '질풍 돌파', amount: 182 }), c);
    const [a, b] = live();
    expect(live().length).toBe(2);
    expect(b.z).toBeGreaterThan(a.z);
  });

  it('numbers never rise into the top HUD row', () => {
    const v = new Vfx();
    const c = ctx();
    v.handle(hit({ source: 'drag', skillName: '질풍 돌파', pos: { x: 11, y: 0 }, amount: 50 }), c);
    const cam = new Camera();
    cam.setArena(36, 12);
    cam.snap(12);
    const { ctx: g, texts } = fakeCtx();
    v.update(0.5, c);
    v.drawOverlay(g, cam);
    for (const t of texts) expect(t.y, t.text).toBeGreaterThanOrEqual(132);
  });

  it('a melee basic hit waits for the swing wind-up before its number and flash', () => {
    const v = new Vfx();
    const c = ctx();
    v.handle({ type: 'attack', sourceId: 1, targetId: 2, ranged: false }, c);
    v.handle(hit({ source: 'basic' }), c);
    expect(v.floaters.count).toBe(0);
    v.update(0.1, c);
    expect(v.floaters.count).toBe(1);
    expect(c.memos.get(2)!.flash).toBeGreaterThan(0);
  });
});

describe('sim fills the optional render fields', () => {
  it('damage events say their source (and skill name for skills); multi-part / multi-hit casts carry delay / hits', () => {
    const g = createGame({
      seed: 7,
      players: [{ name: '나', isBot: false, characters: ['blade', 'mage', 'cleric'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] }],
      tunables: { ...DEFAULT_TUNABLES, instantCooldowns: true },
    });
    const events: GameEvent[] = [];
    // let a wave arrive, drop the mage on an enemy (5 timed meteors), then bring the blade back for its 8-hit ult
    for (let i = 0; i < 30 * 12 && !g.state.entities.some(e => e.team === 'enemy'); i++) {
      g.step(1 / 30);
      events.push(...g.drainEvents());
    }
    const foe = g.state.entities.find(e => e.team === 'enemy')!;
    expect(g.dispatch({ type: 'swap', player: 0, partyIndex: 1, pos: { ...foe.pos } }).ok).toBe(true);
    for (let i = 0; i < 30 * 2; i++) {
      g.step(1 / 30);
      events.push(...g.drainEvents());
    }
    const meteors = events.filter((e): e is SkillCastEvent => e.type === 'skillCast' && e.skillId === 'mage_d');
    expect(meteors.length).toBe(getCharacter('mage').drag.actions.length);
    expect(meteors.map(m => m.delay)).toEqual(getCharacter('mage').drag.actions.map(a => a.delay));
    const dmg = events.filter((e): e is Extract<GameEvent, { type: 'damage' }> => e.type === 'damage' && e.targetTeam === 'enemy');
    expect(dmg.every(d => d.source !== undefined)).toBe(true);
    const drag = dmg.filter(d => d.source === 'drag' && d.skillName);
    expect(drag.length).toBeGreaterThan(0);
    expect(drag.every(d => d.skillName === '유성우')).toBe(true);
    expect(dmg.filter(d => d.source === 'basic').every(d => d.skillName === undefined)).toBe(true);
    // a multi-hit ult announces its hits
    g.dispatch({ type: 'debug', action: { kind: 'chargeUlt', player: 0 } });
    g.dispatch({ type: 'swap', player: 0, partyIndex: 0, pos: { ...g.state.entities.find(e => e.team === 'enemy')?.pos ?? foe.pos } });
    for (let i = 0; i < 30; i++) g.step(1 / 30);
    g.drainEvents();
    expect(g.dispatch({ type: 'ult', player: 0 }).ok).toBe(true);
    const ult = g.drainEvents().find((e): e is SkillCastEvent => e.type === 'skillCast' && e.skillId === 'blade_u');
    expect(ult?.hits).toBe(getCharacter('blade').ult.actions[0].hits);
    expect(ult?.hitInterval).toBe(getCharacter('blade').ult.actions[0].hitInterval);
  });
});

describe('skill-name callouts', () => {
  it('callouts by the top wall never overlap each other and never go up under the HUD row', () => {
    const v = new Vfx();
    const cam = new Camera();
    cam.setArena(36, 12);
    cam.snap(12);
    const { ctx } = fakeCtx();
    const spawn = (text: string, size: number, dx: number) => {
      const l = v['label'](12 + dx, 0.2, 2.5, text, '#ffffff', size, 1.4);
      l.pill = '#ff4d6d';
    };
    // my drag callout, a bot's normal skill and another bot's same-name normal skill, all on one spot by the wall
    spawn('질풍 돌파!', 27, 0);
    spawn('방패 강타', 13, -0.3);
    spawn('회전 베기', 13, 0.3);
    spawn('천 개의 칼날', 24, 0.1);
    v.drawOverlay(ctx, cam);
    const ls = v.labels.items.slice(0, v.labels.count);
    const box = (l: (typeof ls)[number]) => ({ x0: l.sx - (l.w + 8) / 2, x1: l.sx + (l.w + 8) / 2, y0: l.sy - l.size * 0.98, y1: l.sy + l.size * 0.32 });
    for (const l of ls) expect(l.sy - l.size, l.text).toBeGreaterThanOrEqual(105);
    for (let i = 0; i < ls.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = box(ls[i]);
        const b = box(ls[j]);
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(overlap, `${ls[i].text} / ${ls[j].text}`).toBe(false);
      }
    }
  });
});
