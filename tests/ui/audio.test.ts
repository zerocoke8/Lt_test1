// 기획 13차 효과음 (docs/sfx.md): routing of every GameEvent, stage coverage for the renewed skills, mixing rules
// (rate limits, voice caps, far versions, ducking floor, mute), the file override manifest, settings, button sounds,
// baking — all without a real AudioContext (a small fake records what the engine schedules).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOSSES, CHARACTERS, FIELD_EVENTS, GOEDAM_ROOMS, PETS } from '../../src/data';
import type { Entity, GameEvent, GameState, PlayerState } from '../../src/types';
import { DASH_LAND } from '../../src/render/dashtime';
import { Director, EVENT_SOUNDS, JUST_DUCK, mergeFrame, type Routed, type SoundReq } from '../../src/audio/director';
import { AudioEngine, DUCK_FLOOR_DB, duckDb } from '../../src/audio/engine';
import { GROUP_CAP, dbToGain, familyDefault, sfxRow } from '../../src/audio/ids';
import { BAKE_BUSY_MS, BAKE_SLICE_MS, Baker, bakeBudget, bakeSamples } from '../../src/audio/bake';
import { FILE_TABLE, buildFileTable, resolveSource, type FileLevel, type FileSource } from '../../src/audio/manifest';
import LEVELS from '../../src/audio/files/levels.json';
import { AUDIO_DEFAULTS, forcedMute, loadAudio, sanitizeAudio } from '../../src/audio/settings';
import { STAGE_CUES, stageCues } from '../../src/audio/stages';
import { CHAR_VOICE } from '../../src/audio/synth/voices';
import { BOSS_KINDS, BOSS_TIMBRES, BOSS_VOICE, bossSkillKind } from '../../src/audio/synth/bossVoices';
import { hasRecipe, recipeIds } from '../../src/audio/synth/recipes';
import { peakOf } from '../../src/audio/synth/prims';
import { uiSoundFor, type UiTarget } from '../../src/audio/uiSfx';
import { Sfx } from '../../src/audio';
import { boardFamily } from '../../src/audio/devboard';

/** 기획 19차: baked boss.intro digests of the classic four (length:hash) — the same on the commit before the voice registry (18d69b8). */
const CLASSIC_INTRO_DIGEST: Record<string, string> = { elevator_keeper: '105600:665229598', overtime_lord: '105600:3062746771', surgeon_director: '105600:3954526778', abyss_watcher: '105600:3386170169' };

// ─────────────────────────── fake AudioContext ───────────────────────────

