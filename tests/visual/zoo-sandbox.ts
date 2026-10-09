// 기획 8차 visual check: zone backgrounds, every monster look, the four bosses (with phases) and the new mechanics'
// VFX — hand-made GameState fixtures with stub stats (no dependency on the content data being finished).
// Open via render-sandbox.html?scene=zoo&… — screenshots: node tests/visual/shoot-zoo.mjs
//   zone=lobby|office|ward|rooftop     background (default lobby)
//   gallery=1                          every look key in rows, names under them (arena 24, centered)
//   pack=1                             the zone's own monsters as a fight (normal floor)
//   boss=<id> [phase=1|2|3]            boss floor with that boss (elevator_keeper / overtime_lord / surgeon_director / abyss_watcher)
//   fx=blink|charge|fan|split|heal|phase|landing   synthetic events for the new mechanics
//   t=<s>                              seconds rendered (fixed 1/60 steps) before the shot
//   enraged=1

import { createRenderer } from '../../src/render';
import { BOSS_POS, PLAYER_COLORS } from '../../src/config';
import { getCharacter } from '../../src/data';
import { CREATURE_ART } from '../../src/render/creatures';
import type { ContributionStats, Entity, FloorTheme, GameEvent, GameState, PlayerState, RenderUiState, Telegraph, Vec2, Zone } from '../../src/types';
import { LOGICAL_H, LOGICAL_W } from '../../src/types';

declare global {
  interface Window {
    __sandbox?: { ready: boolean; step?: (ms: number) => void; bench?: number };
  }
}

/** Stub radius / tier per contract id (the data may not have them yet). */
const STUB: Record<string, { r: number; tier: 'normal' | 'mid' }> = {
  slime: { r: 0.4, tier: 'normal' },
  goblin: { r: 0.35, tier: 'normal' },
  skeleton_archer: { r: 0.4, tier: 'normal' },
  bomb_bug: { r: 0.32, tier: 'normal' },
  golem: { r: 0.6, tier: 'normal' },
  overtime_ghost: { r: 0.42, tier: 'normal' },
  copy_man: { r: 0.42, tier: 'normal' },
  copy_mini: { r: 0.3, tier: 'normal' },
  iv_zombie: { r: 0.45, tier: 'normal' },
  wheelchair_rush: { r: 0.5, tier: 'normal' },
  nurse_doll: { r: 0.38, tier: 'normal' },
  eye_stalk: { r: 0.45, tier: 'normal' },
  red_mask: { r: 0.4, tier: 'normal' },
  ogre: { r: 0.9, tier: 'mid' },
  lich: { r: 0.8, tier: 'mid' },
  elevator_girl: { r: 0.8, tier: 'mid' },
  copier_beast: { r: 0.9, tier: 'mid' },
  head_nurse: { r: 0.85, tier: 'mid' },
  signal_man: { r: 0.85, tier: 'mid' },
};

const ZONE_PACK: Record<FloorTheme, string[]> = {
  lobby: ['slime', 'goblin', 'skeleton_archer', 'bomb_bug', 'golem', 'slime', 'goblin'],
  office: ['overtime_ghost', 'copy_man', 'copy_mini', 'copy_mini', 'skeleton_archer', 'golem', 'overtime_ghost'],
  ward: ['iv_zombie', 'wheelchair_rush', 'nurse_doll', 'iv_zombie', 'goblin', 'nurse_doll', 'bomb_bug'],
  rooftop: ['eye_stalk', 'red_mask', 'eye_stalk', 'red_mask', 'wheelchair_rush', 'copy_man', 'overtime_ghost'],
};
const ZONE_MID: Record<FloorTheme, string> = { lobby: 'elevator_girl', office: 'copier_beast', ward: 'head_nurse', rooftop: 'signal_man' };
const ZONE_BOSS: Record<FloorTheme, string> = { lobby: 'elevator_keeper', office: 'overtime_lord', ward: 'surgeon_director', rooftop: 'abyss_watcher' };
const ZONE_FLOOR: Record<FloorTheme, number> = { lobby: 3, office: 7, ward: 12, rooftop: 17 };

let nextId = 1;

