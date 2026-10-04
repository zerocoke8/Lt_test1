// Visual sandbox for the renderer: hand-made GameState fixtures + synthetic events.
// Serve: npx vite --port 5174  →  http://localhost:5174/tests/visual/render-sandbox.html
// Params: scene=normal|boss  t=<seconds simulated before the first shot>  drag=valid|invalid|pet|none
//         enraged=1  cutin=1  live=1 (keep animating)  freeze=1 (no fixture animation)
//         stress=1 (≈60 entities + 30 projectiles + a hail of damage events)  bench=1 (rAF timing run, 240 frames)
//         scene=sim [&floor=5] [&t=20]: drives the real createGame (all players bot-controlled) through the renderer

import { createRenderer } from '../../src/render';
import { BOSS_POS, BOT_PRESETS, DEFAULT_TUNABLES, PLAYER_COLORS } from '../../src/config';
import { getBoss, getCharacter, getMonster } from '../../src/data';
import type {
  ContributionStats,
  DragPreview,
  Entity,
  GameEvent,
  GameState,
  PlayerState,
  Projectile,
  StatusId,
  StatusInstance,
  Telegraph,
  Vec2,
  Zone,
} from '../../src/types';
import { LOGICAL_H, LOGICAL_W } from '../../src/types';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'normal';
const simSeconds = Number(params.get('t') ?? '0.6');
const dragMode = params.get('drag') ?? (scene === 'normal' ? 'valid' : 'none');
const enraged = params.get('enraged') === '1';
const cutin = params.get('cutin') === '1';
const live = params.get('live') === '1';
const freeze = params.get('freeze') === '1';
const stress = params.get('stress') === '1';
const bench = params.get('bench') === '1';
const appear = params.get('appear') === '1';

// ─────────────────────────── fixture builders ───────────────────────────

let nextId = 1;

function stats(): ContributionStats {
  return {
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
  };
}

function st(id: StatusId, remaining: number, total: number, value = 0.3): StatusInstance {
  return { id, remaining, total, value, sourcePlayer: null };
}

