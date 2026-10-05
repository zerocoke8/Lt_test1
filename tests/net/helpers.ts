// In-process game server + raw ws test clients (tests/net).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startServer, type RunningServer, type ServerOptions } from '../../server/server';
import type { ClientMsg, PresetChoice, ServerMsg } from '../../src/net/protocol';
import { PROTOCOL_VERSION } from '../../src/net/protocol';

export const PRESET_A: PresetChoice = { characters: ['guardian', 'blade', 'mage'], pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
export const PRESET_B: PresetChoice = { characters: ['ranger', 'cleric', 'berserker'], pets: ['owl_frost', 'turtle_guard', 'frog_bomb'] };

let staticDir: string | null = null;
function testStaticDir(): string {
  if (!staticDir) {
    staticDir = mkdtempSync(path.join(tmpdir(), 'swap-tower-static-'));
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>스왑 타워 테스트</title>' + 'x'.repeat(4000));
  }
  return staticDir;
}

export function startTestServer(opts: Partial<ServerOptions> = {}): Promise<RunningServer> {
  return startServer({
    port: 0,
    host: '127.0.0.1',
    staticDir: testStaticDir(),
    rewardTimeoutSec: 0.6,
    goedamTimeoutSec: 0.6,
    endLingerMs: 300,
    lobbyGraceMs: 400,
    heartbeatMs: 60_000,
    log: () => {},
    ...opts,
  });
}

type Msg<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

export class TestClient {
  readonly ws: WebSocket;
  readonly msgs: ServerMsg[] = [];
  private cursor = 0;
  private waiters: (() => void)[] = [];
  closed = false;
  closeCode: number | null = null;
  sessionId = '';
  token = '';
  name = '';

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', data => {
      this.msgs.push(JSON.parse(String(data)) as ServerMsg);
      for (const w of this.waiters.splice(0)) w();
    });
    ws.on('close', code => {
      this.closed = true;
      this.closeCode = code;
      for (const w of this.waiters.splice(0)) w();
    });
  }

  /** Open a socket (no hello). */
  static open(port: number): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = new TestClient(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(c));
      ws.once('error', reject);
    });
  }

  /** Open + hello + welcome. */
  static async connect(port: number, name: string, token?: string): Promise<TestClient> {
    const c = await TestClient.open(port);
    c.send(token ? { t: 'hello', v: PROTOCOL_VERSION, name, token } : { t: 'hello', v: PROTOCOL_VERSION, name });
    const w = await c.next('welcome');
    c.sessionId = w.sessionId;
    c.token = w.token;
    c.name = w.name;
    return c;
  }

  send(msg: ClientMsg | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(data: string | Buffer): void {
    this.ws.send(data);
  }

  /** Only messages received after this call count for the next waits. */
  mark(): void {
    this.cursor = this.msgs.length;
  }

  /** First message after the cursor matching type + predicate (advances the cursor past it). */
  async next<T extends ServerMsg['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, timeout = 4000): Promise<Msg<T>> {
    const until = Date.now() + timeout;
    for (;;) {
      for (let i = this.cursor; i < this.msgs.length; i++) {
        const m = this.msgs[i];
        if (m.t === t && pred(m as Msg<T>)) {
          this.cursor = i + 1;
          return m as Msg<T>;
        }
      }
      const left = until - Date.now();
      if (left <= 0 || this.closed) throw new Error(`timeout waiting for '${t}' (got ${this.msgs.slice(this.cursor).map(m => m.t).join(',') || 'nothing'})`);
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Newest snapshot matching pred (waits for new ones). */
  snap(pred: (m: Msg<'snap'>) => boolean = () => true, timeout = 4000): Promise<Msg<'snap'>> {
    return this.next('snap', pred, timeout);
  }

  last<T extends ServerMsg['t']>(t: T): Msg<T> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i] as Msg<T>;
    return undefined;
  }

  count(t: ServerMsg['t']): number {
    return this.msgs.filter(m => m.t === t).length;
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise(resolve => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }

  /** Simulate a dropped connection (no close handshake). */
  kill(): void {
    this.ws.terminate();
  }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
