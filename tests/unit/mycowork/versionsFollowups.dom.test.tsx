/**
 * [mycowork] PR11 版本页 / 空间页发布设计对齐的审查跟进（协调者 2026-10-09）。只替换 Bridge HTTP。
 * 覆盖：发布未完成时按退避节奏重读、本会话发起的发布到终态给最终提示（成功 / 失败带原因与重试）、空间列表在发布推进后自己刷新；
 * 次要 / 轻按钮与弹窗取消按钮的禁用态样式；发布标记 Tag 长库名省略；每次点发布重读 Secret 状态且读失败有“重试”；
 * 列表重读失败时预览标题不带版本号；结果提示在版本页本页不再给“查看版本与变化”。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import { resetAccountScopedState } from '@mycowork/ui';
import { watchPublication } from '@mycowork/ui/pages/versions/index.ts';
import { OfficeResourcesSlot, OfficeVersionsSlot } from '@/renderer/mycowork-slots';
import { settleTracker } from './saveTrackerTeardown';

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'fixture-account' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => vi.fn(),
}));
readRetry.delays = [0, 0];

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => {
  const res = { status, ok: status < 300, json: async () => body, clone: () => res };
  return res;
};
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const rev = (id: string, over: object = {}) => ({
  revision_id: id, parent_id: null, content_sha256: 'x', size: 1, created_at: '2026-10-08T01:00:00.000Z', origin: 'edit', current: false, ...over,
});
const pub = (status: string, over: object = {}) => ({
  publication_id: 'p1', resource_id: 'res_1', revision_id: 'rev_bbbbbbbb',
  target: { kind: 'knowledge_base', source_id: 'src_q', file_name: 'a.pptx' },
  status, error: null, published_resource_id: null, accepted_at: 't', published_at: null, created_at: 't', ...over,
});
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));

type Opts = {
  pubs?: () => object[];
  metadata?: () => unknown;
  revisions?: () => unknown;
  list?: () => object[];
};
function bridge(o: Opts = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/revisions'))
      return o.revisions
        ? (o.revisions() as never)
        : reply(200, {
            resource_id: 'res_1', current_revision_id: 'rev_bbbbbbbb', file_name: '季度汇报.pptx',
            items: [rev('rev_bbbbbbbb', { current: true }), rev('rev_aaaaaaaa', { origin: 'original' })],
            page: 1, page_size: 50, total: 2,
          });
    if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: o.pubs?.() ?? [], page: 1, page_size: 50, total: 0 });
    if (url.endsWith('/retry')) return reply(200, {});
    if (url === '/bridge/v1/scopes')
      return reply(200, { sources: [{ source_id: 'src_q', name: '青禾库-很长很长很长很长很长很长很长的名字知识库', provider: 'weknora', counts }], projects: [] });
    if (url.endsWith('/metadata')) return o.metadata ? (o.metadata() as never) : reply(200, { secret: false });
    if (url.includes('/changes?'))
      return reply(200, {
        resource_id: 'res_1', from_revision_id: 'rev_aaaaaaaa', to_revision_id: 'rev_bbbbbbbb', format: 'pptx', compared_root: '/', status: 'complete',
        coverage: { nodes_from: 1, nodes_to: 1, truncated: false, lists_truncated: false }, changes: [], unknown_parts: [],
      });
    if (url.endsWith('/office/html')) return { ...reply(200, null), text: async () => '<html><head></head><body></body></html>' };
    if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (url.startsWith('/bridge/v1/resources?')) {
      const items = o.list?.() ?? [];
      return reply(200, { page: 1, page_size: 50, total: items.length, items });
    }
    void method;
    return reply(404, {});
  });
}
const output = (status: string) => ({
  resource_id: 'res_o', file_name: '产物.pptx', source_id: null, origin: 'outputs', purpose: 'working', state: 'stored',
  tag_ids: [], secret: false, can_mark_secret: true, updated_at: '2026-10-08T01:00:00.000Z', revision_count: 1,
  published_to: [{ publication_id: 'p1', source_id: 'src_q', status, has_published: status === 'published' }],
});
const clickPublish = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '发布到知识库' }));
  return screen.findByRole('dialog');
};

describe('发布设计对齐的审查跟进', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    cleanup();
    resetAccountScopedState();
    Message.clear();
    vi.unstubAllGlobals();
    await settleTracker();
  });

  it('版本页有排队中的发布时按 5 秒节奏重读，到“已完成”后给最终提示', async () => {
    let n = 0;
    bridge({ pubs: () => [n++ === 0 ? pub('queued') : pub('published', { published_resource_id: 'res_kb' })] });
    watchPublication('p1', { kb: '青禾库', lang: 'zh-CN' });
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText(/· 排队中/)).toBeInTheDocument();
    expect(await screen.findByText(/· 已完成/, {}, { timeout: 8000 })).toBeInTheDocument();
    expect(await screen.findByText('已发布到「青禾库」，AI 现在可以引用它')).toBeInTheDocument();
  }, 15_000);

  it('失败：不自动消失的提示带人话原因与“重试”，重试走原 publication_id', async () => {
    bridge({ pubs: () => [pub('failed', { error: 'upstream_failed' })] });
    watchPublication('p1', { kb: '青禾库', lang: 'zh-CN' });
    render(<OfficeVersionsSlot />);
    const toast = await screen.findByText(/发布到「青禾库」没有成功：知识库没有接收成功/);
    expect(toast.textContent).not.toContain('upstream_failed');
    fireEvent.click(within(toast).getByRole('button', { name: '重试' }));
    await waitFor(() => expect(calls('POST', '/publications/p1/retry')).toHaveLength(1));
  });

  it('空间列表：发布推进（queued → published）后自己刷新，不用手动刷新', async () => {
    let n = 0;
    bridge({ list: () => [output(n++ === 0 ? 'queued' : 'published')] });
    render(<OfficeResourcesSlot />);
    await screen.findByTestId('mycowork-output-publication');
    await waitFor(() => expect(screen.queryByTestId('mycowork-output-publication')).toBeNull(), { timeout: 9000 });
  }, 15_000);

  it('次要 / 轻按钮与弹窗取消按钮的底色字色只作用于未禁用状态', () => {
    const css = readFileSync(join(process.env['MYCOWORK_UI_DIR'] ?? '', 'pages/shell/page-shell.css'), 'utf8');
    for (const sel of ['.mcw-pill-secondary.arco-btn', '.mcw-pill-light.arco-btn', '.mcw-dialog .arco-modal-footer .arco-btn-secondary']) {
      const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, s, body]) => s!.includes(sel) && /(^|\s)(background|color):/.test(body!));
      expect(rules.length, sel).toBeGreaterThan(0);
      for (const [, s] of rules) expect(s, sel).toContain(':not(.arco-btn-disabled)');
    }
  });

  it('发布标记的长库名 Tag 可收缩（省略 + 提示），不撑出横向滚动', async () => {
    bridge({ pubs: () => [pub('queued')] });
    render(<OfficeVersionsSlot />);
    const tag = (await screen.findByText(/青禾库-很长/)).closest('.arco-tag') as HTMLElement;
    expect(tag.className).toContain('mcw-ver-pub-tag');
    const css = readFileSync(join(process.env['MYCOWORK_UI_DIR'] ?? '', 'pages/versions/versions.css'), 'utf8');
    expect(css).toMatch(/\.mcw-ver-pub-tag[^{]*\{[^}]*max-width:\s*100%/);
    expect(css).toMatch(/\.mcw-ver-pub-tag[^{]*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it('每次点发布都重读 Secret 状态；读失败有“重试”，重试读到后放行', async () => {
    let n = 0;
    bridge({ metadata: () => (n++ < 2 ? reply(404, { error: { code: 'NOT_FOUND', message: 'x' } }) : reply(200, { secret: false })) });
    render(<OfficeVersionsSlot />);
    await screen.findByText('v2');
    await waitFor(() => expect(calls('GET', '/metadata')).toHaveLength(1)); // 进页读一次（失败）
    const dialog = await clickPublish();
    await waitFor(() => expect(calls('GET', '/metadata')).toHaveLength(2)); // 点发布再读一次
    fireEvent.click(await within(dialog).findByRole('button', { name: '重试' }));
    await waitFor(() => expect(calls('GET', '/metadata')).toHaveLength(3));
    await waitFor(() => expect(within(dialog).queryByText(/暂时读不到/)).toBeNull());
    expect(within(dialog).queryByText(/正在确认/)).toBeNull();
  });

  it('列表重读失败（已提示没能刷新）时，预览标题不带版本号', async () => {
    let fail = false;
    bridge({
      revisions: () =>
        fail
          ? reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } })
          : reply(200, {
              resource_id: 'res_1', current_revision_id: 'rev_bbbbbbbb', file_name: '季度汇报.pptx',
              items: [rev('rev_bbbbbbbb', { current: true }), rev('rev_aaaaaaaa', { origin: 'original' })], page: 1, page_size: 50, total: 2,
            }),
    });
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('当前内容预览 · v2')).toBeInTheDocument();
    fail = true;
    await act(async () => {
      window.dispatchEvent(new CustomEvent('mycowork:resource-changed', { detail: { resourceId: 'res_1' } }));
    });
    await waitFor(() => expect(screen.queryByText('当前内容预览 · v2')).toBeNull());
    expect(screen.getByText('当前内容预览')).toBeInTheDocument();
  });
});