function baseEntity(e: Partial<Entity> & Pick<Entity, 'kind' | 'team' | 'defId' | 'tier' | 'pos' | 'radius' | 'maxHp'>): Entity {
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

function monster(defId: string, x: number, y: number, extra: Partial<Entity> = {}): Entity {
  const d = getMonster(defId);
  return baseEntity({
    kind: 'monster',
    team: 'enemy',
    defId,
    tier: d.tier,
    pos: { x, y },
    radius: d.radius,
    maxHp: Math.round(d.stats.maxHp * 1.12),
    facing: Math.PI,
    ...extra,
  });
}

function character(owner: number, partyIndex: number, defId: string, x: number, y: number, extra: Partial<Entity> = {}): Entity {
  const d = getCharacter(defId);
  return baseEntity({
    kind: 'character',
    team: 'ally',
    defId,
    tier: 'character',
    pos: { x, y },
    radius: 0.5,
    maxHp: d.stats.maxHp,
    ownerPlayer: owner,
    partyIndex,
    ...extra,
  });
}

function player(id: number, name: string, isBot: boolean, chars: string[], active: number | null, entityId: number | null): PlayerState {
  return {
    id,
    name,
    isBot,
    color: PLAYER_COLORS[id],
    party: chars.map((c, i) => {
      const d = getCharacter(c);
      return {
        defId: c,
        hp: d.stats.maxHp,
        maxHp: d.stats.maxHp,
        shield: 0,
        statuses: [],
        dead: false,
        reviveRemaining: 0,
        swapCooldownRemaining: i === active ? d.swapCooldown : 0,
        swapCooldownTotal: d.swapCooldown,
        normalCooldownRemaining: 0,
        entityId: i === active ? entityId : null,
      };
    }),
    activeIndex: active,
    pets: [],
    ult: { charge: 0.6, fullSince: null },
    out: false,
    appearLock: 0,
    relics: [],
    rewards: [],
    stats: stats(),
  };
}

function telegraph(team: 'ally' | 'enemy', center: Vec2, origin: Vec2, area: Telegraph['area'], remaining: number, total: number): Telegraph {
  return { id: nextId++, team, center, origin, area, remaining, total };
}

function zone(team: 'ally' | 'enemy', owner: number | null, center: Vec2, radius: number, kind: Zone['kind'], remaining: number, total: number): Zone {
  return { id: nextId++, team, ownerPlayer: owner, center, radius, remaining, total, kind };
}

function projectile(team: 'ally' | 'enemy', pos: Vec2, targetId: number | null, targetPos: Vec2, speed: number, color: string): Projectile {
  return { id: nextId++, team, pos, targetId, targetPos, speed, color };
}

interface Fixture {
  state: GameState;
  script: { at: number; ev: GameEvent }[];
  drag: DragPreview | null;
}

function emptyState(floor: number, kind: 'normal' | 'boss', w: number, h: number): GameState {
  return {
    seed: 1,
    tick: 0,
    time: 0,
    phase: 'combat',
    floor,
    plan: { floor, kind, timeLimit: kind === 'boss' ? 90 : 120, arena: { width: w, height: h }, statMult: 1.12, waves: [] },
    floorTime: 30,
    timeRemaining: 90,
    entities: [],
    players: [],
    telegraphs: [],
    zones: [],
    projectiles: [],
    bossId: null,
    bossEnraged: false,
    wavesRemaining: 2,
    monstersAlive: 0,
    midBossSpawned: true,
    rewardOffers: null,
    runResult: null,
  };
}

// ─────────────────────────── normal floor ───────────────────────────

function normalFixture(): Fixture {
  const s = emptyState(2, 'normal', 36, 12);
  // local player's mage, bots' ranger + berserker, plus a turret summon (pet)
  const me = character(0, 1, 'mage', 14.5, 6.2, appear ? { facing: 0, anim: 'appear', animTime: 0.5, invulnTime: 0.5 } : { facing: 0, statuses: [st('atkUp', 3, 5)], anim: 'cast', animTime: 0.2 });
  const bot1 = character(1, 1, 'ranger', 11.2, 8.6, { facing: 0.2, hp: 300, anim: 'attack', animTime: 0.12, statuses: [st('haste', 2, 4)] });
  const bot2 = character(2, 2, 'berserker', 19.6, 4.6, { facing: 0, hp: 420, shield: 160, anim: 'attack', animTime: 0.1, statuses: [st('atkUp', 6, 8), st('lifesteal', 6, 8), st('slow', 1, 3)] });
  const turret = baseEntity({ kind: 'summon', team: 'ally', defId: 'turret', tier: 'summon', pos: { x: 12.8, y: 3.4 }, radius: 0.45, maxHp: 300, hp: 260, ownerPlayer: 0, expiresIn: 6, facing: 0 });
  s.entities.push(me, bot1, bot2, turret);
  s.players.push(
    player(0, '나', false, ['guardian', 'mage', 'cleric'], 1, me.id),
    player(1, 'BOT 1', true, ['guardian', 'ranger', 'cleric'], 1, bot1.id),
    player(2, 'BOT 2', true, ['blade', 'mage', 'berserker'], 2, bot2.id),
  );

  const ogre = monster('ogre', 21.6, 6.4, { hp: 640, anim: 'cast', animTime: 0.5, statuses: [st('burn', 2, 4), st('vulnerable', 3, 5)] });
  const lich = monster('lich', 27.5, 3.2, { hp: 700 });
  const mons: Entity[] = [
    ogre,
    lich,
    monster('slime', 17.2, 7.5, { hp: 40 }),
    monster('slime', 18.4, 9.0),
    monster('goblin', 16.8, 5.4, { hp: 20, anim: 'stunned', statuses: [st('stun', 0.6, 1)] }),
    monster('goblin', 20.5, 8.8, { anim: 'move' }),
    monster('goblin', 23.4, 9.6, { anim: 'move' }),
    monster('skeleton_archer', 24.2, 4.1, { anim: 'attack', animTime: 0.2 }),
    monster('skeleton_archer', 25.4, 7.3),
    monster('bomb_bug', 16.0, 10.2, { anim: 'move', facing: Math.PI * 0.8 }),
    monster('bomb_bug', 9.8, 2.3, { anim: 'move', facing: 0 }),
    monster('golem', 22.8, 2.4, { hp: 150, statuses: [st('slow', 2, 3)] }),
    monster('golem', 26.6, 10.4),
    monster('slime', 8.4, 10.6, { facing: 0 }),
    monster('goblin', 7.2, 4.8, { facing: 0, anim: 'attack', animTime: 0.15 }),
  ];
  for (const m of mons) m.targetId = me.id;
  s.entities.push(...mons);
  s.monstersAlive = mons.length;

  s.telegraphs.push(
    telegraph('enemy', { x: 19.6, y: 5.6 }, { x: 21.6, y: 6.4 }, { shape: 'circle', radius: 3 }, 0.5, 1.2), // ogre slam
    telegraph('ally', { x: 24.6, y: 8.4 }, { x: 24.6, y: 8.4 }, { shape: 'circle', radius: 3 }, 0.35, 0.6), // meteor
    telegraph('enemy', { x: 12.0, y: 9.6 }, { x: 27.5, y: 3.2 }, { shape: 'line', length: 9, width: 1.6 }, 0.9, 1.5),
  );
  s.zones.push(
    zone('ally', 1, { x: 23.8, y: 4.2 }, 2.8, 'damage', 2.0, 3), // arrow rain
    zone('ally', 0, { x: 12.4, y: 7.0 }, 3, 'heal', 3.0, 4), // cleric spring
    zone('enemy', null, { x: 9.0, y: 4.0 }, 2.5, 'debuff', 2.5, 4), // lich curse
  );
  s.projectiles.push(
    projectile('ally', { x: 14.2, y: 8.0 }, ogre.id, ogre.pos, 18, '#06d6a0'),
    projectile('ally', { x: 17.6, y: 6.4 }, ogre.id, ogre.pos, 12, '#ff9e3d'),
    projectile('enemy', { x: 20.4, y: 5.0 }, me.id, me.pos, 10, '#e9ecef'),
    projectile('enemy', { x: 25.0, y: 3.9 }, me.id, me.pos, 9, '#c77dff'),
    projectile('ally', { x: 14.0, y: 3.7 }, mons[11].id, mons[11].pos, 16, '#adb5bd'),
  );

  const script: Fixture['script'] = [
    { at: 0.02, ev: { type: 'spawnWarning', pos: { x: 30.5, y: 6 }, delay: 1 } },
    { at: 0.02, ev: { type: 'spawnWarning', pos: { x: 4.2, y: 9.8 }, delay: 1 } },
    { at: 0.05, ev: { type: 'appear', player: 0, partyIndex: 1, entityId: me.id, pos: me.pos } },
    { at: 0.05, ev: { type: 'skillCast', sourceId: me.id, player: 0, slot: 'drag', skillId: 'mage_d', name: '운석 낙하', center: { x: 24.6, y: 8.4 }, area: { shape: 'circle', radius: 3 }, team: 'ally' } },
    { at: 0.1, ev: { type: 'attack', sourceId: bot2.id, targetId: ogre.id, ranged: false } },
    { at: 0.1, ev: { type: 'damage', targetId: ogre.id, amount: 87, crit: true, pos: ogre.pos, targetTeam: 'enemy', absorbed: 0 } },
    { at: 0.2, ev: { type: 'damage', targetId: mons[2].id, amount: 31, crit: false, pos: mons[2].pos, targetTeam: 'enemy', absorbed: 0 } },
    { at: 0.25, ev: { type: 'damage', targetId: bot1.id, amount: 14, crit: false, pos: bot1.pos, targetTeam: 'ally', absorbed: 0 } },
    { at: 0.3, ev: { type: 'heal', targetId: me.id, amount: 45, pos: me.pos } },
    { at: 0.3, ev: { type: 'damage', targetId: bot2.id, amount: 0, crit: false, pos: bot2.pos, targetTeam: 'ally', absorbed: 22 } },
    { at: 0.35, ev: { type: 'skillCast', sourceId: null, player: 1, slot: 'pet', skillId: 'owl_frost', name: '서리 부엉이', center: { x: 17.4, y: 8.0 }, area: { shape: 'circle', radius: 3 }, team: 'ally' } },
    { at: 0.4, ev: { type: 'skillCast', sourceId: ogre.id, player: null, slot: 'monster', skillId: 'ogre_slam', name: '내려찍기', center: { x: 19.6, y: 5.6 }, area: { shape: 'circle', radius: 3 }, team: 'enemy' } },
    { at: 0.45, ev: { type: 'damage', targetId: mons[4].id, amount: 52, crit: false, pos: mons[4].pos, targetTeam: 'enemy', absorbed: 0 } },
  ];
  if (cutin) {
    script.push({ at: 0.15, ev: { type: 'skillCast', sourceId: me.id, player: 0, slot: 'ult', skillId: 'mage_u', name: '블리자드', center: ogre.pos, area: { shape: 'circle', radius: 4 }, team: 'ally' } });
  }
  const drag: DragPreview | null =
    dragMode === 'valid'
      ? { kind: 'swap', pos: { x: 9.0, y: 7.6 }, area: { shape: 'circle', radius: 3.5 }, valid: true, color: '#4cc9f0' }
      : dragMode === 'invalid'
        ? { kind: 'swap', pos: { x: 6.0, y: 11.6 }, area: { shape: 'circle', radius: 2.2 }, valid: false, color: '#4cc9f0' }
        : dragMode === 'pet'
          ? { kind: 'pet', pos: { x: 9.0, y: 7.6 }, area: { shape: 'circle', radius: 4 }, valid: true, color: '#5a189a' }
          : null;
  return { state: s, script, drag };
}

// ─────────────────────────── boss floor ───────────────────────────

function bossFixture(): Fixture {
  const s = emptyState(5, 'boss', 24, 12);
  const def = getBoss('abyss_watcher');
  const me = character(0, 0, 'guardian', 10.5, 5.5, { facing: -0.6, statuses: [st('defUp', 2, 4)], shield: 200, anim: 'attack', animTime: 0.1 });
  const bot1 = character(1, 2, 'cleric', 6.0, 8.5, { hp: 380, facing: -1 });
  const bot2 = character(2, 0, 'blade', 15.5, 4.2, { anim: 'attack', animTime: 0.08, statuses: [st('haste', 2, 4)] });
  s.entities.push(me, bot1, bot2);
  s.players.push(
    player(0, '나', false, ['guardian', 'mage', 'cleric'], 0, me.id),
    player(1, 'BOT 1', true, ['guardian', 'ranger', 'cleric'], 2, bot1.id),
    player(2, 'BOT 2', true, ['blade', 'mage', 'berserker'], 0, bot2.id),
  );
  const boss = baseEntity({
    kind: 'monster',
    team: 'enemy',
    defId: def.id,
    tier: 'boss',
    pos: { ...BOSS_POS },
    radius: def.radius,
    maxHp: def.stats.maxHp,
    hp: 5200,
    targetId: me.id,
    anim: 'cast',
    animTime: 0.6,
    enraged,
  });
  s.entities.push(boss);
  s.bossId = boss.id;
  s.bossEnraged = enraged;
  const adds = [
    monster('goblin', 9.4, 3.2, { anim: 'move', facing: 0.3 }),
    monster('goblin', 13.2, 3.0, { hp: 30 }),
    monster('goblin', 16.8, 6.0, { anim: 'move' }),
    monster('goblin', 4.5, 6.4, { facing: 0 }),
  ];
  for (const a of adds) a.targetId = me.id;
  s.entities.push(...adds);
  s.telegraphs.push(
    telegraph('enemy', { x: 6.0, y: 8.5 }, { x: 6.0, y: 8.5 }, { shape: 'circle', radius: 3 }, 0.6, 1.5), // 심연 폭발
    telegraph('enemy', { x: 17.0, y: 9.0 }, { ...BOSS_POS }, { shape: 'line', length: 16, width: 3 }, 1.2, 1.8), // 대지 균열
  );
  s.zones.push(zone('ally', 1, { x: 6.5, y: 8.0 }, 3, 'heal', 2.5, 4));
  s.projectiles.push(
    projectile('enemy', { x: 11.4, y: 2.0 }, me.id, me.pos, 11, '#7b2cbf'),
    projectile('ally', { x: 8.0, y: 6.0 }, boss.id, boss.pos, 14, '#ffd166'),
  );
  const script: Fixture['script'] = [
    { at: 0.05, ev: { type: 'skillCast', sourceId: boss.id, player: null, slot: 'monster', skillId: 'boss_burst', name: '심연 폭발', center: { x: 6, y: 8.5 }, area: { shape: 'circle', radius: 3 }, team: 'enemy' } },
    { at: 0.1, ev: { type: 'damage', targetId: boss.id, amount: 132, crit: true, pos: boss.pos, targetTeam: 'enemy', absorbed: 0 } },
    { at: 0.2, ev: { type: 'damage', targetId: boss.id, amount: 41, crit: false, pos: boss.pos, targetTeam: 'enemy', absorbed: 0 } },
    { at: 0.25, ev: { type: 'damage', targetId: me.id, amount: 58, crit: false, pos: me.pos, targetTeam: 'ally', absorbed: 30 } },
    { at: 0.3, ev: { type: 'death', entityId: adds[1].id, pos: adds[1].pos, kind: 'monster', tier: 'normal' } },
  ];
  if (enraged) script.push({ at: 0.05, ev: { type: 'enrage' } });
  if (cutin) {
    script.push({ at: 0.15, ev: { type: 'skillCast', sourceId: me.id, player: 0, slot: 'ult', skillId: 'guardian_u', name: '불굴의 성벽', center: me.pos, area: { shape: 'circle', radius: 4 }, team: 'ally' } });
  }
  return { state: s, script, drag: null };
}

// ─────────────────────────── run ───────────────────────────

if (scene === 'sim') void runSim();
else runFixture();

/** Hand-made fixture scenes (normal / boss) + synthetic events. */
function runFixture(): void {
  const fixture = scene === 'boss' ? bossFixture() : normalFixture();
  const state = fixture.state;

  // cosmetic PRNG for the sandbox only (deterministic screenshots)
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);

  if (stress) {
    const ids = ['slime', 'goblin', 'skeleton_archer', 'bomb_bug', 'golem'];
    const w = state.plan.arena.width;
    while (state.entities.length < 60) {
      const m = monster(ids[state.entities.length % ids.length], 2 + rnd() * (w - 4), 1 + rnd() * 10, { anim: rnd() < 0.5 ? 'move' : 'attack', animTime: 0.3, facing: rnd() * Math.PI * 2 });
      m.hp = m.maxHp * (0.3 + rnd() * 0.7);
      if (rnd() < 0.3) m.statuses.push(st('slow', 2, 3));
      state.entities.push(m);
    }
    const ens = state.entities;
    for (let i = 0; i < 30; i++) {
      const t = ens[Math.floor(rnd() * ens.length)];
      state.projectiles.push(projectile(rnd() < 0.5 ? 'ally' : 'enemy', { x: 2 + rnd() * (w - 4), y: 1 + rnd() * 10 }, t.id, t.pos, 12, rnd() < 0.5 ? '#ffd166' : '#e9ecef'));
    }
  }

  /** Per-frame synthetic event hail for stress/bench runs. */
  function stressEvents(out: GameEvent[]): void {
    const ens = state.entities;
    for (let i = 0; i < 6; i++) {
      const t = ens[Math.floor(rnd() * ens.length)];
      if (t.tier === 'boss') continue;
      out.push({ type: 'damage', targetId: t.id, amount: 5 + rnd() * 60, crit: rnd() < 0.15, pos: t.pos, targetTeam: t.team, absorbed: 0 });
      const src = ens[Math.floor(rnd() * ens.length)];
      out.push({ type: 'attack', sourceId: src.id, targetId: t.id, ranged: false });
    }
    if (rnd() < 0.05) {
      const t = ens[Math.floor(rnd() * ens.length)];
      out.push({ type: 'skillCast', sourceId: null, player: 1, slot: 'drag', skillId: 'x', name: '테스트', center: { x: t.pos.x, y: t.pos.y }, area: { shape: 'circle', radius: 3 }, team: 'ally' });
    }
    if (rnd() < 0.1) {
      const t = ens[Math.floor(rnd() * ens.length)];
      out.push({ type: 'heal', targetId: t.id, amount: 30, pos: t.pos });
    }
  }
  // remove the goblin that "died" in the boss script at that moment
  const deaths = new Map<number, number>();
  for (const s of fixture.script) if (s.ev.type === 'death') deaths.set(s.ev.entityId, s.at);

  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = createRenderer(canvas);

  function fit(): void {
    const k = Math.min(window.innerWidth / LOGICAL_W, window.innerHeight / LOGICAL_H);
    canvas.style.width = `${Math.floor(LOGICAL_W * k)}px`;
    canvas.style.height = `${Math.floor(LOGICAL_H * k)}px`;
  }
  fit();
  window.addEventListener('resize', fit);

  let simT = 0;
  const DT = 1 / 60;

  /** Tiny fixture animation (sandbox only): anim timers tick, attack anims loop, projectiles fly, timers drain. */
  function animateFixture(dt: number): void {
    if (freeze) return;
    state.time += dt;
    for (const e of state.entities) {
      if (e.animTime > 0) {
        e.animTime = Math.max(0, e.animTime - dt);
        if (e.animTime === 0) {
          if (e.anim === 'attack') e.animTime = 0.6; // loop a slow attack for liveliness
          else if (e.anim === 'cast') e.animTime = 0.8;
          else if (e.anim === 'appear') e.anim = 'idle';
        }
      }
      if (e.anim === 'move') e.pos.x += Math.cos(e.facing) * 0.4 * dt * (live ? 1 : 0);
    }
    for (const t of state.telegraphs) {
      t.remaining -= dt;
      if (t.remaining <= 0) t.remaining = t.total;
    }
    for (const z of state.zones) {
      z.remaining -= dt;
      if (z.remaining <= 0) z.remaining = z.total;
    }
    for (const p of state.projectiles) {
      const dx = p.targetPos.x - p.pos.x;
      const dy = p.targetPos.y - p.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.3) continue;
      const step = Math.min(d, p.speed * dt * 0.15);
      p.pos.x += (dx / d) * step;
      p.pos.y += (dy / d) * step;
    }
  }

  const ui = { localPlayer: 0, dragPreview: fixture.drag, freezeCamera: false };

  function frame(): void {
    const prev = simT;
    simT += DT;
    const evs: GameEvent[] = [];
    for (const s of fixture.script) if (s.at > prev && s.at <= simT) evs.push(s.ev);
    if (stress) stressEvents(evs);
    for (const [id, at] of deaths) {
      if (at > prev && at <= simT) {
        const i = state.entities.findIndex(e => e.id === id);
        if (i >= 0) state.entities.splice(i, 1);
      }
    }
    animateFixture(DT);
    const t0 = performance.now();
    renderer.render(state, evs, DT, ui);
    lastMs = performance.now() - t0;
  }

  let lastMs = 0;
  const frames = Math.max(1, Math.round(simSeconds / DT));
  let total = 0;
  const frameMs: number[] = [];
  for (let i = 0; i < frames; i++) {
    frame();
    total += lastMs;
    frameMs.push(Math.round(lastMs * 100) / 100);
  }
  const hud = document.getElementById('hud')!;
  hud.innerHTML = `<b>${scene}</b> · ${state.entities.length} entities · avg render ${(total / frames).toFixed(2)} ms · canvas ${canvas.width}×${canvas.height}`;
  (window as unknown as { __sandbox: unknown }).__sandbox = {
    ready: true,
    avgMs: total / frames,
    frameMs,
    worldToScreen: (v: Vec2) => renderer.worldToScreen(v),
    screenToWorld: (p: Vec2) => renderer.screenToWorld(p),
  };

  if (live) {
    const loop = () => {
      frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  if (bench) {
    // Real presentation path: one render per rAF. Reports JS render time and frame intervals.
    const js: number[] = [];
    const gaps: number[] = [];
    let last = 0;
    let n = 0;
    const step = (ts: number) => {
      if (last) gaps.push(ts - last);
      last = ts;
      frame();
      js.push(lastMs);
      if (++n < 240) requestAnimationFrame(step);
      else {
        const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
        const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
        const res = { entities: state.entities.length, projectiles: state.projectiles.length, jsAvg: avg(js), jsP95: p95(js), gapAvg: avg(gaps), gapP95: p95(gaps) };
        (window as unknown as { __bench: unknown }).__bench = res;
        hud.innerHTML += ` · bench js ${res.jsAvg.toFixed(2)}ms (p95 ${res.jsP95.toFixed(2)}) · frame ${res.gapAvg.toFixed(1)}ms`;
      }
    };
    requestAnimationFrame(step);
  }
}

// ─────────────────────────── real sim integration ───────────────────────────

async function runSim(): Promise<void> {
  const hudEl = document.getElementById('hud')!;
  const cv = document.getElementById('c') as HTMLCanvasElement;
  const fitCv = () => {
    const k = Math.min(window.innerWidth / LOGICAL_W, window.innerHeight / LOGICAL_H);
    cv.style.width = `${Math.floor(LOGICAL_W * k)}px`;
    cv.style.height = `${Math.floor(LOGICAL_H * k)}px`;
  };
  fitCv();
  window.addEventListener('resize', fitCv);
  try {
    const { createGame } = await import('../../src/sim');
    const game = createGame({
      seed: Number(params.get('seed') ?? '7'),
      players: [
        { name: '나', isBot: true, characters: ['guardian', 'mage', 'cleric'], pets: ['frog_bomb', 'owl_frost', 'golem_turret'] },
        ...BOT_PRESETS.map(b => ({ name: b.name, isBot: true, characters: b.characters, pets: b.pets })),
      ],
      tunables: { ...DEFAULT_TUNABLES },
      startFloor: Number(params.get('floor') ?? '1'),
    });
    const r = createRenderer(cv);
    const uiState = { localPlayer: 0, dragPreview: null, freezeCamera: false };
    const step = () => {
      game.step(1 / 60);
      if (game.state.phase === 'reward') game.dispatch({ type: 'chooseReward', player: 0, offerIndex: 0 });
      r.render(game.state, game.drainEvents(), 1 / 60, uiState);
    };
    const n = Math.round(simSeconds * 60);
    for (let i = 0; i < n; i++) step();
    const st = game.state;
    hudEl.innerHTML = `<b>sim</b> · floor ${st.floor} (${st.plan.kind}) · t ${st.floorTime.toFixed(1)}s · ${st.entities.length} entities · phase ${st.phase}`;
    (window as unknown as { __sandbox: unknown }).__sandbox = { ready: true, avgMs: 0, frameMs: [] };
    if (live) {
      const loop = () => {
        step();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  } catch (err) {
    hudEl.innerHTML = `<b>sim error</b>: ${String(err)}`;
    (window as unknown as { __sandbox: unknown }).__sandbox = { ready: true, avgMs: 0, frameMs: [], error: String(err) };
  }
}
