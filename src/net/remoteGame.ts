// Multiplayer client game: implements the same `Game` interface as the local sim, backed by server snapshots, so the
// renderer/HUD/drag code runs unchanged (R32 서버 권위).
// - state: the newest snapshot, but entity/projectile positions are drawn a little in the past: each unit keeps its
//   last few snapshot positions (server time) and is interpolated at "server now − delay", where the delay adapts to
//   the snapshot interval plus the measured arrival jitter. A late snapshot then no longer stops units mid-stride
//   (jittery mobile links), and a slightly too-late frame extrapolates briefly instead of freezing.
// - stalled: no snapshot for STALL_BANNER_MS while the game runs (socket silently dead: tunnel, elevator) → the HUD
//   shows the network banner and swap/pet/ult/reward are refused; after STALL_RECONNECT_MS the socket is replaced.
// - dispatch(): validated locally with the same pure rules as the sim, sent as a Command, answered optimistically.
//   Every command carries `atTick` (newest snapshot seen) so the server drops swaps/pets that arrive stale.
// - tunables: a live object the host's debug panel mutates; changes are diffed each frame and sent as 'tunables'.

import type {
  AreaShape,
  Command,
  CommandResult,
  Game,
  GameEvent,
  GameState,
  PreviewPart,
  Telemetry,
  Tunables,
  Vec2,
} from '../types';
import { DEFAULT_TUNABLES } from '../config';
import { ARENA_MARGIN } from '../sim/constants';
import { canSwapState, canUltState, canUsePetState } from '../sim/players';
import { previewPartsFor } from '../sim/preview';
import { STALL_RECONNECT_MS, type Connection } from './connection';
import type { ServerMsg } from './protocol';
import { SNAPSHOT_HZ } from './protocol';

type SnapMsg = Extract<ServerMsg, { t: 'snap' }>;
type StartMsg = Extract<ServerMsg, { t: 'start' }>;

/** Positions further apart than this between snapshots are teleports (floor start, blink): no easing. */
const TELEPORT_DIST = 2.5;
/** No snapshot for this long during a running game = stalled link (banner, inputs refused). */
export const STALL_BANNER_MS = 1500;
/** Interpolation delay = snapshot interval + arrival jitter envelope + this margin, within [MIN, MAX]. */
const INTERP_MARGIN_MS = 10;
const INTERP_MIN_MS = 50;
const INTERP_MAX_MS = 350;
/** Past the newest snapshot a unit keeps its last velocity this long, then holds. */
const EXTRAP_MAX_MS = 80;
/** Snapshot positions kept per unit. */
const TRACK_SAMPLES = 6;
/** The render clock may run this much faster/slower than real time while it adapts to a new delay. */
const CLOCK_SLEW = 0.1;
const PENDING_TTL_MS = 1500;
/** After a swap/pet is sent, the card stays blocked this long (or until the server answers). */
const OPTIMISTIC_LOCK_MS = 700;
const TUNABLES_SEND_MS = 120;
/** A sent tunable is not overwritten by older snapshots for this long. */
const TUNABLES_ECHO_MS = 1000;
const MAX_BUFFERED_EVENTS = 3000;

/** One snapshot position of a unit at server time `t` (ms). */
interface Sample {
  t: number;
  x: number;
  y: number;
}

const ok: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

const EMPTY_TELEMETRY: Telemetry = {
  swapsPerMinute: 0,
  damageShareBySource: { basic: 0, passive: 0, normal: 0, drag: 0, ult: 0, pet: 0, relic: 0, zone: 0, summon: 0 },
  avgUltDelay: 0,
  floorTimes: [],
};

export interface RemoteGameCallbacks {
  /** The server refused a command the client had accepted optimistically. */
  onRejected?(cmd: Command, reason: string): void;
}

