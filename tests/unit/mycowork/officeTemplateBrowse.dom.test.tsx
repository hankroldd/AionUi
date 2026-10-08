/**
 * [mycowork] ADR-0011: P09 "browse all" / "view original template" drawer and "adopt all first choices" (MyCowork PR05 slices j, k; A167, A169).
 * Only the Bridge boundary is mocked (fetch). Covers: list request shape and real previews, closing the drawer leaves the plan untouched,
 * choosing a non-candidate asset (new decision id in the address bar), excluded items are greyed with the reason and cannot be chosen,
 * 409 keeps the original decision, detail by exact version, pagination, and adopt-all (order, skip already chosen, stop on failure).
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeCompositionSlot } from '@/renderer/mycowork-slots';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => navigate,
  useParams: () => ({ decisionId: 'dec_1' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const err = (status: number, code: string) => reply(status, { error: { code, message: 'x' } });
const cand = (id: string) => ({
  asset_id: id,
  version: 1,
  title: `模板 ${id}`,
  structure: id,
  reasons: [{ code: 'relation_match', text: '适合“并列要点”' }],
  limits: [],
  preview: { state: 'pending', render_profile: null },
});
type Page = { no: number; picked?: string; cands: string[]; excluded?: boolean };
const pageOf = (p: Page) => ({
  page_no: p.no,
  intent: `意图${p.no}`,
  relation: 'parallel',
  facts: [],
  facts_sha256: `f${p.no}`,
  status: p.picked ? 'selected' : 'awaiting_confirmation',
  selected: p.picked ? { asset_id: p.picked, version: 1 } : null,
  candidates: p.cands.map(cand),
  excluded: p.excluded
    ? [{ asset_id: 'x1', version: 1, title: '排除模板', reasons: [{ code: 'font_missing', text: '缺少字体 FZ' }] }]
    : [],
  fallbacks: [],
  message: null,
});
const decisionOf = (n: number, pages: Page[]) => ({
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
const item = (id: string, kind = 'page-pattern') => ({
  asset_id: id,
  version: 1,
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
const detail = (id: string) => ({
  ...item(id),
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

type Server = { pages: Page[]; items?: ReturnType<typeof item>[]; total?: number; failChoiceAt?: { pageNo: number } };
/** 有状态的假 Bridge：每次 choices 生成 dec_{n+1}，只改被选的那一页。 */
function serve(s: Server) {
  let n = 1;
  const posts: { id: string; body: { page_no: number; asset_id: string } }[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://x');
    const path = u.pathname;
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push({ id: path.split('/')[4] as string, body });
      if (s.failChoiceAt?.pageNo === body.page_no) return err(409, 'TEMPLATE_NOT_ELIGIBLE');
      s.pages = s.pages.map((p) => (p.no === body.page_no ? { ...p, picked: body.asset_id } : p));
      return reply(201, decisionOf(++n, s.pages));
    }
    if (path.endsWith('/preview')) return reply(200, '<html>预览</html>');
    if (path === '/bridge/v1/assets')
      return reply(200, { page: Number(u.searchParams.get('page')), page_size: 50, total: s.total ?? 2, items: s.items ?? [] });
    const a = /^\/bridge\/v1\/assets\/([^/]+)$/.exec(path);
    if (a) return reply(200, detail(a[1] as string));
    return reply(200, decisionOf(n, s.pages));
  });
  return posts;
}
const calls = (re: RegExp) => fetchMock.mock.calls.filter(([u]) => re.test(String(u)));

