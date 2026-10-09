// 기획 13차 효과음: game events + state changes → sound requests (docs/sfx.md 3장 "언제", 4-3 나/다른 플레이어).
// Pure of audio: `route()` returns what to play (id, delay, pan, far …) and bus controls (ducks, low-pass, loop stops),
// so tests check routing without an AudioContext. Client only — it reads server snapshots / the local sim's state,
// never src/sim. Every GameEvent type has a row in EVENT_SOUNDS (a new event type is a type error until routed).

import type { AreaShape, Entity, GameEvent, GameState, Role, Vec2 } from '../types';
import { LOGICAL_H, LOGICAL_W } from '../types';
import { CHARACTERS, PETS, getGoedamTrace, getMonster, goedamTraceKind } from '../data';
import { DASH_LAND } from '../render/dashtime';
import { stageCues, type Cue } from './stages';
import { fieldUltGauge } from '../sim/ultMode';

export interface SoundReq {
  id: string;
  /** Real seconds from now. */
  delay?: number;
  /** Extra dB on top of the id's level. */
  db?: number;
  /** −1..1. */
  pan?: number;
  /** Another player's drag / ult: the far version (−8 dB, 3.5 kHz low-pass, no ducking). */
  far?: boolean;
  /** Playback rate (pitch steps). */
  rate?: number;
  /** Loop the sound for this many real seconds (Infinity = until stopped by key). */
  loopFor?: number;
  /** Handle for stopping it later ('amb', 'groggy' …). */
  key?: string;
  /** Skill id: a `skill.<skillId>` file replaces the whole skill (2-2 lookup ①). */
  skill?: string;
}

export type Ctl =
  | { kind: 'duck'; target: 'sfx' | 'bg'; db: number; at?: number; attack?: number; hold: number; release?: number; key?: string }
  /** Release a keyed (held) duck (기획 13차 리뷰: the '내가 탈락' duck ends when I am back). */
  | { kind: 'unduck'; target: 'sfx' | 'bg'; key: string; release?: number }
  | { kind: 'lowpass'; freq: number | null; at?: number; ramp: number }
  | { kind: 'stop'; key: string; fade?: number };

export interface Routed {
  sounds: SoundReq[];
  ctl: Ctl[];
}

export interface RouteView {
  localPlayer: number;
  /** tunables.gameSpeed: sim delays are divided by it (2-5). */
  gameSpeed: number;
  /** World → logical screen px (renderer camera); absent = everything centred. */
  toScreen?: (p: Vec2) => Vec2;
  /** Real seconds (performance.now / 1000). */
  now: number;
  /**
   * 기획 13차 리뷰: is a keyed loop playing / scheduled (engine)? A loop whose request failed (not baked yet, a stale
   * frame, the voice cap) is asked for again. Absent = assume it plays (tests).
   */
  playing?: (key: string) => boolean;
}

/** A missing loop is asked for again at most this often (s). */
const LOOP_REASK = 0.5;

/** My drag's big beat ducks the effect bus this much for this long at the hit-stop (4-4). */
export const DRAG_BEAT_DUCK: readonly [number, number] = [-4, 0.15];
/** My ult's effect-bus duck: hold + release (s); boss windups / impacts in it play 3 dB louder (4-4). */
export const ULT_DUCK_SEC = 1.2 + 0.4;

/** What each event sounds like ('none' = deliberately silent). The handler below must cover every key. */
export const EVENT_SOUNDS: Record<GameEvent['type'], string> = {
  damage: 'hit.basic / hit.skill / hit.crit / hit.weak / hit.boss / hurt.char / hurt.shield (drag·ult hits: none)',
  heal: 'heal.tick / heal.big / heal.drain / mon.heal',
  benchHeal: 'bench.heal',
  attack: 'atk.swing.<role> / atk.shot.<char> / atk.shot.turret',
  skillCast: 'normal.<char> / pet.<pet> / stage build-ups / mon.windup / mid.windup / boss.windup.<kind>',
  skillStage: 'drag.<char>.<stage> / ult.<char>.<stage> / role default / doll.burst',
  ultCast: 'ult.<char>.cutin',
  statusApplied: 'fx.taunt / fx.tether / fx.charm',
  stasisEnd: 'ult.chrono.resume',
  benchBuff: 'bench.buff',
  reviveCut: 'ui.cdcut',
  swapCdCut: 'ui.cdcut',
  appear: 'char.appear.<role>',
  dash: 'dash.<role> / mon.charge / fe.toad.hop',
  blink: 'mon.blink',
  bossPhase: 'boss.phase.<boss>',
  leave: 'char.leave',
  death: 'char.down / char.down.far / mon.death.* / mid.death / copy.pop',
  spawnWarning: 'mon.spawnWarn',
  interrupt: 'mon.interrupt',
  spawn: 'mon.spawn / mid.spawn',
  revive: 'char.revive / char.revive.all',
  playerOut: 'run.out / player.out',
  ultReady: 'ult.ready',
  floorStart: 'floor.start.<zone> / boss.intro.<boss> / zone.enter',
  floorClear: 'floor.clear / floor.clear.boss',
  enrage: 'boss.enrage',
  bossRetreat: 'boss.retreat',
  runOver: 'run.victory / run.defeat',
  goedamOpen: 'gd.enter + gd.room.<room>',
  goedamOutcome: 'gd.flicker + gd.result.<tone>',
  goedamTrace: 'gd.trace.<kind>',
  goedamTraceExpired: 'gd.trace.expire',
  fieldEventWarn: 'fe.warn',
  fieldEventStart: 'fe.start.<event>',
  fieldEventProgress: 'fe.lamp / fe.fall / fe.tally / fe.startle / fe.monitor',
  fieldEventEnd: 'fe.success / fe.fail.<event>',
  bossGroggy: 'groggy.break + groggy.stars',
  bossGroggyEnd: 'groggy.recover',
  groggyGain: 'groggy.fill',
  // 기획 15차 원정: the screens (src/ui/expedition*) play 'exp.*' themselves; the events stay silent here
  stageClear: 'none',
  gearProc: 'none',
};

// ─────────────────────────── static lookups ───────────────────────────