export class RemoteGame implements Game {
  readonly localPlayer: number;
  readonly seed: number;
  hostPlayerIndex: number;
  /** Server said the game is over ('gameEnded'). */
  ended = false;
  private readonly conn: Connection;
  private readonly cb: RemoteGameCallbacks;
  private view: GameState | null = null;
  private snapTick = -1;
  private events: GameEvent[] = [];
  private telemetryLatest: Telemetry = EMPTY_TELEMETRY;
  private deadlineServer: number | null = null;
  private seq = 0;
  private readonly pending = new Map<number, { cmd: Command; at: number }>();
  private readonly ents = new Map<number, Sample[]>();
  private readonly projs = new Map<number, Sample[]>();
  /** Server-time gap between snapshots (EMA, ms). */
  private snapInterval = 1000 / SNAPSHOT_HZ;
  /** performance.now() of the newest snapshot. */
  private lastSnapAt = 0;
  private lastServerTime: number | null = null;
  /** max(serverTime − local arrival) over recent snapshots (the fastest packet), slowly decaying. */
  private clockOffset: number | null = null;
  /** How late snapshots arrive relative to the fastest one (fast-rise / slow-fall envelope, ms). */
  private lateEnv = 0;
  /** Render clock = performance.now() + renderShift (server ms); slewed toward clockOffset − delay. */
  private renderShift = 0;
  private lastEaseAt = 0;
  private readonly tunablesObj: Tunables;
  private readonly tunablesBase: Tunables;
  private readonly tunablesSentAt = new Map<keyof Tunables, number>();
  private lastTunablesSend = 0;
  private localChoice: { floor: number; until: number; confirmed: boolean } | null = null;
  private readonly unsub: (() => void)[] = [];

  constructor(conn: Connection, start: StartMsg, cb: RemoteGameCallbacks = {}) {
    this.conn = conn;
    this.cb = cb;
    this.localPlayer = start.playerIndex;
    this.hostPlayerIndex = start.hostPlayerIndex;
    this.seed = start.seed;
    this.tunablesObj = { ...DEFAULT_TUNABLES, ...start.tunables };
    this.tunablesBase = { ...this.tunablesObj };
    this.unsub.push(
      conn.on('snap', m => this.onSnap(m)),
      conn.on('cmdResult', m => this.onCmdResult(m.seq, m.ok, m.reason)),
      conn.on('gameEnded', () => {
        this.ended = true;
      }),
    );
  }

  /** First snapshot arrived (state is usable). */
  get ready(): boolean {
    return this.view != null;
  }

  get isHost(): boolean {
    return this.hostPlayerIndex === this.localPlayer;
  }

  get connected(): boolean {
    return this.conn.online;
  }

  /** Online but no snapshot for STALL_BANNER_MS while the game runs: the link is (silently) stuck. */
  get stalled(): boolean {
    return this.stallMs(performance.now()) >= STALL_BANNER_MS;
  }

  /** Current interpolation delay (ms) behind the server (diagnostics / tests). */
  get interpDelayMs(): number {
    return this.clockOffset == null ? 0 : this.clockOffset - this.renderShift;
  }

  private stallMs(now: number): number {
    const s = this.view;
    if (!s || this.ended || s.phase === 'runOver' || !this.conn.online) return 0;
    const since = Math.max(this.lastSnapAt, this.conn.onlineSince ?? 0);
    return since > 0 ? now - since : 0;
  }

  get latencyMs(): number | null {
    return this.conn.latencyMs;
  }

  /** Reward auto-pick deadline on the local clock (Date.now() ms), null outside the reward phase. */
  get rewardDeadline(): number | null {
    return this.deadlineServer == null ? null : this.deadlineServer - this.conn.serverOffsetMs;
  }

  dispose(): void {
    for (const u of this.unsub.splice(0)) u();
  }

  // ─────────────────────────── Game ───────────────────────────

  get state(): GameState {
    if (!this.view) throw new Error('RemoteGame: no snapshot yet');
    return this.view;
  }

  get tunables(): Tunables {
    return this.tunablesObj;
  }