function stats(): ContributionStats {
  return {
    damageDealt: 0, damageToBoss: 0, damageTaken: 0, healing: 0, kills: 0, swaps: 0, ultsUsed: 0, petsUsed: 0,
    damageBySource: { basic: 0, passive: 0, normal: 0, drag: 0, ult: 0, pet: 0, relic: 0, zone: 0, summon: 0 },
    ultDelayTotal: 0, ultDelayCount: 0, fieldEvents: 0, groggyPoints: 0, groggyBreaks: 0, groggyDamage: 0,
  };
}

function ent(e: Partial<Entity> & Pick<Entity, 'kind' | 'team' | 'defId' | 'tier' | 'pos' | 'radius' | 'maxHp'>): Entity {
  return {
    id: nextId++, facing: Math.PI, hp: e.maxHp, shield: 0, statuses: [], targetId: null, targetHeldFor: 0, ownerPlayer: null,
    partyIndex: null, anim: 'idle', animTime: 0, invulnTime: 0, expiresIn: null, enraged: false, ...e,
  };
}

function mon(id: string, x: number, y: number, extra: Partial<Entity> = {}): Entity {
  const st = STUB[id] ?? { r: 0.4, tier: 'normal' as const };
  return ent({ kind: 'monster', team: 'enemy', defId: id, tier: st.tier, pos: { x, y }, radius: st.r, maxHp: st.tier === 'mid' ? 3000 : 300, ...extra });
}

function hero(owner: number, idx: number, defId: string, x: number, y: number, extra: Partial<Entity> = {}): Entity {
  return ent({ kind: 'character', team: 'ally', defId, tier: 'character', pos: { x, y }, radius: 0.5, maxHp: getCharacter(defId).stats.maxHp, ownerPlayer: owner, partyIndex: idx, facing: 0, ...extra });
}

function player(id: number, name: string, chars: string[], active: number, entityId: number): PlayerState {
  return {
    id, name, isBot: id !== 0, color: PLAYER_COLORS[id],
    party: chars.map((c, i) => ({
      defId: c, hp: 500, maxHp: 500, shield: 0, statuses: [], dead: false, reviveRemaining: 0, swapCooldownRemaining: 0,
      swapCooldownTotal: 10, normalCooldownRemaining: 0, entityId: i === active ? entityId : null, ult: { charge: 0.5, fullSince: null },
    })),
    activeIndex: active, pets: [], out: false, appearLock: 0, relics: [], rewards: [], stats: stats(), goedamTraces: [], goedamLog: [],
  };
}

function baseState(floor: number, kind: 'normal' | 'boss', w: number, theme: FloorTheme, bossId?: string): GameState {
  return {
    seed: 7, tick: 1, time: 10, phase: 'combat', floor,
    plan: { floor, kind, timeLimit: 120, arena: { width: w, height: 12 }, statMult: 1, waves: [], theme, ...(bossId ? { bossId } : {}) },
    floorTime: 10, timeRemaining: 100, entities: [], players: [], telegraphs: [], zones: [], projectiles: [], bossId: null,
    bossEnraged: false, wavesRemaining: 1, monstersAlive: 0, midBossSpawned: true, rewardOffers: null, rewardOffersByPlayer: [], goedam: null, fieldEvent: null, bossGroggy: null, runResult: null,
  };
}

interface Scene {
  state: GameState;
  script: { at: number; ev: GameEvent }[];
  labels: { id: number; text: string }[];
  /** Per-frame fixture animation (sandbox only). */
  tick?: (t: number, dt: number) => void;
}

function addParty(s: GameState, x: number, y: number): Entity {
  const me = hero(0, 0, 'blade', x, y);
  const b1 = hero(1, 1, 'guardian', x - 3, y + 2.5, { facing: 0 });
  const b2 = hero(2, 0, 'mage', x - 2, y - 2.6, { facing: 0 });
  s.entities.push(me, b1, b2);
  s.players.push(player(0, '나', ['blade', 'mage', 'cleric'], 0, me.id), player(1, 'BOT 1', ['guardian', 'ranger', 'cleric'], 1, b1.id), player(2, 'BOT 2', ['mage', 'blade', 'bard'], 0, b2.id));
  return me;
}