interface SkillInfo {
  char: string;
  role: Role;
  slot: 'normal' | 'drag' | 'ult';
}
const SKILLS = new Map<string, SkillInfo>();
for (const c of CHARACTERS) for (const slot of ['normal', 'drag', 'ult'] as const) SKILLS.set(c[slot].id, { char: c.id, role: c.role, slot });
const CHAR_ROLE = new Map<string, Role>(CHARACTERS.map(c => [c.id, c.role]));
const RANGED_CHARS = new Set(CHARACTERS.filter(c => c.basic.kind !== 'melee').map(c => c.id));
const PET_IDS = new Set(PETS.map(p => p.id));

/** Boss skill id → windup / impact kind (3-7). */
const BOSS_KIND: Record<string, string> = {
  ek_doors: 'doors',
  ek_doors_back: 'doors',
  ek_summon: 'summon',
  ek_counter: 'countdown',
  ol_paperstorm: 'papers',
  ol_summon: 'summon',
  ol_stamp: 'stamp',
  ol_stamp_combo: 'stamp',
  sd_scalpels: 'blades',
  sd_scalpel_storm: 'blades',
  sd_summon: 'summon',
  sd_gas: 'gas',
  sd_incision: 'slice',
  boss_burst: 'burst',
  boss_summon: 'summon',
  boss_rift: 'beam',
  boss_beams: 'beam',
  boss_tentacles: 'tentacle',
  boss_abyss_ring: 'ring',
};

/** Monster look → mon.death variant (3-6). */
const DEATH_LOOK: Record<string, string> = {
  phone: 'phone',
  copy_man: 'copy',
  copy_mini: 'copy',
  mannequin: 'mannequin',
  giant_mannequin: 'mannequin',
  eye_stalk: 'eye',
  vending: 'vending',
  umbrella: 'umbrella',
};

const FE_PROGRESS: Record<string, string> = { lamp: 'fe.lamp', fall: 'fe.fall', kill: 'fe.tally', startle: 'fe.startle', heal: 'fe.monitor' };
const ZONE_FIRST = new Set([1, 6, 11, 16]);
/** groggy.fill pentatonic steps C5 → C6. */
const PENTA = [0, 2, 4, 7, 9, 12];

export function impactShape(a: AreaShape): 'circle' | 'line' | 'cone' | 'ring' {
  switch (a.shape) {
    case 'line':
    case 'rect':
      return 'line';
    case 'cone':
    case 'fan':
      return 'cone';
    case 'ring':
    case 'cross':
      return 'ring';
    default:
      return 'circle';
  }
}

const st = (n: number): number => Math.pow(2, n / 12);

// ─────────────────────────── per-frame snapshot (solo states are mutated in place) ───────────────────────────

interface Snap {
  tick: number;
  phase: GameState['phase'];
  floor: number;
  telegraphs: Map<number, { team: string }>;
  statuses: Map<number, Set<string>>;
  shields: Map<number, number>;
  defs: Map<number, { defId: string; tier: string; kind: string; owner: number | null }>;
  cardsReady: boolean[];
  timerSec: number;
  feSec: number;
  printed: number;
  bots: boolean[];
  connected: boolean;
}

interface TeleInfo {
  kind: string | null;
  tier: string;
  shape: 'circle' | 'line' | 'cone' | 'ring';
}

export class Director {
  private snap: Snap | null = null;
  /** telegraph id → what lands there (matched to the monster cast that made it). */
  private tele = new Map<number, TeleInfo>();
  private counters = new Map<string, { n: number; at: number }>();
  private seen = new Map<string, number>();
  private castWindow = new Map<number, number>();
  private frenzyUntil = new Map<number, number>();
  private amb: string | null = null;
  private enrageLoop = false;
  /** Real time my ult's duck ends (boss warnings in it are compensated +3 dB). */
  private ultDuckUntil = -1;
  /** My '내가 탈락' duck is held. */
  private outDuck = false;
  private lowHpAt = -1;
  /** Per gauge (party slot) the fullSince 'ult.remind' already played for. */
  private reminded = new Map<number, number>();
  /** 기획 14차 개별 게이지: my field slot and the sim time it came on (a gauge filled on the bench reminds from then). */
  private fieldSlot: number | null | undefined = undefined;
  private fieldSince = 0;
  private rewardShown = false;
  private stasisTill = 0;

  reset(): void {
    this.snap = null;
    this.tele.clear();
    this.counters.clear();
    this.seen.clear();
    this.castWindow.clear();
    this.frenzyUntil.clear();
    this.amb = null;
    this.enrageLoop = false;
    this.ultDuckUntil = -1;
    this.outDuck = false;
    this.lowHpAt = -1;
    this.reminded.clear();
    this.fieldSlot = undefined;
    this.fieldSince = 0;
    this.rewardShown = false;
    this.stasisTill = 0;
  }

  /** Loops were cut (pause / scene change): the watchers restart what should be playing. */
  forgetLoops(): void {
    this.amb = null;
    this.enrageLoop = false;
  }

  route(events: readonly GameEvent[], s: GameState, view: RouteView): Routed {
    const out: Routed = { sounds: [], ctl: [] };
    const ctx = new FrameCtx(this, s, view, out);
    const prev = this.snap;
    // a new run / reconnect snapshot: no diffs against the old one
    const fresh = !prev || s.tick < prev.tick || s.floor < prev.floor - 1;
    if (fresh) this.reset();
    const interrupted = new Set<number>();
    for (const e of events) if (e.type === 'interrupt' && e.telegraphId != null) interrupted.add(e.telegraphId);
    const pending: { center: Vec2; info: TeleInfo }[] = [];
    for (const e of events) this.onEvent(ctx, e, pending);
    if (!fresh && prev) this.watch(ctx, prev, interrupted, pending);
    this.loops(ctx);
    this.snap = takeSnap(s, view.localPlayer, this.snap);
    out.sounds = mergeFrame(out.sounds);
    this.gc(view.now);
    return out;
  }

  // ─────────────────────────── events ───────────────────────────

