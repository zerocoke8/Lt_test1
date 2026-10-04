// Headless smoke test of createRenderer against a recording fake 2D context.
// Proves: never mutates GameState (deep-frozen), handles every GameEvent type, sizes the backing store,
// avoids shadowBlur, camera follows the local character / freezes / centers boss arenas.
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../../src/render';
import { BOSS_POS, PLAYER_COLORS } from '../../src/config';
import { getCharacter, getMonster } from '../../src/data';
import type { Entity, GameEvent, GameState, PlayerState, RenderUiState } from '../../src/types';

interface FakeCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  getContext: (kind: string) => unknown;
}

function fakeCanvas(): { canvas: FakeCanvas; sets: Set<string>; calls: Map<string, number> } {
  const sets = new Set<string>();
  const calls = new Map<string, number>();
  const gradient = { addColorStop() {} };
  const store: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      return (..._args: unknown[]) => {
        calls.set(String(prop), (calls.get(String(prop)) ?? 0) + 1);
      };
    },
    set(target, prop, value) {
      sets.add(String(prop));
      target[prop] = value;
      return true;
    },
  });
  const canvas: FakeCanvas = { width: 300, height: 150, style: {}, getContext: () => ctx };
  return { canvas, sets, calls };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

let nextId = 1;
function ent(e: Partial<Entity> & Pick<Entity, 'kind' | 'team' | 'defId' | 'tier' | 'pos' | 'radius' | 'maxHp'>): Entity {
  return {
    id: nextId++,
    facing: 0,
    hp: e.maxHp,
    shield: 0,
    statuses: [],
    targetId: null,
    targetHeldFor: 0,
    ownerPlayer: null,
    partyIndex: null,
    anim: 'idle',
    animTime: 0,
    invulnTime: 0,
    expiresIn: null,
    enraged: false,
    ...e,
  };
}

function player(id: number, chars: string[], active: number | null, entityId: number | null): PlayerState {
  return {
    id,
    name: id === 0 ? '나' : `BOT ${id}`,
    isBot: id !== 0,
    color: PLAYER_COLORS[id],
    party: chars.map((c, i) => ({
      defId: c,
      hp: 500,
      maxHp: 500,
      shield: 0,
      statuses: [],
      dead: false,
      reviveRemaining: 0,
      swapCooldownRemaining: 0,
      swapCooldownTotal: 10,
      normalCooldownRemaining: 0,
      entityId: i === active ? entityId : null,
    })),
    activeIndex: active,
    pets: [],
    ult: { charge: 0, fullSince: null },
    out: false,
    appearLock: 0,
    relics: [],
    rewards: [],
    stats: {
      damageDealt: 0,
      damageToBoss: 0,
      damageTaken: 0,
      healing: 0,
      kills: 0,
      swaps: 0,
      ultsUsed: 0,
      petsUsed: 0,
      damageBySource: { basic: 0, passive: 0, normal: 0, drag: 0, ult: 0, pet: 0, relic: 0, zone: 0, summon: 0 },
      ultDelayTotal: 0,
      ultDelayCount: 0,
    },
  };
}