function galleryScene(zone: FloorTheme): Scene {
  const s = baseState(ZONE_FLOOR[zone], 'normal', 24, zone);
  const me = addParty(s, 2.2, 10.6);
  const ids = Object.keys(CREATURE_ART);
  const labels: Scene['labels'] = [];
  const perRow = 7;
  ids.forEach((id, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = 3.2 + col * 3.0 + (row === 2 ? 1.5 : 0);
    const y = 2.6 + row * 3.6;
    const m = mon(id, x, y, { facing: col % 2 ? 0 : Math.PI, hp: STUB[id]?.tier === 'mid' ? 2100 : 300 });
    s.entities.push(m);
    labels.push({ id: m.id, text: CREATURE_ART[id].name });
  });
  void me;
  return {
    state: s,
    script: [],
    labels,
    tick: t => {
      // cycle poses: attack on odd seconds, move otherwise
      for (const e of s.entities) {
        if (e.kind !== 'monster') continue;
        const k = Math.floor(t * 0.8 + e.id * 0.37) % 3;
        e.anim = k === 0 ? 'attack' : k === 1 ? 'move' : 'idle';
        e.animTime = k === 0 ? 0.6 - ((t * 0.8 + e.id * 0.37) % 1) * 0.6 : 0;
      }
    },
  };
}

function packScene(zone: FloorTheme): Scene {
  const s = baseState(ZONE_FLOOR[zone], 'normal', 36, zone);
  const me = addParty(s, 10, 6.5);
  const ids = ZONE_PACK[zone];
  const spots: Vec2[] = [[14, 4.6], [15.5, 7.2], [17.2, 5.2], [13.4, 9.4], [18.8, 8.6], [16.2, 2.6], [20, 4]].map(([x, y]) => ({ x, y }));
  ids.forEach((id, i) => {
    const m = mon(id, spots[i].x, spots[i].y, { targetId: me.id, anim: i % 2 ? 'move' : 'attack', animTime: 0.3 });
    if (i === 1) m.hp = m.maxHp * 0.45;
    s.entities.push(m);
  });
  const mid = mon(ZONE_MID[zone], 21.5, 6.6, { targetId: me.id, hp: 2000 });
  s.entities.push(mid);
  s.monstersAlive = ids.length + 1;
  return { state: s, script: [], labels: [] };
}

function bossScene(zone: FloorTheme, bossId: string, phase: number, enraged: boolean): Scene {
  const s = baseState(ZONE_FLOOR[zone] < 5 ? 5 : ZONE_FLOOR[zone] + 3, 'boss', 24, zone, bossId);
  s.floor = { lobby: 5, office: 10, ward: 15, rooftop: 20 }[zone];
  s.plan.floor = s.floor;
  const me = addParty(s, 10.5, 6.5);
  const maxHp = 10000;
  const hp = phase >= 3 ? 2000 : phase === 2 ? 4500 : 9000;
  const b = ent({ kind: 'monster', team: 'enemy', defId: bossId, tier: 'boss', pos: { ...BOSS_POS }, radius: 3, maxHp, hp, targetId: me.id, anim: 'cast', animTime: 0.8, enraged });
  s.entities.push(b);
  s.bossId = b.id;
  s.bossEnraged = enraged;
  const add = ZONE_PACK[zone][0];
  s.entities.push(mon(add, 7, 4, { targetId: me.id, anim: 'move' }), mon(add, 15, 5, { targetId: me.id }), mon(ZONE_PACK[zone][1], 16.5, 8.4, { targetId: me.id, anim: 'attack', animTime: 0.4 }));
  const teles: Telegraph[] = [];
  const T = (center: Vec2, origin: Vec2, area: Telegraph['area'], rem: number, tot: number) => teles.push({ id: nextId++, team: 'enemy', center, origin, area, remaining: rem, total: tot });
  if (bossId === 'elevator_keeper') {
    T({ x: 3, y: 5 }, { x: 3, y: 5 }, { shape: 'rect', dir: 'right', anchor: 'start', length: 8, width: 3 }, 0.8, 1.6);
    T({ x: 17, y: 8 }, { x: 17, y: 8 }, { shape: 'ring', inner: 1.5, outer: 3.2 }, 1.1, 2);
  } else if (bossId === 'overtime_lord') {
    T({ x: 9, y: 8 }, { ...BOSS_POS }, { shape: 'fan', radius: 11, angle: 40 }, 0.9, 1.5);
    T({ x: 17, y: 6 }, { x: 17, y: 6 }, { shape: 'cross', length: 3.5, width: 1.4 }, 0.5, 1.2);
  } else if (bossId === 'surgeon_director') {
    for (const dx of [-4, 0, 4]) T({ x: 12 + dx, y: 11 }, { x: 12 + dx * 0.3, y: 0.5 }, { shape: 'line', length: 11, width: 1.1 }, 0.7, 1.2);
  } else {
    T({ x: 7, y: 9 }, { ...BOSS_POS }, { shape: 'line', length: 14, width: 2 }, 1.0, 1.8);
    T({ x: 16, y: 6 }, { x: 16, y: 6 }, { shape: 'ring', inner: 1.8, outer: 4 }, 0.6, 1.8);
  }
  s.telegraphs.push(...teles);
  if (bossId === 'surgeon_director') s.zones.push(zoneOf('enemy', { x: 6, y: 9 }, 2.5, 'debuff'));
  const script: Scene['script'] = [];
  if (phase >= 2) script.push({ at: 0.05, ev: { type: 'bossPhase', entityId: b.id, phase, name: phase === 2 ? '2페이즈' : '3페이즈' } });
  return { state: s, script, labels: [] };
}

