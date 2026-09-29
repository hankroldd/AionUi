/**
 * WebUI static server.
 *
 * Serves out/renderer/ as the SPA and reverse-proxies /api/*, /ws, /api/stt/stream,
 * /login and /logout to aioncore; [mycowork] /bridge/* goes to the MyCowork Bridge
 * (AIONUI_BRIDGE_URL, default http://127.0.0.1:25900). All auth goes to backend's aionui-auth crate;
 * /login and /logout are aionui-auth's top-level paths, the rest live under
 * /api/auth/*. /ws and /api/stt/stream are WebSocket/stream upgrades spliced at
 * TCP level; /api/stt/stream is the STT streaming endpoint.
 *
 * Design: Node native http + serve-handler. No Express. No business routes.
 */

import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import net, { type Socket } from 'node:net';
import serveHandler from 'serve-handler';

export type StaticServerOptions = {
  staticDir: string;
  backendPort: number;
  port?: number;
  allowRemote?: boolean;
};

export type StaticServerHandle = {
  port: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};

const DEFAULT_PORT = 25808;

// Ranges that are non-internal IPv4 yet never a reachable LAN address, so we
// must never advertise them as the WebUI access URL even when they are the only
// non-loopback interface present:
//   169.254.0.0/16  link-local / APIPA (host got no DHCP lease)
//   198.18.0.0/15   RFC 2544 benchmarking range — handed out by utility tunnels
//                   such as Cloudflare WARP; this is the address that showed up
//                   on a multi-NIC machine instead of the real LAN IP.
const isUnreachableLanRange = (addr: string): boolean => addr.startsWith('169.254.') || /^198\.(18|19)\./.test(addr);

// Rank candidate LAN addresses by how likely they are the network the user
// actually reaches the desktop on. Lower is better. Private (RFC 1918) home /
// office ranges win over anything else; 192.168/16 is the most common LAN, then
// the 172.16/12 block, then 10/8 (frequently carved up by VPNs / corp routing).
const rankLanCandidate = (addr: string): number => {
  if (addr.startsWith('192.168.')) return 0;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(addr)) return 1;
  if (addr.startsWith('10.')) return 2;
  return 3;
};

// Pick the best LAN IPv4 to advertise. Pure over the interface map so it can be
// unit-tested against real multi-NIC layouts. Iterating and returning the first
// non-internal hit (the old behavior) picks whatever the OS lists first, which
// on a multi-NIC box can be a VPN / benchmark adapter rather than the LAN.
export function pickLanIP(nets: ReturnType<typeof networkInterfaces>): string | null {
  const candidates: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (isUnreachableLanRange(iface.address)) continue;
      candidates.push(iface.address);
    }
  }
  // Stable sort keeps OS interface order among equally-ranked addresses (e.g. a
  // physical NIC listed before a VPN when both are 10/8).
  candidates.sort((a, b) => rankLanCandidate(a) - rankLanCandidate(b));
  return candidates[0] ?? null;
}

function getLanIP(): string | null {
  return pickLanIP(networkInterfaces());
}

function forward(
  req: IncomingMessage,
  res: ServerResponse,
  target: URL,
  headers: http.IncomingHttpHeaders,
  unreachableBody: unknown
): void {
  const options: http.RequestOptions = {
    hostname: target.hostname,
    port: target.port,
    path: req.url,
    method: req.method,
    headers: { ...headers, host: target.host },
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxy.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify(unreachableBody));
    } else {
      res.destroy();
    }
  });
  req.pipe(proxy);
}

// [mycowork] D35/A35: the officecli watch preview (proxied by aioncore) is read-only here. Its server also
// rewrites the live document (/api/send, /api/batch), retargets the preview to any local file (/api/switch)
// and echoes host paths (/api/status); only the page, its SSE stream and selection reports may pass.
// Default-deny: anything under the watch proxy prefix (any case, any port spelling such as `+41234` or `%34…`,
// which aioncore still accepts) must match the strict whitelist exactly, or it is refused.
const WATCH_PREFIX = /^\/api\/(?:office-watch-proxy|ppt-proxy)(?:[/?]|$)/i;
const WATCH_PAGE = /^\/api\/(?:office-watch-proxy|ppt-proxy)\/[0-9]+(?:\/|\/events)?(?:\?.*)?$/;
const WATCH_SELECTION = /^\/api\/(?:office-watch-proxy|ppt-proxy)\/[0-9]+\/api\/selection(?:\?.*)?$/;

