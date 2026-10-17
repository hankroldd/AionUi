/**
 * [mycowork] R061: login-session gate for NON-LOOPBACK peers.
 *
 * aioncore runs in `identity_mode=local, auth=disabled`: it authenticates nothing but /api/auth/user, and it
 * sees every proxied request as coming from 127.0.0.1. So when the Web Host is reachable from the LAN (built-in
 * TLS), this gate is the only thing between a LAN peer and /api/* and /ws. Loopback peers are never gated.
 *
 * A session is valid iff GET /api/auth/user on the backend (over loopback, `aionui-session` cookie only — the
 * same check the Bridge uses) answers 200. Only positive answers are cached, briefly.
 */
import { createHash } from 'node:crypto';
import { normalizeGuardPath } from './remote-guard.js';

// Endpoints the login page needs before a session exists (renderer AuthContext.tsx:50,89 /api/auth/user probe,
// sessionRefresh.ts:40 silent refresh with the refresh cookie). /login, /logout, /qr-login are not under /api.
// Matched against the RAW path (case-sensitive, query stripped) so a path the backend might read differently
// can never ride an allowlist entry.
export const PRE_SESSION_API = new Set(['/api/auth/user', '/api/auth/refresh']);

export function sessionCookieOf(cookie: string | undefined): string | undefined {
  return cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('aionui-session=') && c.length > 'aionui-session='.length);
}

/** true when a non-loopback request to this URL must carry a valid session (fail-closed on unparseable paths). */
export function needsSession(rawUrl: string | undefined): boolean {
  const raw = rawUrl ?? '';
  const rawPath = raw.split(/[?#]/)[0];
  if (PRE_SESSION_API.has(rawPath)) return false;
  const p = normalizeGuardPath(raw);
  return p === null || p === '/api' || p.startsWith('/api/') || rawPath === '/api' || rawPath.startsWith('/api/');
}

const TTL_MS = 10_000;
const MAX_ENTRIES = 500;

export type SessionVerdict = 'ok' | 'denied' | 'unavailable';

export function createSessionGate(backendPort: number, now: () => number = Date.now) {
  const positive = new Map<string, number>(); // sha256(cookie) -> expiry; ponytail: no negative cache, no per-user revocation hook (logout waits out the 10 s TTL)
  return async function check(cookieHeader: string | undefined): Promise<SessionVerdict> {
    const session = sessionCookieOf(cookieHeader);
    if (!session) return 'denied';
    const key = createHash('sha256').update(session).digest('hex');
    const until = positive.get(key);
    if (until !== undefined && until > now()) return 'ok';
    positive.delete(key);
    try {
      const res = await fetch(`http://127.0.0.1:${backendPort}/api/auth/user`, {
        headers: { cookie: session },
        signal: AbortSignal.timeout(3000),
      });
      await res.arrayBuffer().catch(() => undefined);
      if (res.status === 200) {
        if (positive.size >= MAX_ENTRIES) positive.clear();
        positive.set(key, now() + TTL_MS);
        return 'ok';
      }
      return res.status === 401 || res.status === 403 ? 'denied' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  };
}

const body = (code: string): string => JSON.stringify({ success: false, error: code, code });

export function sessionDeniedResponse(verdict: SessionVerdict): { status: number; body: string } {
  return verdict === 'unavailable'
    ? { status: 503, body: body('AUTH_UNAVAILABLE') }
    : { status: 401, body: body('UNAUTHORIZED') };
}