  step(_realDt: number): void {
    const now = performance.now();
    // silent stall: replace the socket (same token → the server hands the seat back with a fresh snapshot)
    if (this.stallMs(now) >= STALL_RECONNECT_MS) this.conn.reconnectNow?.();
    this.ease(now);
    this.flushTunables(now);
    for (const [seq, p] of this.pending) if (now - p.at > PENDING_TTL_MS) this.pending.delete(seq);
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  dispatch(cmd: Command): CommandResult {
    const s = this.view;
    if (!s) return fail('연결 중');
    const me = this.localPlayer;
    let r: CommandResult = ok;
    let wire: Command = cmd;
    switch (cmd.type) {
      case 'swap':
        r = this.canSwap(me, cmd.partyIndex);
        wire = { ...cmd, player: me };
        break;
      case 'pet':
        r = this.canUsePet(me, cmd.petIndex);
        wire = { ...cmd, player: me };
        break;
      case 'ult':
        r = canUltState(s, me);
        if (r.ok && this.hasPending('ult')) r = fail('게이지 부족');
        wire = { ...cmd, player: me };
        break;
      case 'chooseReward': {
        const offers = this.offersFor(me);
        r = s.phase !== 'reward' ? fail('보상 단계가 아님') : !offers ? fail('고를 보상이 없음') : !offers[cmd.offerIndex] ? fail('잘못된 선택') : ok;
        wire = { ...cmd, player: me };
        break;
      }
      case 'debug':
      case 'tunables':
        r = this.isHost ? ok : fail('방장만 할 수 있어요');
        break;
      case 'quit':
        r = ok;
        break;
    }
    if (!r.ok) return r;
    if (!this.conn.online) return fail('서버와 연결이 끊겼어요');
    if (this.stalled && cmd.type !== 'quit' && cmd.type !== 'debug' && cmd.type !== 'tunables') return fail('연결이 불안정해요');
    const seq = ++this.seq;
    if (!this.conn.send({ t: 'cmd', seq, cmd: wire, atTick: Math.max(0, this.snapTick) })) return fail('서버와 연결이 끊겼어요');
    this.pending.set(seq, { cmd: wire, at: performance.now() });
    if (cmd.type === 'chooseReward') {
      this.localChoice = { floor: s.floor, until: performance.now() + 2500, confirmed: false };
      this.applyLocalChoice(s);
    }
    return ok;
  }

  canSwap(player: number, partyIndex: number): CommandResult {
    const s = this.view;
    if (!s) return fail('연결 중');
    const r = canSwapState(s, player, partyIndex);
    if (!r.ok || player !== this.localPlayer) return r;
    if (this.stalled) return fail('연결이 불안정해요');
    // just swapped: the server's appear lock is not in our snapshot yet
    if (this.hasPending('swap', OPTIMISTIC_LOCK_MS)) return fail('등장 중');
    return r;
  }

  canUsePet(player: number, petIndex: number): CommandResult {
    const s = this.view;
    if (!s) return fail('연결 중');
    const r = canUsePetState(s, player, petIndex);
    if (!r.ok || player !== this.localPlayer) return r;
    if (this.stalled) return fail('연결이 불안정해요');
    for (const p of this.pending.values()) {
      if (p.cmd.type === 'pet' && p.cmd.petIndex === petIndex && performance.now() - p.at < OPTIMISTIC_LOCK_MS) return fail('쿨타임');
    }
    return r;
  }

  previewParts(player: number, kind: 'swap' | 'pet', index: number): PreviewPart[] {
    const s = this.view;
    if (!s) return [{ area: { shape: 'single' }, offset: { x: 0, y: 0 }, delay: 0, affects: 'enemies' }];
    return previewPartsFor(s, player, kind, index);
  }

  previewArea(player: number, kind: 'swap' | 'pet', index: number): AreaShape {
    return this.previewParts(player, kind, index)[0]?.area ?? { shape: 'single' };
  }

  /** Multiplayer: the server decides who is a bot. */
  setPlayerBot(_player: number, _isBot: boolean): void {}

  clampToArena(p: Vec2): Vec2 {
    const a = this.view?.plan.arena ?? { width: 24, height: 12 };
    const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
    return {
      x: clamp(Number.isFinite(p.x) ? p.x : a.width / 2, ARENA_MARGIN, a.width - ARENA_MARGIN),
      y: clamp(Number.isFinite(p.y) ? p.y : a.height / 2, ARENA_MARGIN, a.height - ARENA_MARGIN),
    };
  }

  /** The server sends the receiving player's tuning log only, once the run is over (empty before that). */
  telemetry(_player?: number): Telemetry {
    return this.telemetryLatest;
  }

  // ─────────────────────────── snapshots ───────────────────────────

  private offersFor(pi: number): GameState['rewardOffers'] {
    const s = this.view;
    if (!s) return null;
    return s.rewardOffersByPlayer?.[pi] ?? (pi === 0 ? s.rewardOffers : null);
  }

  private hasPending(type: Command['type'], withinMs = PENDING_TTL_MS): boolean {
    const now = performance.now();
    for (const p of this.pending.values()) if (p.cmd.type === type && now - p.at < withinMs) return true;
    return false;
  }

  private onSnap(m: SnapMsg): void {
    if (m.tick < this.snapTick && m.tick !== 0) return; // stale (should not happen on one socket)
    this.snapTick = m.tick;
    const now = performance.now();
    const t = Number.isFinite(m.serverTime) ? m.serverTime : now + (this.clockOffset ?? 0);
    this.syncClock(t, now);
    this.lastSnapAt = now;
    const st = m.state;
    if (!Array.isArray(st.rewardOffersByPlayer)) st.rewardOffersByPlayer = st.players.map((_, i) => (i === 0 ? st.rewardOffers : null));
    this.track(this.ents, st.entities, t);
    this.track(this.projs, st.projectiles, t);
    this.view = st;
    this.applyLocalChoice(st);
    this.ease(now);
    if (m.events.length) {
      for (const e of m.events) this.events.push(e);
      if (this.events.length > MAX_BUFFERED_EVENTS) this.events.splice(0, this.events.length - MAX_BUFFERED_EVENTS);
    }
    if (m.telemetry) this.telemetryLatest = m.telemetry; // sent once the run is over
    this.deadlineServer = m.rewardDeadline;
    this.hostPlayerIndex = m.hostPlayerIndex;
    this.mergeTunables(m.tunables, now);
  }

  /**
   * Snapshot clock: `offset` ≈ serverTime − local time for the fastest packet (the max, decaying ~2 ms/s so a
   * permanently slower route is followed); how much later the others arrive is the jitter the delay must cover.
   */
  private syncClock(serverTime: number, now: number): void {
    const sample = serverTime - now;
    if (this.lastServerTime != null) {
      const gap = serverTime - this.lastServerTime;
      if (gap > 0) this.snapInterval = Math.max(30, Math.min(200, this.snapInterval * 0.8 + gap * 0.2));
    }
    this.lastServerTime = serverTime;
    if (this.clockOffset == null) {
      this.clockOffset = sample;
      this.lateEnv = 0;
      this.renderShift = sample - this.targetDelay();
      this.lastEaseAt = now;
    } else {
      this.clockOffset -= Math.max(0, now - this.lastSnapAt) * 0.002;
      if (sample > this.clockOffset) this.clockOffset = sample;
    }
    // a burst after a stall is not jitter: cap one sample's weight so the delay settles back quickly
    const late = Math.min(this.clockOffset - sample, INTERP_MAX_MS);
    this.lateEnv = late > this.lateEnv ? late : this.lateEnv + (late - this.lateEnv) * 0.03;
  }

  private targetDelay(): number {
    return Math.max(INTERP_MIN_MS, Math.min(INTERP_MAX_MS, this.snapInterval + this.lateEnv + INTERP_MARGIN_MS));
  }

  /** Append this snapshot's positions (server time `t`) to each unit's track; forget units that are gone. */
  private track(map: Map<number, Sample[]>, list: { id: number; pos: Vec2 }[], t: number): void {
    const seen = new Set<number>();
    for (const o of list) {
      seen.add(o.id);
      let tr = map.get(o.id);
      if (!tr) {
        tr = [];
        map.set(o.id, tr);
      }
      const last = tr[tr.length - 1];
      if (last && t <= last.t) tr.pop(); // same server time (reconnect resend): newest wins
      tr.push({ t, x: o.pos.x, y: o.pos.y });
      if (tr.length > TRACK_SAMPLES) tr.splice(0, tr.length - TRACK_SAMPLES);
    }
    for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
  }

  /** Position on a track at render time `rt` (server ms). */
  private sampleAt(tr: Sample[], rt: number, out: Vec2): void {
    const n = tr.length;
    const first = tr[0];
    const last = tr[n - 1];
    if (n === 1 || rt <= first.t) {
      out.x = first.x;
      out.y = first.y;
      return;
    }
    if (rt >= last.t) {
      // past the newest snapshot (it is late): keep moving at the last velocity for a moment, then hold
      const prev = tr[n - 2];
      const span = last.t - prev.t;
      out.x = last.x;
      out.y = last.y;
      if (span >= this.snapInterval * 0.5 && Math.hypot(last.x - prev.x, last.y - prev.y) <= TELEPORT_DIST) {
        const ex = Math.min(rt - last.t, EXTRAP_MAX_MS) / span;
        out.x += (last.x - prev.x) * ex;
        out.y += (last.y - prev.y) * ex;
      }
      return;
    }
    for (let i = n - 2; i >= 0; i--) {
      const a = tr[i];
      if (a.t > rt) continue;
      const b = tr[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) > TELEPORT_DIST) {
        // teleport (floor start, blink): jump straight to the new spot
        out.x = b.x;
        out.y = b.y;
        return;
      }
      const k = (rt - a.t) / Math.max(1e-6, b.t - a.t);
      out.x = a.x + (b.x - a.x) * k;
      out.y = a.y + (b.y - a.y) * k;
      return;
    }
  }