describe('P09 browse all / view original / adopt all', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    navigate.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
        observe() {
          this.cb([{ isIntersecting: true }]);
        }
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = async () => {
    render(<OfficeCompositionSlot />);
    fireEvent.click((await screen.findAllByRole('button', { name: '浏览全部' }))[0] as HTMLElement);
    return await screen.findByRole('dialog');
  };

  it('lists visible page patterns for this page with a real isolated preview, and closing leaves the plan as it was', async () => {
    serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('n1'), item('n2')] });
    const dialog = await open();
    expect(await within(dialog).findByText('资产 n1')).toBeInTheDocument();
    const q = new URL(String(calls(/\/assets\?/)[0]?.[0]), 'http://x').searchParams;
    expect([q.get('kind'), q.get('relation'), q.get('page')]).toEqual(['page-pattern', 'parallel', '1']);
    await waitFor(() => expect(dialog.querySelector('iframe.mcw-tp-frame')).not.toBeNull());
    expect(dialog.querySelector('iframe.mcw-tp-frame')?.getAttribute('sandbox')).toBe('allow-scripts');
    fireEvent.click(document.querySelector('.arco-drawer-close-icon') as HTMLElement);
    expect(screen.getByText('意图1')).toBeInTheDocument();
    expect(screen.getByText('模板 a1')).toBeInTheDocument();
    expect(calls(/template-decisions\/dec_1$/)).toHaveLength(1); // 没有重读也没有换版本
    expect(navigate).not.toHaveBeenCalled();
  });

  it('uses a non-candidate pattern for the page: one POST however often clicked, address switches to the new decision', async () => {
    const posts = serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('n1')] });
    const dialog = await open();
    const use = await within(dialog).findByRole('button', { name: '用于第 1 页' });
    fireEvent.click(use);
    fireEvent.click(use);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/office/compositions/dec_2', { replace: true }));
    expect(posts).toEqual([{ id: 'dec_1', body: expect.objectContaining({ page_no: 1, asset_id: 'n1' }) }]);
    expect(await screen.findByText('决策版本 v2')).toBeInTheDocument();
    expect(screen.getAllByText('已选定').length).toBeGreaterThan(0);
  });

  it('greys out excluded items with the reason and never posts for them; marks the item already chosen', async () => {
    const posts = serve({ pages: [{ no: 1, cands: ['a1'], excluded: true, picked: 'n2' }], items: [item('x1'), item('n2')] });
    const dialog = await open();
    expect(await within(dialog).findByText('缺少字体 FZ')).toBeInTheDocument();
    const buttons = within(dialog).getAllByRole('button', { name: /用于第 1 页|已选中/ });
    expect(buttons).toHaveLength(2);
    buttons.forEach((b) => expect(b).toBeDisabled());
    fireEvent.click(buttons[0] as HTMLElement);
    expect(posts).toHaveLength(0);
  });

  it('on 409 shows the not-eligible note and the page is still the original decision', async () => {
    serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('n1')], failChoiceAt: { pageNo: 1 } });
    const dialog = await open();
    fireEvent.click(await within(dialog).findByRole('button', { name: '用于第 1 页' }));
    expect(await screen.findByText('这个模板在当前约束下不再合格，已重新读取')).toBeInTheDocument();
    expect(screen.getByText('决策版本 v1')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('pages through the list 50 at a time and does not offer "use" for themes', async () => {
    serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('t1', 'theme')], total: 60 });
    const dialog = await open();
    expect(await within(dialog).findByText('资产 t1')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '用于第 1 页' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(calls(/\/assets\?.*page=2/)).toHaveLength(1));
  });

  it('"view original" opens the exact version in the same drawer with fields and a preview, without listing', async () => {
    serve({ pages: [{ no: 1, cands: ['a1'] }] });
    render(<OfficeCompositionSlot />);
    fireEvent.click((await screen.findAllByRole('button', { name: '查看原模板' }))[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('fixtures / qualified-16x9.pptx#/slide[2]')).toBeInTheDocument();
    expect(within(dialog).getByText('Noto Sans')).toBeInTheDocument();
    expect(calls(/\/assets\/a1\?version=1$/)).toHaveLength(1);
    await waitFor(() => expect(dialog.querySelector('iframe.mcw-tp-frame')).not.toBeNull());
    expect(calls(/\/assets\?/)).toHaveLength(0);
    expect(screen.getByText('意图1')).toBeInTheDocument(); // 页面没有卸载
  });

  it('adopts the first candidate of every pending page in order, skipping chosen pages, then looks like hand-picked', async () => {
    const posts = serve({
      pages: [
        { no: 1, cands: ['a1', 'a2'] },
        { no: 2, cands: ['b1'], picked: 'b0' },
        { no: 3, cands: ['c1'] },
      ],
    });
    render(<OfficeCompositionSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '全部采用首选' }));
    expect(await screen.findByText('决策版本 v3')).toBeInTheDocument();
    expect(posts.map((p) => [p.id, p.body.page_no, p.body.asset_id])).toEqual([
      ['dec_1', 1, 'a1'],
      ['dec_2', 3, 'c1'],
    ]);
    expect(screen.getAllByText('已选中')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '全部采用首选' })).toBeNull();
    expect(navigate).toHaveBeenLastCalledWith('/office/compositions/dec_3', { replace: true });
  });

  it('stops at the first failing page, keeps what was adopted and says which page failed', async () => {
    const posts = serve({
      pages: [
        { no: 1, cands: ['a1'] },
        { no: 2, cands: ['b1'] },
        { no: 3, cands: ['c1'] },
        { no: 4, cands: ['d1'] },
      ],
      failChoiceAt: { pageNo: 3 },
    });
    render(<OfficeCompositionSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '全部采用首选' }));
    expect(await screen.findByText(/已采用 2 页.*第 3 页没成功/)).toBeInTheDocument();
    expect(posts.map((p) => p.body.page_no)).toEqual([1, 2, 3]); // 第 4 页没有被动
    expect(screen.getByText('决策版本 v3')).toBeInTheDocument();
    expect(screen.getAllByText('已选中')).toHaveLength(2);
  });
});
