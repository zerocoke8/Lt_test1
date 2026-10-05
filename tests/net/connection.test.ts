// src/net/connection.ts against fake sockets/fetch (fake timers): 4001 'replaced' stops (R34), "여기서 계속" takes the
// seat back, a silent socket is replaced, a static host is asked once, an unreachable server keeps being probed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = ((ev: { data?: unknown; code?: number }) => void) | null;

let sockets: FakeSocket[] = [];
/** When false the fake server swallows everything (a silently dead link). */
let answering = true;
/** When false the fake server refuses hello with 'bad_version' and closes (another build deployed). */
let versionOk = true;

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  onopen: Listener = null;
  onmessage: Listener = null;
  onclose: Listener = null;
  onerror: Listener = null;
  hellos: { token?: string }[] = [];
  constructor(public url: string) {
    sockets.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 5);
  }
  send(data: string): void {
    const msg = JSON.parse(data) as { t: string; token?: string; at?: number };
    if (!answering) return;
    if (msg.t === 'hello' && !versionOk) {
      setTimeout(() => {
        this.deliver({ t: 'error', code: 'bad_version', message: '게임 버전이 달라요 · 페이지를 새로고침해 주세요' });
        this.serverClose(4002);
      }, 5);
      return;
    }
    if (msg.t === 'hello') {
      this.hellos.push({ token: msg.token });
      setTimeout(() => this.deliver({ t: 'welcome', v: 1, sessionId: 'sid', token: msg.token ?? 'a'.repeat(32), name: '탭' }), 5);
    }
    if (msg.t === 'ping') setTimeout(() => this.deliver({ t: 'pong', at: msg.at, serverTime: Date.now() }), 5);
  }
  deliver(msg: unknown): void {
    if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.onclose?.({ code }), 1);
  }
  close(code = 1000): void {
    this.serverClose(code);
  }
}

function storage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: k => void m.delete(k),
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

let fetches = 0;
function stubFetch(answer: () => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>): void {
  vi.stubGlobal('fetch', (_url: string, init?: { signal?: AbortSignal }) => {
    fetches++;
    return new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      answer().then(resolve, reject);
    });
  });
}
const OK = async () => ({ ok: true, status: 200, text: async () => 'ok' });

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  answering = true;
  versionOk = true;
  fetches = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'game.test' });
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
  stubFetch(OK);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Connection', () => {
  it("close 4001 ('replaced' by another tab) stops reconnecting; retryNow takes the seat back with the same token", async () => {
    const { Connection } = await import('../../src/net/connection');
    const c = new Connection({ name: () => 'A' });
    const statuses: string[] = [];
    c.onStatus(s => statuses.push(s));
    c.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(c.status).toBe('online');
    sockets[0].serverClose(4001);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(c.status).toBe('replaced');
    expect(sockets).toHaveLength(1); // no reconnect attempt at all
    expect(c.send({ t: 'listRooms' })).toBe(false);
    // "여기서 계속"
    c.retryNow();
    await vi.advanceTimersByTimeAsync(100);
    expect(c.status).toBe('online');
    expect(sockets).toHaveLength(2);
    expect(sockets[1].hellos[0].token).toBe('a'.repeat(32));
    // any other close is a network drop: reconnect with backoff
    sockets[1].serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.status).toBe('online');
    expect(sockets).toHaveLength(3);
    expect(statuses).toContain('reconnecting');
    c.stop();
  });

  it('a silently dead socket (nothing comes back, no close) is replaced within ~8 s, and the new one reclaims the seat', async () => {
    const { Connection, STALL_RECONNECT_MS } = await import('../../src/net/connection');
    const c = new Connection({ name: () => 'A' });
    c.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(c.status).toBe('online');
    await vi.advanceTimersByTimeAsync(20_000); // pings answered: stays on the first socket
    expect(sockets).toHaveLength(1);
    answering = false; // tunnel: the socket stays "open", nothing arrives
    await vi.advanceTimersByTimeAsync(STALL_RECONNECT_MS + 2000 + 1000);
    expect(sockets.length).toBe(2);
    expect(c.status).toBe('reconnecting');
    // still dead: the hanging connect is retried instead of waiting forever
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets.length).toBeGreaterThanOrEqual(3);
    answering = true; // signal is back
    await vi.advanceTimersByTimeAsync(12_000);
    expect(c.status).toBe('online');
    expect(sockets.at(-1)!.hellos[0].token).toBe('a'.repeat(32));
    c.stop();
  });

  it('static host (404 /healthz): one request, offline "noServer", no retries', async () => {
    stubFetch(async () => ({ ok: false, status: 404, text: async () => 'not found' }));
    const { Connection } = await import('../../src/net/connection');
    const c = new Connection({ name: () => 'A' });
    c.start();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(c.status).toBe('offline');
    expect(c.offlineReason).toBe('noServer');
    expect(fetches).toBe(1);
    expect(sockets).toHaveLength(0);
    c.stop();
  });

  it('unreachable server (5xx / network error): stays "probing" with backoff for minutes, then offline "unreachable"; retryNow probes at once', async () => {
    stubFetch(async () => ({ ok: false, status: 503, text: async () => 'waking up' }));
    const { Connection } = await import('../../src/net/connection');
    const c = new Connection({ name: () => 'A' });
    c.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.status).toBe('probing');
    const early = fetches;
    expect(early).toBeGreaterThanOrEqual(5);
    expect(early).toBeLessThanOrEqual(8);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(c.status).toBe('offline');
    expect(c.offlineReason).toBe('unreachable');
    const total = fetches;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetches).toBe(total); // the chain ended
    stubFetch(OK);
    c.retryNow();
    await vi.advanceTimersByTimeAsync(100);
    expect(c.status).toBe('online');
    c.stop();
  });

  it("기획 10차 'bad_version' (stale tab): offline 'badVersion' for good — no reconnect, retryNow does nothing (only a reload helps)", async () => {
    versionOk = false;
    const { Connection } = await import('../../src/net/connection');
    const c = new Connection({ name: () => 'A' });
    c.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(c.status).toBe('offline');
    expect(c.offlineReason).toBe('badVersion');
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(sockets).toHaveLength(1);
    expect(fetches).toBe(1);
    c.retryNow();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1);
    expect(fetches).toBe(1);
    expect(c.status).toBe('offline');
    c.stop();
  });
});
