/**
 * [mycowork] ADR-0011: `/office/resources` (MyCowork P05 resource center, PR04 slice d/f; redesign PR11/D123).
 * Only the Bridge boundary is mocked (fetch). Covers: the home view "Recent" merges My imports and every granted knowledge base
 * newest first (sort=updated) and shows type, source, local time, version count and state; the left nav switches to one knowledge
 * base or My imports; a failing source only shows a local notice, other results stay (02 P05); the search box looks up names/tags
 * across all sources (q=…) and says content search is not available; card/list/table switch, remembered locally and on a saved
 * view; starring creates or updates the "starred" collection and the Starred nav lists it; a tag filters across sources and can be
 * saved as a view; editing tags patches metadata with the read revision (409 → reload + notice); moving a tag to the top level;
 * empty and no-permission states.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: null, pathname: '/' }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 13).toISOString();
const older = new Date(now.getFullYear() - 1, 2, 2, 9, 5).toISOString();
const TAGS = [
  { tag_id: 'tag_p', name: '项目', parent_id: null, namespace: 'platform', aliases: [], revision: 1, updated_at: 't' },
  {
    tag_id: 'tag_c',
    name: '风险',
    parent_id: 'tag_p',
    namespace: 'platform',
    aliases: [],
    revision: 3,
    updated_at: 't',
  },
];
const item = (over: object) => ({
  resource_id: 'res_1',
  file_name: '工作稿.pptx',
  source_id: null,
  purpose: 'working',
  state: 'stored',
  tag_ids: ['tag_c'],
  secret: false,
  can_mark_secret: true,
  updated_at: older,
  revision_count: 3,
  ...over,
});
const WEEKLY = item({
  resource_id: 'res_q',
  file_name: '周报.md',
  source_id: 'src_q',
  state: 'ready',
  tag_ids: [],
  updated_at: today,
  revision_count: 0,
});
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));
const bodyOf = (method: string, part: string, i = 0) => JSON.parse(String(calls(method, part)[i]?.[1]?.body));

type Opts = { patchStatus?: number; empty?: boolean; sourceStatus?: number; starred?: string[]; views?: object[] };
function bridge(opts: Opts = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/bridge/v1/scopes')
      return reply(200, {
        sources: [{ source_id: 'src_q', name: '青禾库', provider: 'weknora', counts }],
        projects: [],
      });
    if (url.startsWith('/bridge/v1/resources?')) {
      const q = new URLSearchParams(url.split('?')[1]);
      if (q.get('source_id') && opts.sourceStatus)
        return reply(opts.sourceStatus, { error: { code: 'NOT_FOUND', message: 'x' } });
      let items = opts.empty ? [] : q.get('source_id') === 'src_q' ? [WEEKLY] : [item({})];
      if (q.get('collection_id')) items = items.filter((i) => opts.starred?.includes(i.resource_id));
      if (q.get('q')) items = items.filter((i) => i.file_name.includes(q.get('q') as string));
      return reply(200, { page: 1, page_size: 50, total: items.length, items });
    }
    if (url === '/bridge/v1/tags' && method === 'GET') return reply(200, { tags: TAGS });
    if (url === '/bridge/v1/saved-views' && method === 'GET') return reply(200, { views: opts.views ?? [] });
    if (url === '/bridge/v1/collections' && method === 'GET')
      return reply(200, {
        collections: opts.starred
          ? [
              {
                collection_id: 'col_s',
                name: '收藏',
                purpose: 'starred',
                member_count: 1,
                resource_ids: opts.starred,
                revision: 2,
                updated_at: 't',
              },
            ]
          : [],
      });
    if (url.endsWith('/metadata') && method === 'GET')
      return reply(200, {
        resource_id: 'res_1',
        metadata_revision: 4,
        current_revision_id: 'rev_1',
        tag_ids: ['tag_c'],
        secret: false,
      });
    if (url.endsWith('/metadata') && method === 'PATCH')
      return opts.patchStatus
        ? reply(opts.patchStatus, { error: { code: 'REVISION_CONFLICT', message: 'x' } })
        : reply(200, {});
    return reply(method === 'GET' ? 404 : 201, {});
  });
}

describe('OfficeResourcesSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Recent merges My imports and granted knowledge bases newest first, with type, source, local time, versions and state', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    const rows = await screen.findAllByTestId('mycowork-resource-item');
    expect(rows.map((r) => within(r).getByRole('link', { name: /\.(md|pptx)$/ }).textContent)).toEqual([
      '周报.md',
      '工作稿.pptx',
    ]);
    expect(calls('GET', 'origin=imports&sort=updated')).toHaveLength(1);
    expect(calls('GET', 'source_id=src_q&sort=updated')).toHaveLength(1);
    const [weekly, draft] = rows as [HTMLElement, HTMLElement];
    expect(within(weekly).getByText('青禾库')).toBeInTheDocument();
    expect(within(weekly).getAllByText('今天 10:13').length).toBeGreaterThan(0);
    expect(within(weekly).getByText('—')).toBeInTheDocument(); // 只在知识库，没有 MyCowork 版本
    expect(within(weekly).getByText('可检索')).toBeInTheDocument();
    expect(within(draft).getByText('我的导入')).toBeInTheDocument();
    expect(within(draft).getByRole('link', { name: '3 个版本' })).toHaveAttribute(
      'href',
      '#/office/resources/res_1/versions'
    );
    expect(within(draft).getByText('只存原件')).toBeInTheDocument();
    expect(within(draft).getByText('风险')).toBeInTheDocument();
    expect(screen.queryByText(/T\d\d:\d\d/)).toBeNull(); // 不直出 ISO
  });

  it('the nav switches to one knowledge base or My imports', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_q'));
    await waitFor(() => expect(calls('GET', 'source_id=src_q&page=1')).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: '青禾库' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mycowork-nav-imports'));
    await waitFor(() => expect(calls('GET', 'origin=imports&page=1')).toHaveLength(1));
    expect(screen.getByTestId('mycowork-nav-imports')).toHaveAttribute('aria-current', 'page');
  });

  it('a failing source shows a local notice; results from the others stay', async () => {
    bridge({ sourceStatus: 500 });
    render(<OfficeResourcesSlot />);
    expect(await screen.findByText('工作稿.pptx')).toBeInTheDocument();
    expect(screen.getByText(/以下来源暂时读不到：青禾库/)).toBeInTheDocument();
  });

  it('a knowledge base without access shows the no-permission state', async () => {
    bridge({ sourceStatus: 404 });
    render(<OfficeResourcesSlot />);
    await screen.findByText('工作稿.pptx');
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_q'));
    expect(await screen.findByText('没有这个来源的权限')).toBeInTheDocument();
  });

  it('search looks up names and tags across all sources and says content search is not available', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(screen.getByText(/按正文内容跨来源搜索尚未提供/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索名称或标签'), { target: { value: '周报' } });
    await waitFor(() => expect(calls('GET', `q=${encodeURIComponent('周报')}`)).toHaveLength(2));
    expect(await screen.findByRole('heading', { name: '搜索“周报”' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索名称或标签'), { target: { value: '不存在的词' } });
    expect(await screen.findByText('没有名称或标签匹配的资料')).toBeInTheDocument();
  });

  it('switches card / list / table and remembers the choice locally', async () => {
    bridge();
    const { unmount, container } = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByLabelText('卡片'));
    await waitFor(() => expect(container.querySelector('.mcw-rc-grid')).not.toBeNull());
    fireEvent.click(screen.getByLabelText('表格'));
    await waitFor(() => expect(container.querySelector('.arco-table')).not.toBeNull());
    unmount();
    const again = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(again.container.querySelector('.arco-table')).not.toBeNull();
  });

  it('a saved view remembers its own layout on the Bridge', async () => {
    bridge({
      views: [
        {
          view_id: 'view_1',
          name: '风险视图',
          filter: { tag_ids: ['tag_c'] },
          layout: 'card',
          revision: 5,
          missing_tag_ids: [],
        },
      ],
    });
    const { container } = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-view-view_1'));
    await waitFor(() => expect(calls('GET', 'view_id=view_1')).toHaveLength(2));
    await waitFor(() => expect(container.querySelector('.mcw-rc-grid')).not.toBeNull());
    fireEvent.click(screen.getByLabelText('列表'));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/saved-views/view_1')).toHaveLength(1));
    expect(bodyOf('PATCH', '/saved-views/view_1')).toEqual({ expected_revision: 5, layout: 'list' });
  });

  it('starring creates the starred collection first, then adds/removes with its revision; Starred lists it', async () => {
    bridge();
    const first = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '收藏 工作稿.pptx' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/collections')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/collections')).toEqual({
      name: '收藏',
      purpose: 'starred',
      resource_ids: ['res_1'],
    });
    first.unmount();
    fetchMock.mockReset();
    bridge({ starred: ['res_1'] });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(screen.getByRole('button', { name: '取消收藏 工作稿.pptx' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '收藏 周报.md' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/collections/col_s')).toHaveLength(1));
    expect(bodyOf('PATCH', '/collections/col_s')).toEqual({ expected_revision: 2, add: ['res_q'] });
    fireEvent.click(screen.getByTestId('mycowork-nav-starred'));
    await waitFor(() => expect(calls('GET', 'collection_id=col_s')).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByTestId('mycowork-resource-item')).toHaveLength(1));
  });

  it('a tag filters across sources and can be saved as a view with the current layout', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-tag-tag_c'));
    await waitFor(() => expect(calls('GET', 'tag_id=tag_c')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '存为视图' }));
    fireEvent.change(await screen.findByLabelText('视图名'), { target: { value: '我的风险' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/saved-views')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/saved-views')).toEqual({
      name: '我的风险',
      filter: { tag_ids: ['tag_c'] },
      layout: 'list',
    });
  });

  it('edits tags from "More" with the read metadata revision; a 409 reloads and says so', async () => {
    for (const patchStatus of [undefined, 409]) {
      fetchMock.mockReset();
      bridge({ patchStatus });
      const { unmount } = render(<OfficeResourcesSlot />);
      await screen.findByText('工作稿.pptx');
      fireEvent.click(screen.getByRole('button', { name: '更多操作 工作稿.pptx' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: '编辑标签' }));
      fireEvent.click(await screen.findByLabelText('编辑标签'));
      await screen.findByRole('option', { name: '项目' });
      fireEvent.click(screen.getByText('项目', { selector: 'li *' })); // 多选选项要点到选项里的文字（Arco 在内层元素上处理）
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(calls('PATCH', '/metadata')).toHaveLength(1));
      expect(bodyOf('PATCH', '/metadata')).toEqual({
        expected_metadata_revision: 4,
        tags: { add: ['tag_p'], remove: [] },
      });
      if (patchStatus)
        expect(await screen.findByText('已被其他地方修改，已重新读取，请再操作一次')).toBeInTheDocument();
      unmount();
    }
  });

  it('moves a tag to the top level with its revision', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '标签“风险”的更多操作' }));
    await act(async () => fireEvent.click(await screen.findByRole('menuitem', { name: '（顶层）' })));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/tags/tag_c')).toHaveLength(1));
    expect(bodyOf('PATCH', '/bridge/v1/tags/tag_c')).toEqual({ expected_revision: 3, parent_id: null });
  });

  it('no resources: the empty state leads to the import page', async () => {
    bridge({ empty: true });
    render(<OfficeResourcesSlot />);
    expect(await screen.findByText('最近没有变化的资料')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /导入资料/ });
    expect(links.every((a) => a.getAttribute('href') === '#/office/imports')).toBe(true);
    expect(links.length).toBe(2); // 标题区主操作 + 空状态引导
  });
});