  private onEvent(c: FrameCtx, e: GameEvent, pending: { center: Vec2; info: TeleInfo }[]): void {
    switch (e.type) {
      case 'damage':
        return this.onDamage(c, e);
      case 'heal': {
        const t = c.ent(e.targetId);
        if (t?.team === 'enemy') return c.play('mon.heal', { pan: c.pan(e.pos) });
        if (!c.isMine(t)) return;
        if (e.from != null) c.play('heal.drain', { pan: c.pan(e.pos) });
        else if (t && e.amount >= t.maxHp * 0.15) c.play('heal.big', { pan: c.pan(e.pos) });
        else c.play('heal.tick', { pan: c.pan(e.pos) });
        return;
      }
      case 'benchHeal':
        if (e.player === c.lp) c.play('bench.heal');
        return;
      case 'attack':
        return this.onAttack(c, e);
      case 'skillCast':
        return this.onCast(c, e, pending);
      case 'skillStage':
        return this.onStage(c, e);
      case 'ultCast':
        if (e.player !== c.lp) return;
        c.play(`ult.${e.defId}.cutin`, { pan: c.heroPan(e.entityId), skill: e.skillId });
        c.duck('sfx', -8, 0, 1.2, 0.04, 0.4);
        this.ultDuckUntil = c.now + ULT_DUCK_SEC;
        c.duck('bg', -14, 0, 1.2, 0.04, 0.4);
        return;
      case 'statusApplied': {
        if (e.player !== c.lp) return;
        const id = e.status === 'taunt' ? 'fx.taunt' : e.status === 'tether' || e.status === 'root' ? 'fx.tether' : e.status === 'charm' ? 'fx.charm' : null;
        if (id) c.play(id, { pan: c.entPan(e.targetId) });
        return;
      }
      case 'stasisEnd':
        // my 시간 정지 ends (one per frozen unit: the first one releases the tape stop)
        if (e.player !== c.lp || !this.once('stasisEnd', c.now, 0.6)) return;
        c.play('ult.chrono.resume', { pan: c.entPan(e.entityId) });
        c.out.ctl.push({ kind: 'lowpass', freq: null, ramp: 0.3 }, { kind: 'stop', key: 'chrono.tock' });
        this.stasisTill = 0;
        return;
      case 'benchBuff':
        if (e.player === c.lp) c.play('bench.buff');
        return;
      case 'reviveCut':
      case 'swapCdCut':
        if (e.player === c.lp) c.play('ui.cdcut');
        return;
      case 'appear': {
        if (e.player !== c.lp) return;
        const role = CHAR_ROLE.get(c.ent(e.entityId)?.defId ?? '') ?? 'melee';
        c.play(`char.appear.${role}`, { pan: c.pan(e.pos) * 0.4 });
        return;
      }
      case 'dash':
        return this.onDash(c, e);
      case 'blink': {
        const m = c.ent(e.entityId);
        if (m && m.team === 'enemy') c.play('mon.blink', { pan: c.pan(e.to) });
        return;
      }
      case 'bossPhase':
        c.play(`boss.phase.${c.bossDef(e.entityId)}`);
        c.duck('sfx', -6, 0, 0.6);
        return;
      case 'leave':
        if (e.player === c.lp) c.play('char.leave', { pan: c.pan(e.pos) * 0.4 });
        return;
      case 'death':
        return this.onDeath(c, e);
      case 'spawnWarning':
        c.play('mon.spawnWarn', c.pos(e.pos));
        return;
      case 'interrupt':
        c.play('mon.interrupt', c.pos(e.pos));
        return;
      case 'spawn':
        if (e.tier === 'mid') {
          c.play('mid.spawn', { pan: c.pan(e.pos) * 0.5 });
          c.duck('sfx', -6, 0, 0.6);
        } else if (e.tier !== 'boss') c.play('mon.spawn', c.pos(e.pos));
        return;
      case 'revive':
        if (e.player !== c.lp) return;
        // 층 클리어 → everyone revives in the same frame: one chord
        if (c.flags.floorClear) {
          if (!c.flags.revivedAll) c.play('char.revive.all', { delay: 0.4 });
          c.flags.revivedAll = true;
        } else c.play('char.revive');
        return;
      case 'playerOut':
        if (e.player === c.lp) {
          c.play('run.out');
          c.duck('sfx', -6, 0, Infinity, 0.04, 0.4, 'out');
          this.outDuck = true;
        } else c.play('player.out');
        return;
      case 'ultReady':
        // per-character gauges (기획 15차): only the field character's (the one the ult button shows) chimes
        if (e.player === c.lp && e.partyIndex === c.s.players[c.lp]?.activeIndex) c.play('ult.ready');
        return;
      case 'floorStart':
        return this.onFloorStart(c, e);
      case 'floorClear':
        c.flags.floorClear = true;
        if (c.s.plan.kind === 'boss' || c.s.floor % 5 === 0) {
          c.play('floor.clear.boss', { delay: 0.3 });
          c.duck('sfx', -8, 0, 1);
        } else c.play('floor.clear');
        c.out.ctl.push({ kind: 'stop', key: 'enrage', fade: 0.3 }, { kind: 'stop', key: 'groggy', fade: 0.3 });
        return;
      case 'enrage':
        c.play('boss.enrage');
        return;
      case 'bossRetreat':
        c.play('boss.retreat');
        c.duck('sfx', -8, 0, 1);
        c.out.ctl.push({ kind: 'stop', key: 'groggy', fade: 0.3 }, { kind: 'stop', key: 'enrage', fade: 0.3 });
        return;
      case 'runOver':
        if (e.result.reason === 'quit') return;
        if (e.result.outcome === 'victory') c.play('run.victory');
        else c.play('run.defeat', { delay: 0.25 });
        c.out.ctl.push({ kind: 'stop', key: 'amb', fade: 0.6 }, { kind: 'stop', key: 'enrage', fade: 0.3 }, { kind: 'stop', key: 'groggy', fade: 0.3 });
        return;
      case 'goedamOpen':
        c.play('gd.enter');
        c.play(`gd.room.${e.roomId}`, { delay: 0.5 });
        return;
      case 'goedamOutcome':
        if (e.player !== c.lp) return;
        c.play('gd.flicker');
        c.duck('bg', -60, 0.2, 0.15, 0.01, 0.1);
        c.play(e.optionId === 'leave' ? 'gd.result.leave' : `gd.result.${e.tone}`, { delay: 0.6 });
        return;
      case 'goedamTrace':
        if (e.player === c.lp) c.play(`gd.trace.${traceKind(e.traceId)}`, { delay: 0.8 });
        return;
      case 'goedamTraceExpired':
        if (e.player === c.lp) c.play('gd.trace.expire');
        return;
      case 'fieldEventWarn':
        c.play('fe.warn', { pan: c.pan(e.pos) * 0.5 });
        return;
      case 'fieldEventStart':
        c.play(`fe.start.${e.id}`, { pan: c.pan(e.pos) * 0.5 });
        return;
      case 'fieldEventProgress': {
        const id = FE_PROGRESS[e.kind ?? ''] ?? 'fe.tally';
        c.play(id, { rate: st(Math.round((12 * e.progress) / Math.max(1, e.goal))) });
        return;
      }
      case 'fieldEventEnd':
        if (e.success) {
          c.play('fe.success');
          c.play('ui.reward.pulse', { delay: 0.4 });
        } else c.play(`fe.fail.${e.id}`);
        return;
      case 'bossGroggy':
        c.play('groggy.break', { pan: c.entPan(e.entityId) * 0.5 });
        c.duck('sfx', -6, 0, 0.6);
        c.play('groggy.stars', { loopFor: e.duration / c.speed, key: 'groggy', delay: 0.3, pan: c.entPan(e.entityId) * 0.5 });
        return;
      case 'bossGroggyEnd':
        c.out.ctl.push({ kind: 'stop', key: 'groggy', fade: 0.2 });
        c.play('groggy.recover', { pan: c.entPan(e.entityId) * 0.5 });
        return;
      case 'groggyGain': {
        const fill = c.s.bossGroggy?.fill ?? 0;
        c.play('groggy.fill', { rate: st(PENTA[Math.min(5, Math.round(fill * 5))]), db: e.player === c.lp ? 0 : -8 });
        return;
      }
      case 'stageClear':
      case 'gearProc':
        return; // 기획 15차 원정: the expedition screens play their own cues
      default: {
        const never: never = e;
        return never;
      }
    }
  }

