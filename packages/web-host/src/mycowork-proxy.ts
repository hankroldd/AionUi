/**
 * [mycowork] Web Host proxy pieces that are not upstream: the read-only officecli watch preview whitelist (D35/A35)
 * and the same-origin /bridge/* proxy helpers (ADR-0011). Moved out of static-server.ts unchanged.
 */
import http, { type IncomingMessage } from 'node:http';
import { isLoopbackAddr } from './remote-guard.js';
import { peerHeaders, sessionCookieOf } from './session-gate.js';

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

// [mycowork] ADR-0011: same-origin reverse proxy /bridge/* to the MyCowork Bridge.
// Only the aionui-session cookie may leave for the Bridge (cf. Grafana CVE-2022-39201).
export const BRIDGE_UNAVAILABLE = { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'bridge unavailable' } };

export function bridgeHeaders(req: IncomingMessage): http.IncomingHttpHeaders {
  const { cookie, ...rest } = peerHeaders(
    req.headers,
    req.socket.remoteAddress,
    isLoopbackAddr(req.socket.remoteAddress)
  );
  const session = sessionCookieOf(cookie);
  return session ? { ...rest, cookie: session } : rest;
}

// Fire-and-forget: tell the Bridge to drop its identity cache for this session (ADR-0011 D21).
// Never awaited, errors ignored — logout itself must not depend on the Bridge.
export function notifyBridgeLogout(bridge: URL, req: IncomingMessage): void {
  const session = sessionCookieOf(req.headers.cookie);
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
