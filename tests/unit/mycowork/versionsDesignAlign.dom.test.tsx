/**
 * [mycowork] PR11 版本页与发布弹窗向空间页设计语言对齐（负责人 2026-10-09）。只替换 Bridge HTTP（fetch），页面与 Arco 组件是真的。
 * 覆盖：页头主按钮（在线编辑）与空间“新建”共用 mcw-pill-primary、发布到知识库为次要 mcw-pill-secondary、一个主按钮；
 * 页头显示文件名与类型；预览标题带版本号；时间线上的发布标记（库名 / 失败原因 / 在知识库中查看）；
 * 读不到是否为 Secret 时发布入口提示并不放行（不当成“不是 Secret”）；发布弹窗带 mcw-dialog。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import '@arco-design/web-react/lib/_util/react-19-adapter';
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
  revision_id: id,
  parent_id: null,
  content_sha256: 'x',
  size: 1,
  created_at: '2026-10-08T01:00:00.000Z',
  origin: 'edit',
  current: false,
  ...over,
});
const pub = (id: string, over: object) => ({
  publication_id: id,
  resource_id: 'res_1',
  revision_id: 'rev_bbbbbbbb',
  target: { kind: 'knowledge_base', source_id: 'src_q', file_name: 'a.pptx' },
  status: 'queued',
  error: null,
  published_resource_id: null,
  accepted_at: 't',
  published_at: null,
  created_at: 't',
  ...over,
});

function bridge(opts: { pubs?: object[]; metadata?: () => unknown } = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/revisions'))
      return reply(200, {
        resource_id: 'res_1',
        current_revision_id: 'rev_bbbbbbbb',
        file_name: '季度汇报.pptx',
        items: [rev('rev_bbbbbbbb', { current: true }), rev('rev_aaaaaaaa', { origin: 'original' })],
        page: 1,
        page_size: 50,
        total: 2,
      });
    if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: opts.pubs ?? [], page: 1, page_size: 50, total: 0 });
    if (url === '/bridge/v1/scopes')
      return reply(200, { sources: [{ source_id: 'src_q', name: '青禾库', provider: 'weknora', counts }], projects: [] });
    if (url.endsWith('/metadata')) return opts.metadata ? (opts.metadata() as never) : reply(200, { secret: false });
    if (url.includes('/changes?'))
      return reply(200, {
        resource_id: 'res_1', from_revision_id: 'rev_aaaaaaaa', to_revision_id: 'rev_bbbbbbbb', format: 'pptx',
        compared_root: '/', status: 'complete', coverage: { nodes_from: 1, nodes_to: 1, truncated: false, lists_truncated: false },
        changes: [], unknown_parts: [],
      });
    if (url.endsWith('/office/html')) return { ...reply(200, null), text: async () => '<html><head></head><body></body></html>' };
    if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (url.startsWith('/bridge/v1/resources?')) return reply(200, { page: 1, page_size: 50, total: 0, items: [] });
    return reply(404, {});
  });
}

describe('版本页向空间页设计语言对齐', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await settleTracker();
  });

  it('页头：主按钮与空间“新建”共用 mcw-pill-primary，发布到知识库是次要胶囊，只有一个主按钮', async () => {
    bridge();
    const { unmount } = render(<OfficeVersionsSlot />);
    const actions = (await screen.findByTestId('mycowork-versions')).querySelector('.mcw-page-actions') as HTMLElement;
    await waitFor(() => expect(within(actions).getByRole('button', { name: '在线编辑' })).toBeInTheDocument());
    const edit = within(actions).getByRole('button', { name: '在线编辑' });
    expect(edit.className).toContain('mcw-pill-primary');
    expect(within(actions).getByRole('button', { name: '发布到知识库' }).className).toContain('mcw-pill-secondary');
    expect(actions.querySelectorAll('.arco-btn-primary')).toHaveLength(1);
    unmount();
    render(<OfficeResourcesSlot />);
    await screen.findByText('空间');
    const create = document.querySelector('.mcw-space-create') as HTMLElement;
    expect(create.className).toContain('mcw-pill-primary');
  });

  it('页头显示文件名与类型；预览标题带当前版本号', async () => {
    bridge();
    render(<OfficeVersionsSlot />);
    expect((await screen.findByTestId('versions-file')).textContent).toBe('季度汇报.pptx · PPTX');
    expect(await screen.findByText('当前内容预览 · v2')).toBeInTheDocument();
  });

  it('时间线上的发布标记：库名、失败原因的人话、成功后在知识库中查看', async () => {
    bridge({
      pubs: [
        pub('p1', { status: 'queued' }),
        pub('p2', { status: 'failed', error: 'target_forbidden' }),
        pub('p3', { status: 'published', published_resource_id: 'res_kb', target: { kind: 'knowledge_base', source_id: 'src_gone' } }),
      ],
    });
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('发布到「青禾库」 · 排队中')).toBeInTheDocument();
    expect(screen.getByText('发布到「青禾库」 · 失败')).toBeInTheDocument();
    expect(screen.getByTestId('version-publication-error').textContent).toContain('你已不能再向这个库发布');
    expect(screen.queryByText(/target_forbidden/)).toBeNull();
    expect(screen.getByText('发布到「知识库」 · 已完成')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '在知识库中查看' }).getAttribute('href')).toBe('#/office/resources/res_kb/versions');
  });

  it('读不到是否为 Secret：发布入口提示稍后重试，不放行', async () => {
    bridge({ metadata: () => reply(404, { error: { code: 'NOT_FOUND', message: 'x' } }) });
    render(<OfficeVersionsSlot />);
    await screen.findByText('v2');
    fireEvent.click(await screen.findByRole('button', { name: '发布到知识库' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/暂时读不到这份文件是否为 Secret/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '发布' })).toBeDisabled();
    expect(dialog.className).toContain('mcw-dialog');
  });
});