  private onDamage(c: FrameCtx, e: Extract<GameEvent, { type: 'damage' }>): void {
    const { pan, db } = c.pos(e.pos);
    if (e.targetTeam === 'ally') {
      const t = c.ent(e.targetId);
      if (!c.isMine(t) || t?.kind !== 'character') return;
      c.play(e.amount <= 0 && e.absorbed > 0 ? 'hurt.shield' : 'hurt.char', { pan });
      return;
    }
    // drag / ult hits: the landing sound already says it (3-3)
    if (e.source === 'drag' || e.source === 'ult') return;
    const t = c.ent(e.targetId);
    if (e.weak) c.play('hit.weak', { pan, db });
    if (t?.tier === 'boss' || t?.tier === 'mid') c.play('hit.boss', { pan, db: db + (t.tier === 'mid' ? -3 : 0) });
    else c.play(e.source && e.source !== 'basic' ? 'hit.skill' : 'hit.basic', { pan, db });
    if (e.crit) c.play('hit.crit', { pan, db });
  }

  private onAttack(c: FrameCtx, e: Extract<GameEvent, { type: 'attack' }>): void {
    const src = c.ent(e.sourceId);
    if (!src || !c.isMine(src)) return;
    const pan = c.pan(src.pos);
    if (src.kind === 'summon') {
      if (e.ranged) c.play('atk.shot.turret', { pan });
      return;
    }
    if (src.kind !== 'character') return;
    const frenzy = (this.frenzyUntil.get(src.id) ?? 0) > c.now;
    const o = { pan, rate: frenzy ? st(-3) : 1, db: frenzy ? 2 : 0 };
    if (e.ranged || RANGED_CHARS.has(src.defId)) c.play(`atk.shot.${src.defId}`, o);
    else c.play(`atk.swing.${CHAR_ROLE.get(src.defId) ?? 'melee'}`, o);
  }

  private onDash(c: FrameCtx, e: Extract<GameEvent, { type: 'dash' }>): void {
    const m = c.ent(e.entityId);
    if (!m) return;
    if (m.team === 'enemy') {
      c.play(m.defId === 'fe_toad' ? 'fe.toad.hop' : 'mon.charge', { pan: c.pan(e.to) });
      return;
    }
    // a dash inside my drag / ult is part of its stage sound
    if (!c.isMine(m) || m.kind !== 'character' || (this.castWindow.get(m.id) ?? 0) > c.now) return;
    c.play(`dash.${CHAR_ROLE.get(m.defId) ?? 'melee'}`, { pan: c.pan(e.to) * 0.4 });
  }

  private onDeath(c: FrameCtx, e: Extract<GameEvent, { type: 'death' }>): void {
    const { pan, db } = c.pos(e.pos);
    if (e.kind === 'character') {
      const owner = this.snap?.defs.get(e.entityId)?.owner ?? c.ent(e.entityId)?.ownerPlayer;
      c.play(owner === c.lp ? 'char.down' : 'char.down.far', { pan });
      return;
    }
    if (e.tier === 'boss') return; // boss.retreat
    const def = this.snap?.defs.get(e.entityId)?.defId ?? c.ent(e.entityId)?.defId ?? '';
    if (def.startsWith('paper_doll')) return; // doll.burst (its stage event)
    if (e.tier === 'mid') {
      c.play('mid.death', { pan, db });
      return;
    }
    if ((this.snap?.defs.get(e.entityId)?.owner ?? null) != null) return; // a player's summon (포탑) expiring
    if (def === 'copy_man') {
      c.play('copy.pop', { pan, db });
      return;
    }
    c.play(`mon.death${deathVariant(def)}`, { pan, db });
  }

  private onFloorStart(c: FrameCtx, e: Extract<GameEvent, { type: 'floorStart' }>): void {
    if (e.kind === 'boss') {
      c.play(`boss.intro.${c.s.plan.bossId ?? 'abyss_watcher'}`, { delay: 0.2 });
      return;
    }
    const theme = c.s.plan.theme ?? 'lobby';
    if (ZONE_FIRST.has(e.floor)) c.play('zone.enter');
    c.play(`floor.start.${theme}`, { delay: ZONE_FIRST.has(e.floor) ? 0.6 : 0 });
  }

  // ─────────────────────────── skills ───────────────────────────