function zoneOf(team: 'enemy' | 'ally', center: Vec2, radius: number, kind: Zone['kind']): Zone {
  return { id: nextId++, team, ownerPlayer: null, center, radius, remaining: 3, total: 4, kind };
}

/** New mechanics: blink, charge, fan spray, split on death, monster heal, landing (hit-stop). */
function fxScene(zone: FloorTheme, fx: string): Scene {
  const s = baseState(ZONE_FLOOR[zone], 'normal', 36, zone);
  const me = addParty(s, 10, 6.5);
  const script: Scene['script'] = [];
  const at = (t: number, ev: GameEvent) => script.push({ at: t, ev });
  if (fx === 'blink') {
    const d = mon('nurse_doll', 16, 3, { targetId: me.id });
    s.entities.push(d);
    at(0.1, { type: 'blink', entityId: d.id, from: { x: 16, y: 3 }, to: { x: 11.1, y: 6.6 } });
    at(0.1, { type: 'skillCast', sourceId: d.id, player: null, slot: 'monster', skillId: 'doll_stab', name: '주사 찌르기', center: me.pos, area: { shape: 'single' }, team: 'enemy' });
    return { state: s, script, labels: [], tick: t => { if (t >= 0.1) d.pos = { x: 11.1, y: 6.6 }; } };
  }
  if (fx === 'charge') {
    const w = mon('wheelchair_rush', 18, 4, { targetId: me.id });
    s.entities.push(w);
    const tg: Telegraph = { id: nextId++, team: 'enemy', center: { x: 9.5, y: 7.4 }, origin: { x: 18, y: 4 }, area: { shape: 'line', length: 9.4, width: 1.2 }, remaining: 0.8, total: 1.2 };
    s.telegraphs.push(tg);
    at(0.05, { type: 'skillCast', sourceId: w.id, player: null, slot: 'monster', skillId: 'wheel_rush', name: '질주', center: tg.center, area: tg.area, team: 'enemy', delay: 1.2 });
    return {
      state: s, script, labels: [],
      tick: (t, dt) => {
        if (tg.remaining > 0) tg.remaining = Math.max(0, tg.remaining - dt);
        if (tg.remaining <= 0 && s.telegraphs.length) {
          s.telegraphs.length = 0;
          w.pos = { x: 9.9, y: 7.2 };
          pending.push({ type: 'dash', entityId: w.id, from: { x: 18, y: 4 }, to: { x: 9.9, y: 7.2 }, duration: 0.3 });
        }
      },
    };
  }
  if (fx === 'fan') {
    const e = mon('eye_stalk', 17, 4.5, { targetId: me.id, anim: 'cast', animTime: 0.8 });
    s.entities.push(e);
    s.telegraphs.push({ id: nextId++, team: 'enemy', center: { x: 10, y: 6.5 }, origin: { x: 17, y: 4.5 }, area: { shape: 'fan', radius: 8.5, angle: 50 }, remaining: 0.5, total: 1.2 });
    s.zones.push({ id: nextId++, team: 'enemy', ownerPlayer: null, center: { x: 20, y: 9 }, radius: 4, area: { shape: 'fan', radius: 4, angle: 60 }, remaining: 2, total: 3, kind: 'damage' });
    at(0.05, { type: 'skillCast', sourceId: e.id, player: null, slot: 'monster', skillId: 'stalk_spray', name: '시선 분사', center: { x: 10, y: 6.5 }, area: { shape: 'fan', radius: 8.5, angle: 50 }, team: 'enemy' });
    return { state: s, script, labels: [] };
  }
  if (fx === 'split') {
    const c = mon('copy_man', 14, 6, { targetId: me.id });
    s.entities.push(c);
    const a = mon('copy_mini', 14.6, 5.6, { targetId: me.id });
    const b = mon('copy_mini', 13.5, 6.6, { targetId: me.id });
    at(0.1, { type: 'death', entityId: c.id, pos: { x: 14, y: 6 }, kind: 'monster', tier: 'normal' });
    at(0.1, { type: 'spawn', entityId: a.id, pos: a.pos, tier: 'normal' });
    at(0.1, { type: 'spawn', entityId: b.id, pos: b.pos, tier: 'normal' });
    return {
      state: s, script, labels: [],
      tick: t => {
        if (t >= 0.1 && s.entities.includes(c)) {
          s.entities.splice(s.entities.indexOf(c), 1);
          s.entities.push(a, b);
        }
      },
    };
  }
  if (fx === 'heal') {
    const p = mon('iv_zombie', 15, 6, { targetId: me.id, anim: 'cast', animTime: 0.6 });
    const g = mon('goblin', 13.5, 4.8, { hp: 120 });
    const k = mon('golem', 16.6, 7.6, { hp: 200 });
    s.entities.push(p, g, k);
    at(0.05, { type: 'skillCast', sourceId: p.id, player: null, slot: 'monster', skillId: 'iv_drip', name: '수액 공급', center: p.pos, area: { shape: 'circle', radius: 3 }, team: 'enemy' });
    at(0.1, { type: 'heal', targetId: g.id, amount: 40, pos: g.pos });
    at(0.1, { type: 'heal', targetId: k.id, amount: 60, pos: k.pos });
    return { state: s, script, labels: [] };
  }
  // landing: my blade... use the guardian band so there is an immediate area
  const pack = [mon('slime', 13, 6), mon('goblin', 14.5, 6.4), mon('golem', 16, 6), mon('slime', 12.4, 5.2), mon('bomb_bug', 15.2, 7)];
  s.entities.push(...pack);
  const g = hero(0, 1, 'guardian', 14, 6.2, { anim: 'idle' });
  at(0.1, { type: 'leave', player: 0, partyIndex: 0, pos: me.pos });
  at(0.1, { type: 'appear', player: 0, partyIndex: 1, entityId: g.id, pos: g.pos });
  at(0.1, { type: 'skillCast', sourceId: g.id, player: 0, slot: 'drag', skillId: 'guardian_d', name: '방패 파동', center: g.pos, area: { shape: 'rect', dir: 'right', anchor: 'center', length: 7, width: 2 }, team: 'ally' });
  for (const m of pack) at(0.1, { type: 'damage', targetId: m.id, amount: 70, crit: false, pos: m.pos, targetTeam: 'enemy', absorbed: 0, source: 'drag', skillName: '방패 파동' });
  return {
    state: s, script, labels: [],
    tick: (t, dt) => {
      if (t >= 0.1 && s.entities.includes(me)) {
        s.entities.splice(s.entities.indexOf(me), 1);
        s.entities.push(g);
        s.players[0].activeIndex = 1;
        s.players[0].party[1].entityId = g.id;
        s.players[0].party[0].entityId = null;
        g.anim = 'appear';
        g.animTime = 0.5;
      } else if (g.anim === 'appear') {
        g.animTime = Math.max(0, g.animTime - dt);
        if (g.animTime <= 0) g.anim = 'idle';
      }
    },
  };
}