function makeState(kind: 'normal' | 'boss', localX: number, floor = 1): GameState {
  const w = kind === 'boss' ? 24 : 36;
  const me = ent({ kind: 'character', team: 'ally', defId: 'guardian', tier: 'character', pos: { x: localX, y: 6 }, radius: 0.5, maxHp: getCharacter('guardian').stats.maxHp, ownerPlayer: 0, partyIndex: 0, anim: 'appear', animTime: 0.5, invulnTime: 0.5 });
  const bot = ent({ kind: 'character', team: 'ally', defId: 'ranger', tier: 'character', pos: { x: localX - 3, y: 8 }, radius: 0.5, maxHp: 480, ownerPlayer: 1, partyIndex: 1, anim: 'attack', animTime: 0.3, statuses: [{ id: 'haste', remaining: 2, total: 4, value: 0.3, sourcePlayer: 1 }] });
  const turret = ent({ kind: 'summon', team: 'ally', defId: 'turret', tier: 'summon', pos: { x: localX + 1, y: 3 }, radius: 0.45, maxHp: 300, ownerPlayer: 2, expiresIn: 1 });
  const entities: Entity[] = [me, bot, turret];
  for (const id of ['slime', 'goblin', 'skeleton_archer', 'bomb_bug', 'golem', 'ogre', 'lich']) {
    const d = getMonster(id);
    entities.push(ent({ kind: 'monster', team: 'enemy', defId: id, tier: d.tier, pos: { x: localX + 2 + entities.length, y: 2 + (entities.length % 8) }, radius: d.radius, maxHp: d.stats.maxHp, hp: d.stats.maxHp * 0.5, shield: 10, anim: 'stunned', statuses: [{ id: 'stun', remaining: 1, total: 1, value: 0, sourcePlayer: 0 }], targetId: me.id }));
  }
  let bossId: number | null = null;
  if (kind === 'boss') {
    const b = ent({ kind: 'monster', team: 'enemy', defId: 'abyss_watcher', tier: 'boss', pos: { ...BOSS_POS }, radius: 3, maxHp: 9000, anim: 'cast', animTime: 1, targetId: me.id, enraged: true });
    entities.push(b);
    bossId = b.id;
  }
  return {
    seed: 1,
    tick: 0,
    time: 0,
    phase: 'combat',
    floor,
    plan: { floor, kind, timeLimit: 120, arena: { width: w, height: 12 }, statMult: 1, waves: [] },
    floorTime: 0,
    timeRemaining: 100,
    entities,
    players: [player(0, ['guardian', 'mage', 'cleric'], 0, me.id), player(1, ['guardian', 'ranger', 'cleric'], 1, bot.id), player(2, ['blade', 'mage', 'berserker'], null, null)],
    telegraphs: [
      { id: 900, team: 'enemy', center: { x: localX, y: 6 }, origin: { x: localX + 4, y: 2 }, area: { shape: 'circle', radius: 3 }, remaining: 0.1, total: 1.2 },
      { id: 901, team: 'enemy', center: { x: localX, y: 6 }, origin: { ...BOSS_POS }, area: { shape: 'line', length: 16, width: 3 }, remaining: 1, total: 1.5 },
      { id: 902, team: 'ally', center: { x: localX + 2, y: 6 }, origin: { x: localX + 2, y: 6 }, area: { shape: 'single' }, remaining: 0.5, total: 0.6 },
    ],
    zones: [
      { id: 950, team: 'ally', ownerPlayer: 0, center: { x: localX, y: 6 }, radius: 3, remaining: 2, total: 4, kind: 'heal' },
      { id: 951, team: 'enemy', ownerPlayer: null, center: { x: localX + 3, y: 4 }, radius: 99, remaining: 2, total: 4, kind: 'debuff' },
    ],
    projectiles: [
      { id: 970, team: 'ally', pos: { x: localX, y: 5 }, targetId: entities[4].id, targetPos: { x: localX + 5, y: 5 }, speed: 18, color: '#06d6a0' },
      { id: 971, team: 'enemy', pos: { x: localX + 2, y: 5 }, targetId: null, targetPos: { x: localX + 2, y: 5 }, speed: 10, color: '#e9ecef' },
    ],
    bossId,
    bossEnraged: kind === 'boss',
    wavesRemaining: 1,
    monstersAlive: 7,
    midBossSpawned: true,
    rewardOffers: null,
    runResult: null,
  };
}