class FakeParam {
  value: number;
  calls: [string, number, number][] = [];
  constructor(v = 1) {
    this.value = v;
  }
  setValueAtTime(v: number, t: number) {
    this.calls.push(['set', v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(['lin', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.calls.push(['exp', v, t]);
  }
  setTargetAtTime(v: number, t: number) {
    this.calls.push(['target', v, t]);
    this.value = v;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(['cancel', 0, t]);
  }
}

class FakeNode {
  out: FakeNode[] = [];
  constructor(readonly kind: string) {}
  connect(n: FakeNode) {
    this.out.push(n);
    return n;
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
  constructor() {
    super('gain');
  }
}

class FakeSource extends FakeNode {
  buffer: { duration: number; tag?: string } | null = null;
  playbackRate = new FakeParam(1);
  loop = false;
  startAt: number | null = null;
  /** 기획 21차: the offset / duration of start(t, offset, duration) (a file with a trimmed head / tail); [] = start(t). */
  startArgs: number[] = [];
  loopStart = 0;
  loopEnd = 0;
  stopAt: number | null = null;
  onended: (() => void) | null = null;
  constructor() {
    super('source');
  }
  start(t: number, ...rest: number[]) {
    this.startAt = t;
    this.startArgs = rest;
  }
  stop(t: number) {
    // same rule as the browser: stop() before start() throws
    if (this.startAt == null) throw new Error("cannot call stop without calling start first");
    this.stopAt = t;
  }
}

class FakeCtx {
  currentTime = 0;
  state = 'running';
  destination = new FakeNode('dest');
  sources: FakeSource[] = [];
  onstatechange: (() => void) | null = null;
  createGain() {
    return new FakeGain();
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createStereoPanner() {
    return Object.assign(new FakeNode('pan'), { pan: new FakeParam(0) });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode('biquad'), { type: 'lowpass', frequency: new FakeParam(20000) });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode('comp'), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
  createBuffer(_ch: number, n: number, sr: number) {
    const data = new Float32Array(n);
    return { duration: n / sr, length: n, getChannelData: () => data };
  }
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
}

function engine(o: { maxVoices?: number; files?: Map<string, { urls: string[]; gain: number; rate: [number, number] }> } = {}) {
  const ctx = new FakeCtx();
  const e = new AudioEngine({ random: () => 0.5, bakeInFrame: true, maxVoices: o.maxVoices ?? 24, files: o.files ?? new Map(), loadFile: async (_c, url) => ({ duration: 1, tag: url }) as unknown as AudioBuffer });
  e.init(ctx as unknown as AudioContext);
  return { e, ctx };
}

// ─────────────────────────── state fixture ───────────────────────────

const ent = (o: Partial<Entity>): Entity =>
  ({
    id: 1,
    kind: 'monster',
    team: 'enemy',
    defId: 'slime',
    tier: 'normal',
    pos: { x: 10, y: 5 },
    radius: 0.4,
    facing: 0,
    hp: 100,
    maxHp: 100,
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
    ...o,
  }) as Entity;

const player = (id: number, chars = ['guardian', 'blade', 'mage']): PlayerState =>
  ({
    id,
    name: `p${id}`,
    isBot: id !== 0,
    color: '#fff',
    party: chars.map((defId, i) => ({ defId, hp: 100, maxHp: 100, shield: 0, statuses: [], dead: false, reviveRemaining: 0, swapCooldownRemaining: 5, swapCooldownTotal: 10, normalCooldownRemaining: 0, entityId: i === 0 ? 100 + id : null, ult: { charge: 0, fullSince: null } })),
    activeIndex: 0,
    pets: [{ defId: 'frog_bomb', cooldownRemaining: 0, cooldownTotal: 28 }],
    out: false,
    appearLock: 0,
    relics: [],
    rewards: [],
    stats: {},
    goedamTraces: [],
    goedamLog: [],
  }) as unknown as PlayerState;

function state(o: Partial<GameState> = {}): GameState {
  return {
    seed: 1,
    tick: 100,
    time: 3,
    phase: 'combat',
    floor: 3,
    plan: { floor: 3, kind: 'normal', timeLimit: 120, arena: { width: 24, height: 12 }, statMult: 1, waves: [], theme: 'lobby' },
    floorTime: 3,
    timeRemaining: 100,
    entities: [
      ent({ id: 100, kind: 'character', team: 'ally', defId: 'guardian', tier: 'character', ownerPlayer: 0, partyIndex: 0, pos: { x: 6, y: 6 } }),
      ent({ id: 101, kind: 'character', team: 'ally', defId: 'ranger', tier: 'character', ownerPlayer: 1, partyIndex: 0, pos: { x: 8, y: 6 } }),
      ent({ id: 1, defId: 'slime' }),
      ent({ id: 2, defId: 'bomb_bug' }),
      ent({ id: 3, defId: 'ogre', tier: 'mid' }),
      ent({ id: 4, defId: 'elevator_keeper', tier: 'boss' }),
      ent({ id: 5, defId: 'fe_toad' }),
      ent({ id: 6, kind: 'summon', team: 'ally', defId: 'turret', tier: 'summon', ownerPlayer: 0 }),
    ],
    players: [player(0), player(1, ['ranger', 'cleric', 'bard'])],
    telegraphs: [],
    zones: [],
    projectiles: [],
    bossId: null,
    bossEnraged: false,
    wavesRemaining: 1,
    monstersAlive: 3,
    midBossSpawned: false,
    rewardOffers: null,
    rewardOffersByPlayer: [null, null],
    goedam: null,
    fieldEvent: null,
    bossGroggy: { fill: 0.5, left: 0, total: 5, lock: 0, lockTotal: 10, count: 0, near: false, breaker: null },
    runResult: null,
    ...o,
  } as GameState;
}

const view = (o: Partial<{ localPlayer: number; gameSpeed: number; now: number }> = {}) => ({ localPlayer: 0, gameSpeed: 1, now: 10, ...o });

/** Route events on a warmed-up director (first frame only snapshots). */
function route(events: GameEvent[], s = state(), v = view(), d = new Director()): Routed {
  d.route([], s, { ...v, now: v.now - 1 });
  return d.route(events, s, v);
}
const ids = (r: Routed): string[] => r.sounds.map(x => x.id);

// one sample of every event type: a missing type is a compile error here
const P = { x: 10, y: 5 };
const SAMPLES: { [K in GameEvent['type']]: Extract<GameEvent, { type: K }> } = {
  damage: { type: 'damage', targetId: 1, amount: 10, crit: false, pos: P, targetTeam: 'enemy', absorbed: 0, source: 'basic' },
  heal: { type: 'heal', targetId: 100, amount: 5, pos: P },
  benchHeal: { type: 'benchHeal', player: 0, partyIndex: 1, amount: 5 },
  attack: { type: 'attack', sourceId: 100, targetId: 1, ranged: false },
  skillCast: { type: 'skillCast', sourceId: 100, player: 0, slot: 'normal', skillId: 'guardian_n', name: 'x', center: P, area: { shape: 'circle', radius: 2 }, team: 'ally' },
  skillStage: { type: 'skillStage', sourceId: 100, player: 0, slot: 'drag', skillId: 'guardian_d', stage: 'slam', actionIndex: 0, center: P, area: { shape: 'circle', radius: 2 }, team: 'ally', hit: 0, hits: 1, targets: 2 },
  ultCast: { type: 'ultCast', player: 0, entityId: 100, defId: 'guardian', skillId: 'guardian_u', name: 'x' },
  statusApplied: { type: 'statusApplied', targetId: 1, status: 'taunt', duration: 2, player: 0, sourceId: 100 },
  stasisEnd: { type: 'stasisEnd', entityId: 1, amount: 10, player: 0 },
  benchBuff: { type: 'benchBuff', player: 0, partyIndex: 1, status: 'atkUp', duration: 5, value: 0.1, from: 0 },
  reviveCut: { type: 'reviveCut', player: 0, partyIndex: 1, seconds: 5, from: 0 },
  swapCdCut: { type: 'swapCdCut', player: 0, seconds: 2, from: 0 },
  stageClear: { type: 'stageClear', stage: 1 },
  gearProc: { type: 'gearProc', player: 0, partyIndex: 0, id: 'w_appear_bolt', pos: P },
  // 기획 17차
  justSwap: { type: 'justSwap', player: 0, outIndex: 0, inIndex: 1, inEntityId: 100, pos: P, drop: P, sourceId: 1, skillId: 'x', boss: false, dodged: 1, telegraphIds: [7], landIn: 0.3, cdCut: 4 },
  rewardProc: { type: 'rewardProc', player: 0, partyIndex: 0, entityId: 100, rewardId: 'bolt', pos: P },
  tagSet: { type: 'tagSet', player: 0, tag: 'swap' },
  markClear: { type: 'markClear', targetId: 100, pos: P }, // 기획 20차
  appear: { type: 'appear', player: 0, partyIndex: 0, entityId: 100, pos: P },
  dash: { type: 'dash', entityId: 100, from: P, to: P, duration: 0.2 },
  blink: { type: 'blink', entityId: 1, from: P, to: P },
  bossPhase: { type: 'bossPhase', entityId: 4, phase: 1, name: 'x' },
  leave: { type: 'leave', player: 0, partyIndex: 0, pos: P },
  death: { type: 'death', entityId: 1, pos: P, kind: 'monster', tier: 'normal' },
  spawnWarning: { type: 'spawnWarning', pos: P, delay: 1 },
  interrupt: { type: 'interrupt', sourceId: 1, telegraphId: 9, pos: P, name: 'x' },
  spawn: { type: 'spawn', entityId: 1, pos: P, tier: 'normal' },
  revive: { type: 'revive', player: 0, partyIndex: 1 },
  playerOut: { type: 'playerOut', player: 1 },
  ultReady: { type: 'ultReady', player: 0, partyIndex: 0 },
  floorStart: { type: 'floorStart', floor: 3, kind: 'normal' },
  floorClear: { type: 'floorClear', floor: 3 },
  enrage: { type: 'enrage' },
  bossRetreat: { type: 'bossRetreat' },
  runOver: { type: 'runOver', result: { outcome: 'victory', reason: 'cleared', floorReached: 20, duration: 100 } },
  goedamOpen: { type: 'goedamOpen', floor: 3, roomId: 'copier' },
  goedamOutcome: { type: 'goedamOutcome', player: 0, optionId: 'x', outcomeId: 'y', tone: 'good' },
  goedamTrace: { type: 'goedamTrace', player: 0, traceId: 'x', floorsLeft: 2 },
  goedamTraceExpired: { type: 'goedamTraceExpired', player: 0, traceId: 'x' },
  fieldEventWarn: { type: 'fieldEventWarn', id: 'lucky_toad', pos: P },
  fieldEventStart: { type: 'fieldEventStart', id: 'lucky_toad', pos: P },
  fieldEventProgress: { type: 'fieldEventProgress', id: 'dark_lamps', progress: 1, goal: 4, player: 0, kind: 'lamp' },
  fieldEventEnd: { type: 'fieldEventEnd', id: 'lucky_toad', success: true, player: 0 },
  bossGroggy: { type: 'bossGroggy', entityId: 4, player: 0, count: 1, duration: 5 },
  bossGroggyEnd: { type: 'bossGroggyEnd', entityId: 4 },
  groggyGain: { type: 'groggyGain', player: 0, amount: 10, why: 'drag' },
};

// ─────────────────────────── routing ───────────────────────────

describe('sfx director: every GameEvent type has a sound', () => {
  it('EVENT_SOUNDS lists every event type, and each sample routes to a known sound', () => {
    expect(Object.keys(EVENT_SOUNDS).sort()).toEqual(Object.keys(SAMPLES).sort());
    for (const [type, ev] of Object.entries(SAMPLES)) {
      const r = route([ev as GameEvent]);
      if (EVENT_SOUNDS[type as GameEvent['type']] === 'none') continue;
      expect(ids(r).length, type).toBeGreaterThan(0);
      for (const id of ids(r)) expect(hasRecipe(id) || familyDefault(id, c => CHAR_VOICE[c]?.role ?? null) != null, `${type} → ${id}`).toBe(true);
    }
  });

  it('picks the doc ids for the common cases', () => {
    expect(ids(route([SAMPLES.damage]))).toEqual(['hit.basic']);
    expect(ids(route([{ ...SAMPLES.damage, crit: true, source: 'normal' }])).sort()).toEqual(['hit.crit', 'hit.skill']);
    expect(ids(route([{ ...SAMPLES.damage, targetId: 4 }]))).toEqual(['hit.boss']);
    expect(ids(route([{ ...SAMPLES.damage, weak: true, targetId: 5, source: 'pet' }])).sort()).toEqual(['hit.skill', 'hit.weak']);
    // drag / ult hits are silent: the landing sound carries them
    expect(ids(route([{ ...SAMPLES.damage, source: 'drag' }, { ...SAMPLES.damage, source: 'ult', crit: true }]))).toEqual([]);
    expect(ids(route([{ ...SAMPLES.damage, targetTeam: 'ally', targetId: 100 }]))).toEqual(['hurt.char']);
    expect(ids(route([{ ...SAMPLES.damage, targetTeam: 'ally', targetId: 100, amount: 0, absorbed: 30 }]))).toEqual(['hurt.shield']);
    expect(ids(route([{ ...SAMPLES.damage, targetTeam: 'ally', targetId: 101 }]))).toEqual([]);
    expect(ids(route([SAMPLES.attack]))).toEqual(['atk.swing.tank']);
    expect(ids(route([{ ...SAMPLES.attack, sourceId: 6, ranged: true }]))).toEqual(['atk.shot.turret']);
    expect(ids(route([{ ...SAMPLES.attack, sourceId: 101, ranged: true }]))).toEqual([]);
    expect(ids(route([{ ...SAMPLES.death, entityId: 2 }]))).toEqual(['mon.death.phone']);
    expect(ids(route([{ ...SAMPLES.dash, entityId: 5 }]))).toEqual(['fe.toad.hop']);
    expect(ids(route([SAMPLES.ultCast]))).toEqual(['ult.guardian.cutin']);
    expect(ids(route([{ ...SAMPLES.ultCast, player: 1 }]))).toEqual([]);
    expect(ids(route([{ ...SAMPLES.floorStart, floor: 6 }]))).toEqual(['zone.enter', 'floor.start.lobby']);
    expect(ids(route([{ ...SAMPLES.runOver, result: { outcome: 'defeat', reason: 'quit', floorReached: 3, duration: 1 } }]))).toEqual([]);
    expect(ids(route([{ ...SAMPLES.runOver, result: { outcome: 'defeat', reason: 'wipe', floorReached: 3, duration: 1 } }]))).toEqual(['run.defeat']);
    expect(ids(route([SAMPLES.goedamOutcome]))).toEqual(['gd.flicker', 'gd.result.good']);
    expect(ids(route([{ ...SAMPLES.goedamOutcome, optionId: 'leave' }]))).toEqual(['gd.flicker', 'gd.result.leave']);
    expect(ids(route([SAMPLES.bossGroggy]))).toEqual(['groggy.break', 'groggy.stars']);
  });

  it('my ult cut-in ducks the effect bus −8 dB for 1.2 s and the background −14 dB', () => {
    const r = route([SAMPLES.ultCast]);
    expect(r.ctl).toContainEqual(expect.objectContaining({ kind: 'duck', target: 'sfx', db: -8, hold: 1.2 }));
    expect(r.ctl).toContainEqual(expect.objectContaining({ kind: 'duck', target: 'bg', db: -14 }));
  });

  it('instant drag beats land after the visual drop-in (+DASH_LAND), louder with more targets; 4+ targets crunch', () => {
    const one = route([{ ...SAMPLES.skillStage, targets: 1 }]).sounds.find(x => x.id === 'drag.guardian.slam')!;
    const many = route([{ ...SAMPLES.skillStage, targets: 5 }]);
    const slam = many.sounds.find(x => x.id === 'drag.guardian.slam')!;
    expect(one.delay).toBeCloseTo(DASH_LAND);
    expect(slam.db!).toBeGreaterThan(one.db!);
    expect(ids(many)).toContain('drag.crunch');
  });

  it('build-up sounds are scheduled from the cast so the impact meets the hit, divided by gameSpeed', () => {
    const fin: GameEvent = { type: 'skillCast', sourceId: 100, player: 0, slot: 'ult', skillId: 'berserker_u', name: 'x', center: P, area: { shape: 'circle', radius: 3 }, team: 'ally', delay: 8.25, stage: 'finale', actionIndex: 3 };
    const x1 = route([fin]).sounds.find(x => x.id === 'ult.berserker.finale')!;
    const x2 = route([fin], state(), view({ gameSpeed: 2 })).sounds.find(x => x.id === 'ult.berserker.finale')!;
    expect(x1.delay).toBeCloseTo(8.25 - 0.6);
    expect(x2.delay).toBeCloseTo(8.25 / 2 - 0.6);
    // and the landing event itself does not play it twice
    expect(ids(route([{ ...SAMPLES.skillStage, slot: 'ult', skillId: 'berserker_u', stage: 'finale', actionIndex: 3 }]))).not.toContain('ult.berserker.finale');
  });

  it('zone loops last the zone (÷ gameSpeed) and end with their end sound', () => {
    const z: GameEvent = { ...SAMPLES.skillStage, stage: 'wall', actionIndex: 3, hit: 0 };
    const r = route([z], state(), view({ gameSpeed: 2 }));
    const loop = r.sounds.find(x => x.id === 'drag.guardian.wall')!;
    expect(loop.loopFor).toBeCloseTo(2);
    expect(r.sounds.find(x => x.id === 'drag.guardian.shatter')!.delay).toBeCloseTo(2);
  });

  it('flurries step their pitch per hit and stop at max; other players hear 4 at most', () => {
    const d = new Director();
    const hop = (player: number, sourceId = 100): GameEvent => ({ ...SAMPLES.skillStage, player, sourceId, slot: 'ult', skillId: 'blade_u', stage: 'hop', actionIndex: 0 });
    route([], state(), view(), d);
    const rates: number[] = [];
    for (let i = 0; i < 7; i++) rates.push(...d.route([hop(0)], state(), view({ now: 10 + i * 0.12 })).sounds.filter(x => x.id === 'ult.blade.hop').map(x => x.rate!));
    expect(rates.length).toBe(5);
    expect(rates[1] / rates[0]).toBeCloseTo(Math.pow(2, 2 / 12));
    const far = new Director();
    route([], state(), view(), far);
    let n = 0;
    for (let i = 0; i < 7; i++) n += far.route([hop(1, 101)], state(), view({ now: 20 + i * 0.12 })).sounds.filter(x => x.far).length;
    expect(n).toBe(4);
  });

  it("other players: drag = far version, ult = final beat only, normal / basic / pet / ult ready silent", () => {
    const other: GameEvent = { ...SAMPLES.skillStage, player: 1, sourceId: 101 };
    const r = route([other]);
    expect(r.sounds.find(x => x.id === 'drag.guardian.slam')?.far).toBe(true);
    expect(r.ctl.filter(c => c.kind === 'duck')).toEqual([]);
    const rally: GameEvent = { ...other, slot: 'ult', skillId: 'guardian_u', stage: 'rally', actionIndex: 1 };
    const citadel: GameEvent = { ...other, slot: 'ult', skillId: 'guardian_u', stage: 'citadel', actionIndex: 2 };
    expect(ids(route([rally]))).toEqual([]);
    expect(route([citadel]).sounds.map(x => [x.id, x.far])).toEqual([['ult.guardian.citadel', true]]);
    expect(ids(route([{ ...SAMPLES.skillCast, player: 1, sourceId: 101 }]))).toEqual([]);
    expect(ids(route([{ ...SAMPLES.ultReady, player: 1 }]))).toEqual([]);
    expect(ids(route([{ type: 'skillCast', sourceId: 101, player: 1, slot: 'pet', skillId: 'frog_bomb', name: 'x', center: P, area: { shape: 'circle', radius: 2 }, team: 'ally' }]))).toEqual([]);
    expect(ids(route([{ type: 'death', entityId: 101, pos: P, kind: 'character', tier: 'character' }]))).toEqual(['char.down.far']);
  });

  it('per-character gauges (기획 15차): only my field character\'s gauge chimes ult.ready (bench gauges fill silently)', () => {
    expect(ids(route([{ type: 'ultReady', player: 0, partyIndex: 0 }]))).toEqual(['ult.ready']);
    expect(ids(route([{ type: 'ultReady', player: 0, partyIndex: 2 }]))).toEqual([]);
    expect(ids(route([{ type: 'ultReady', player: 1, partyIndex: 0 }]))).toEqual([]);
    // the 10 s reminder follows the field character's own gauge
    const s = state();
    const me = s.players[0];
    me.party.forEach((m, i) => (m.ult = { charge: i === 1 ? 1 : 0.2, fullSince: i === 1 ? -20 : null }));
    expect(ids(route([], s))).toEqual([]);
    me.activeIndex = 1;
    expect(ids(route([], s))).toEqual(['ult.remind']);
  });

  it('per-character gauges (기획 15차): a card that filled on the bench reminds 10 s after it came on, once per card', () => {
    const d = new Director();
    const at = (time: number, active: number) => {
      const s = state({ tick: Math.round(time * 30), time });
      s.players[0].party.forEach((m, i) => (m.ult = { charge: i === 2 ? 0.3 : 1, fullSince: i === 2 ? null : 5 }));
      s.players[0].activeIndex = active;
      return ids(d.route([], s, view({ now: time }))).filter(x => x === 'ult.remind');
    };
    at(39, 2); // warm-up frame (snapshot only)
    expect(at(40, 2)).toEqual([]); // 0 and 1 full on the bench since t 5: no reminder from there
    expect(at(41, 0)).toEqual([]); // swapped in at 41: castable from now
    expect(at(50, 0)).toEqual([]);
    expect(at(51, 0)).toEqual(['ult.remind']);
    expect(at(52, 1)).toEqual([]); // swap 0 → 1: a fresh clock for 1
    expect(at(62, 1)).toEqual(['ult.remind']);
    expect(at(63, 0)).toEqual([]); // back to 0 (already reminded for this fill): silent
    expect(at(80, 0)).toEqual([]);
  });

  it('10 hits in one frame play once (hit.multi), louder but at most ×2', () => {
    const r = route(Array.from({ length: 10 }, () => SAMPLES.damage));
    expect(ids(r)).toEqual(['hit.multi']);
    expect(dbToGain(r.sounds[0].db!)).toBeCloseTo(Math.min(2, 1 + 0.35 * Math.log2(10)));
    const two = mergeFrame([{ id: 'hit.basic' }, { id: 'hit.basic' }]);
    expect(two.map(x => x.id)).toEqual(['hit.basic']);
    expect(dbToGain(two[0].db!)).toBeCloseTo(1.35);
  });

  it('watches the state: telegraph landed vs broken, card ready, timer ticks, enrage loop, ambience', () => {
    const d = new Director();
    const tel = { id: 7, team: 'enemy' as const, center: P, origin: P, area: { shape: 'circle' as const, radius: 2 }, remaining: 1, total: 1 };
    const tel2 = { ...tel, id: 8 };
    const cast: GameEvent = { type: 'skillCast', sourceId: 4, player: null, slot: 'monster', skillId: 'ek_doors', name: 'x', center: P, area: tel.area, team: 'enemy', delay: 1 };
    const s0 = state();
    d.route([], s0, view({ now: 1 }));
    const s1 = state({ telegraphs: [tel, tel2], tick: 101 });
    expect(ids(d.route([cast], s1, view({ now: 1.1 })))).toContain('boss.windup.doors');
    const s2 = state({ telegraphs: [], tick: 102, timeRemaining: 9.5 });
    const r = d.route([{ ...SAMPLES.interrupt, telegraphId: 8 }], s2, view({ now: 1.2 }));
    expect(ids(r).filter(x => x === 'boss.impact.doors')).toHaveLength(1);
    expect(ids(r)).toContain('mon.interrupt');
    expect(ids(r)).toContain('ui.timer.tick');
    const ready = state({ tick: 103 });
    ready.players[0].party[1].swapCooldownRemaining = 0;
    expect(ids(d.route([], ready, view({ now: 1.3 })))).toContain('ui.cardReady');
    const enr = d.route([], state({ tick: 104, bossEnraged: true }), view({ now: 1.4 }));
    expect(enr.sounds.find(x => x.id === 'enrage.heart')?.key).toBe('enrage');
    const rew = d.route([], state({ tick: 105, phase: 'reward', rewardOffersByPlayer: [[], null] }), view({ now: 1.5 }));
    expect(ids(rew)).toEqual(expect.arrayContaining(['reward.open', 'amb.goedam']));
    expect(rew.ctl).toContainEqual(expect.objectContaining({ kind: 'stop', key: 'amb' }));
  });
});

// ─────────────────────────── coverage of the doc's id table ───────────────────────────

describe('sfx ids: nothing missing', () => {
  const all = new Set(recipeIds());
  const roles = ['tank', 'melee', 'ranged', 'healer', 'support'];

  it('every character has a voice, a normal / tick / cut-in / shot sound, and every drag / ult stage a sound or a covering sibling', () => {
    for (const c of CHARACTERS) {
      expect(CHAR_VOICE[c.id], c.id).toBeTruthy();
      for (const id of [`normal.${c.id}`, `ult.${c.id}.tick`, `ult.${c.id}.cutin`, `atk.shot.${c.id}`]) expect(all.has(id), id).toBe(true);
      expect(STAGE_CUES[c.id], c.id).toBeTruthy();
      for (const slot of ['drag', 'ult'] as const) {
        for (const a of c[slot].actions) {
          expect(a.stage, `${c.id} ${slot}`).toBeTruthy();
          const cues = stageCues(c.id, slot, a.stage!);
          expect(cues, `${c.id}.${slot}.${a.stage} must be in STAGE_CUES`).toBeDefined();
          for (const cue of cues!) for (const id of [cue.id, cue.tick, cue.end, cue.last].filter(Boolean) as string[]) expect(all.has(id), id).toBe(true);
        }
        // at least one stage of each skill makes a sound
        expect(c[slot].actions.some(a => (stageCues(c.id, slot, a.stage!) ?? []).length > 0), `${c.id} ${slot}`).toBe(true);
      }
    }
    for (const r of roles) for (const f of ['char.appear', 'drag._role', 'ult._role', 'dash', 'atk.swing']) expect(all.has(`${f}.${r}`), `${f}.${r}`).toBe(true);
  });

  it('pets, bosses, 괴담 rooms, 돌발 괴담, zones and boss pattern kinds all have recipes', () => {
    for (const p of PETS) expect(all.has(`pet.${p.id}`), p.id).toBe(true);
    expect(all.has('pet.frog_bomb.impact')).toBe(true);
    for (const b of BOSSES) for (const f of ['boss.intro', 'boss.phase']) expect(all.has(`${f}.${b.id}`), `${f}.${b.id}`).toBe(true);
    for (const r of GOEDAM_ROOMS) expect(all.has(`gd.room.${r.id}`), r.id).toBe(true);
    for (const f of FIELD_EVENTS) for (const k of ['fe.start', 'fe.fail']) expect(all.has(`${k}.${f.id}`), `${k}.${f.id}`).toBe(true);
    for (const z of ['lobby', 'office', 'ward', 'rooftop']) expect(all.has(`floor.start.${z}`) && all.has(`amb.${z}`), z).toBe(true);
    for (const k of ['doors', 'countdown', 'papers', 'stamp', 'summon', 'blades', 'gas', 'slice', 'burst', 'beam', 'tentacle', 'ring']) expect(all.has(`boss.windup.${k}`) && all.has(`boss.impact.${k}`), k).toBe(true);
  });

  it("the doc's fixed ids (3-1 … 3-11) all exist", () => {
    const doc = `drag.crunch char.leave char.revive doll.burst atk.shot.turret hit.basic hit.skill hit.crit hit.weak hit.boss hurt.char hurt.shield hurt.lowhp
      heal.tick heal.big heal.drain bench.heal bench.buff fx.shield fx.stun fx.frost fx.curse fx.buff fx.cleanse fx.knock fx.pull fx.taunt fx.tether fx.charm fx.summon
      ui.cdcut char.down char.down.far char.revive.all run.out player.out mon.spawnWarn mon.spawn mon.windup mon.impact.circle mon.impact.line mon.impact.cone
      mon.impact.ring mon.interrupt mon.charge mon.blink mon.heal mon.death mon.death.phone mon.death.copy mon.death.mannequin mon.death.eye mon.death.vending
      mon.death.umbrella mon.death.multi mid.spawn mid.windup mid.death copy.pop boss.enrage enrage.heart boss.retreat groggy.fill groggy.break groggy.stars
      groggy.recover zone.enter floor.clear floor.clear.boss ui.timer.tick ui.timer.hot amb.boss amb.goedam gd.enter gd.pick gd.flicker gd.result.good
      gd.result.bad gd.result.neutral gd.result.leave gd.trace.curse gd.trace.bless gd.trace.mixed gd.trace.expire gd.continue fe.warn fe.lamp fe.fall fe.tally
      fe.startle fe.monitor fe.toad.hop fe.print fe.urgent fe.success ui.tap ui.tap.soft ui.confirm ui.back ui.start ui.select ui.select.off ui.refuse ui.warn
      ui.toast.good ui.toast.warn ui.toast.info ui.card.lift ui.pet.lift ui.card.cancel ui.cardReady ui.sheet.open ui.pause.open ui.pause.close ui.ult.press
      ui.ult.denied ult.ready ult.remind ui.reward.pulse reward.open reward.pick.common reward.pick.rare reward.pick.epic relic.get relic.proc result.best
      run.victory run.defeat net.playerJoin net.playerLeave net.lost net.reconnect net.botTakeover
      drag.guardian.charge drag.guardian.shatter drag.paladin.charge drag.warden.drop drag.ranger.draw drag.mage.sigil drag.gunner.pump drag.chrono.wind
      ult.chrono.tock ult.chrono.resume`.split(/\s+/).filter(Boolean);
    for (const id of doc) expect(all.has(id), id).toBe(true);
  });

  // ── 기획 19차 보스 레이드: the boss sound registry (src/audio/synth/bossVoices) ──

  it('기획 19차: 15 boss pattern kinds (water · static · chime are new) each have a wind-up and an impact that bake', () => {
    expect([...BOSS_KINDS]).toEqual(['doors', 'countdown', 'papers', 'stamp', 'summon', 'blades', 'gas', 'slice', 'burst', 'beam', 'tentacle', 'ring', 'water', 'static', 'chime']);
    for (const k of BOSS_KINDS) for (const f of ['boss.windup', 'boss.impact']) expect(all.has(`${f}.${k}`), `${f}.${k}`).toBe(true);
    for (const k of ['water', 'static', 'chime']) {
      for (const f of ['boss.windup', 'boss.impact']) {
        const s = bakeSamples(`${f}.${k}`)!;
        expect(s.length, `${f}.${k}`).toBeGreaterThan(3000);
        expect(peakOf(s), `${f}.${k}`).toBeGreaterThan(0.3);
        expect(peakOf(s), `${f}.${k}`).toBeLessThanOrEqual(0.91);
      }
    }
    expect(sfxRow('boss.windup.water')).toEqual(sfxRow('boss.windup.doors'));
  });

  it('기획 19차: every boss has an intro, a phase and a death sound; every timbre token bakes; kinds only name that boss skills', () => {
    for (const b of BOSSES) {
      for (const f of ['boss.intro', 'boss.phase', 'boss.death']) expect(all.has(`${f}.${b.id}`), `${f}.${b.id}`).toBe(true);
      const v = BOSS_VOICE[b.id];
      expect(v, `${b.id} voice`).toBeDefined();
      const skills = new Set([...b.skills, ...(b.phases ?? []).flatMap(p => p.skills ?? [])].map(sk => sk.id));
      for (const id of Object.keys(v.kinds)) expect(skills.has(id), `${b.id} kinds key ${id}`).toBe(true);
      for (const id of skills) expect(BOSS_KINDS as readonly string[], `${id} kind`).toContain(v.kinds[id]);
    }
    const death = bakeSamples('boss.death.abyss_watcher')!;
    expect(death.length).toBeGreaterThan(32000);
    expect(peakOf(death)).toBeGreaterThan(0.3);
    expect(sfxRow('boss.death.abyss_watcher')).toMatchObject({ bus: 'hero', group: 'hero' });
    expect(sfxRow('boss.death.abyss_watcher').db).toBeLessThan(sfxRow('boss.retreat').db);
    expect([...BOSS_TIMBRES]).toHaveLength(12);
  });

  it('기획 19차: the classic four sound as before — same root, motif and timbre layers', () => {
    expect(BOSS_VOICE.elevator_keeper).toMatchObject({ base: 98, motif: [0, -4, -1], timbre: 'elevator' });
    expect(BOSS_VOICE.overtime_lord).toMatchObject({ base: 82.4, motif: [0, 1, 0, -5], timbre: 'office' });
    expect(BOSS_VOICE.surgeon_director).toMatchObject({ base: 110, motif: [0, 6, 5], timbre: 'surgery' });
    expect(BOSS_VOICE.abyss_watcher).toMatchObject({ base: 55, motif: [0, 1, -1, 0], timbre: 'abyss' });
    // golden digests of the baked intro (recorded before the registry move): any change of a classic layer shows here
    const digest = (id: string): string => {
      const s = bakeSamples(id)!;
      let h = 2166136261;
      for (let i = 0; i < s.length; i += 7) {
        h ^= Math.round(s[i] * 32767) & 0xffff;
        h = Math.imul(h, 16777619) >>> 0;
      }
      return `${s.length}:${h}`;
    };
    expect(Object.fromEntries(['elevator_keeper', 'overtime_lord', 'surgeon_director', 'abyss_watcher'].map(id => [id, digest(`boss.intro.${id}`)]))).toEqual(CLASSIC_INTRO_DIGEST);
  });

  it('기획 19차: the director takes the kind of a boss skill from the voice rows, and a retreat plays that boss own way out', () => {
    expect(bossSkillKind('ek_doors_back')).toBe('doors');
    expect(bossSkillKind('boss_abyss_ring')).toBe('ring');
    expect(bossSkillKind('sd_incision')).toBe('slice');
    expect(bossSkillKind('xx_unknown')).toBe('burst');
    const boss = { floor: 5, kind: 'boss' as const, timeLimit: 90, arena: { width: 24, height: 12 }, statMult: 1, waves: [], theme: 'lobby' as const, bossId: 'elevator_keeper' };
    const d = new Director();
    d.route([], state({ plan: boss, bossId: 4 }), view({ now: 1 }));
    // bots only: by the retreat frame the state may already be the next floor (another boss)
    const next = state({ tick: 101, floor: 6, plan: { ...boss, floor: 6, bossId: 'overtime_lord' }, bossId: 4 });
    const r = ids(d.route([SAMPLES.bossRetreat], next, view({ now: 1.1 })));
    expect(r).toContain('boss.retreat');
    expect(r).toContain('boss.death.elevator_keeper');
    expect(r).not.toContain('boss.death.overtime_lord');
  });

  it('every id has a mixing row with a sane level and priority', () => {
    for (const id of all) {
      const r = sfxRow(id);
      expect(r.db, id).toBeLessThanOrEqual(-3);
      expect(r.prio, id).toBeGreaterThanOrEqual(0);
      expect(r.prio, id).toBeLessThanOrEqual(5);
    }
    expect(sfxRow('ult.guardian.cutin')).toMatchObject({ bus: 'hero', prio: 5, db: -3 });
    expect(sfxRow('drag.blade.dash')).toMatchObject({ bus: 'hero', prio: 4, db: -5 });
    expect(sfxRow('hit.basic')).toMatchObject({ prio: 1, db: -20, gap: 45, group: 'hit', variants: 3 });
    expect(sfxRow('amb.lobby')).toMatchObject({ bus: 'bg', prio: 0 });
    expect(sfxRow('ui.tap').bus).toBe('ui');
  });
});

// ─────────────────────────── engine (fake AudioContext) ───────────────────────────

describe('sfx engine', () => {
  it('rate-limits the same id by its minimum gap', () => {
    const { e, ctx } = engine();
    expect(e.play('hit.basic')).toBe(true);
    expect(e.play('hit.basic')).toBe(false);
    ctx.currentTime = 0.05;
    expect(e.play('hit.basic')).toBe(true);
  });

  it('caps voices at 24 (16 on small phones): equal-or-lower priority oldest is evicted, else the new one is dropped', () => {
    const { e, ctx } = engine({ maxVoices: 16 });
    const low = recipeIds().filter(id => sfxRow(id).prio <= 2 && !sfxRow(id).group.match(/hit|death|ui|tick|atk|mon|loop/)).slice(0, 30);
    for (const id of low) e.play(id);
    expect(e.active).toBe(16);
    // a priority-5 sound always gets in
    expect(e.play('ult.blade.cutin')).toBe(true);
    expect(e.active).toBe(16);
    // fill with priority 5, then a priority-1 one is refused
    const hi = recipeIds().filter(id => sfxRow(id).prio === 5 && sfxRow(id).group === 'hero');
    for (const id of hi.slice(0, 20)) e.play(id);
    expect(e.play('mon.heal')).toBe(false);
    expect(ctx.sources.length).toBeGreaterThan(16);
  });

  it('group caps: 6 hits at once', () => {
    const { e } = engine();
    for (const id of ['hit.basic', 'hit.skill', 'hit.crit', 'hit.weak', 'hit.boss', 'hit.multi', 'hurt.char', 'hurt.shield']) e.play(id);
    expect(e.activeIds().filter(x => sfxRow(x).group === 'hit').length).toBe(GROUP_CAP.hit);
  });

  it('ducks: the lowest wins (no summing), the effect bus never below −14 dB', () => {
    const a = { at: 0, attack: 0.04, hold: 1, release: 0.4, db: -8 };
    const b = { at: 0, attack: 0.04, hold: 1, release: 0.4, db: -12 };
    expect(duckDb([a, b], 0.5)).toBe(-12);
    expect(duckDb([a, { ...b, db: -30 }], 0.5, DUCK_FLOOR_DB)).toBe(-14);
    expect(duckDb([a], 2)).toBe(0);
    const { e } = engine();
    e.duck('sfx', -8, 0, 1.2);
    e.duck('sfx', -12, 0, 0.5);
    expect(e.duckNow('sfx', 0.3)).toBe(-12);
    expect(e.duckNow('sfx', 0.9)).toBe(-8);
  });

  it('far sounds go through the far bus (−8 dB + 3.5 kHz low-pass) and only one other-player ult plays at a time', () => {
    const { e, ctx } = engine();
    e.play('ult.guardian.citadel', { far: true });
    e.play('ult.blade.issen', { far: true });
    expect(e.activeIds()).toEqual(['ult.blade.issen']);
    const src = ctx.sources.at(-1)!;
    const gain = src.out[0] as FakeGain;
    const farBus = gain.out[0] as FakeGain;
    expect(farBus.gain.value).toBeCloseTo(dbToGain(-8));
    expect((farBus.out[0] as unknown as { frequency: FakeParam }).frequency.value).toBe(3500);
  });

  it('loops: timed loops stop by themselves, keyed loops stop on request; pause halts all but UI', () => {
    const { e, ctx } = engine();
    e.play('amb.lobby', { loopFor: Infinity, key: 'amb' });
    e.play('drag.guardian.wall', { loopFor: 4, key: 'zone:1' });
    const [amb, wall] = ctx.sources.slice(-2);
    expect(amb.loop && amb.stopAt == null).toBe(true);
    expect(wall.stopAt).toBeCloseTo(4.02);
    e.stop('amb', 0.3);
    expect(amb.stopAt).toBeCloseTo(0.3);
    e.halted = true;
    expect(e.play('hit.crit')).toBe(false);
    expect(e.play('ui.tap')).toBe(true);
  });

  it('mute ramps the mute stage to 0 (and back) without stopping anything; ?mute=1 forces it', () => {
    const { e } = engine();
    e.play('ui.tap');
    e.apply({ ...AUDIO_DEFAULTS, muted: true });
    expect(e.active).toBe(1);
    e.apply({ ...AUDIO_DEFAULTS, muted: false });
    e.forced = true;
    e.apply({ ...AUDIO_DEFAULTS, muted: false });
    // the mute gain node is the one fed by every volume node: its last target is 0
    const anyZero = (e as unknown as { nodes: { mute: FakeGain } }).nodes.mute.gain.calls.at(-1)!;
    expect(anyZero[1]).toBe(0);
  });

  it('without an AudioContext everything is a no-op that still logs recent requests', () => {
    const s = new Sfx({ makeContext: () => null });
    expect(s.play('ui.cardReady')).toBe(false);
    s.ui('ui.toast.info');
    expect(s.recent.map(r => r.id)).toEqual(['ui.cardReady', 'ui.toast.info']);
    for (let i = 0; i < 80; i++) s.play('ui.tap');
    expect(s.recent.length).toBe(64);
  });

  it('a toast stays quiet right after a priority ≥ 3 sound', () => {
    const s = new Sfx({ makeContext: () => null });
    s.ui('ui.refuse');
    s.ui('ui.toast.warn');
    expect(s.recent.map(r => r.id)).toEqual(['ui.refuse']);
  });
});

// ─────────────────────────── files · settings · buttons · baking ───────────────────────────

describe('sfx file overrides (2-2)', () => {
  const files = buildFileTable({ './files/drag.guardian.wave.mp3': 'data:wave', './files/skill.blade_d.mp3': 'data:blade', './files/a.mp3': 'data:a', './files/b.mp3': 'data:b' }, {
    'hit.basic': { src: ['a.mp3', 'b.mp3', 'missing.mp3'], gain: 0.8, rate: [0.96, 1.04], source: 'test', license: 'CC0' },
  });
  const deps = { files, hasRecipe, family: (id: string) => familyDefault(id, c => CHAR_VOICE[c]?.role ?? null) };

  it('maps file names to ids and manifest entries to their files', () => {
    expect(files.get('drag.guardian.wave')!.urls).toEqual(['data:wave']);
    expect(files.get('hit.basic')).toEqual({ urls: ['data:a', 'data:b'], gain: 0.8, rate: [0.96, 1.04], start: 0 });
  });

  it('lookup order: skill file → id file → recipe → family default → none', () => {
    expect(resolveSource('drag.blade.dash', deps, 'blade_d')).toEqual({ kind: 'file', id: 'skill.blade_d' });
    expect(resolveSource('drag.guardian.wave', deps, 'guardian_d')).toEqual({ kind: 'file', id: 'drag.guardian.wave' });
    expect(resolveSource('drag.guardian.slam', deps)).toEqual({ kind: 'synth', id: 'drag.guardian.slam' });
    expect(resolveSource('drag.blade.unknown', deps)).toEqual({ kind: 'synth', id: 'drag._role.melee' });
    expect(resolveSource('nothing.here', deps)).toBeNull();
  });

  it('the engine plays a loaded file instead of the synth sound; an unreadable file falls back to synth', async () => {
    const { e, ctx } = engine({ files });
    await new Promise(r => setTimeout(r, 0));
    expect(e.isFile('drag.guardian.wave')).toBe(true);
    e.play('drag.guardian.wave');
    expect(ctx.sources.at(-1)!.buffer!.tag).toBe('data:wave');
    e.play('drag.guardian.slam');
    expect(ctx.sources.at(-1)!.buffer!.tag).toBeUndefined();
    const bad = new AudioEngine({ files, bakeInFrame: true, loadFile: async () => Promise.reject(new Error('x')) });
    const warn = console.warn;
    const msgs: string[] = [];
    console.warn = (m: string) => msgs.push(m);
    bad.init(new FakeCtx() as unknown as AudioContext);
    await new Promise(r => setTimeout(r, 0));
    console.warn = warn;
    expect(bad.isFile('drag.guardian.wave')).toBe(false);
    expect(msgs.length).toBeGreaterThan(0);
    expect(bad.play('drag.guardian.wave')).toBe(true);
  });

  // 기획 18차: real files are generated with scripts/sfx-gen.mjs — keep them few-rule safe instead of "none".
  // 기획 21차: every sound has a file now (456 files, 6 010 230 bytes) — the budget is that total + 20 % (never over 10 MB).
  it('bundled sound files: each replaces a known sound id (or a whole skill), no ogg, within the 21차 budget', () => {
    const dir = join(__dirname, '../../src/audio/files');
    const audio = readdirSync(dir).filter(f => /\.(mp3|m4a|wav|ogg)$/i.test(f));
    expect(audio.filter(f => /\.ogg$/i.test(f))).toEqual([]);
    const ids = audio.map(f => f.replace(/\.(mp3|m4a|wav)$/i, ''));
    expect(ids.filter(id => !id.startsWith('skill.') && !hasRecipe(id))).toEqual([]);
    const bytes = audio.reduce((a, f) => a + statSync(join(dir, f)).size, 0);
    expect(bytes).toBeLessThanOrEqual(Math.min(10 * 1024 * 1024, Math.round(6_010_230 * 1.2)));
  });
});

// ─────────────────────────── 기획 21차: file levels (files/levels.json) · offsets · decode on demand ───────────────────────────

describe('sfx file levels and offsets (기획 21차)', () => {
  const levels: Record<string, FileLevel> = {
    'drag.guardian.wave': { gain: 0.5, start: 0.12, end: 0.8 },
    'hit.basic': { gain: 2, start: 0.02 },
    'amb.lobby': { gain: 1.5, start: 0.3 },
    'ui.tap': { gain: 1, start: 0, off: true },
  };
  const table = buildFileTable(
    { './files/drag.guardian.wave.mp3': 'data:wave', './files/hit.basic.mp3': 'data:hit', './files/amb.lobby.mp3': 'data:amb', './files/ui.tap.mp3': 'data:tap' },
    { 'hit.basic': { src: ['hit.basic.mp3'], rate: [0.94, 1.06] } },
    levels,
  );
  /** An engine whose files decode to 1 s buffers. */
  const make = (preloadFiles: boolean, files: Map<string, FileSource> = table) => {
    const ctx = new FakeCtx();
    const loads: string[] = [];
    const e = new AudioEngine({
      random: () => 0.5,
      bakeInFrame: true,
      maxVoices: 24,
      files,
      preloadFiles,
      loadFile: async (_c, url) => {
        loads.push(url);
        return { duration: 1, length: 48000, numberOfChannels: 1, tag: url } as unknown as AudioBuffer;
      },
    });
    e.init(ctx as unknown as AudioContext);
    return { e, ctx, loads };
  };
  const tick = () => new Promise(r => setTimeout(r, 0));

  it('levels.json gives each file its gain / start / end; off drops the file (synth plays); the manifest still wins on gain / rate', () => {
    expect(table.get('drag.guardian.wave')).toEqual({ urls: ['data:wave'], gain: 0.5, rate: [1, 1], start: 0.12, end: 0.8 });
    expect(table.get('hit.basic')).toEqual({ urls: ['data:hit'], gain: 2, rate: [0.94, 1.06], start: 0.02 });
    expect(table.has('ui.tap')).toBe(false);
    const withGain = buildFileTable({ './files/hit.basic.mp3': 'data:hit' }, { 'hit.basic': { src: ['hit.basic.mp3'], gain: 0.7 } }, levels);
    expect(withGain.get('hit.basic')!.gain).toBe(0.7);
    expect(withGain.get('hit.basic')!.start).toBe(0.02);
  });

  it('the bundled levels.json: one entry per file, small numbers, read into FILE_TABLE', () => {
    const dir = join(__dirname, '../../src/audio/files');
    const ids = readdirSync(dir)
      .filter(f => /\.(mp3|m4a|wav)$/i.test(f))
      .map(f => f.replace(/\.(mp3|m4a|wav)$/i, ''))
      .sort();
    const lv = LEVELS as Record<string, FileLevel>;
    expect(Object.keys(lv).sort()).toEqual(ids);
    for (const [id, l] of Object.entries(lv)) {
      expect(l.gain, id).toBeGreaterThan(0);
      expect(l.gain, id).toBeLessThanOrEqual(16);
      expect(l.start, id).toBeGreaterThanOrEqual(0);
      for (const v of [l.gain, l.start, l.end ?? 0]) expect(Math.abs(v * 1000 - Math.round(v * 1000)), id).toBeLessThan(1e-6);
      if (l.end != null) expect(l.end, id).toBeGreaterThan(l.start);
      const f = FILE_TABLE.get(id);
      if (l.off) {
        expect(f, id).toBeUndefined();
        continue;
      }
      expect(f, id).toBeDefined();
      expect(f!.start, id).toBe(l.start);
      expect(f!.end, id).toBe(l.end);
      expect(f!.gain, id).toBe(l.gain);
    }
    // the manifest's pitch-jittered sounds keep their rate and take the file's level
    const jit = ['hit.skill', 'hurt.char', 'heal.tick'].filter(id => FILE_TABLE.has(id));
    expect(jit.length).toBeGreaterThan(0);
    for (const id of jit) expect(FILE_TABLE.get(id)!.rate, id).toEqual([0.94, 1.06]);
  });

  it('a file starts at its offset, stops at its end (with a short fade) and plays at its level', async () => {
    const { e, ctx } = make(true);
    await tick();
    e.play('drag.guardian.wave');
    const src = ctx.sources.at(-1)!;
    expect(src.buffer!.tag).toBe('data:wave');
    expect(src.startArgs[0]).toBeCloseTo(0.12, 9);
    expect(src.startArgs[1]).toBeCloseTo(0.68, 9);
    const g = (src.out[0] as FakeGain).gain;
    expect(g.calls[0][1]).toBeCloseTo(dbToGain(sfxRow('drag.guardian.wave').db) * 0.5, 9);
    expect(g.calls.at(-1)![0]).toBe('lin');
    expect(g.calls.at(-1)![1]).toBe(0);
    expect(g.calls.at(-1)![2]).toBeCloseTo(0.68, 9);
    // a synth sound still starts the plain way
    e.play('drag.guardian.slam');
    expect(ctx.sources.at(-1)!.startArgs).toEqual([]);
  });

  it('a loop loops from its offset', async () => {
    const { e, ctx } = make(true);
    await tick();
    e.play('amb.lobby', { loopFor: Infinity, key: 'amb' });
    const src = ctx.sources.at(-1)!;
    expect(src.loop).toBe(true);
    expect(src.startArgs).toEqual([0.3]);
    expect(src.loopStart).toBe(0.3);
    expect(src.loopEnd).toBe(1);
  });

  it('bundled table: files decode on demand (UI at init, prepare before a scene, else on the first request, played late)', async () => {
    const files = buildFileTable({ './files/drag.guardian.wave.mp3': 'data:wave', './files/ui.select.mp3': 'data:sel', './files/hit.crit.mp3': 'data:crit' }, {});
    const { e, ctx, loads } = make(false, files);
    await tick();
    expect(loads).toEqual(['data:sel']);
    // prepare: a file id decodes (its synth sound is not baked), a synth id bakes
    e.prepare(['hit.crit', 'drag.guardian.slam']);
    await tick();
    expect(loads).toEqual(['data:sel', 'data:crit']);
    expect(e.isDecoded('hit.crit')).toBe(true);
    expect(e.baker.has('hit.crit')).toBe(false);
    // the first request of a file not decoded yet: nothing now, then it starts (late) with the file once decoded
    expect(e.play('drag.guardian.wave')).toBe(false);
    expect(e.waiting).toBe(1);
    await tick();
    expect(e.waiting).toBe(0);
    expect(ctx.sources.at(-1)!.buffer!.tag).toBe('data:wave');
    expect(e.isFile('drag.guardian.wave')).toBe(true);
  });
});

// ─────────────────────────── 기획 21차 리뷰: hit alignment · decode queue · letting files go ───────────────────────────

describe('sfx files: hit alignment, decode queue, release (기획 21차 리뷰)', () => {
  const tick = () => new Promise(r => setTimeout(r, 0));
  const buf = (url: string) => ({ duration: 1, length: 48000, numberOfChannels: 1, tag: url }) as unknown as AudioBuffer;

  it('levels.json align / delay reach the file table; align fades the cut head in, delay starts the file later', async () => {
    const levels: Record<string, FileLevel> = {
      'ult.gunner.heavy': { gain: 1, start: 0.585, align: true },
      'ult.berserker.finale': { gain: 1, start: 0, end: 0.9, delay: 0.5 },
    };
    const files = buildFileTable({ './files/ult.gunner.heavy.mp3': 'data:heavy', './files/ult.berserker.finale.mp3': 'data:finale' }, {}, levels);
    expect(files.get('ult.gunner.heavy')).toEqual({ urls: ['data:heavy'], gain: 1, rate: [1, 1], start: 0.585, align: true });
    expect(files.get('ult.berserker.finale')).toEqual({ urls: ['data:finale'], gain: 1, rate: [1, 1], start: 0, end: 0.9, delay: 0.5 });
    const ctx = new FakeCtx();
    const e = new AudioEngine({ random: () => 0.5, bakeInFrame: true, maxVoices: 24, files, loadFile: async (_c, url) => buf(url) });
    e.init(ctx as unknown as AudioContext);
    await tick();
    e.play('ult.gunner.heavy');
    let src = ctx.sources.at(-1)!;
    expect(src.startAt).toBe(0);
    expect(src.startArgs[0]).toBeCloseTo(0.585, 9);
    const g = (src.out[0] as FakeGain).gain.calls;
    expect(g[0]).toEqual(['set', 0, 0]);
    expect(g[1][0]).toBe('lin');
    expect(g[1][1]).toBeCloseTo(dbToGain(sfxRow('ult.gunner.heavy').db), 9);
    expect(g[1][2]).toBeGreaterThan(0);
    expect(g[1][2]).toBeLessThan(0.01);
    e.play('ult.berserker.finale', { delay: 0.1 });
    src = ctx.sources.at(-1)!;
    expect(src.startAt).toBeCloseTo(0.6, 9);
    expect((src.out[0] as FakeGain).gain.calls[0]).toEqual(['set', dbToGain(sfxRow('ult.berserker.finale').db), src.startAt]);
  });

  it('the bundled levels.json: align only on a moved start, delay small, both only on stage cues with a lead', () => {
    const leads = new Set<string>();
    for (const c of Object.values(STAGE_CUES))
      for (const slot of [c.drag, c.ult]) for (const v of Object.values(slot)) for (const q of v == null ? [] : Array.isArray(v) ? v : [v]) if (q.lead) leads.add(q.id);
    for (const [id, l] of Object.entries(LEVELS as Record<string, FileLevel>)) {
      if (l.align) expect(l.start, id).toBeGreaterThan(0);
      if (l.delay != null) {
        expect(l.delay, id).toBeGreaterThan(0);
        expect(l.delay, id).toBeLessThan(1);
      }
      if (l.align || l.delay) expect(leads.has(id), id).toBe(true);
    }
  });

  it('files decode a few at a time in the order asked; a sound asked for now jumps the queue', async () => {
    const ids = ['hit.crit', 'hit.skill', 'heal.tick', 'mon.death', 'drag.guardian.slam', 'drag.guardian.wave', 'ui.select'];
    const files = buildFileTable(Object.fromEntries(ids.map(id => [`./files/${id}.mp3`, `data:${id}`])), {});
    const pending: (() => void)[] = [];
    const loads: string[] = [];
    const e = new AudioEngine({
      random: () => 0.5,
      bakeInFrame: true,
      maxVoices: 24,
      files,
      preloadFiles: false,
      loadFile: (_c, url) => {
        loads.push(url);
        return new Promise(r => pending.push(() => r(buf(url))));
      },
    });
    const ctx = new FakeCtx();
    e.init(ctx as unknown as AudioContext);
    expect(loads).toEqual(['data:ui.select']); // UI files at init
    e.prepare(['hit.crit', 'hit.skill', 'heal.tick', 'mon.death', 'drag.guardian.slam']);
    expect(loads).toEqual(['data:ui.select', 'data:hit.crit', 'data:hit.skill']); // 3 at once
    expect(e.filesQueued).toBe(3);
    expect(e.play('drag.guardian.wave')).toBe(false); // not decoded: front of the queue, played late
    pending.shift()!(); // ui.select done → the asked-for sound is next
    await tick();
    expect(loads.at(-1)).toBe('data:drag.guardian.wave');
    while (pending.length) {
      pending.shift()!();
      await tick();
    }
    expect(loads.slice(4)).toEqual(['data:heal.tick', 'data:mon.death', 'data:drag.guardian.slam']);
    expect(e.filesQueued).toBe(0);
    expect(ctx.sources.at(-1)!.buffer!.tag).toBe('data:drag.guardian.wave');
    // letting go: decoded files the game is done with (never UI); asked again → decoded again
    expect(e.releaseFiles(id => id.startsWith('hit.') || id.startsWith('ui.'))).toBe(2);
    expect(e.isDecoded('hit.crit')).toBe(false);
    expect(e.isDecoded('ui.select')).toBe(true);
    expect(e.isFile('hit.crit')).toBe(true);
    expect(e.play('hit.crit')).toBe(false);
    expect(loads.at(-1)).toBe('data:hit.crit');
  });

  it('Sfx: a new floor lets go of past 괴담 / 돌발 괴담 files, the ambience of other zones and bosses other than this and the next', () => {
    const released: string[][] = [];
    const decoded = ['gd.room.copier', 'fe.success', 'amb.lobby', 'amb.office', 'amb.boss', 'boss.intro.elevator_keeper', 'boss.intro.dead_monitor', 'boss.death.washer_drum', 'hit.crit'];
    const fakeEngine = Object.assign(new AudioEngine({ files: new Map(), loadFile: async (_c, url) => buf(url) }), {
      releaseFiles(drop: (id: string) => boolean) {
        released.push(decoded.filter(drop));
        return 0;
      },
    });
    const s = new Sfx({ engine: fakeEngine, makeContext: () => new FakeCtx() as unknown as AudioContext });
    fakeEngine.init(new FakeCtx() as unknown as AudioContext);
    const state = (floor: number) =>
      ({ floor, phase: 'combat', plan: { theme: 'office', bossId: 'dead_monitor', nextBossId: 'washer_drum' }, players: [], entities: [], telegraphs: [] }) as unknown as GameState;
    (s as unknown as { tidyFiles(st: GameState): void }).tidyFiles(state(3));
    expect(released).toEqual([['gd.room.copier', 'fe.success', 'amb.lobby', 'boss.intro.elevator_keeper']]);
    // the same floor: nothing more
    (s as unknown as { tidyFiles(st: GameState): void }).tidyFiles(state(3));
    expect(released.length).toBe(1);
  });
});

describe('sfx settings · buttons · baking', () => {
  it('settings: sanitised, defaults when storage is blocked, ?mute=1', () => {
    expect(sanitizeAudio({ master: 3, sfx: -1, bg: 'x', muted: 1 })).toEqual({ ...AUDIO_DEFAULTS, master: 1, sfx: 0 });
    const g = globalThis as unknown as { localStorage?: unknown };
    const old = g.localStorage;
    g.localStorage = {
      getItem() {
        throw new Error('blocked');
      },
    };
    expect(loadAudio()).toEqual(AUDIO_DEFAULTS);
    g.localStorage = old;
    expect(AUDIO_DEFAULTS).toMatchObject({ master: 0.8, sfx: 1, ui: 0.7, bg: 0.35, muted: false });
    expect(forcedMute('?mute=1')).toBe(true);
    expect(forcedMute('?x=1')).toBe(false);
  });

  it('button sounds: data-sfx wins, then class rules, then the label, else ui.tap', () => {
    const el = (cls: string, attrs: Record<string, string> = {}, text = ''): UiTarget => {
      const classes = cls.split(' ');
      const self: UiTarget = {
        matches: sel => sel.split(',').some(s => s.trim().split(/(?=\.)/).every(p => (p.startsWith('.') ? classes.includes(p.slice(1).replace(/:not\(.*\)/, '')) : p === 'button'))),
        closest: sel => (sel.includes('button') ? self : null),
        getAttribute: n => attrs[n] ?? null,
        hasAttribute: n => n in attrs,
        textContent: text,
        classList: { contains: c => classes.includes(c) },
      };
      return self;
    };
    expect(uiSoundFor(el('btn', { 'data-sfx': 'ui.confirm' }))).toBe('ui.confirm');
    expect(uiSoundFor(el('btn', { 'data-sfx': '' }))).toBeNull();
    expect(uiSoundFor(el('btn btn-primary btn-start'))).toBe('ui.start');
    expect(uiSoundFor(el('ps-card is-picked'))).toBe('ui.select');
    expect(uiSoundFor(el('ps-card'))).toBe('ui.select.off');
    expect(uiSoundFor(el('gd-opt kind-gamble'))).toBe('gd.pick.gamble');
    expect(uiSoundFor(el('btn btn-secondary', {}, '방 나가기'))).toBe('ui.back');
    expect(uiSoundFor(el('btn btn-primary', {}, '다시 하기'))).toBe('ui.start');
    expect(uiSoundFor(el('btn is-disabled'))).toBe('ui.refuse');
    // 기획 24차 검토: the 궁극기 테스트 「충전」 button (its label 충전+) — silent here (chargeMyUlt plays its own tap /
    // refusal), a refusal when dim (all three gauges full: the HUD sets data-sfx); without the attribute it was a tap
    expect(uiSoundFor(el('ult-charge hud-block', {}, '충전+'))).toBe('ui.tap');
    expect(uiSoundFor(el('ult-charge hud-block', { 'data-sfx': '' }, '충전+'))).toBeNull();
    expect(uiSoundFor(el('ult-charge hud-block is-full', { 'data-sfx': 'ui.refuse' }, '충전+'))).toBe('ui.refuse');
    expect(uiSoundFor(el('btn'))).toBe('ui.tap');
  });

  it('bakes non-silent sounds; loops are seamless lengths; variants differ', () => {
    for (const id of ['drag.guardian.slam', 'ult.chrono.stasis', 'ui.tap', 'amb.office', 'gd.room.copier', 'fe.success']) {
      const s = bakeSamples(id)!;
      expect(s.length, id).toBeGreaterThan(100);
      expect(peakOf(s), id).toBeGreaterThan(0.5);
      expect(peakOf(s), id).toBeLessThanOrEqual(0.91);
    }
    expect(bakeSamples('amb.office')!.length).toBe(8 * 32000);
    const v0 = bakeSamples('hit.basic', 0)!;
    const v1 = bakeSamples('hit.basic', 1)!;
    expect(v0.some((x, i) => x !== v1[i])).toBe(true);
    expect(bakeSamples('no.such.id')).toBeNull();
  });

  it('idle baking stops at its time budget and resumes', () => {
    const b = new Baker();
    b.enqueue(['amb.lobby', 'ui.tap', 'ui.back']);
    let t = 0;
    const clock = () => (t += 3);
    const first = b.pump(8, clock);
    expect(first).toBeLessThan(3);
    while (b.pending) b.pump(8, clock);
    expect(b.has('amb.lobby') && b.has('ui.tap') && b.has('ui.back')).toBe(true);
  });

  it('debug board families', () => {
    expect(boardFamily('drag.guardian.slam')).toBe('drag.guardian');
    expect(boardFamily('hit.basic')).toBe('hit');
  });
});

describe('sfx import boundary', () => {
  it('src/sim, src/net/protocol and server/ never import src/audio', () => {
    const root = join(__dirname, '../..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(root, 'src/sim'));
    walk(join(root, 'server'));
    files.push(join(root, 'src/net/protocol.ts'));
    for (const f of files) expect(/from ['"][./]*(src\/)?audio/.test(readFileSync(f, 'utf8')), f).toBe(false);
  });
});

// keep the SoundReq type referenced (shape check)
const _req: SoundReq = { id: 'ui.tap' };
void _req;

describe('idle baking on a busy page (기획 13차 통합)', () => {
  it('bakes only the idle time the browser reports, a sliver when the callback timed out, a full slice without rIC', () => {
    expect(bakeBudget()).toBe(BAKE_SLICE_MS);
    expect(bakeBudget({ didTimeout: false, timeRemaining: () => 30 })).toBe(BAKE_SLICE_MS);
    expect(bakeBudget({ didTimeout: false, timeRemaining: () => 3.5 })).toBe(3.5);
    expect(bakeBudget({ didTimeout: false, timeRemaining: () => 0 })).toBe(1);
    expect(bakeBudget({ didTimeout: true, timeRemaining: () => 0 })).toBe(BAKE_BUSY_MS);
  });
});

describe('기획 13차 리뷰: loops, late bakes, far voices, ducks', () => {
  it('an endless keyed loop (ambience) is never the voice-cap victim; one-shots give way instead', () => {
    const { e } = engine({ maxVoices: 3 });
    expect(e.play('amb.lobby', { loopFor: Infinity, key: 'amb' })).toBe(true);
    for (const id of ['mon.spawn', 'heal.big', 'fx.taunt', 'char.leave', 'bench.heal']) e.play(id);
    expect(e.activeIds()).toContain('amb.lobby');
    expect(e.hasKey('amb')).toBe(true);
  });

  it('a sound asked for before its bake is baked next and starts late (no bake in the frame); the samples are kept once', () => {
    const ctx = new FakeCtx();
    const e = new AudioEngine({ random: () => 0.5, maxVoices: 24, files: new Map(), loadFile: async () => ({ duration: 1 }) as unknown as AudioBuffer });
    e.init(ctx as unknown as AudioContext);
    expect(e.play('ult.blade.cutin')).toBe(false);
    expect(e.waiting).toBe(1);
    expect(e.baker.pending).toBe(1);
    e.baker.pump(60_000);
    ctx.currentTime = 0.1;
    e.flushLate();
    expect(e.activeIds()).toContain('ult.blade.cutin');
    expect(e.waiting).toBe(0);
    expect(e.baker.bytes()).toBe(0);
    expect(e.bufferBytes()).toBeGreaterThan(0);
    // too late: dropped, not played a second later
    expect(e.play('ult.mage.cutin')).toBe(false);
    ctx.currentTime = 2;
    e.baker.pump(60_000);
    e.flushLate();
    expect(e.activeIds()).not.toContain('ult.mage.cutin');
  });

  it('other players: one ult cast at a time, but its stage cues coexist and far drags (own cap 3) are not dropped under it', () => {
    const { e } = engine();
    expect(e.play('ult.guardian.citadel', { far: true, skill: 'guardian_u' })).toBe(true);
    expect(e.play('ult.guardian.slam', { far: true, skill: 'guardian_u' })).toBe(true);
    expect(e.play('drag.blade.dash', { far: true, skill: 'blade_d' })).toBe(true);
    expect(e.play('drag.guardian.slam', { far: true, skill: 'guardian_d' })).toBe(true);
    expect(e.play('drag.guardian.charge', { far: true, skill: 'guardian_d' })).toBe(true);
    expect(e.activeIds().filter(x => x.startsWith('ult.guardian'))).toHaveLength(2);
    expect(e.activeIds().filter(x => x.startsWith('drag.'))).toHaveLength(3);
    expect(e.play('drag.mage.cast', { far: true, skill: 'mage_d' })).toBe(true);
    expect(e.activeIds().filter(x => x.startsWith('drag.'))).toHaveLength(3);
  });

  it("the held '내가 탈락' duck is released by key; a new screen clears every duck", () => {
    const { e } = engine();
    e.duck('sfx', -6, 0, Infinity, 0.04, 0.4, 'out');
    expect(e.duckNow('sfx', 600)).toBeCloseTo(-6);
    e.unduck('sfx', 'out', 0.4);
    expect(e.duckNow('sfx', 1)).toBe(0);
    e.duck('sfx', -6, 0, Infinity, 0.04, 0.4, 'out');
    e.stopAll(0.3);
    expect(e.duckNow('sfx', 600)).toBeCloseTo(-6); // a solo pause keeps it
    e.clearDucks();
    expect(e.duckNow('sfx', 600)).toBe(0);
  });

  it("director: my 'out' duck lets go when I am back; a loop that is not playing is asked for again", () => {
    const d = new Director();
    d.route([], state(), view({ now: 1 }));
    const out = state({ tick: 101, players: [{ ...player(0), out: true }, player(1, ['ranger', 'cleric', 'bard'])] });
    const r1 = d.route([{ type: 'playerOut', player: 0 }], out, view({ now: 1.1 }));
    expect(r1.ctl).toContainEqual(expect.objectContaining({ kind: 'duck', key: 'out', hold: Infinity }));
    expect(d.route([], out, view({ now: 1.2 })).ctl.some(c => c.kind === 'unduck')).toBe(false);
    const back = d.route([], state({ tick: 103 }), view({ now: 1.3 }));
    expect(back.ctl).toContainEqual({ kind: 'unduck', target: 'sfx', key: 'out', release: 0.4 });

    const d2 = new Director();
    const silent = { ...view({ now: 1 }), playing: () => false };
    expect(ids(d2.route([], state(), silent))).toContain('amb.lobby');
    expect(ids(d2.route([], state({ tick: 101 }), { ...silent, now: 1.2 }))).toContain('amb.lobby'); // it did not start
    expect(ids(d2.route([], state({ tick: 102 }), { ...silent, now: 1.4 }))).not.toContain('amb.lobby'); // at most every 0.5 s
    expect(ids(d2.route([], state({ tick: 102 }), { ...silent, now: 1.8 }))).toContain('amb.lobby');
    expect(ids(d2.route([], state({ tick: 103 }), { ...silent, now: 2.5, playing: () => true }))).not.toContain('amb.lobby');
  });

  it("4-4: my drag's big beat ducks −4 dB for 0.15 s; boss warnings stay +3 dB through my ult's whole duck", () => {
    const wave: GameEvent = { ...SAMPLES.skillStage, stage: 'wave', actionIndex: 1 };
    const r = route([wave]);
    expect(r.ctl).toContainEqual(expect.objectContaining({ kind: 'duck', target: 'sfx', db: -4, hold: 0.15 }));
    const far = route([{ ...wave, player: 1, sourceId: 101 }]);
    expect(far.ctl.some(c => c.kind === 'duck' && c.db === -4)).toBe(false);

    const d = new Director();
    const tel = { id: 7, team: 'enemy' as const, center: P, origin: P, area: { shape: 'circle' as const, radius: 2 }, remaining: 1, total: 1 };
    const cast: GameEvent = { type: 'skillCast', sourceId: 4, player: null, slot: 'monster', skillId: 'ek_doors', name: 'x', center: P, area: tel.area, team: 'enemy', delay: 1 };
    d.route([], state(), view({ now: 1 }));
    d.route([SAMPLES.ultCast], state({ tick: 101 }), view({ now: 1.05 }));
    const during = d.route([cast], state({ tick: 102, telegraphs: [tel] }), view({ now: 2.2 }));
    expect(during.sounds.find(x => x.id === 'boss.windup.doors')?.db).toBe(3);
    const after = d.route([cast], state({ tick: 103, telegraphs: [{ ...tel, id: 9 }] }), view({ now: 3 }));
    expect(after.sounds.find(x => x.id === 'boss.windup.doors')?.db).toBe(0);
  });

  it('기획 17차: my 저스트 is loud with a −5 dB 0.25 s duck, anyone else\'s small; the dodged attack whiffs when it lands', () => {
    const mine = route([SAMPLES.justSwap]);
    expect(ids(mine)).toEqual(['just.swap']);
    expect(mine.ctl).toContainEqual(expect.objectContaining({ kind: 'duck', target: 'sfx', db: JUST_DUCK[0], hold: JUST_DUCK[1] }));
    const far = route([{ ...SAMPLES.justSwap, player: 1 }]);
    expect(ids(far)).toEqual(['just.swap.far']);
    expect(far.ctl.some(c => c.kind === 'duck')).toBe(false);
    // the telegraph of my 저스트 lands → just.whiff (with the impact); a cut one does not whiff
    const d = new Director();
    const tel = { id: 7, team: 'enemy' as const, center: P, origin: P, area: { shape: 'circle' as const, radius: 2 }, remaining: 0.3, total: 1 };
    d.route([], state({ telegraphs: [tel] }), view({ now: 1 }));
    d.route([SAMPLES.justSwap], state({ tick: 101, telegraphs: [tel] }), view({ now: 1.05 }));
    expect(ids(d.route([], state({ tick: 102, telegraphs: [] }), view({ now: 1.4 })))).toContain('just.whiff');
    const d2 = new Director();
    d2.route([], state({ telegraphs: [tel] }), view({ now: 1 }));
    d2.route([SAMPLES.justSwap], state({ tick: 101, telegraphs: [tel] }), view({ now: 1.05 }));
    const cut: GameEvent = { type: 'interrupt', sourceId: 1, telegraphId: 7, pos: P, name: 'x' };
    expect(ids(d2.route([cut], state({ tick: 102, telegraphs: [] }), view({ now: 1.4 })))).not.toContain('just.whiff');
  });

  it('기획 17차: reward cues — a proc on my unit (quiet), a set completed, the skip toast is silent; new ids have recipes', () => {
    expect(ids(route([SAMPLES.rewardProc]))).toEqual(['reward.proc']);
    expect(ids(route([{ ...SAMPLES.rewardProc, player: 1 }]))).toEqual([]);
    expect(ids(route([{ ...SAMPLES.rewardProc, entityId: null, partyIndex: null, text: '빚 · 이번 보상 없음' }]))).toEqual([]);
    expect(ids(route([SAMPLES.tagSet]))).toEqual(['reward.set']);
    expect(ids(route([{ ...SAMPLES.tagSet, player: 1 }]))).toEqual([]);
    for (const id of ['just.swap', 'just.swap.far', 'just.whiff', 'reward.reroll', 'reward.pick.legend', 'reward.set', 'reward.proc']) expect(hasRecipe(id), id).toBe(true);
    expect(sfxRow('just.swap').bus).toBe('hero');
    expect(sfxRow('just.swap.far').db).toBeLessThan(sfxRow('just.swap').db);
    expect(sfxRow('reward.proc')).toMatchObject({ db: -14, gap: 300 });
  });
});