  private onCast(c: FrameCtx, e: Extract<GameEvent, { type: 'skillCast' }>, pending: { center: Vec2; info: TeleInfo }[]): void {
    if (e.slot === 'monster') {
      if (e.team !== 'enemy' || !(e.delay && e.delay > 0)) return;
      const src = e.sourceId != null ? c.ent(e.sourceId) : null;
      const tier = src?.tier ?? 'normal';
      const kind = tier === 'boss' ? (BOSS_KIND[e.skillId] ?? 'burst') : null;
      pending.push({ center: e.center, info: { kind, tier, shape: impactShape(e.area) } });
      const once = `wu:${e.sourceId}:${e.skillId}`;
      if (!this.once(once, c.now, 0.3)) return;
      const pan = c.pan(e.center) * (tier === 'boss' ? 0.5 : 1);
      if (kind) c.play(`boss.windup.${kind}`, { pan, db: this.inUltDuck(c) ? 3 : 0 });
      else c.play(tier === 'mid' ? 'mid.windup' : 'mon.windup', { pan });
      return;
    }
    if (e.slot === 'pet') {
      if (e.player !== c.lp || !PET_IDS.has(e.skillId)) return;
      c.play(`pet.${e.skillId}`, { pan: c.pan(e.center) * 0.6 });
      if (e.skillId === 'frog_bomb') c.play('pet.frog_bomb.impact', { delay: (e.delay ?? 0.5) / c.speed, pan: c.pan(e.center) * 0.6 });
      return;
    }
    const info = SKILLS.get(e.skillId);
    if (!info || e.player == null) return;
    if (e.slot === 'normal') {
      if (e.player !== c.lp) return;
      if (this.once(`n:${e.sourceId}:${e.skillId}`, c.now, 0.2)) c.play(`normal.${info.char}`, { pan: c.pan(e.center) });
      return;
    }
    if (e.slot !== 'drag' && e.slot !== 'ult') return;
    if (e.sourceId != null) this.castWindow.set(e.sourceId, c.now + 1.2);
    if (!e.stage) return;
    const cues = stageCues(info.char, e.slot, e.stage) ?? [];
    const far = e.player !== c.lp;
    const delay = e.delay ?? 0;
    const land = landOffset(e.slot, delay);
    for (const cue of cues) {
      if (!c.farOk(cue, far, e.slot)) continue;
      if (cue.on === 'cast') {
        if (this.once(`c:${e.sourceId}:${e.skillId}:${cue.id}`, c.now, 0.5)) c.play(cue.id, { pan: c.heroPan(e.sourceId), far, db: cue.db, skill: e.skillId, delay: e.slot === 'drag' ? DASH_LAND : 0 });
        continue;
      }
      const at = (delay + 0) / c.speed + land;
      if (cue.duck && !far) c.duck('sfx', cue.duck[0], Math.max(0, at - cue.duck[1]), cue.duck[1], 0.02, 0.08);
      if (cue.lead && (!cue.on || cue.on === 'land')) {
        if (this.once(`l:${e.sourceId}:${e.skillId}:${e.stage}`, c.now, 0.2)) c.play(cue.id, { delay: Math.max(0, at - cue.lead), pan: c.panAt(e.center, far), far, db: cue.db, skill: e.skillId });
      }
    }
  }

  private onStage(c: FrameCtx, e: Extract<GameEvent, { type: 'skillStage' }>): void {
    if (e.slot === 'monster') {
      if (e.stage === 'burst' && e.hit === 0) c.play('doll.burst', { pan: c.pan(e.center) });
      return;
    }
    if (e.slot !== 'drag' && e.slot !== 'ult') return;
    const info = SKILLS.get(e.skillId);
    if (!info || e.player == null) return;
    const far = e.player !== c.lp;
    const action = c.action(e.skillId, e.slot, e.actionIndex);
    const delay = action?.delay ?? 0;
    const pan = c.panAt(e.center, far);
    const cues = stageCues(info.char, e.slot, e.stage);
    const key = `${e.sourceId}:${e.skillId}:${e.stage}`;
    if (cues === undefined) {
      if (e.hit === 0 && !far && this.once(`s:${key}`, c.now, 0.2)) c.play(`${e.slot}._role.${info.role}`, { pan, delay: landOffset(e.slot, delay), skill: e.skillId });
      return;
    }
    if (e.slot === 'drag' && e.targets >= 4 && !far && this.once(`crunch:${e.sourceId}:${e.skillId}`, c.now, 1.2)) c.play('drag.crunch', { pan, delay: landOffset(e.slot, delay) });
    const body = e.slot === 'drag' ? Math.min(4, 1.5 * Math.log2(1 + e.targets)) : 0;
    for (const cue of cues) {
      if (!c.farOk(cue, far, e.slot) || cue.on === 'cast' || cue.lead) continue;
      if (cue.on === 'zone') this.zoneCue(c, cue, e, action?.zone?.duration ?? 3, pan, far);
      else if (cue.on === 'hit') this.hitCue(c, cue, key, e, pan, far, delay);
      else if (e.hit === 0 && this.once(`s:${key}:${cue.id}`, c.now, 0.2)) this.landCue(c, cue, e, pan, far, delay, body);
    }
  }

  private landCue(c: FrameCtx, cue: Cue, e: Extract<GameEvent, { type: 'skillStage' }>, pan: number, far: boolean, delay: number, body: number): void {
    if (cue.loopFor) {
      // 버서커 광란: the heartbeat loops while it lasts; its basic attacks sound lower meanwhile
      if (e.sourceId != null) this.frenzyUntil.set(e.sourceId, c.now + cue.loopFor / c.speed);
      c.play(cue.id, { pan, far, db: cue.db, loopFor: cue.loopFor / c.speed, key: `frenzy:${e.sourceId}` });
    } else {
      c.play(cue.id, { pan, far, db: (cue.db ?? 0) + body, rate: cue.step ? st(cue.step) : 1, delay: landOffset(e.slot, delay), skill: e.skillId });
      // 4-4: my drag's big beat ducks the effect bus at its hit-stop
      if (cue.fin && !far && e.slot === 'drag') c.duck('sfx', DRAG_BEAT_DUCK[0], landOffset(e.slot, delay), DRAG_BEAT_DUCK[1], 0.01, 0.1);
    }
    if (cue.special === 'stasis' && !far) {
      const dur = c.effectDuration(e.skillId, 'ult', e.actionIndex, 'stasis') / c.speed;
      this.stasisTill = c.now + dur + 0.5;
      c.out.ctl.push({ kind: 'lowpass', freq: 300, ramp: 0.25 }, { kind: 'lowpass', freq: 1200, at: 0.3, ramp: 0.2 }, { kind: 'lowpass', freq: null, at: dur + 0.4, ramp: 0.3 });
      for (let i = 1; i < dur; i++) c.play('ult.chrono.tock', { delay: i, key: 'chrono.tock', pan });
    }
  }