function allEvents(s: GameState): GameEvent[] {
  const me = s.entities[0];
  const mon = s.entities[3];
  const mid = s.entities.find(e => e.tier === 'mid')!;
  return [
    { type: 'damage', targetId: mon.id, amount: 30, crit: false, pos: mon.pos, targetTeam: 'enemy', absorbed: 0 },
    { type: 'damage', targetId: mon.id, amount: 12, crit: false, pos: mon.pos, targetTeam: 'enemy', absorbed: 0 },
    { type: 'damage', targetId: mon.id, amount: 80, crit: true, pos: mon.pos, targetTeam: 'enemy', absorbed: 0 },
    { type: 'damage', targetId: me.id, amount: 0, crit: false, pos: me.pos, targetTeam: 'ally', absorbed: 25 },
    { type: 'damage', targetId: s.bossId ?? me.id, amount: 99, crit: false, pos: { ...BOSS_POS }, targetTeam: 'enemy', absorbed: 0 },
    { type: 'heal', targetId: me.id, amount: 3, pos: me.pos },
    { type: 'heal', targetId: me.id, amount: 40, pos: me.pos },
    { type: 'attack', sourceId: me.id, targetId: mon.id, ranged: false },
    { type: 'attack', sourceId: mon.id, targetId: me.id, ranged: true },
    { type: 'skillCast', sourceId: me.id, player: 0, slot: 'ult', skillId: 'guardian_u', name: '불굴의 성벽', center: me.pos, area: { shape: 'circle', radius: 4 }, team: 'ally' },
    { type: 'skillCast', sourceId: me.id, player: 0, slot: 'drag', skillId: 'guardian_d', name: '집결의 낙하', center: me.pos, area: { shape: 'circle', radius: 3.5 }, team: 'ally' },
    { type: 'skillCast', sourceId: null, player: 1, slot: 'pet', skillId: 'cat_void', name: '블랙홀 고양이', center: me.pos, area: { shape: 'circle', radius: 4 }, team: 'ally' },
    { type: 'skillCast', sourceId: me.id, player: 0, slot: 'normal', skillId: 'ranger_n', name: '관통 사격', center: mon.pos, area: { shape: 'line', length: 9, width: 1.2 }, team: 'ally' },
    { type: 'skillCast', sourceId: mid.id, player: null, slot: 'monster', skillId: 'ogre_slam', name: '내려찍기', center: me.pos, area: { shape: 'single' }, team: 'enemy' },
    { type: 'skillCast', sourceId: 12345, player: null, slot: 'monster', skillId: '?', name: '?', center: me.pos, area: { shape: 'circle', radius: 999 }, team: 'enemy' },
    { type: 'appear', player: 0, partyIndex: 0, entityId: me.id, pos: me.pos },
    { type: 'leave', player: 1, partyIndex: 1, pos: s.entities[1].pos },
    { type: 'death', entityId: mon.id, pos: mon.pos, kind: 'monster', tier: 'normal' },
    { type: 'death', entityId: mid.id, pos: mid.pos, kind: 'monster', tier: 'mid' },
    { type: 'death', entityId: 424242, pos: me.pos, kind: 'character', tier: 'character' },
    { type: 'spawnWarning', pos: { x: 3, y: 3 }, delay: 1 },
    { type: 'spawn', entityId: 777, pos: { x: 3, y: 3 }, tier: 'mid' },
    { type: 'revive', player: 0, partyIndex: 1 },
    { type: 'playerOut', player: 2 },
    { type: 'ultReady', player: 0 },
    { type: 'enrage' },
    { type: 'floorClear', floor: 1 },
    { type: 'bossRetreat' },
    { type: 'runOver', result: { outcome: 'defeat', reason: 'wipe', floorReached: 1, duration: 10 } },
  ];
}

const UI: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false };

