/**
 * [mycowork] ADR-0011: shared fixtures for the P09 browse / adopt DOM tests (MyCowork PR05 slices j, k): a stateful fake Bridge (fetch only).
 */

import { vi } from 'vitest';

export const fetchMock = vi.fn();
export const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
export const err = (status: number, code: string) => reply(status, { error: { code, message: 'x' } });
export const cand = (id: string, limited = false) => ({
  asset_id: id,
  version: 1,
  title: `模板 ${id}`,
  structure: id,
  reasons: [{ code: 'relation_match', text: '适合“并列要点”' }],
  limits: limited ? [{ code: 'font_missing', text: '缺字体 FZ' }] : [],
  preview: { state: 'pending', render_profile: null },
});
export type Page = { no: number; picked?: string; cands: string[]; excluded?: boolean; limited?: string[] };
export const pageOf = (p: Page) => ({
  page_no: p.no,
  intent: `意图${p.no}`,
  relation: 'parallel',
  facts: [],
  facts_sha256: `f${p.no}`,
  status: p.picked ? 'selected' : 'awaiting_confirmation',
  selected: p.picked ? { asset_id: p.picked, version: 1 } : null,
  candidates: p.cands.map((c) => cand(c, p.limited?.includes(c))),
  excluded: p.excluded
    ? [{ asset_id: 'x1', version: 1, title: '排除模板', reasons: [{ code: 'font_missing', text: '缺少字体 FZ' }] }]
    : [],
  fallbacks: [],
  message: null,
});
export const decisionOf = (n: number, pages: Page[]) => ({
  decision_id: `dec_${n}`,
  version: n,
  mode: 'confirm',
  status: pages.every((p) => p.picked) ? 'selected' : 'awaiting_confirmation',
  output_format: 'pptx',
  aspect: '16:9',
  constraints: { native_editable: true, keep_master: true, allow_split: true },
  theme: null,
  theme_excluded: [],
  fallbacks: [],
  message: null,
  created_at: 't',
  pages: pages.map(pageOf),
});
export const item = (id: string, kind = 'page-pattern', version = 1) => ({
  asset_id: id,
  version,
  kind,
  title: `资产 ${id}`,
  approval: 'approved',
  shared: false,
  scenes: [],
  formats: ['pptx'],
  aspect: '16:9',
  relations: ['parallel'],
  structure: id,
  preview: { state: 'pending', render_profile: null },
});
export const detail = (id: string, version = 1) => ({
  ...item(id),
  version,
  category: 'content',
  density: 'medium',
  slots: null,
  theme_id: null,
  fonts: ['Noto Sans'],
  missing_dependencies: [],
  touches_master: false,
  acceptance: { editable: 'native', checked_at: null, evidence: null },
  source: { package: 'fixtures', path: 'qualified-16x9.pptx#/slide[2]', sha256: null },
  private_keys: [],
  transitions: [],
});

export type Server = {
  pages: Page[];
  items?: ReturnType<typeof item>[];
  total?: number;
  failChoiceAt?: { pageNo: number };
  /** 先于默认处理：返回响应就用它（用来注入失败、慢读、按资产拒绝）。 */
  hook?: (u: URL, init?: RequestInit) => unknown;
};
/** 有状态的假 Bridge：每次 choices 生成 dec_{n+1}，只改被选的那一页。 */
export function serve(s: Server) {
  let n = 1;
  const posts: { id: string; body: { page_no: number; asset_id: string } }[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    const path = u.pathname;
    const hooked = await s.hook?.(u, init);
    if (hooked) return hooked;
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push({ id: path.split('/')[4] as string, body });
      if (s.failChoiceAt?.pageNo === body.page_no) return err(409, 'TEMPLATE_NOT_ELIGIBLE');
      s.pages = s.pages.map((p) => (p.no === body.page_no ? { ...p, picked: body.asset_id } : p));
      return reply(201, decisionOf(++n, s.pages));
    }
    if (path.endsWith('/preview')) return reply(200, '<html>预览</html>');
    if (path === '/bridge/v1/assets')
      return reply(200, {
        page: Number(u.searchParams.get('page')),
        page_size: 50,
        total: s.total ?? 2,
        items: s.items ?? [],
      });
    const a = /^\/bridge\/v1\/assets\/([^/]+)$/.exec(path);
    if (a) return reply(200, detail(decodeURIComponent(a[1] as string), Number(u.searchParams.get('version') ?? 1)));
    return reply(200, decisionOf(n, s.pages));
  });
  return posts;
}
export const calls = (re: RegExp) => fetchMock.mock.calls.filter(([u]) => re.test(String(u)));