export function isBlockedWatchRequest(method: string, url: string): boolean {
  if (!WATCH_PREFIX.test(url)) return false;
  if (method === 'GET') return !WATCH_PAGE.test(url);
  return !(method === 'POST' && WATCH_SELECTION.test(url));
}

// [mycowork] 安全（A67/D150）：aioncore 有一族无需登录即可调用的端点——
//   POST /api/webui/reset-password（返回明文管理员口令）、
//   POST /api/webui/generate-qr-token（无鉴权签发登录令牌，配 /qr-login 可静默接管）、
//   GET  /api/auth/internal/*（账户记录、内部会话，供本机进程直连后端用）。
// 经反向代理放行且 WebUI 对局域网开放（allowRemote，产品要求“其他设备可查看”）时，局域网任意
// 主机不登录即可接管或泄露账户。合法调用者要么直连后端端口、绕过本代理（首启种子口令：
// scripts/webui.ts、web-cli、webuiBridge.ts；resetpass.ts 路径 2 自起后端），要么来自本机回环
// （resetpass.ts 路径 1、桌面设置页在本机）。
// 修复要点（逐请求判定，不再靠首行 peek，独立安全审查 M1–M3）：非回环连接不再原样 TCP splice
// 到内部 HTTP server，而是把 socket 交给进程内 http.Server，使每个请求（含 keep-alive 后续请求
// 与 WebSocket upgrade）都能拿到真实 remoteAddress；对非回环请求按后端会用的规范化路径默认拒绝
// 敏感族，解析不了就拒绝（fail-closed）。回环连接保持原路径，纯回环部署字节行为不变。

function isLoopbackAddr(addr: string | undefined): boolean {
  if (!addr) return false;
  // 0.0.0.0 绑定下回环客户端显示 127.0.0.0/8；双栈/映射形态防御性一并纳入。
  return addr.startsWith('127.') || addr === '::1' || addr.startsWith('::ffff:127.');
}

// 只有这两条是合法的 WebSocket/流 upgrade 目标（peekWsRoute 亦然）。
const UPGRADE_ALLOWED = new Set(['/ws', '/api/stt/stream']);

