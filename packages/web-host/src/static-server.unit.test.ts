import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  isBlockedRemoteRequest,
  isBlockedWatchRequest,
  isSensitivePath,
  normalizeGuardPath,
  startStaticServer,
  type StaticServerHandle,
} from './static-server.js';

// [mycowork] 安全（A67/D150）端到端用例需要从非回环地址发起（否则守卫按回环放行）。取本机第一个
// 非回环 IPv4；无则跳过这些用例（在无网卡的 CI 上），纯函数用例仍全跑。
const LAN_IP = Object.values(os.networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

async function mkRendererFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-static-'));
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>root</title>');
  await fs.mkdir(path.join(dir, 'assets'));
  await fs.writeFile(path.join(dir, 'assets', 'main.js'), 'console.log("hi")');
  return dir;
}

async function startMockBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('static-server', () => {
  let handle: StaticServerHandle | null = null;
  let stopBackend: (() => Promise<void>) | null = null;
  let staticDir = '';

  beforeEach(async () => {
    staticDir = await mkRendererFixture();
  });

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
    if (stopBackend) {
      await stopBackend();
      stopBackend = null;
    }
    await fs.rm(staticDir, { recursive: true, force: true });
  });

  it('serves static index.html at /', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('<title>root</title>');
  });

  it('SPA fallback: /chat/123 returns index.html', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/chat/123`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>root</title>');
  });

  it('static asset /assets/main.js served', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/assets/main.js`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('hi');
  });

  it('/api/* reverse-proxies to backend', async () => {
    const backend = await startMockBackend((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, method: req.method }));
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/anything`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { path: string };
    expect(json.path).toBe('/api/anything');
  });

  it('/login reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/login' && req.method === 'POST') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'aionui-session=backend-token; Path=/; HttpOnly',
        });
        res.end(JSON.stringify({ success: true, proxied: true }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'anything' }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/aionui-session=backend-token/);
    const json = (await r.json()) as { proxied: boolean };
    expect(json.proxied).toBe(true);
  });

  it('/api/auth/user reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/api/auth/user' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: { username: 'from-backend', id: 'from-backend' } }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/api/auth/user`);
    expect(r.status).toBe(200);
    const json = (await r.json()) as { user: { username: string } };
    expect(json.user.username).toBe('from-backend');
  });

  it('/logout reverse-proxies to backend (no local handler)', async () => {
    const backend = await startMockBackend((req, res) => {
      if (req.url === '/logout' && req.method === 'POST') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'aionui-session=; Path=/; Max-Age=0',
        });
        res.end(JSON.stringify({ success: true, proxied: true }));
        return;
      }
      res.writeHead(404).end();
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const r = await fetch(`${handle.localUrl}/logout`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('/api proxy returns 502 when backend unreachable', async () => {
    // allocate a port then free it
    const placeholder = await startMockBackend((_req, res) => res.end());
    const freePort = placeholder.port;
    await placeholder.close();

    handle = await startStaticServer({ staticDir, backendPort: freePort, port: 0 });
    const r = await fetch(`${handle.localUrl}/api/anything`);
    expect(r.status).toBe(502);
  });

  it('/ws WebSocket upgrade is spliced to backend and 101 is relayed', async () => {
    // Mock backend that accepts any WebSocket upgrade and replies with 101.
    // We don't run a real ws protocol — just verify the upgrade response makes
    // it back through the TCP-splice proxy. This is the exact regression path
    // that bun 1.3's http-compat upgrade handler broke.
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      // Send a single 0-length WS text frame as a liveness marker then close.
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    // Speak raw HTTP/1.1 upgrade over a TCP socket against the public listener.
    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /ws HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('/api/stt/stream WebSocket upgrade is spliced to backend and 101 is relayed', async () => {
    // Same as /ws test but for STT streaming endpoint.
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /api/stt/stream HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('/api/stt/stream with query params is spliced to backend', async () => {
    const { createHash } = await import('node:crypto');
    const net = await import('node:net');
    const httpMod = await import('node:http');
    const backendServer = httpMod.createServer();
    backendServer.on('upgrade', (req, socket) => {
      const wsKey = (req.headers['sec-websocket-key'] as string) || '';
      const accept = createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n');
      socket.write('Upgrade: websocket\r\n');
      socket.write('Connection: Upgrade\r\n');
      socket.write(`Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
      socket.write(Buffer.from([0x81, 0x00]));
      socket.end();
    });
    await new Promise<void>((r) => backendServer.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backendServer.close(() => r()));
    const backendPort = (backendServer.address() as { port: number }).port;

    handle = await startStaticServer({ staticDir, backendPort, port: 0 });

    const { port: publicPort } = handle;
    const status: string = await new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: publicPort }, () => {
        sock.write(
          'GET /api/stt/stream?lang=en&model=default HTTP/1.1\r\n' +
            `Host: 127.0.0.1:${publicPort}\r\n` +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
            '\r\n'
        );
      });
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const headEnd = buf.indexOf('\r\n\r\n');
        if (headEnd >= 0) {
          const firstLine = buf.slice(0, buf.indexOf(0x0a)).toString('ascii');
          sock.destroy();
          resolve(firstLine.trim());
        }
      });
      sock.on('error', reject);
      setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout waiting for 101'));
      }, 3000).unref();
    });
    expect(status).toMatch(/HTTP\/1\.1 101/i);
  });

  it('POST body with a large payload is fully forwarded to backend (no byte drop during splice)', async () => {
    // Regression for #4058: WebUI uploads hang forever at 100%. When the routing
    // decision fired on the first chunk, the pre-router removed its 'data'
    // listener but left the socket in flowing mode; body bytes arriving before
    // the async `client.pipe(upstream)` was wired had no consumer and were
    // silently dropped. The backend then waited forever for the missing bytes,
    // so the browser upload sat at 100% and never returned. A body large enough
    // to span multiple TCP segments reproduces the race deterministically.
    const BODY_LEN = 512 * 1024; // 512 KB — spans several TCP segments

    const backend = await startMockBackend((req, res) => {
      let received = 0;
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ received }));
      });
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

    const { port: publicPort } = handle;
    const body = Buffer.alloc(BODY_LEN, 0x61); // 512 KB of 'a'

    const received: number = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: publicPort,
          method: 'POST',
          path: '/api/fs/upload',
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': BODY_LEN,
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            raw += c;
          });
          res.on('end', () => {
            try {
              resolve((JSON.parse(raw) as { received: number }).received);
            } catch (e) {
              reject(e as Error);
            }
          });
        }
      );
      request.on('error', reject);
      request.setTimeout(5000, () => {
        request.destroy(new Error('timeout: backend never received the full body (bytes dropped in splice)'));
      });
      request.end(body);
    });

    expect(received).toBe(BODY_LEN);
  });

  describe('[mycowork] /bridge/* proxy (ADR-0011)', () => {
    const savedBridgeUrl = process.env.AIONUI_BRIDGE_URL;
    let stopBridge: (() => Promise<void>) | null = null;

    afterEach(async () => {
      if (savedBridgeUrl === undefined) delete process.env.AIONUI_BRIDGE_URL;
      else process.env.AIONUI_BRIDGE_URL = savedBridgeUrl;
      if (stopBridge) {
        await stopBridge();
        stopBridge = null;
      }
    });

    it('forwards /bridge/v1/scopes with path intact and only the aionui-session cookie', async () => {
      const backend = await startMockBackend((_req, res) => res.writeHead(404).end());
      stopBackend = backend.close;
      const bridge = await startMockBackend((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ path: req.url, cookie: req.headers.cookie, auth: req.headers.authorization }));
      });
      stopBridge = bridge.close;
      process.env.AIONUI_BRIDGE_URL = `http://127.0.0.1:${bridge.port}`;
      handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

      const r = await fetch(`${handle.localUrl}/bridge/v1/scopes?limit=5`, {
        headers: { cookie: 'grafana_session=leak; aionui-session=tok123; other=x', authorization: 'Bearer p' },
      });
      expect(r.status).toBe(200);
      const json = (await r.json()) as { path: string; cookie: string; auth: string };
      expect(json.path).toBe('/bridge/v1/scopes?limit=5');
      expect(json.cookie).toBe('aionui-session=tok123');
      expect(json.auth).toBe('Bearer p');
    });

    it('returns 502 UPSTREAM_UNAVAILABLE JSON when the Bridge is down', async () => {
      const backend = await startMockBackend((_req, res) => res.writeHead(404).end());
      stopBackend = backend.close;
      const placeholder = await startMockBackend((_req, res) => res.end());
      process.env.AIONUI_BRIDGE_URL = `http://127.0.0.1:${placeholder.port}`;
      await placeholder.close();
      handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

      const r = await fetch(`${handle.localUrl}/bridge/v1/scopes`);
      expect(r.status).toBe(502);
      expect(await r.json()).toEqual({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'bridge unavailable' } });
    });

    it('/logout still returns aioncore response and notifies the Bridge with the session cookie', async () => {
      const backend = await startMockBackend((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'aionui-session=; Path=/; Max-Age=0' });
        res.end(JSON.stringify({ path: req.url, proxied: true }));
      });
      stopBackend = backend.close;
      let notified: (v: { method?: string; url?: string; cookie?: string }) => void = () => {};
      const notification = new Promise<{ method?: string; url?: string; cookie?: string }>((r) => (notified = r));
      const bridge = await startMockBackend((req, res) => {
        notified({ method: req.method, url: req.url, cookie: req.headers.cookie });
        res.writeHead(204).end();
      });
      stopBridge = bridge.close;
      process.env.AIONUI_BRIDGE_URL = `http://127.0.0.1:${bridge.port}`;
      handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });

      const r = await fetch(`${handle.localUrl}/logout`, {
        method: 'POST',
        headers: { cookie: 'other=x; aionui-session=tok123' },
      });
      expect(r.status).toBe(200);
      expect(r.headers.get('set-cookie')).toMatch(/Max-Age=0/);
      expect(((await r.json()) as { path: string }).path).toBe('/logout');
      expect(await notification).toEqual({
        method: 'POST',
        url: '/bridge/v1/session/end',
        cookie: 'aionui-session=tok123',
      });
    });
  });

  it('network URL populated only when allowRemote=true', async () => {
    const backend = await startMockBackend((_req, res) => res.end('nope'));
    stopBackend = backend.close;
    const h1 = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      allowRemote: false,
    });
    expect(h1.networkUrl).toBeUndefined();
    await h1.stop();

    const h2 = await startStaticServer({
      staticDir,
      backendPort: backend.port,
      port: 0,
      allowRemote: true,
    });
    // may still be undefined on CI machines without a LAN interface
    expect(typeof h2.networkUrl === 'string' || h2.networkUrl === undefined).toBe(true);
    await h2.stop();
  });

  // [mycowork] D35/A35: officecli watch preview is read-only through the Web Host.
  it('watch proxy: only the page, SSE and selection reports reach the backend; write/retarget/status get 403', async () => {
    const seen: string[] = [];
    const backend = await startMockBackend((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.end('ok');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0 });
    const base = `${handle.localUrl}/api/office-watch-proxy/41234`;
    const status = (url: string, method = 'GET') =>
      fetch(url, method === 'POST' ? { method, body: '{}' } : undefined).then((r) => r.status);
    expect(await status(base)).toBe(200);
    expect(await status(`${base}/?t=1`)).toBe(200);
    expect(await status(`${base}/events`)).toBe(200);
    expect(await status(`${base}/api/selection`, 'POST')).toBe(200);
    for (const sub of ['/api/send', '/api/batch', '/api/switch'])
      expect(await status(`${base}${sub}`, 'POST')).toBe(403);
    expect(await status(`${base}/api/status`)).toBe(403);
    expect(await status(`${handle.localUrl}/api/ppt-proxy/41234/api/send`, 'POST')).toBe(403);
    expect(seen.some((l) => /send|batch|switch|status/.test(l))).toBe(false);
  });

  it('watch proxy is default-deny: odd port spellings, case and encodings cannot slip past the whitelist', () => {
    for (const url of [
      '/api/office-watch-proxy/+41234/api/send',
      '/api/office-watch-proxy/%2B41234/api/send',
      '/api/office-watch-proxy/%341234/api/batch',
      '/api/Office-Watch-Proxy/41234/api/switch',
      '/api/ppt-proxy/41234/api/%73end',
      '/api/office-watch-proxy/41234//api/send',
      '/api/office-watch-proxy/41234/events/../api/send',
    ])
      expect(isBlockedWatchRequest('POST', url)).toBe(true);
    expect(isBlockedWatchRequest('GET', '/api/office-watch-proxy/+41234')).toBe(true);
    expect(isBlockedWatchRequest('GET', '/api/office-watch-proxy/41234/api/status')).toBe(true);
    expect(isBlockedWatchRequest('HEAD', '/api/office-watch-proxy/41234')).toBe(true);
    expect(isBlockedWatchRequest('GET', '/api/office-watch-proxy/41234/events?x=1')).toBe(false);
    expect(isBlockedWatchRequest('POST', '/api/office-watch-proxy/41234/api/selection')).toBe(false);
  });

  it('isBlockedWatchRequest leaves other /api routes alone', () => {
    expect(isBlockedWatchRequest('POST', '/api/conversations')).toBe(false);
    expect(isBlockedWatchRequest('GET', '/api/office-watch-proxy/1')).toBe(false);
    expect(isBlockedWatchRequest('PUT', '/api/office-watch-proxy/1/api/selection')).toBe(true);
  });

  // [mycowork] 安全（A67/D150）：非回环敏感族逐请求守卫（独立审查 M1–M3、S1–S2）。
  it('normalizeGuardPath 归一成后端会用的小写绝对路径', () => {
    expect(normalizeGuardPath('/api/webui/reset-password')).toBe('/api/webui/reset-password');
    expect(normalizeGuardPath('/api/webui/reset-password?x=1#f')).toBe('/api/webui/reset-password');
    expect(normalizeGuardPath('/api/webui/reset-password/')).toBe('/api/webui/reset-password');
    expect(normalizeGuardPath('/api/webui/./reset-password')).toBe('/api/webui/reset-password');
    expect(normalizeGuardPath('/api//webui//reset-password')).toBe('/api/webui/reset-password');
    expect(normalizeGuardPath('/api/webui/reset-password;x=1')).toBe('/api/webui/reset-password');
    expect(normalizeGuardPath('/api/%77ebui/reset-password')).toBe('/api/webui/reset-password'); // %77=w
    expect(normalizeGuardPath('/api/webui%2Freset-password')).toBe('/api/webui/reset-password'); // 编码斜杠
    expect(normalizeGuardPath('http://x/api/webui/reset-password')).toBe('/api/webui/reset-password'); // 绝对形式
    expect(normalizeGuardPath('/api/auth/internal/../internal/users')).toBe('/api/auth/internal/users');
    expect(normalizeGuardPath('/API/WebUI/Reset-Password')).toBe('/api/webui/reset-password'); // 小写化
    expect(normalizeGuardPath('/%zz')).toBeNull(); // 坏转义 → 拒绝
    expect(normalizeGuardPath('notapath')).toBeNull();
    expect(normalizeGuardPath(undefined)).toBeNull();
  });

  it('isSensitivePath 覆盖整个 /api/webui/ 与 /api/auth/internal/ 族', () => {
    for (const p of [
      '/api/webui',
      '/api/webui/reset-password',
      '/api/webui/change-password',
      '/api/webui/change-username',
      '/api/webui/generate-qr-token',
      '/api/auth/internal',
      '/api/auth/internal/users/system',
    ])
      expect(isSensitivePath(p)).toBe(true);
    for (const p of [
      '/api/auth/status',
      '/api/auth/user',
      '/login',
      '/logout',
      '/qr-login',
      '/api/conversations',
      '/',
      '/api/webuix',
    ])
      expect(isSensitivePath(p)).toBe(false);
  });

  it('isBlockedRemoteRequest：回环放行、非回环敏感/变体/不可解析拒绝、非回环正常放行', () => {
    // 回环一律放行（含敏感族：resetpass 路径 1、桌面本机）
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
      expect(isBlockedRemoteRequest('/api/webui/reset-password', addr)).toBe(false);
    // 非回环敏感族 + 归一化变体 → 拒绝
    for (const u of [
      '/api/webui/reset-password',
      '/api/webui/change-password',
      '/api/webui/generate-qr-token',
      '/api/auth/internal/users',
      '/api/webui%2Freset-password',
      '/api/webui/./reset-password',
      'http://x/api/webui/reset-password',
      '/api/auth/internal/../internal/users',
    ])
      expect(isBlockedRemoteRequest(u, '192.168.10.7')).toBe(true);
    // 非回环不可解析 → fail-closed
    expect(isBlockedRemoteRequest('/%zz', '192.168.10.7')).toBe(true);
    // 非回环非敏感 → 放行
    for (const u of ['/api/auth/status', '/login', '/qr-login?token=x', '/', '/api/conversations'])
      expect(isBlockedRemoteRequest(u, '192.168.10.7')).toBe(false);
  });

  // 端到端：真实 net.Server + mock 后端，从本机非回环 IP 发起（无网卡则跳过）。
  const itRemote = LAN_IP ? it : it.skip;

  itRemote(`非回环单发敏感请求 403 且不触达后端（LAN=${LAN_IP ?? 'skip'}）`, async () => {
    const seen: string[] = [];
    const backend = await startMockBackend((req, res) => {
      seen.push(req.url!);
      res.writeHead(200).end('{"ok":true}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0, allowRemote: true });
    const r = await collect(
      LAN_IP!,
      handle.port,
      'POST /api/webui/reset-password HTTP/1.1\r\nHost: h\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
    );
    expect(r.statuses).toEqual(['403']);
    expect(r.body).toContain('REMOTE_FORBIDDEN');
    // 变异守卫：去掉逐请求拦截，reset-password 会到后端、此断言变红。
    expect(seen).not.toContain('/api/webui/reset-password');
  });

  itRemote('非回环 keep-alive 第二个请求也 403（审查 M1）', async () => {
    const seen: string[] = [];
    const backend = await startMockBackend((req, res) => {
      seen.push(req.url!);
      res.writeHead(200).end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0, allowRemote: true });
    const r = await collect(
      LAN_IP!,
      handle.port,
      'GET /api/auth/status HTTP/1.1\r\nHost: h\r\n\r\n',
      'POST /api/webui/reset-password HTTP/1.1\r\nHost: h\r\nContent-Length: 0\r\n\r\n'
    );
    expect(r.statuses).toEqual(['200', '403']);
    expect(seen).toContain('/api/auth/status');
    expect(seen).not.toContain('/api/webui/reset-password');
  });

  itRemote('非回环超长首行仍 403（审查 M2）', async () => {
    const seen: string[] = [];
    const backend = await startMockBackend((req, res) => {
      seen.push(req.url!);
      res.writeHead(200).end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0, allowRemote: true });
    const r = await collect(
      LAN_IP!,
      handle.port,
      `POST /api/webui/reset-password?x=${'a'.repeat(4200)} HTTP/1.1\r\nHost: h\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
    expect(r.statuses).toEqual(['403']);
    expect(seen).not.toContain('/api/webui/reset-password');
  });

  itRemote('非回环归一化变体逐条 403（审查 S2）', async () => {
    const seen: string[] = [];
    const backend = await startMockBackend((req, res) => {
      seen.push(req.url!);
      res.writeHead(200).end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0, allowRemote: true });
    for (const p of [
      '/api/webui/reset-password/',
      '/api/webui/./reset-password',
      '/api/webui/reset-password;x=1',
      '/api//webui//reset-password',
      '/api/%77ebui/reset-password',
      'http://x/api/webui/reset-password',
      '/api/auth/internal/../internal/users',
    ]) {
      const r = await collect(
        LAN_IP!,
        handle.port,
        `POST ${p} HTTP/1.1\r\nHost: h\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
      );
      expect(r.statuses, p).toEqual(['403']);
    }
    expect(seen).toEqual([]);
  });

  itRemote('非回环 WebSocket upgrade：敏感路径拒绝、/ws 转发后端并回传 101', async () => {
    const backend = http.createServer((_req, res) => res.writeHead(404).end());
    let sawWsUpgrade = false;
    backend.on('upgrade', (req, socket) => {
      if (req.url === '/ws') {
        sawWsUpgrade = true;
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      }
      socket.end();
    });
    await new Promise<void>((r) => backend.listen(0, '127.0.0.1', () => r()));
    stopBackend = () => new Promise<void>((r) => backend.close(() => r()));
    const backendPort = (backend.address() as AddressInfo).port;
    handle = await startStaticServer({ staticDir, backendPort, port: 0, allowRemote: true });
    const up = (p: string): string =>
      `GET ${p} HTTP/1.1\r\nHost: h\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
    const bad = await collect(LAN_IP!, handle.port, up('/api/webui/reset-password'));
    expect(bad.statuses).toEqual(['403']);
    expect(sawWsUpgrade).toBe(false);
    const ok = await collect(LAN_IP!, handle.port, up('/ws'));
    expect(ok.statuses).toEqual(['101']);
    expect(sawWsUpgrade).toBe(true);
  });

  itRemote('非回环正常请求可达（/api/auth/status 到后端，/qr-login 与静态页 200）', async () => {
    const seen: string[] = [];
    const backend = await startMockBackend((req, res) => {
      seen.push(req.url!);
      res.writeHead(200).end('{}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0, allowRemote: true });
    const st = await collect(
      LAN_IP!,
      handle.port,
      'GET /api/auth/status HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n'
    );
    expect(st.statuses).toEqual(['200']);
    expect(seen).toContain('/api/auth/status');
    // /qr-login 与静态页由 SPA/静态目录服务（不转发后端），非回环不应被拦成 403。
    const qr = await collect(
      LAN_IP!,
      handle.port,
      'GET /qr-login?token=x HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n'
    );
    expect(qr.statuses).toEqual(['200']);
    const root = await collect(LAN_IP!, handle.port, 'GET / HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n');
    expect(root.statuses).toEqual(['200']);
  });

  it('回环来源敏感请求仍转发后端（resetpass 路径 1、桌面本机不受影响）', async () => {
    const seen: string[] = [];
    const backend = await startMockBackend((req, res) => {
      seen.push(req.url!);
      res.writeHead(200).end('{"success":true}');
    });
    stopBackend = backend.close;
    handle = await startStaticServer({ staticDir, backendPort: backend.port, port: 0, allowRemote: true });
    const r = await collect(
      '127.0.0.1',
      handle.port,
      'POST /api/webui/reset-password HTTP/1.1\r\nHost: h\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
    );
    expect(r.statuses).toEqual(['200']);
    expect(seen).toContain('/api/webui/reset-password');
  });
});

// 原始 socket 上按序发若干请求，收集响应状态码与全文（不含任何机密断言）。
function collect(host: string, port: number, ...requests: string[]): Promise<{ statuses: string[]; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port }, () => {
      sock.write(requests[0]);
      for (let i = 1; i < requests.length; i++) setTimeout(() => sock.write(requests[i]), 200 * i);
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
    });
    sock.on('error', reject);
    setTimeout(
      () => {
        sock.destroy();
        const s = buf.toString('latin1');
        resolve({ statuses: [...s.matchAll(/HTTP\/1\.[01] (\d{3})/g)].map((m) => m[1]), body: s });
      },
      requests.length > 1 ? 1000 : 600
    );
  });
}
