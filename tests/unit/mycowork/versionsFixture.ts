/**
 * [mycowork] 版本页正确性用例的共用替身：只替换 Bridge 边界（fetch）。n 个版本 rev-1…rev-n（rev-n 是当前版本，parent = 前一版），
 * 时间线按每页 50 条分页，其余路由给最小的可用响应；每个用例可替换 diff / restore / 预览 / 编辑会话 / 发布记录的处理。
 */
import { vi } from 'vitest';

export const RES = 'resource-1';
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export type Hooks = {
  total: number;
  fileName?: string;
  failPages?: Set<number>; // 这些页码读不到（503）
  diff?: (from: string, to: string) => Response | Promise<Response>;
  restore?: (
    body: { submission_id: string; expected_current_revision_id: string },
    rev: string
  ) => Response | Promise<Response>;
  editing?: () => Response | Promise<Response>;
  publications?: () => Response | Promise<Response>;
  preview?: () => Response | Promise<Response>;
  metadata?: () => Response | Promise<Response>;
};

export const revItem = (k: number, total: number, over: object = {}) => ({
  revision_id: `rev-${k}`,
  parent_id: k > 1 ? `rev-${k - 1}` : null,
  content_sha256: `sha-${k}`,
  size: 10,
  created_at: new Date(Date.UTC(2026, 9, 1, 8, 0, 0) + k * 60_000).toISOString(),
  origin: k === 1 ? 'original' : 'editor',
  current: k === total,
  ...over,
});

export const diffOf = (from: string, to: string) => ({
  resource_id: RES,
  from_revision_id: from,
  to_revision_id: to,
  format: 'docx',
  engine: 'officecli',
  tool_version: '1',
  compared_root: '/body',
  status: 'complete',
  coverage: { nodes_from: 1, nodes_to: 1, truncated: false, lists_truncated: false },
  changes: [],
  unknown_parts: [],
  native_revisions: 0,
});

export function installBridge(h: Hooks) {
  const hooks = h;
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const timelinePage = (page: number) => {
    const all = Array.from({ length: hooks.total }, (_, i) => revItem(hooks.total - i, hooks.total));
    return {
      resource_id: RES,
      current_revision_id: hooks.total ? `rev-${hooks.total}` : null,
      file_name: hooks.fileName ?? '虚构文档.docx',
      items: all.slice((page - 1) * 50, page * 50),
      page,
      page_size: 50,
      total: hooks.total,
    };
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const tl = /\/revisions(?:\?page=(\d+))?$/.exec(url);
    if (tl && method === 'GET') {
      const page = Number(tl[1] ?? 1);
      return hooks.failPages?.has(page)
        ? json({ error: { code: 'UPSTREAM_UNAVAILABLE' } }, 503)
        : json(timelinePage(page));
    }
    const rs = /\/revisions\/([^/]+)\/restore$/.exec(url);
    if (rs && method === 'POST')
      return hooks.restore?.(body, decodeURIComponent(rs[1] ?? '')) ?? json({ error: { code: 'INTERNAL' } }, 500);
    const ch = /\/changes\?from=([^&]+)&to=([^&]+)/.exec(url);
    if (ch) {
      const [from, to] = [decodeURIComponent(ch[1] ?? ''), decodeURIComponent(ch[2] ?? '')];
      return hooks.diff ? hooks.diff(from, to) : json(diffOf(from, to));
    }
    if (url.includes('/publications?'))
      return hooks.publications?.() ?? json({ items: [], total: 0, page: 1, page_size: 50 });
    if (url.endsWith('/scopes')) return json({ sources: [], projects: [] });
    if (url.endsWith('/metadata')) return hooks.metadata?.() ?? json({ secret: false });
    if (url.endsWith('/edit-sessions')) return hooks.editing?.() ?? json({ items: [] });
    if (url.endsWith('/preview') || url.endsWith('/office/html')) return hooks.preview?.() ?? new Response('虚构正文');
    throw new Error(`未安排的请求 ${method} ${url}`);
  });
  return { calls, hooks, timelinePage };
}