  private hitCue(c: FrameCtx, cue: Cue, key: string, e: Extract<GameEvent, { type: 'skillStage' }>, pan: number, far: boolean, delay: number): void {
    const n = this.count(key, c.now);
    if (n >= (cue.max ?? 99) || (far && n >= 4)) return;
    const last = cue.last && n === (cue.max ?? 0) - 1;
    const jitter = cue.jitter ? (((n * 7) % 3) - 1) * cue.jitter : 0;
    // 4-5: flurries alternate ±0.35 around the caster
    const altPan = Math.max(-1, Math.min(1, pan + (n % 2 ? 0.35 : -0.35)));
    c.play(last ? cue.last! : cue.id, { pan: altPan, far, db: cue.db, rate: st((cue.step ?? 0) * n + jitter), delay: n === 0 ? landOffset(e.slot, delay) : 0, skill: e.skillId });
  }

  private zoneCue(c: FrameCtx, cue: Cue, e: Extract<GameEvent, { type: 'skillStage' }>, duration: number, pan: number, far: boolean): void {
    const dur = duration / c.speed;
    if (e.hit === 0) {
      if (!this.once(`z:${e.sourceId}:${e.skillId}:${e.stage}`, c.now, 0.2)) return;
      if (cue.loop) c.play(cue.id, { pan, far, db: cue.db, loopFor: dur, key: `zone:${e.sourceId}:${e.stage}` });
      if (cue.end) c.play(cue.end, { pan, far, db: -4, delay: dur });
      if (cue.special === 'countdown' && !far) {
        for (let t = 1; t < duration - 1; t++) c.play(`ult.${SKILLS.get(e.skillId)?.char}.tick`, { delay: t / c.speed, db: -8, pan });
        for (let t = duration - 1; t < duration - 0.01; t += 0.25) c.play(`ult.${SKILLS.get(e.skillId)?.char}.tick`, { delay: t / c.speed, db: -5, pan });
      }
      return;
    }
    if (cue.tick && this.once(`zt:${e.sourceId}:${e.skillId}:${e.stage}:${e.hit}`, c.now, 0.1)) c.play(cue.tick, { pan, far, db: cue.db });
  }

  // ─────────────────────────── state watchers ───────────────────────────

  private watch(c: FrameCtx, prev: Snap, interrupted: Set<number>, pending: { center: Vec2; info: TeleInfo }[]): void {
    const s = c.s;
    // new enemy telegraphs: remember what made them
    for (const t of s.telegraphs) {
      if (t.team !== 'enemy' || prev.telegraphs.has(t.id) || this.tele.has(t.id)) continue;
      const p = pending.find(x => Math.abs(x.center.x - t.center.x) < 0.05 && Math.abs(x.center.y - t.center.y) < 0.05) ?? (pending.length === 1 ? pending[0] : undefined);
      this.tele.set(t.id, p?.info ?? { kind: null, tier: 'normal', shape: impactShape(t.area) });
    }
    // gone without an interrupt → it landed (3-6 mon.impact / 3-7 boss.impact)
    if (s.phase === 'combat' && prev.phase === 'combat') {
      const now = new Set(s.telegraphs.map(t => t.id));
      for (const [id, info] of prev.telegraphs) {
        if (info.team !== 'enemy' || now.has(id) || interrupted.has(id)) continue;
        const ti = this.tele.get(id);
        if (ti?.kind) c.play(`boss.impact.${ti.kind}`, { db: this.inUltDuck(c) ? 3 : 0 });
        else c.play(`mon.impact.${ti?.shape ?? 'circle'}`, { db: ti?.tier === 'mid' ? 2 : 0 });
      }
    }
    for (const id of [...this.tele.keys()]) if (!s.telegraphs.some(t => t.id === id)) this.tele.delete(id);
    this.watchStatuses(c, prev);
    this.watchMine(c, prev);
    this.watchClock(c, prev);
  }

  private watchStatuses(c: FrameCtx, prev: Snap): void {
    for (const e of c.s.entities) {
      const before = prev.statuses.get(e.id);
      for (const st of e.statuses) {
        if (st.sourcePlayer !== c.lp || before?.has(st.id)) continue;
        const id = statusSound(st.id, e.team);
        if (id) c.play(id, { pan: c.pan(e.pos) });
      }
      if (c.isMine(e) && e.shield > (prev.shields.get(e.id) ?? 0) + 1) c.play('fx.shield', { pan: c.pan(e.pos) });
    }
  }

  private watchMine(c: FrameCtx, prev: Snap): void {
    const me = c.s.players[c.lp];
    if (!me || c.s.phase !== 'combat') return;
    me.party.forEach((m, i) => {
      const ready = !m.dead && m.swapCooldownRemaining <= 0;
      if (ready && prev.cardsReady[i] === false && i !== me.activeIndex) c.play('ui.cardReady');
    });
    const act = me.activeIndex != null ? me.party[me.activeIndex] : null;
    const ent = act?.entityId != null ? c.ent(act.entityId) : null;
    if (ent && ent.hp > 0 && ent.hp < ent.maxHp * 0.25 && c.now - this.lowHpAt >= 1.2) {
      this.lowHpAt = c.now;
      c.play('hurt.lowhp');
    }
    if (me.activeIndex !== this.fieldSlot) {
      // first look (join, scene change): unknown — the card counts as on the field all along
      this.fieldSince = this.fieldSlot === undefined ? -Infinity : c.s.time;
      this.fieldSlot = me.activeIndex;
    }
    const full = fieldUltGauge(me)?.fullSince ?? null;
    // 기획 14차 개별 게이지: the field card's gauge is castable only since it came on (it may have filled on the bench)
    const slot = me.activeIndex ?? -2;
    const since = full != null ? Math.max(full, this.fieldSince) : null;
    if (full != null && since != null && c.s.time - since >= 10 && this.reminded.get(slot) !== full) {
      this.reminded.set(slot, full);
      c.play('ult.remind');
    }
    c.s.players.forEach((p, i) => {
      if (i !== c.lp && p.isBot && prev.bots[i] === false && p.disconnected) c.play('net.botTakeover');
    });
  }