  private ease(now: number): void {
    const s = this.view;
    if (!s || this.clockOffset == null) return;
    // slew the render clock toward "server now − delay" (never a visible jump unless way off)
    const dt = Math.max(0, now - this.lastEaseAt);
    this.lastEaseAt = now;
    const target = this.clockOffset - this.targetDelay();
    const diff = target - this.renderShift;
    if (Math.abs(diff) > 1000) this.renderShift = target;
    else this.renderShift += Math.max(-CLOCK_SLEW * dt, Math.min(CLOCK_SLEW * dt, diff));
    const rt = now + this.renderShift;
    for (const e of s.entities) {
      const tr = this.ents.get(e.id);
      if (tr && tr.length) this.sampleAt(tr, rt, e.pos);
    }
    for (const p of s.projectiles) {
      const tr = this.projs.get(p.id);
      if (tr && tr.length) this.sampleAt(tr, rt, p.pos);
    }
  }

  /** Hide my offers right after I picked (until the server confirms or refuses), so the cards don't flash back. */
  private applyLocalChoice(st: GameState): void {
    const lc = this.localChoice;
    if (!lc) return;
    if (st.phase !== 'reward' || st.floor !== lc.floor) {
      this.localChoice = null;
      return;
    }
    if (!lc.confirmed && performance.now() > lc.until) {
      this.localChoice = null;
      return;
    }
    if (st.rewardOffersByPlayer) st.rewardOffersByPlayer[this.localPlayer] = null;
    if (this.localPlayer === 0) st.rewardOffers = null;
  }

