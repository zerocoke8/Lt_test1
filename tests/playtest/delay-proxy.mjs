// TCP delay proxy (playtest only): simulates a phone on mobile data talking to a far game server.
// Every chunk in either direction is held for `delay ± jitter` ms; release order is kept (TCP semantics), so jitter
// shows up as bunching, like a real network. HTTP + WebSocket both pass through untouched.
// Run: node tests/playtest/delay-proxy.mjs <listenPort> <targetPort> <oneWayDelayMs> [jitterMs]
//   e.g. node tests/playtest/delay-proxy.mjs 8791 8790 40 12   → RTT ≈ 80 ms, ±12 ms per direction
// Also exported for in-process use: startDelayProxy({ listen, target, delay, jitter }).

import net from 'node:net';
import { pathToFileURL } from 'node:url';

export function startDelayProxy({ listen, target, delay = 40, jitter = 0, host = '127.0.0.1' }) {
  const pipe = (from, to) => {
    // one FIFO per direction + one timer at a time: chunks can never overtake each other (separate setTimeouts can,
    // when their due times round to the same ms)
    const q = [];
    let lastAt = 0;
    let timer = null;
    const drain = () => {
      timer = null;
      const now = Date.now();
      while (q.length && q[0].at <= now) {
        const { buf } = q.shift();
        if (!to.destroyed) to.write(buf);
      }
      if (q.length) timer = setTimeout(drain, Math.max(0, q[0].at - Date.now()));
    };
    from.on('data', buf => {
      const want = Date.now() + delay + (jitter ? (Math.random() * 2 - 1) * jitter : 0);
      const at = Math.max(want, lastAt); // keep order
      lastAt = at;
      q.push({ at, buf });
      if (!timer) timer = setTimeout(drain, Math.max(0, at - Date.now()));
    });
    from.on('end', () => setTimeout(() => to.end(), delay + jitter + 5));
    from.on('error', () => to.destroy());
  };
  const server = net.createServer(client => {
    const up = net.connect(target, host);
    client.setNoDelay(true);
    up.setNoDelay(true);
    pipe(client, up);
    pipe(up, client);
    client.on('close', () => up.destroy());
    up.on('close', () => client.destroy());
  });
  return new Promise(resolve => server.listen(listen, host, () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [listen, target, delay, jitter] = process.argv.slice(2).map(Number);
  startDelayProxy({ listen, target, delay, jitter: jitter || 0 }).then(() =>
    console.log(`delay proxy :${listen} → :${target} one-way ${delay}±${jitter || 0} ms`),
  );
}