const pending: GameEvent[] = [];

/** bench=<id>: 40 of one look moving/attacking over the zone floor (render cost per look, ms/frame). */
function benchScene(zone: FloorTheme, id: string): Scene {
  const s = baseState(ZONE_FLOOR[zone], 'normal', 36, zone);
  const me = addParty(s, 12, 6);
  for (let i = 0; i < 40; i++) s.entities.push(mon(id, 2 + (i % 10) * 2.2, 1 + Math.floor(i / 10) * 3, { targetId: me.id, anim: i % 2 ? 'move' : 'attack', animTime: 0.3, hp: 150 }));
  return {
    state: s, script: [], labels: [],
    tick: (t) => {
      for (const e of s.entities) if (e.kind === 'monster' && e.anim === 'attack') e.animTime = 0.6 - ((t + e.id * 0.1) % 0.6);
    },
  };
}

export function run(params: URLSearchParams): void {
  const zone = (params.get('zone') ?? 'lobby') as FloorTheme;
  const bench = params.get('bench');
  if (bench) {
    const scene = benchScene(zone, bench);
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    canvas.style.width = `${Math.floor(LOGICAL_W * 0.54)}px`;
    canvas.style.height = `${Math.floor(LOGICAL_H * 0.54)}px`;
    const r = createRenderer(canvas);
    const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false };
    const g = canvas.getContext('2d')!;
    let t = 0;
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      scene.tick!(t, 1 / 60);
      const t0 = performance.now();
      r.render(scene.state, [], 1 / 60, ui);
      g.getImageData(0, 0, 1, 1); // flush the raster work into the measurement
      times.push(performance.now() - t0);
      t += 1 / 60;
    }
    times.sort((a, b) => a - b);
    const avg = times.slice(20).reduce((a, b) => a + b, 0) / (times.length - 20);
    window.__sandbox = { ready: true, bench: +avg.toFixed(2) } as Window['__sandbox'];
    return;
  }
  const fx = params.get('fx');
  const bossId = params.get('boss');
  const scene: Scene = fx
    ? fxScene(zone, fx)
    : bossId
      ? bossScene(zone, bossId === '1' ? ZONE_BOSS[zone] : bossId, Number(params.get('phase') ?? '1'), params.get('enraged') === '1')
      : params.get('pack') === '1'
        ? packScene(zone)
        : galleryScene(zone);
  const total = Number(params.get('t') ?? '0.8');
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const fit = () => {
    const k = Math.min(window.innerWidth / LOGICAL_W, window.innerHeight / LOGICAL_H);
    canvas.style.width = `${Math.floor(LOGICAL_W * k)}px`;
    canvas.style.height = `${Math.floor(LOGICAL_H * k)}px`;
  };
  fit();
  const r = createRenderer(canvas);
  const ui: RenderUiState = { localPlayer: 0, dragPreview: null, freezeCamera: false };
  const ctx = canvas.getContext('2d')!;
  let t = 0;
  const DT = 1 / 60;
  const script = [...scene.script].sort((a, b) => a.at - b.at);
  function frame(dt: number): void {
    const evs: GameEvent[] = pending.splice(0);
    while (script.length && script[0].at <= t + 1e-9) evs.push(script.shift()!.ev);
    scene.tick?.(t, dt);
    scene.state.tick++;
    scene.state.time += dt;
    r.render(scene.state, evs, dt, ui);
    t += dt;
    if (scene.labels.length) {
      ctx.font = '800 15px "Pretendard","Noto Sans KR",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const l of scene.labels) {
        const e = scene.state.entities.find(x => x.id === l.id);
        if (!e) continue;
        const p = r.worldToScreen({ x: e.pos.x, y: e.pos.y + 0.55 });
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000';
        ctx.strokeText(l.text, p.x, p.y);
        ctx.fillStyle = '#fff';
        ctx.fillText(l.text, p.x, p.y);
      }
    }
  }
  for (let i = 0; i * DT < total; i++) frame(DT);
  window.__sandbox = { ready: true, step: (ms: number) => { for (let k = 0; k < Math.round(ms / (1000 * DT)); k++) frame(DT); } };
}