  private onCmdResult(seq: number, okk: boolean, reason?: string): void {
    const p = this.pending.get(seq);
    this.pending.delete(seq);
    if (!p) return;
    if (p.cmd.type === 'chooseReward' && this.localChoice) {
      if (okk) this.localChoice.confirmed = true;
      else this.localChoice = null;
    }
    if (!okk) this.cb.onRejected?.(p.cmd, reason ?? '거절됨');
  }

  // ─────────────────────────── tunables (host debug panel) ───────────────────────────

  private flushTunables(now: number): void {
    if (now - this.lastTunablesSend < TUNABLES_SEND_MS) return;
    const patch: Record<string, number | boolean> = {};
    let n = 0;
    for (const k of Object.keys(this.tunablesBase) as (keyof Tunables)[]) {
      const v = this.tunablesObj[k];
      if (v === this.tunablesBase[k]) continue;
      if (typeof v !== typeof this.tunablesBase[k]) {
        (this.tunablesObj as unknown as Record<string, unknown>)[k] = this.tunablesBase[k];
        continue;
      }
      patch[k] = v;
      n++;
    }
    if (n === 0) return;
    if (!this.isHost || !this.conn.online) {
      Object.assign(this.tunablesObj, this.tunablesBase); // only the host tunes (R35)
      return;
    }
    this.lastTunablesSend = now;
    Object.assign(this.tunablesBase, patch);
    for (const k of Object.keys(patch) as (keyof Tunables)[]) this.tunablesSentAt.set(k, now);
    const seq = ++this.seq;
    const cmd: Command = { type: 'tunables', patch: patch as Partial<Tunables> };
    if (this.conn.send({ t: 'cmd', seq, cmd })) this.pending.set(seq, { cmd, at: now });
  }

  private mergeTunables(server: Tunables | undefined, now: number): void {
    if (!server) return;
    const obj = this.tunablesObj as unknown as Record<string, unknown>;
    const base = this.tunablesBase as unknown as Record<string, unknown>;
    for (const k of Object.keys(server) as (keyof Tunables)[]) {
      if (obj[k] !== base[k]) continue; // local edit not sent yet
      if (now - (this.tunablesSentAt.get(k) ?? -Infinity) < TUNABLES_ECHO_MS && server[k] !== base[k]) continue;
      obj[k] = server[k];
      base[k] = server[k];
    }
  }
}