  private watchClock(c: FrameCtx, prev: Snap): void {
    const s = c.s;
    if (s.phase === 'combat' && s.timeRemaining > 0) {
      const sec = Math.ceil(s.timeRemaining);
      if (sec <= 10 && sec < prev.timerSec) c.play(sec <= 5 ? 'ui.timer.hot' : 'ui.timer.tick');
    }
    const fe = s.fieldEvent;
    if (fe && fe.stage === 'active') {
      const sec = Math.ceil(fe.remaining);
      if (sec <= 5 && sec < prev.feSec) c.play('fe.urgent');
      if ((fe.printed ?? 0) > prev.printed) c.play('fe.print', { pan: c.pan(fe.pos) });
    }
    const offers = s.phase === 'reward' && !!s.rewardOffersByPlayer[c.lp];
    if (offers && !this.rewardShown) c.play('reward.open');
    this.rewardShown = offers;
  }

  /** Background loop + enrage heartbeat follow the state (2-5: reward / 괴담 → 괴담 drone). */
  private loops(c: FrameCtx): void {
    const s = c.s;
    const amb = s.phase === 'combat' ? (s.plan.kind === 'boss' ? 'amb.boss' : `amb.${s.plan.theme ?? 'lobby'}`) : s.phase === 'runOver' ? null : 'amb.goedam';
    if (amb !== this.amb) {
      c.out.ctl.push({ kind: 'stop', key: 'amb', fade: 0.3 });
      if (amb) c.play(amb, { loopFor: Infinity, key: 'amb', delay: 0.3 });
      this.amb = amb;
    } else if (amb && !c.playing('amb') && this.once('reask:amb', c.now, LOOP_REASK)) c.play(amb, { loopFor: Infinity, key: 'amb' }); // 리뷰: it never started / was cut
    const enr = s.phase === 'combat' && s.bossEnraged;
    if (enr !== this.enrageLoop) {
      if (enr) c.play('enrage.heart', { loopFor: Infinity, key: 'enrage', delay: 0.9 });
      else c.out.ctl.push({ kind: 'stop', key: 'enrage', fade: 0.3 });
      this.enrageLoop = enr;
    } else if (enr && !c.playing('enrage') && this.once('reask:enrage', c.now, LOOP_REASK)) c.play('enrage.heart', { loopFor: Infinity, key: 'enrage' });
    // 기획 13차 리뷰: I am back (next floor / revive / a new run): the '내가 탈락' duck lets go
    if (this.outDuck && !s.players[c.lp]?.out) {
      c.out.ctl.push({ kind: 'unduck', target: 'sfx', key: 'out', release: 0.4 });
      this.outDuck = false;
    }
    // combat pauses (reward / 괴담): battle loops off in 0.3 s
    if (s.phase !== 'combat' && c.snapPhase === 'combat') c.out.ctl.push({ kind: 'stop', key: 'zone', fade: 0.3 }, { kind: 'stop', key: 'groggy', fade: 0.3 }, { kind: 'stop', key: 'frenzy', fade: 0.3 });
  }

  // ─────────────────────────── memo helpers ───────────────────────────

  /** My ult's effect-bus duck is on (its whole 1.2 s hold + 0.4 s release, not only the frame it started). */
  private inUltDuck(c: FrameCtx): boolean {
    return c.now < this.ultDuckUntil;
  }

  /** True the first time `key` is seen within `win` s. */
  once(key: string, now: number, win: number): boolean {
    const t = this.seen.get(key);
    if (t != null && now - t < win) return false;
    this.seen.set(key, now);
    return true;
  }

  private count(key: string, now: number): number {
    const c = this.counters.get(key);
    const n = c && now - c.at < 3 ? c.n : 0;
    this.counters.set(key, { n: n + 1, at: now });
    return n;
  }

  get snapPhase(): GameState['phase'] | null {
    return this.snap?.phase ?? null;
  }

  private gc(now: number): void {
    if (this.seen.size > 256) for (const [k, t] of this.seen) if (now - t > 5) this.seen.delete(k);
    if (this.counters.size > 128) for (const [k, v] of this.counters) if (now - v.at > 5) this.counters.delete(k);
    if (this.castWindow.size > 64) for (const [k, t] of this.castWindow) if (t < now) this.castWindow.delete(k);
  }
}

/** Real seconds after the event at which a drag / ult beat lands: instant drag beats wait for the visual drop-in. */
function landOffset(slot: string, delay: number): number {
  return slot === 'drag' && delay <= 0 ? DASH_LAND : 0;
}

function deathVariant(defId: string): string {
  let look = '';
  try {
    look = getMonster(defId).look ?? '';
  } catch {
    look = '';
  }
  const v = DEATH_LOOK[look] ?? DEATH_LOOK[defId];
  return v ? `.${v}` : '';
}

function traceKind(id: string): string {
  try {
    return goedamTraceKind(getGoedamTrace(id));
  } catch {
    return 'mixed';
  }
}

function statusSound(id: string, team: string): string | null {
  switch (id) {
    case 'stun':
      return 'fx.stun';
    case 'slow':
      return 'fx.frost';
    case 'atkDown':
    case 'vulnerable':
    case 'drain':
      return 'fx.curse';
    case 'atkUp':
    case 'haste':
    case 'defUp':
      return team === 'ally' ? 'fx.buff' : null;
    default:
      return null;
  }
}

