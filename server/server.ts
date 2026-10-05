// HTTP (static client + /healthz) and the game WebSocket at /ws on one port.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import { GOEDAM_TIMEOUT_SEC, MAX_COMMAND_AGE_MS, REWARD_TIMEOUT_SEC, SNAPSHOT_HZ } from '../src/net/protocol';
import { TICK_RATE } from '../src/config';
import { createStaticHandler } from './http';
import { Hub } from './hub';
import type { ServerOptions } from './room';

export type { ServerOptions } from './room';

export const DEFAULT_OPTIONS: ServerOptions = {
  port: 8080,
  host: '0.0.0.0',
  staticDir: 'dist',
  tickHz: TICK_RATE,
  snapshotHz: SNAPSHOT_HZ,
  rewardTimeoutSec: REWARD_TIMEOUT_SEC,
  goedamTimeoutSec: GOEDAM_TIMEOUT_SEC,
  endLingerMs: 5000,
  lobbyGraceMs: 15_000,
  abandonMs: 60_000,
  // 5 s rounds: a silently dead phone link (tunnel, elevator) hands its slot to a bot within 5–10 s
  heartbeatMs: 5_000,
  maxCommandAgeMs: MAX_COMMAND_AGE_MS,
  maxConnections: 300,
  maxConnectionsPerIp: 16,
  // ≈3% of a core per running game (docs/multiplayer.md 측정 장); small instances lower it (render.yaml MAX_GAMES)
  maxPlayingRooms: 20,
  trustProxy: false,
  maxMessageBytes: 16 * 1024,
  ratePerSec: 40,
  rateBurst: 80,
  sessionTtlMs: 30 * 60_000,
  debug: false,
  log: (msg: string) => console.log(`${new Date().toISOString()} ${msg}`),
};

/** Client address for the per-IP limit: the socket peer, or what a trusted proxy reports (Fly-Client-IP / first X-Forwarded-For hop). */
export function clientIp(req: IncomingMessage, trustProxy: boolean | 'fly'): string {
  if (trustProxy === 'fly') {
    const fly = req.headers['fly-client-ip'];
    const ip = (Array.isArray(fly) ? fly[0] : fly)?.trim();
    if (ip) return ip.slice(0, 64);
  }
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return req.socket.remoteAddress ?? '?';
}

export interface RunningServer {
  readonly port: number;
  readonly hub: Hub;
  readonly http: Server;
  close(): Promise<void>;
}

export async function startServer(options: Partial<ServerOptions> = {}): Promise<RunningServer> {
  const opts: ServerOptions = { ...DEFAULT_OPTIONS, ...options };
  const hub = new Hub(opts);
  const http = createServer(createStaticHandler(opts.staticDir));
  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: opts.maxMessageBytes,
    // snapshots are repetitive JSON: deflate with context takeover shrinks them several times
    perMessageDeflate: {
      threshold: 256,
      concurrencyLimit: 10,
      zlibDeflateOptions: { level: 4, memLevel: 8 },
    },
  });

  http.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    // server-wide limits (one small instance): refuse before the handshake, the client retries with backoff
    const ip = clientIp(req, opts.trustProxy);
    if (!hub.admit(ip)) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nRetry-After: 10\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      hub.attach(ws, ip);
    });
  });
  http.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(opts.port, opts.host, () => {
      http.off('error', reject);
      resolve();
    });
  });
  const port = (http.address() as AddressInfo).port;

  return {
    port,
    hub,
    http,
    close: () =>
      new Promise<void>(resolve => {
        hub.close();
        wss.close();
        http.close(() => resolve());
        http.closeAllConnections?.();
      }),
  };
}
