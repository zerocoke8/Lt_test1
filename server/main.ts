// Entry point (bundled to dist-server/index.js): `PORT=8080 node dist-server/index.js`.
// Env: PORT (default 8080), HOST (0.0.0.0), STATIC_DIR (default: ../dist next to this file),
//      DEBUG_NET=1 (log snapshot sizes), REWARD_TIMEOUT_SEC, GOEDAM_TIMEOUT_SEC, END_LINGER_MS (tests),
//      MAX_GAMES (games running at once), MAX_CONNECTIONS, MAX_CONNECTIONS_PER_IP,
//      TRUST_PROXY=1 (behind Render's proxy: the per-IP limit reads X-Forwarded-For) or TRUST_PROXY=fly (Fly.io: Fly-Client-IP).

import { fileURLToPath } from 'node:url';
import { startServer } from './server';

const env = process.env;
const num = (v: string | undefined): number | undefined => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

const staticDir = env.STATIC_DIR || fileURLToPath(new URL('../dist/', import.meta.url));

startServer({
  port: num(env.PORT) ?? 8080,
  host: env.HOST || '0.0.0.0',
  staticDir,
  debug: env.DEBUG_NET === '1',
  ...(num(env.REWARD_TIMEOUT_SEC) != null ? { rewardTimeoutSec: num(env.REWARD_TIMEOUT_SEC)! } : {}),
  ...(num(env.GOEDAM_TIMEOUT_SEC) != null ? { goedamTimeoutSec: num(env.GOEDAM_TIMEOUT_SEC)! } : {}),
  ...(num(env.END_LINGER_MS) != null ? { endLingerMs: num(env.END_LINGER_MS)! } : {}),
  ...(num(env.MAX_GAMES) != null ? { maxPlayingRooms: num(env.MAX_GAMES)! } : {}),
  ...(num(env.MAX_CONNECTIONS) != null ? { maxConnections: num(env.MAX_CONNECTIONS)! } : {}),
  ...(num(env.MAX_CONNECTIONS_PER_IP) != null ? { maxConnectionsPerIp: num(env.MAX_CONNECTIONS_PER_IP)! } : {}),
  trustProxy: env.TRUST_PROXY === 'fly' ? 'fly' : env.TRUST_PROXY === '1',
})
  .then(server => {
    console.log(`스왑 타워 게임 서버 · http://localhost:${server.port} (ws /ws, static ${staticDir})`);
    const stop = (sig: string) => {
      console.log(`${sig} — shutting down`);
      server.close().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
  })
  .catch(err => {
    console.error('failed to start:', err);
    process.exit(1);
  });