function takeSnap(s: GameState, lp: number, old: Snap | null): Snap {
  const defs = old?.defs ?? new Map<number, { defId: string; tier: string; kind: string; owner: number | null }>();
  const statuses = new Map<number, Set<string>>();
  const shields = new Map<number, number>();
  for (const e of s.entities) {
    statuses.set(e.id, new Set(e.statuses.map(x => x.id)));
    shields.set(e.id, e.shield);
    if (!defs.has(e.id)) defs.set(e.id, { defId: e.defId, tier: e.tier, kind: e.kind, owner: e.ownerPlayer });
  }
  if (defs.size > 400) for (const id of [...defs.keys()].slice(0, defs.size - 300)) defs.delete(id);
  const me = s.players[lp];
  return {
    tick: s.tick,
    phase: s.phase,
    floor: s.floor,
    telegraphs: new Map(s.telegraphs.map(t => [t.id, { team: t.team }])),
    statuses,
    shields,
    defs,
    cardsReady: me ? me.party.map(m => !m.dead && m.swapCooldownRemaining <= 0) : [],
    timerSec: Math.ceil(s.timeRemaining),
    feSec: s.fieldEvent ? Math.ceil(s.fieldEvent.remaining) : 99,
    printed: s.fieldEvent?.printed ?? 0,
    bots: s.players.map(p => p.isBot),
    connected: true,
  };
}

/** 4-2 one frame: N of a merging id → one play, louder by 0.35·log2 N (max ×2); 4+ hits → the `.multi` sound. */
export function mergeFrame(list: SoundReq[]): SoundReq[] {
  const MERGE = /^(hit\.basic|hit\.skill|mon\.death|mon\.spawn|mon\.impact\.|heal\.tick|fx\.|atk\.)/;
  const groups = new Map<string, SoundReq[]>();
  const out: SoundReq[] = [];
  for (const r of list) {
    if (!MERGE.test(r.id) || r.delay || r.loopFor) {
      out.push(r);
      continue;
    }
    const k = r.id.startsWith('hit.') ? 'hit' : r.id.startsWith('mon.death') ? 'death' : r.id;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  for (const [k, g] of groups) {
    const n = g.length;
    const gain = Math.min(2, 1 + 0.35 * Math.log2(n));
    const pan = g.reduce((a, r) => a + (r.pan ?? 0), 0) / n;
    const id = n >= 4 && k === 'hit' ? 'hit.multi' : n >= 4 && k === 'death' ? 'mon.death.multi' : g[0].id;
    out.push({ ...g[0], id, pan, db: (g[0].db ?? 0) + 20 * Math.log10(gain) });
  }
  return out;
}

// ─────────────────────────── per-frame helper ───────────────────────────

class FrameCtx {
  readonly lp: number;
  readonly speed: number;
  readonly now: number;
  readonly flags = { floorClear: false, revivedAll: false };
  private byId: Map<number, Entity> | null = null;

  constructor(
    private readonly dir: Director,
    readonly s: GameState,
    private readonly view: RouteView,
    readonly out: Routed,
  ) {
    this.lp = view.localPlayer;
    this.speed = Math.max(0.1, view.gameSpeed || 1);
    this.now = view.now;
  }

  get snapPhase(): GameState['phase'] | null {
    return this.dir.snapPhase;
  }

  ent(id: number | null | undefined): Entity | undefined {
    if (id == null) return undefined;
    if (!this.byId) this.byId = new Map(this.s.entities.map(e => [e.id, e]));
    return this.byId.get(id);
  }

  isMine(e: Entity | undefined): boolean {
    return !!e && e.team === 'ally' && e.ownerPlayer === this.lp;
  }

  play(id: string, o: Omit<SoundReq, 'id'> = {}): void {
    this.out.sounds.push({ id, ...o });
  }

  duck(target: 'sfx' | 'bg', db: number, at: number, hold: number, attack = 0.04, release = 0.4, key?: string): void {
    this.out.ctl.push({ kind: 'duck', target, db, at, hold, attack, release, ...(key != null ? { key } : null) });
  }

  /** A keyed loop is playing (RouteView.playing; unknown → yes). */
  playing(key: string): boolean {
    return this.view.playing ? this.view.playing(key) : true;
  }

  /** 4-5: pan by screen x (±0.7); off-screen → ±0.8 and quieter (handled by the engine through `db`). */
  pan(p: Vec2): number {
    if (!this.view.toScreen) return 0;
    const q = this.view.toScreen(p);
    if (q.x < 0) return -0.8;
    if (q.x > LOGICAL_W) return 0.8;
    return Math.max(-0.7, Math.min(0.7, ((q.x / LOGICAL_W) * 2 - 1) * 0.7));
  }

  /** Pan + off-screen attenuation (≥ 0.35×) for a world point. */
  pos(p: Vec2, k = 1): { pan: number; db: number } {
    return { pan: this.pan(p) * k, db: 20 * Math.log10(this.offscreen(p)) };
  }

  /** Off-screen factor (≥ 0.35) for a world point. */
  offscreen(p: Vec2): number {
    if (!this.view.toScreen) return 1;
    const q = this.view.toScreen(p);
    const dx = Math.max(0, -q.x, q.x - LOGICAL_W);
    const dy = Math.max(0, -q.y, q.y - LOGICAL_H);
    return Math.max(0.35, 1 - Math.hypot(dx, dy) / 640);
  }

  /** My drag / ult: centre-weighted (×0.4); others' at full pan. */
  panAt(p: Vec2, far: boolean): number {
    return this.pan(p) * (far ? 1 : 0.4);
  }

  heroPan(entityId: number | null): number {
    const e = this.ent(entityId);
    return e ? this.pan(e.pos) * 0.4 : 0;
  }

  entPan(entityId: number | null): number {
    const e = this.ent(entityId);
    return e ? this.pan(e.pos) : 0;
  }

  bossDef(entityId: number): string {
    return this.ent(entityId)?.defId ?? this.s.plan.bossId ?? 'abyss_watcher';
  }

  /** Other players: drag cues all play (far); ult → only the final beat and up to 4 hits (4-3). */
  farOk(cue: Cue, far: boolean, slot: 'drag' | 'ult'): boolean {
    if (!far) return true;
    if (slot === 'drag') return !cue.loop;
    return !!cue.fin || cue.on === 'hit';
  }

  action(skillId: string, slot: 'drag' | 'ult', index: number) {
    const info = SKILLS.get(skillId);
    const c = info ? CHARACTERS.find(x => x.id === info.char) : undefined;
    return c?.[slot].actions[index];
  }

  effectDuration(skillId: string, slot: 'drag' | 'ult', index: number, status: string): number {
    const a = this.action(skillId, slot, index);
    for (const ef of a?.effects ?? []) if (ef.kind === 'status' && ef.status === status) return ef.duration;
    return 2.5;
  }
}
