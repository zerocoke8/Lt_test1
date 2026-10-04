// Adversarial review of src/net/connection.ts (client side of R30/R34).
// 1) Two tabs presenting the SAME session token — e.g. the browser's
// "duplicate tab" copies sessionStorage, so both tabs read the same swapTower.netToken.tab.v1 — fight over the seat.
// The server closes the older socket with 4001 'replaced' (server/hub.ts hello); src/net/connection.ts treats every
// close as a network drop and reconnects with the same token, which replaces the other tab, and so on forever.
// 2) A sleeping free-plan server (Render) takes ~30–60 s to wake: /healthz hangs. The client probes 3 times
// (6 s timeout, retries after 3 s and 8 s) and then stays 'offline' for the page's lifetime.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = ((ev: { data?: unknown; code?: number }) => void) | null;

/** Minimal fake server: one seat per token, newest socket wins (same rule as server/hub.ts). */
class FakeServer {
  holders = new Map<string, FakeSocket>();
  hellos = 0;
  hello(sock: FakeSocket, token: string | undefined): void {
    this.hellos++;
    const t = token ?? 'f'.repeat(32);
    const old = this.holders.get(t);
    if (old && old !== sock) old.serverClose(4001);
    this.holders.set(t, sock);
    sock.deliver({ t: 'welcome', v: 1, sessionId: 'sid', token: t, name: '탭' });
  }
}

const server = new FakeServer();

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
  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 5);
  }
  send(data: string): void {
    const msg = JSON.parse(data) as { t: string; token?: string; at?: number };
    if (msg.t === 'hello') setTimeout(() => server.hello(this, msg.token), 5);
    // like server/hub.ts: every ping is answered (the client's stall watchdog reconnects a socket that goes silent)
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'game.test' });
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, text: async () => 'ok' }));
  vi.stubGlobal('localStorage', storage());
  const ss = storage();
  ss.setItem('swapTower.netToken.tab.v1', 'a'.repeat(32)); // a duplicated tab inherits this
  vi.stubGlobal('sessionStorage', ss);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('duplicate tab (same token in two tabs)', () => {
  // FINDING (Medium) — fixed: connection.ts stops on close code 4001 (status 'replaced', "여기서 계속" takes the seat back).
  it('the replaced tab stops instead of reconnecting and stealing the seat back (no endless ping-pong)', async () => {
    const { Connection } = await import('../../src/net/connection');
    const tabA = new Connection({ name: () => 'A' });
    const tabB = new Connection({ name: () => 'B' });
    tabA.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(tabA.status).toBe('online');
    tabB.start();
    await vi.advanceTimersByTimeAsync(20_000);
    const hellos = server.hellos;
    console.log(`hellos in 20 s with two tabs on one token: ${hellos}; A=${tabA.status} B=${tabB.status}`);
    tabA.stop();
    tabB.stop();
    // 2 = each tab said hello once; anything well above that is the two tabs kicking each other out
    expect(hellos).toBeLessThanOrEqual(4);
  });
});

describe('cold-starting game server (Render free plan)', () => {
  // FINDING (Medium) — fixed: an unreachable server is probed with backoff for ~3 min (status 'probing'), and 출발 opens
  // the 매칭 screen (which probes again) instead of going solo.
  it('the client is still able to go online once the server woke up ~50 s later (without a page reload)', async () => {
    const { Connection } = await import('../../src/net/connection');
    let awakeAt = Date.now() + 50_000;
    let probes = 0;
    vi.stubGlobal('fetch', (_url: string, init?: { signal?: AbortSignal }) => {
      probes++;
      if (Date.now() >= awakeAt) return Promise.resolve({ ok: true, status: 200, text: async () => 'ok' });
      // the platform holds the request while the instance boots: it only ends by the client's abort
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    const c = new Connection({ name: () => 'A' });
    c.start();
    await vi.advanceTimersByTimeAsync(120_000);
    const status = c.status;
    console.log(`cold start: ${probes} probes in 120 s, status ${status}`);
    c.stop();
    awakeAt = 0;
    // src/ui/app.ts goMatching(): status 'offline' → straight into solo, no re-probe → multiplayer unreachable until reload
    expect(status).toBe('online');
  });
});
