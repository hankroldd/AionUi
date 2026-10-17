/**
 * [mycowork] R061: guarded upgrade splice for NON-LOOPBACK peers.
 *
 * A raw splice would let a client pipeline a second HTTP request behind the upgrade request: if the backend rejects the
 * upgrade (e.g. 400) but keeps the connection, that second request would reach aioncore without passing the A67 guard
 * or the session gate. So: forward only the already-parsed upgrade request (never `head`), hold the client's socket
 * paused, and open the byte pipe only after the backend answers `HTTP/1.1 101`. Any other answer is relayed once and
 * both sockets are destroyed.
 */
import net, { type Socket } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { reconstructRequest } from './remote-guard.js';
import { sessionDeniedResponse, type createSessionGate } from './session-gate.js';

const MAX_STATUS_BYTES = 8192;
const WAIT_MS = 10_000;

/** A well-formed WebSocket upgrade: `Upgrade: websocket` (any case), `Connection` has `upgrade`, a Sec-WebSocket-Key. */
export function isWebSocketUpgrade(req: IncomingMessage): boolean {
  const up = req.headers.upgrade;
  const conn = req.headers.connection;
  const key = req.headers['sec-websocket-key'];
  return (
    typeof up === 'string' &&
    up.trim().toLowerCase() === 'websocket' &&
    typeof conn === 'string' &&
    conn.toLowerCase().split(',').some((t) => t.trim() === 'upgrade') &&
    typeof key === 'string' &&
    key.trim().length > 0
  );
}

export function spliceUpgradeAfter101(client: Socket, backendPort: number, request: Buffer): void {
  client.pause();
  const upstream = net.connect({ host: '127.0.0.1', port: backendPort });
  upstream.setNoDelay(true);
  let buf = Buffer.alloc(0);
  const tearDown = (): void => {
    clearTimeout(timer);
    client.destroy();
    upstream.destroy();
  };
  const timer = setTimeout(tearDown, WAIT_MS);
  upstream.once('connect', () => upstream.write(request));
  upstream.on('data', function onData(chunk: Buffer) {
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0 && buf.length < MAX_STATUS_BYTES) return;
    upstream.off('data', onData);
    clearTimeout(timer);
    if (!/^HTTP\/1\.1 101[ \r]/.test(buf.subarray(0, 16).toString('latin1'))) {
      // not a switch: relay the backend's answer once, then close — nothing else from the client goes upstream
      client.end(buf, () => tearDown());
      upstream.destroy();
      return;
    }
    client.write(buf);
    upstream.pipe(client);
    client.pipe(upstream); // pipe() resumes the paused client
  });
  upstream.on('error', tearDown);
  client.on('error', tearDown);
  upstream.on('close', tearDown);
  client.on('close', tearDown);
}

/**
 * Non-loopback upgrades (already past the A67 path guard) must be a well-formed WebSocket upgrade with no pipelined bytes,
 * hold a valid session, and are relayed only up to the backend's 101 — no request smuggling behind a refused upgrade.
 */
export function handleLanUpgrade(
  socket: Socket,
  req: IncomingMessage,
  head: Buffer,
  backendPort: number,
  gate: ReturnType<typeof createSessionGate>
): void {
  if (!isWebSocketUpgrade(req) || head.length > 0) {
    socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    return;
  }
  const peer = socket.remoteAddress ?? '';
  void gate(req.headers.cookie, peer).then((verdict) => {
    if (socket.destroyed) return;
    if (verdict === 'ok') {
      spliceUpgradeAfter101(socket, backendPort, reconstructRequest(req, Buffer.alloc(0), peer));
      return;
    }
    const d = sessionDeniedResponse(verdict);
    socket.end(
      `HTTP/1.1 ${d.status} ${d.status === 401 ? 'Unauthorized' : 'Service Unavailable'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(d.body)}\r\nConnection: close\r\n\r\n${d.body}`
    );
  });
}
