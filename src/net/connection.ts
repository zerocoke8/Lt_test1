// Browser side of the game-server link: one WebSocket to `/ws` on the page's own origin.
// - Probe GET /healthz first ("ok" = our game server). Static hosts (vite preview, claude.ai Artifact) answer something
//   else, so no WebSocket is attempted and nothing errors in the console → status 'offline' (혼자 하기만 가능).
// - hello carries a session token; the same token reclaims the seat after a reload/network drop (R34).
// - Reconnect with backoff; ping/pong for latency and the server clock offset.
// - Close code 4001 ('replaced'): another tab took this session (duplicated tab = same token). Stop here — reconnecting
//   would kick that tab, which reconnects and kicks back, forever — until the user explicitly retries ("여기서 계속").
// - Unreachable server (network error, timeout, 5xx — e.g. a sleeping free-plan server waking up): keep probing with
//   backoff for a few minutes (status stays 'probing'); a static host that answers "not ok" is asked once only.
// - Silent stall (socket open, nothing arrives — tunnel, elevator): a ping unanswered for STALL_RECONNECT_MS drops the
//   socket and reconnects with the same token.

import type { ClientMsg, ServerMsg } from './protocol';
import { PROTOCOL_VERSION } from './protocol';

export type NetStatus =
  /** not started */
  | 'idle'
  /** checking /healthz */
  | 'probing'
  /** socket opening / waiting for welcome */
  | 'connecting'
  | 'online'
  /** was online, trying again */
  | 'reconnecting'
  /** no game server here (or it never answered) */
  | 'offline'
  /** another tab/window took over this session (close 4001): stopped until retryNow() */
  | 'replaced';

/** Why the status is 'offline': no game server on this host (static/solo build) vs. a server that did not answer. */
export type OfflineReason = 'noServer' | 'unreachable';

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;
type Handler<T extends ServerMsg['t']> = (msg: Msg<T>) => void;

const LS_TOKEN = 'swapTower.netToken.v1';
const LS_ALIVE = 'swapTower.netTokenAlive.v1';
const SS_TOKEN = 'swapTower.netToken.tab.v1';
/** A shared token whose owner tab refreshed LS_ALIVE within this window is considered in use by another tab. */
const ALIVE_WINDOW_MS = 6000;
const PING_MS = 2000;
const PROBE_TIMEOUT_MS = 6000;
const RECONNECT_MS = [400, 1000, 2000, 4000, 8000];
/** Unreachable server: probe again after these waits (≈3 min in all, enough for a free-plan cold start), then 'offline'. */
const PROBE_RETRY_MS = [3000, 5000, 8000, 10000, 15000, 15000, 15000, 15000, 15000, 15000];
/** A ping (or any traffic) unanswered this long while online = stalled socket → reconnect. */
export const STALL_RECONNECT_MS = 5000;
/** A new socket that has not been welcomed within this long is dropped and retried. */
const CONNECT_TIMEOUT_MS = 8000;
/** Server close code: this session was taken over by a newer socket (server/hub.ts hello). */
export const CLOSE_REPLACED = 4001;

function lsGet(k: string): string | null {
  try {
    return globalThis.localStorage?.getItem(k) ?? null;
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string): void {
  try {
    globalThis.localStorage?.setItem(k, v);
  } catch {
    /* storage blocked */
  }
}
function ssGet(k: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(k) ?? null;
  } catch {
    return null;
  }
}
function ssSet(k: string, v: string): void {
  try {
    globalThis.sessionStorage?.setItem(k, v);
  } catch {
    /* storage blocked */
  }
}

/**
 * Token to present in hello: this tab's own (reload) first, else the device's shared one unless another open tab
 * is using it right now (several tabs on one device = several players when testing locally).
 */
function initialToken(): string | undefined {
  const tab = ssGet(SS_TOKEN);
  if (tab) return tab;
  const shared = lsGet(LS_TOKEN);
  const alive = Number(lsGet(LS_ALIVE) ?? 0);
  if (shared && !(Date.now() - alive < ALIVE_WINDOW_MS)) return shared;
  return undefined;
}

/**
 * Solo-only build (claude.ai Artifact, `npm run build:artifact`): scripts/make-artifact.mjs sets this global, so the page
 * never probes /healthz or opens a socket (no network request, no console error on hosts without a game server).
 */
export function isSoloOnlyBuild(): boolean {
  return (globalThis as { __SWAP_TOWER_SOLO__?: unknown }).__SWAP_TOWER_SOLO__ === true;
}