// 按后端会解释的方式把请求目标归一成小写绝对路径：取绝对形式 URI 的 path、去 query/fragment、
// 百分号解码一次（%2f→/、%2e→.）、反斜杠转斜杠、去每段的 ;matrix 参数、合并 // 并解析 . 与 ..。
// 解析不了返回 null（调用方对非回环按拒绝处理，fail-closed）。
export function normalizeGuardPath(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  let s = rawUrl.trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('//')) {
      s = new URL(s, 'http://placeholder').pathname; // 绝对形式 / 协议相对 → 只取 path
    } else {
      const cut = s.search(/[?#]/);
      if (cut >= 0) s = s.slice(0, cut);
    }
  } catch {
    return null;
  }
  if (!s.startsWith('/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    return null; // 半个百分号转义等 → 可疑，拒绝
  }
  decoded = decoded.replace(/\\/g, '/');
  const out: string[] = [];
  for (let seg of decoded.split('/')) {
    const sc = seg.indexOf(';');
    if (sc >= 0) seg = seg.slice(0, sc); // 去矩阵参数
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return '/' + out.join('/').toLowerCase();
}

// 默认拒绝整个无鉴权管理族（私有实例实测：reset-password / change-password / change-username /
// generate-qr-token 无 cookie 从局域网均 200，即接管或改名换密），以及供本机进程直连后端的
// /api/auth/internal/*。范围按前缀而非逐条枚举（审查 M3“范围太窄”），远程无这些端点的合法用途；
// 手机扫码登录用顶层 /qr-login（token 即凭据），不在此列，仍放行。
export function isSensitivePath(normalizedPath: string): boolean {
  if (normalizedPath === '/api/auth/internal' || normalizedPath.startsWith('/api/auth/internal/')) return true;
  if (normalizedPath === '/api/webui' || normalizedPath.startsWith('/api/webui/')) return true;
  return false;
}

// 非回环请求是否应拒绝：来源非回环，且（路径解析不了 → fail-closed，或命中敏感族）。
export function isBlockedRemoteRequest(rawUrl: string | undefined, remoteAddress: string | undefined): boolean {
  if (isLoopbackAddr(remoteAddress)) return false;
  let p = normalizeGuardPath(rawUrl);
  if (p === null) return true;
  // 多轮解码（复审 S3）：aioncore v0.2.2 实测不解码 %2f、不合并 //（直连后端均 404），但不把安全性押在
  // 后端“只解一层”上——%252f 等多重编码逐轮再解，任何一轮落入敏感族即拒绝；后续轮解不开说明后端
  // 也得不到敏感路径，停止；4 轮后仍含转义则 fail-closed。
  for (let round = 0; round < 3; round++) {
    if (isSensitivePath(p)) return true;
    if (!p.includes('%')) return false;
    const next = normalizeGuardPath(p);
    if (next === null || next === p) return false;
    p = next;
  }
  return true;
}

const REMOTE_FORBIDDEN_BODY = '{"error":"REMOTE_FORBIDDEN"}';

function writeRemoteForbidden(res: ServerResponse): void {
  res.writeHead(403, { 'content-type': 'application/json' }).end(REMOTE_FORBIDDEN_BODY);
}

function destroyRemoteForbidden(socket: Socket): void {
  socket.end(
    `HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(REMOTE_FORBIDDEN_BODY)}\r\nConnection: close\r\n\r\n${REMOTE_FORBIDDEN_BODY}`
  );
}

// 把 http.Server 已解析的 upgrade 请求原样重建（保持首部大小写与顺序），供裸 TCP 转发给后端。
function reconstructRequest(req: IncomingMessage, head: Buffer): Buffer {
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
  const rh = req.rawHeaders;
  for (let i = 0; i < rh.length; i += 2) lines.push(`${rh[i]}: ${rh[i + 1]}`);
  return Buffer.concat([Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1'), head ?? Buffer.alloc(0)]);
}

function forwardToBackend(req: IncomingMessage, res: ServerResponse, backendPort: number): void {
  forward(req, res, new URL(`http://127.0.0.1:${backendPort}`), req.headers, { error: 'BACKEND_UNREACHABLE' });
}

// [mycowork] ADR-0011: same-origin reverse proxy /bridge/* to the MyCowork Bridge.
// Only the aionui-session cookie may leave for the Bridge (cf. Grafana CVE-2022-39201).
const BRIDGE_UNAVAILABLE = { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'bridge unavailable' } };

function sessionCookieOnly(cookie: string | undefined): string | undefined {
  return cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('aionui-session='));
}

function bridgeHeaders(req: IncomingMessage): http.IncomingHttpHeaders {
  const { cookie, ...rest } = req.headers;
  const session = sessionCookieOnly(cookie);
  return session ? { ...rest, cookie: session } : rest;
}

// Fire-and-forget: tell the Bridge to drop its identity cache for this session (ADR-0011 D21).
// Never awaited, errors ignored — logout itself must not depend on the Bridge.
function notifyBridgeLogout(bridge: URL, req: IncomingMessage): void {
  const session = sessionCookieOnly(req.headers.cookie);
  if (!session) return;
  const notify = http.request(new URL('/bridge/v1/session/end', bridge), {
    method: 'POST',
    headers: { cookie: session },
  });
  notify.on('response', (r) => r.resume());
  notify.on('error', () => {});
  notify.setTimeout(2000, () => notify.destroy());
  notify.end();
}

// Max bytes we peek before forcing a routing decision. An HTTP request-line
// on its own is typically < 100 bytes; a full header block is < 2 KB. If we
// haven't seen a newline after 4 KB the client is sending something weird —
// hand it to the internal HTTP server and let it return 400.
const PEEK_LIMIT_BYTES = 4096;

/**
 * Splice `client` to a TCP endpoint on `targetPort`. Any bytes already read
 * from `client` during peek are replayed to the upstream as the first write,
 * so the endpoint sees the full HTTP request as-sent.
 */
function spliceToTcpEndpoint(client: Socket, targetPort: number, initialBytes: Buffer): void {
  client.setNoDelay(true);
  client.setKeepAlive(true);
  client.setTimeout(0);
  // The peek phase left `client` in flowing mode (it had a 'data' listener),
  // but that listener is now removed and the real consumer — `client.pipe(upstream)`
  // — is only wired inside the async 'connect' handler below. Pause here so any
  // body bytes arriving in the gap are buffered by the socket instead of being
  // dropped for lack of a consumer; `pipe()` resumes the socket once connected.
  // Without this, large/buffered uploads (e.g. reverse-proxied POST bodies that
  // span multiple TCP segments) lose their tail bytes and the backend hangs
  // forever waiting for the missing Content-Length (issue #4058).
  client.pause();
  const upstream = net.connect({ host: '127.0.0.1', port: targetPort });
  upstream.setNoDelay(true);
  upstream.setKeepAlive(true);
  upstream.once('connect', () => {
    if (initialBytes.length > 0) upstream.write(initialBytes);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const tearDown = (): void => {
    client.destroy();
    upstream.destroy();
  };
  upstream.on('error', tearDown);
  client.on('error', tearDown);
  upstream.on('close', tearDown);
  client.on('close', tearDown);
}

/**
 * Decide routing from the first chunk of an incoming HTTP connection:
 *  - `true`  → `GET /ws[...] HTTP/1.x` or `GET /api/stt/stream[...] HTTP/1.x` (WebSocket/stream upgrades), splice to backend
 *  - `false` → any other HTTP method / path, hand to internal HTTP server
 *  - `null`  → need more bytes (no CRLF yet)
 *
 * We only check the request-line; `Upgrade: websocket` is not strictly
 * required — the backend will reject a non-upgrade GET on these paths on its own.
 * Keeping the rule simple means we can decide after the first ~50 bytes
 * instead of waiting for the full header block.
 */
function peekWsRoute(buf: Buffer): boolean | null {
  const newlineIdx = buf.indexOf(0x0a); // \n
  if (newlineIdx < 0) return null;
  const firstLine = buf.slice(0, newlineIdx).toString('ascii');
  return /^GET\s+\/(?:ws|api\/stt\/stream)(?:\?[^\s]*)?\s+HTTP\/1\.[01]\r?$/.test(firstLine);
}

export async function startStaticServer(opts: StaticServerOptions): Promise<StaticServerHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const allowRemote = opts.allowRemote === true;
  const host = allowRemote ? '0.0.0.0' : '127.0.0.1';
  const bridgeUrl = new URL(process.env.AIONUI_BRIDGE_URL ?? 'http://127.0.0.1:25900');

  // The HTTP server listens only on loopback — user traffic hits the outer
  // net.Server first. We route to this server for everything except WS
  // upgrades and STT stream upgrades, which go straight to the backend via a raw TCP splice.
  //
  // Why two listeners instead of using `http.Server`'s native `upgrade` event:
  // bun 1.3's http-compat layer does not faithfully forward writes on the
  // socket delivered to the `upgrade` handler, so the backend's 101 response
  // never reaches the browser (see #2824). Making the outer listener pure
  // TCP avoids touching that code path on both bun and node.
  const http_server: Server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        res.writeHead(400).end();
        return;
      }

      // [mycowork] 安全（A67/D150）：逐请求判定。回环连接经内部 splice 到达，remoteAddress 恒为
      // 127.0.0.1，不触发；非回环连接由 tcp_server 直接交给本 server（emit('connection')），
      // 每个请求（含 keep-alive 后续）都拿到真实来源，命中敏感族或路径不可解析即拒绝。
      if (isBlockedRemoteRequest(req.url, req.socket.remoteAddress)) {
        writeRemoteForbidden(res);
        return;
      }

      // /api/* — reverse proxy to backend (includes /api/auth/*).
      // /login and /logout are aionui-auth's top-level auth endpoints: proxy them too
      // so WebUI browser clients reach the backend without a path-rewrite.
      if (req.url.startsWith('/api/') || req.url.startsWith('/api?') || req.url === '/login' || req.url === '/logout') {
        // Notify only after aioncore has finished the logout, so a concurrent Bridge request cannot re-cache the session.
        if (req.url === '/logout') res.once('finish', () => notifyBridgeLogout(bridgeUrl, req));
        if (isBlockedWatchRequest(req.method, req.url)) {
          res.writeHead(403, { 'content-type': 'application/json' }).end('{"error":"READ_ONLY_PREVIEW"}');
          return;
        }
        forwardToBackend(req, res, opts.backendPort);
        return;
      }

      if (req.url.startsWith('/bridge/')) {
        forward(req, res, bridgeUrl, bridgeHeaders(req), BRIDGE_UNAVAILABLE);
        return;
      }

      // static files + SPA fallback
      await serveHandler(req, res, {
        public: opts.staticDir,
        rewrites: [{ source: '**', destination: '/index.html' }],
      });
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INTERNAL_ERROR' }));
      } else {
        res.destroy();
      }
    }
  });

  // Internal HTTP server — 127.0.0.1 ephemeral port, never visible to the user.
  await new Promise<void>((resolve, reject) => {
    http_server.once('error', reject);
    http_server.listen(0, '127.0.0.1', () => {
      http_server.off('error', reject);
      resolve();
    });
  });
  const internalPort = (http_server.address() as { port: number } | null)?.port;
  if (!internalPort) {
    throw new Error('internal HTTP server failed to bind to a port');
  }

  // [mycowork] 安全（A67/D150）：非回环连接的 WebSocket/流 upgrade 也要按真实来源判定。只有回环
  // 或 /ws、/api/stt/stream 放行（裸 TCP 转发给后端，自己重写请求并搬字节，不经 http.Server 写回
  // 101 —— 规避 bun #2824）；非回环的敏感族或其它路径一律拒绝。
  http_server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const p = normalizeGuardPath(req.url);
    if (!isLoopbackAddr(socket.remoteAddress) && (p === null || isSensitivePath(p) || !UPGRADE_ALLOWED.has(p))) {
      destroyRemoteForbidden(socket);
      return;
    }
    spliceToTcpEndpoint(socket, opts.backendPort, reconstructRequest(req, head));
  });

  // Loopback: peek the first line and raw-TCP splice to backend (/ws, /api/stt/stream)
  // or the internal HTTP server (everything else) — byte-identical to the pre-guard
  // default deployment. Non-loopback: hand the raw socket to the in-process HTTP server
  // so every request (keep-alive included) and every upgrade is parsed with the true
  // remoteAddress visible, and the per-request guard above can reject the sensitive family.
  const routeLoopback = (client: Socket): void => {
    let peeked = Buffer.alloc(0);
    let settled = false;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      client.removeListener('data', onData);
      client.removeListener('error', onEarlyError);
      client.removeListener('end', onEarlyEnd);
    };
    const onData = (chunk: Buffer): void => {
      peeked = Buffer.concat([peeked, chunk]);
      const decision = peekWsRoute(peeked);
      if (decision === null && peeked.length < PEEK_LIMIT_BYTES) return;
      cleanup();
      const target = decision === true ? opts.backendPort : internalPort;
      spliceToTcpEndpoint(client, target, peeked);
    };
    const onEarlyError = (): void => {
      cleanup();
      client.destroy();
    };
    const onEarlyEnd = (): void => {
      // Client closed before we saw a request line — nothing to route.
      cleanup();
      client.destroy();
    };
    client.on('data', onData);
    client.on('error', onEarlyError);
    client.on('end', onEarlyEnd);
  };

  const tcp_server = net.createServer((client: Socket) => {
    if (!isLoopbackAddr(client.remoteAddress)) {
      // Never raw-splice a remote connection: route it through the HTTP server so the
      // per-request guard sees the real address (defeats keep-alive pipelining and
      // oversized-first-line splice bypasses — audit M1/M2).
      http_server.emit('connection', client);
      return;
    }
    routeLoopback(client);
  });

  await new Promise<void>((resolve, reject) => {
    tcp_server.once('error', reject);
    tcp_server.listen(port, host, () => {
      tcp_server.off('error', reject);
      resolve();
    });
  });

  const actualPort = (tcp_server.address() as { port: number } | null)?.port ?? port;
  const lanIP = allowRemote ? (getLanIP() ?? undefined) : undefined;
  const localUrl = `http://127.0.0.1:${actualPort}`;
  const networkUrl = lanIP ? `http://${lanIP}:${actualPort}` : undefined;

  return {
    port: actualPort,
    url: networkUrl ?? localUrl,
    localUrl,
    networkUrl,
    lanIP,
    stop: () =>
      new Promise<void>((resolve) => {
        tcp_server.close(() => {
          http_server.close(() => resolve());
        });
      }),
  };
}

export async function stopStaticServer(handle: StaticServerHandle): Promise<void> {
  await handle.stop();
}