describe('createRenderer (headless, fake context)', () => {
  it('sizes the backing store to the 1280×720 logical surface', () => {
    const { canvas } = fakeCanvas();
    const r = createRenderer(canvas as unknown as HTMLCanvasElement);
    r.render(deepFreeze(makeState('normal', 18)), [], 1 / 60, UI);
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
  });

  it('renders every event type without mutating a deep-frozen GameState, and never uses shadowBlur', () => {
    const { canvas, sets, calls } = fakeCanvas();
    const r = createRenderer(canvas as unknown as HTMLCanvasElement);
    for (const kind of ['normal', 'boss'] as const) {
      const s = deepFreeze(makeState(kind, 18));
      const evs = deepFreeze(allEvents(s));
      const drags: RenderUiState['dragPreview'][] = [
        null,
        { kind: 'swap', pos: { x: 10, y: 6 }, area: { shape: 'circle', radius: 3 }, valid: true, color: '#4cc9f0' },
        { kind: 'pet', pos: { x: 10, y: 6 }, area: { shape: 'line', length: 6, width: 2 }, valid: false, color: '#fff' },
        { kind: 'swap', pos: { x: 10, y: 6 }, area: { shape: 'single' }, valid: true, color: '' },
      ];
      for (let i = 0; i < 180; i++) {
        const ui: RenderUiState = { localPlayer: 0, dragPreview: drags[i % drags.length], freezeCamera: i % 50 === 0 };
        expect(() => r.render(s, i % 30 === 0 ? evs : [], i === 7 ? 5 : 1 / 60, ui)).not.toThrow();
      }
      // a frame where telegraphs vanish (resolve burst path) + the boss disappears (retreat path)
      const after = deepFreeze({ ...makeState(kind, 18), telegraphs: [], entities: [] });
      expect(() => r.render(after, [], 1 / 60, UI)).not.toThrow();
      expect(() => r.render(after, [{ type: 'floorStart', floor: 2, kind }], 1 / 60, UI)).not.toThrow();
    }
    expect(sets.has('shadowBlur')).toBe(false);
    expect(calls.get('fillText') ?? 0).toBeGreaterThan(0);
    expect(calls.get('ellipse') ?? 0).toBeGreaterThan(0);
  });

  it('camera follows the local field character, freezes on request, and stops when the field is empty', () => {
    const { canvas } = fakeCanvas();
    const r = createRenderer(canvas as unknown as HTMLCanvasElement);
    const a = deepFreeze(makeState('normal', 15));
    r.render(a, [], 1 / 60, UI); // first frame snaps
    expect(r.worldToScreen({ x: 15, y: 6 }).x).toBeCloseTo(640, 6);
    // character moved to x=21: camera eases toward it
    const b = deepFreeze(makeState('normal', 21));
    r.render(b, [], 1 / 60, UI);
    const mid = r.worldToScreen({ x: 21, y: 6 }).x;
    expect(mid).toBeGreaterThan(640);
    for (let i = 0; i < 240; i++) r.render(b, [], 1 / 60, UI);
    expect(r.worldToScreen({ x: 21, y: 6 }).x).toBeCloseTo(640, 1);
    // frozen while dragging
    const c = deepFreeze(makeState('normal', 14));
    const before = r.screenToWorld({ x: 640, y: 300 }).x;
    for (let i = 0; i < 60; i++) r.render(c, [], 1 / 60, { ...UI, freezeCamera: true });
    expect(r.screenToWorld({ x: 640, y: 300 }).x).toBeCloseTo(before, 9);
    // field empty → camera stays
    const empty = deepFreeze({ ...makeState('normal', 14), players: makeState('normal', 14).players.map(p => ({ ...p, activeIndex: null })) });
    for (let i = 0; i < 60; i++) r.render(empty, [], 1 / 60, UI);
    expect(r.screenToWorld({ x: 640, y: 300 }).x).toBeCloseTo(before, 9);
    // clamped at the arena edge
    const edge = deepFreeze(makeState('normal', 35));
    for (let i = 0; i < 600; i++) r.render(edge, [], 1 / 60, UI);
    expect(r.screenToWorld({ x: 1280, y: 300 }).x).toBeCloseTo(36, 3);
  });

  it('boss arenas (24 wide) are centered without scrolling, and screenToWorld/worldToScreen round-trip', () => {
    const { canvas } = fakeCanvas();
    const r = createRenderer(canvas as unknown as HTMLCanvasElement);
    for (const x of [2, 12, 22]) {
      const s = deepFreeze(makeState('boss', x, 5));
      for (let i = 0; i < 30; i++) r.render(s, [], 1 / 60, UI);
      expect(r.screenToWorld({ x: 0, y: 150 }).x).toBeCloseTo(0, 6);
      expect(r.screenToWorld({ x: 1280, y: 150 }).x).toBeCloseTo(24, 6);
    }
    const w = r.screenToWorld({ x: 333, y: 444 });
    const p = r.worldToScreen(w);
    expect(p.x).toBeCloseTo(333, 9);
    expect(p.y).toBeCloseTo(444, 9);
  });
});