export function gameServerUrl(): string | null {
  if (isSoloOnlyBuild()) return null;
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export interface ConnectionOptions {
  /** Current nickname (sent in hello). */
  name(): string;
}

export class Connection {
  status: NetStatus = 'idle';
  /** Round trip of the last ping (ms). */
  latencyMs: number | null = null;
  /** serverTime − Date.now() (ms), from ping/pong. */
  serverOffsetMs = 0;
  sessionId: string | null = null;
  /** Name as the server stored it (sanitised). */
  name = '';
  /** Set while status is 'offline'. */
  offlineReason: OfflineReason | null = null;
  /** performance.now() of the last 'welcome' (start of the current online stretch). */
  onlineSince = 0;
  private readonly opts: ConnectionOptions;
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<(m: ServerMsg) => void>>();
  private readonly statusHandlers = new Set<(s: NetStatus) => void>();
  private token: string | undefined = initialToken();
  private ownsSharedToken = false;
  private everOnline = false;
  private wanted = false;
  private attempt = 0;
  private probeAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private bestOffsetRtt = Infinity;
  /** performance.now() of the oldest ping sent since the last message received (null = nothing outstanding). */
  private awaitingSince: number | null = null;

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
    // Closing the tab frees the device's shared token at once, so reopening the link on this device reclaims the seat
    // (R34) instead of waiting out ALIVE_WINDOW_MS. A reload keeps using this tab's own token (sessionStorage).
    try {
      globalThis.addEventListener?.('pagehide', () => {
        if (this.ownsSharedToken && lsGet(LS_TOKEN) === this.token) lsSet(LS_ALIVE, '0');
      });
      // the device is back online: reconnect now instead of waiting out the backoff
      globalThis.addEventListener?.('online', () => {
        if (this.wanted && this.everOnline && this.status === 'reconnecting' && !this.ws) {
          this.attempt = 0;
          this.open();
        }
      });
    } catch {
      /* not a browser */
    }
  }

  get online(): boolean {
    return this.status === 'online';
  }

  /** Start probing/connecting (idempotent). */
  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    if (!gameServerUrl()) {
      this.goOffline('noServer');
      return;
    }
    void this.probe();
  }

  /**
   * Manual retry (매칭 screen "다시 시도" / "여기서 계속", 출발 after an unreachable server). While a probe chain is
   * waiting for its next try, probe right now.
   */
  retryNow(): void {
    if (!this.wanted) {
      this.start();
      return;
    }
    if (this.status === 'online' || this.status === 'connecting') return;
    if (this.status === 'probing' && !this.retryTimer) return; // a probe is in flight
    this.clearRetry();
    this.probeAttempt = 0;
    if (this.everOnline) this.open();
    else void this.probe();
  }

  /** Drop the current socket and reconnect with the same token at once (stalled game, see RemoteGame). */
  reconnectNow(): void {
    if (!this.wanted || !this.everOnline || this.status === 'replaced') return;
    if (this.status !== 'online' && this.status !== 'connecting' && this.status !== 'reconnecting') return;
    this.dropSocket();
    this.stopPing();
    this.attempt = 0;
    this.open();
  }

  stop(): void {
    this.wanted = false;
    this.clearRetry();
    this.stopPing();
    this.dropSocket();
    this.setStatus('idle');
  }

  send(msg: ClientMsg): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (msg.t !== 'hello' && this.status !== 'online') return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  on<T extends ServerMsg['t']>(t: T, fn: Handler<T>): () => void {
    let set = this.handlers.get(t);
    if (!set) {
      set = new Set();
      this.handlers.set(t, set);
    }
    const f = fn as (m: ServerMsg) => void;
    set.add(f);
    return () => set!.delete(f);
  }

  onStatus(fn: (s: NetStatus) => void): () => void {
    this.statusHandlers.add(fn);
    return () => this.statusHandlers.delete(fn);
  }

  /** Server clock now (ms), for deadlines in snapshots. */
  serverNow(): number {
    return Date.now() + this.serverOffsetMs;
  }

  // ─────────────────────────── internals ───────────────────────────

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of [...this.statusHandlers]) fn(s);
  }

  private emit(msg: ServerMsg): void {
    const set = this.handlers.get(msg.t);
    if (set) for (const fn of [...set]) fn(msg);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  /** Forget the current socket without triggering the reconnect logic. */
  private dropSocket(): void {
    this.clearConnectTimer();
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onclose = null;
    ws.onmessage = null;
    ws.onopen = null;
    try {
      ws.close(1000);
    } catch {
      /* ignore */
    }
  }

  private goOffline(reason: OfflineReason): void {
    this.offlineReason = reason;
    this.setStatus('offline');
  }

  private async probe(): Promise<void> {
    if (!this.wanted) return;
    if (!gameServerUrl()) {
      // solo-only build or file:// — never touch the network ("다시 시도" stays offline)
      this.goOffline('noServer');
      return;
    }
    this.retryTimer = null;
    this.setStatus(this.everOnline ? 'reconnecting' : 'probing');
    let ok = false;
    /** The host answered and it is not our game server (static host: 404 / SPA page): retrying cannot help. */
    let notGameServer = false;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch('/healthz', { cache: 'no-store', signal: ctl?.signal });
      ok = res.ok && (await res.text()).trim() === 'ok';
      notGameServer = !ok && res.status < 500;
    } catch {
      ok = false; // network error / timeout (e.g. a sleeping free-plan server): worth retrying
    } finally {
      clearTimeout(timer);
    }
    if (!this.wanted) return;
    if (ok) {
      this.open();
      return;
    }
    if (this.everOnline) {
      this.scheduleReconnect();
      return;
    }
    if (notGameServer) {
      this.goOffline('noServer'); // one request (one 404 at most) on static hosts; "다시 시도" can still probe again
      return;
    }
    this.retryProbe();
  }

  /** Unreachable (not a static host): keep 'probing' through the backoff chain, then 'offline'. */
  private retryProbe(): void {
    const wait = PROBE_RETRY_MS[this.probeAttempt++];
    if (wait == null) {
      this.goOffline('unreachable');
      return;
    }
    this.setStatus('probing');
    this.clearRetry();
    this.retryTimer = setTimeout(() => void this.probe(), wait);
  }

  private open(): void {
    const url = gameServerUrl();
    if (!url || !this.wanted) return;
    this.clearRetry();
    this.dropSocket();
    this.setStatus(this.everOnline ? 'reconnecting' : 'connecting');
    if (globalThis.navigator?.onLine === false) {
      // the device itself is offline: a socket attempt can only fail (and logs an error); wait for 'online' / retry
      this.retryTimer = setTimeout(() => this.open(), RECONNECT_MS[1]);
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.onSocketClosed(null);
      return;
    }
    this.ws = ws;
    // a connect that hangs (network still down after a stall) is retried instead of waiting for the browser's timeout
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.ws !== ws || this.status === 'online') return;
      this.dropSocket();
      this.onSocketClosed(null);
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      const hello: Extract<ClientMsg, { t: 'hello' }> = { t: 'hello', v: PROTOCOL_VERSION, name: this.opts.name() };
      if (this.token) hello.token = this.token;
      this.send(hello);
    };
    ws.onmessage = ev => {
      if (this.ws !== ws || typeof ev.data !== 'string') return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data) as ServerMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
      this.awaitingSince = null;
      this.onMessage(msg);
    };
    ws.onclose = ev => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearConnectTimer();
      this.onSocketClosed(typeof ev?.code === 'number' ? ev.code : null);
    };
    ws.onerror = () => {
      /* close follows */
    };
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.sessionId = msg.sessionId;
        this.name = msg.name;
        this.rememberToken(msg.token);
        this.attempt = 0;
        this.everOnline = true;
        this.offlineReason = null;
        this.clearConnectTimer();
        this.onlineSince = performance.now();
        this.setStatus('online');
        this.startPing();
        break;
      case 'pong': {
        const rtt = performance.now() - msg.at;
        if (rtt >= 0 && rtt < 60_000) {
          this.latencyMs = this.latencyMs == null ? rtt : this.latencyMs * 0.7 + rtt * 0.3;
          // the lowest-latency sample gives the best clock estimate; re-anchor slowly so drift is tracked
          if (rtt <= this.bestOffsetRtt * 1.2) {
            this.bestOffsetRtt = Math.min(this.bestOffsetRtt, rtt);
            this.serverOffsetMs = msg.serverTime + rtt / 2 - Date.now();
          }
          this.bestOffsetRtt *= 1.02;
        }
        break;
      }
      case 'error':
        if (msg.code === 'bad_version') {
          this.wanted = false;
          this.goOffline('noServer');
        }
        break;
    }
    this.emit(msg);
  }

  private rememberToken(token: string): void {
    this.token = token;
    ssSet(SS_TOKEN, token);
    const shared = lsGet(LS_TOKEN);
    const alive = Number(lsGet(LS_ALIVE) ?? 0);
    const sharedBusy = !!shared && shared !== token && Date.now() - alive < ALIVE_WINDOW_MS;
    this.ownsSharedToken = !sharedBusy;
    if (this.ownsSharedToken) {
      lsSet(LS_TOKEN, token);
      lsSet(LS_ALIVE, String(Date.now()));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.awaitingSince = null;
    const tick = () => {
      const now = performance.now();
      // silent stall: nothing at all came back since a ping went out STALL_RECONNECT_MS ago. Measured from the ping
      // (not from the last message) so throttled timers in a background tab never look like a stall.
      if (this.awaitingSince != null && now - this.awaitingSince >= STALL_RECONNECT_MS) {
        this.reconnectNow();
        return;
      }
      if (this.awaitingSince == null) this.awaitingSince = now;
      this.send({ t: 'ping', at: now });
      if (this.ownsSharedToken) lsSet(LS_ALIVE, String(Date.now()));
    };
    tick();
    this.pingTimer = setInterval(tick, PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private onSocketClosed(code: number | null): void {
    this.stopPing();
    if (!this.wanted) return;
    if (code === CLOSE_REPLACED) {
      // another tab presented this session's token: it has the seat now. Reconnecting would kick it, it would kick
      // back, and so on forever — stay put until the user explicitly takes the seat back ("여기서 계속" = retryNow).
      this.clearRetry();
      this.setStatus('replaced');
      return;
    }
    if (!this.everOnline) {
      // the probe said "ok" but the socket failed: treat like an unreachable server, retry with backoff
      this.retryProbe();
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const wait = RECONNECT_MS[Math.min(this.attempt++, RECONNECT_MS.length - 1)];
    this.clearRetry();
    this.retryTimer = setTimeout(() => this.open(), wait);
  }
}
