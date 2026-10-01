/**
 * [mycowork] ADR-0011: `/office/resources` (MyCowork P05 resource center, PR04 slice d/f; redesign PR11/D123).
 * Only the Bridge boundary is mocked (fetch). Covers: the home view "Recent" merges My imports and every granted knowledge base
 * newest first (sort=updated) and shows type, source, local time, tags and the state in "will AI use it" words (D145; no version
 * count in the list, D146); the left nav switches to one knowledge
 * base or My imports; a failing source only shows a local notice, other results stay (02 P05); the search box looks up names/tags
 * across all sources (q=…) and says content search is not available; card/list/table switch, remembered locally and on a saved
 * view; starring creates or updates the "starred" collection and the Starred nav lists it; a tag filters across sources and can be
 * saved as a view; editing tags patches metadata with the read revision (409 → reload + notice); moving a tag to the top level;
 * empty and no-permission states. Round 3 (2026-09-29): collapsible nav groups remembered locally and a keyboard-resizable
 * nav width clamped to 200–360; smart groups (D143) edited / deleted from their "More" menu; a knowledge base filtered by tags,
 * saved as a smart group limited to that base, and "ask with these files" (D144); search lists matching tags (D146);
 * archive-only items show at most two tags plus "+N" and offer "add to a knowledge base" (D145).
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ScopeChip } from '@mycowork/ui';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';

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

type Opts = {
  patchStatus?: number;
  createTagStatus?: number;
  createTagWait?: Promise<void>;
  tagPatchStatus?: number;
  tagDeleteStatus?: number;
  tagDeleteWait?: Promise<void>;
  empty?: boolean;
  sourceStatus?: number;
  starred?: string[];
  views?: Record<string, unknown>[];
  tags3?: boolean;
};
function bridge(opts: Opts = {}) {
  let tags = structuredClone(TAGS);
  let views = structuredClone(opts.views ?? []);
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
      let items = opts.empty
        ? []
        : q.get('source_id') === 'src_q'
          ? [WEEKLY]
          : [item(opts.tags3 ? { tag_ids: ['tag_c', 'tag_p', 'tag_x'] } : {})];
      if (q.get('collection_id')) items = items.filter((i) => opts.starred?.includes(i.resource_id));
      if (q.get('q')) items = items.filter((i) => i.file_name.includes(q.get('q') as string));
      return reply(200, { page: 1, page_size: 50, total: items.length, items });
    }
    if (url === '/bridge/v1/tags' && method === 'GET')
      return reply(200, {
        tags: opts.tags3 ? [...tags, { ...TAGS[0], tag_id: 'tag_x', name: '第三个', revision: 1 }] : tags,
      });
    if (url === '/bridge/v1/tags' && method === 'POST') {
      await opts.createTagWait;
      return opts.createTagStatus
        ? reply(opts.createTagStatus, { error: { code: 'NAME_CONFLICT', message: 'x' } })
        : reply(201, {});
    }
    if (url.startsWith('/bridge/v1/tags/') && method === 'PATCH') {
      if (opts.tagPatchStatus)
        return reply(opts.tagPatchStatus, { error: { code: 'REVISION_CONFLICT', message: 'x' } });
      const body = JSON.parse(String(init?.body));
      tags = tags.map((t) => (url.endsWith(t.tag_id) ? { ...t, ...body, revision: t.revision + 1 } : t));
      return reply(200, {});
    }
    if (url.startsWith('/bridge/v1/tags/') && method === 'DELETE') {
      await opts.tagDeleteWait;
      if (opts.tagDeleteStatus)
        return reply(opts.tagDeleteStatus, {
          error: { code: opts.tagDeleteStatus === 409 ? 'TAG_HAS_CHILDREN' : 'NOT_FOUND', message: 'x' },
        });
      tags = tags.filter((t) => !url.endsWith(t.tag_id));
      return reply(200, { tag_id: url.split('/').at(-1), untagged_resources: 1, affected_view_ids: [] });
    }
    if (url === '/bridge/v1/saved-views' && method === 'GET') return reply(200, { views });
    if (url.startsWith('/bridge/v1/saved-views/') && method === 'PATCH') {
      const body = JSON.parse(String(init?.body));
      views = views.map((view) =>
        url.endsWith(String(view['view_id']))
          ? {
              ...view,
              ...body,
              revision: Number(view['revision']) + 1,
            }
          : view
      );
      return reply(200, {});
    }
    if (url.startsWith('/bridge/v1/saved-views/') && method === 'DELETE') {
      views = views.filter((view) => !url.endsWith(String(view['view_id'])));
      return reply(204, undefined);
    }
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

  it('Recent merges My imports and granted knowledge bases newest first, with type, source, local time, tags and state (no version count)', async () => {
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
    expect(within(weekly).getByText('AI 可引用')).toBeInTheDocument();
    expect(within(draft).getByText('我的导入')).toBeInTheDocument();
    expect(within(draft).getByRole('link', { name: '工作稿.pptx' })).toHaveAttribute(
      'href',
      '#/office/resources/res_1/versions'
    );
    expect(screen.queryByText(/个版本/)).toBeNull(); // 版本数在版本与变化页看（D146）
    expect(within(draft).getByText('仅存档')).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('搜索文件名或标签'), { target: { value: '周报' } });
    await waitFor(() => expect(calls('GET', `q=${encodeURIComponent('周报')}`)).toHaveLength(2));
    expect(await screen.findByRole('heading', { name: '搜索“周报”' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索文件名或标签'), { target: { value: '不存在的词' } });
    expect(await screen.findByText('没有名称或标签匹配的资料')).toBeInTheDocument();
    // D146：名字匹配的标签列在结果上方（全路径），点一下进入该标签
    fireEvent.change(screen.getByLabelText('搜索文件名或标签'), { target: { value: '风险' } });
    const hits = await screen.findByTestId('mycowork-hit-tags');
    fireEvent.click(within(hits).getByText('项目 / 风险'));
    await waitFor(() => expect(calls('GET', 'tag_id=tag_c')).toHaveLength(2));
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
    fireEvent.click(screen.getByRole('button', { name: '存为智能分组' }));
    fireEvent.change(await screen.findByLabelText('分组名'), { target: { value: '我的风险' } });
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

  it('nav groups stay collapsed; old internal width is ignored because the native sidebar owns resizing', async () => {
    bridge();
    const first = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const tagsHeader = () =>
      screen.getByText('标签', { selector: '.arco-collapse-item-header *' }).closest('.arco-collapse-item-header');
    fireEvent.click(tagsHeader() as HTMLElement);
    await waitFor(() =>
      expect(JSON.parse(String(localStorage.getItem('mycowork.resources.nav'))).open).not.toContain('tags')
    );
    expect(screen.queryByRole('separator')).toBeNull();
    localStorage.setItem('mycowork.resources.nav', JSON.stringify({ width: 200, open: ['sources', 'views'] }));
    first.unmount();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(screen.queryByRole('separator')).toBeNull();
    expect(tagsHeader()).toHaveAttribute('aria-expanded', 'false');
  });

  it('portal navigation shares the main query and closes only the mobile drawer after choosing results', async () => {
    bridge();
    const collapse = vi.fn();
    const { container } = render(
      <LayoutContext.Provider value={{ isMobile: true, siderCollapsed: false, setSiderCollapsed: collapse }}>
        <aside id='mycowork-space-sider' />
        <div onClick={() => collapse(true)}>
          <OfficeResourcesSlot />
        </div>
      </LayoutContext.Provider>
    );
    await screen.findByText('周报.md');
    const host = container.querySelector('#mycowork-space-sider') as HTMLElement;
    expect(within(host).getByTestId('mycowork-resource-nav')).toBeInTheDocument();
    expect(within(screen.getByTestId('mycowork-resources')).queryByTestId('mycowork-resource-nav')).toBeNull();
    fireEvent.click(within(host).getByText('知识库', { selector: '.arco-collapse-item-header *' }));
    expect(collapse).not.toHaveBeenCalled();
    fireEvent.click(within(host).getByText('知识库', { selector: '.arco-collapse-item-header *' }));
    fireEvent.click(within(host).getByRole('button', { name: '搜索空间' }));
    expect(collapse).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('搜索文件名或标签'), { target: { value: '周报' } });
    fireEvent.keyDown(within(dialog).getByLabelText('搜索文件名或标签'), { key: 'Enter', isComposing: true });
    expect(collapse).not.toHaveBeenCalled();
    await waitFor(() => expect(calls('GET', `q=${encodeURIComponent('周报')}`)).toHaveLength(2));
    expect(within(screen.getByTestId('mycowork-resources')).getByLabelText('搜索文件名或标签')).toHaveValue('周报');
    fireEvent.click(within(dialog).getByRole('button', { name: '查看结果' }));
    expect(collapse).toHaveBeenCalledWith(true);
    fireEvent.click(within(host).getByTestId('mycowork-nav-imports'));
    await waitFor(() => expect(calls('GET', 'origin=imports&page=1')).toHaveLength(1));
    expect(within(screen.getByTestId('mycowork-resources')).getByLabelText('搜索文件名或标签')).toHaveValue('');
    expect(screen.queryByRole('button', { name: '全部' })).toBeNull();
    expect(screen.queryByRole('button', { name: '回收站' })).toBeNull();
  });

  it('the new menu opens existing tag creation; a conflict keeps the dialog and draft', async () => {
    bridge({ createTagStatus: 409 });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const nav = screen.getByTestId('mycowork-resource-nav');
    fireEvent.click(within(nav).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('新标签名'), { target: { value: '重复标签' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/tags')).toEqual({ name: '重复标签' });
    expect(within(dialog).getByLabelText('新标签名')).toHaveValue('重复标签');
    expect(await within(dialog).findByText('已有同名标签，请换个名字')).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('the header and sidebar share one tag dialog; composing Enter does not create a tag', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const header = screen.getByTestId('mycowork-resources').querySelector('header') as HTMLElement;
    expect(within(header).getByRole('heading', { name: '最近' })).toBeInTheDocument();
    fireEvent.click(within(header).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText('新标签名');
    fireEvent.change(name, { target: { value: '页头标签' } });
    fireEvent.keyDown(name, { key: 'Enter', isComposing: true });
    expect(calls('POST', '/bridge/v1/tags')).toHaveLength(0);
    fireEvent.keyDown(name, { key: 'Enter', isComposing: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1);
    expect(bodyOf('POST', '/tags')).toEqual({ name: '页头标签' });
    fireEvent.click(within(screen.getByTestId('mycowork-resource-nav')).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByLabelText('新标签名')).toHaveValue('');
  });

  it('tag creation waits for its response without closing, editing or submitting twice', async () => {
    let finish!: () => void;
    bridge({
      createTagStatus: 409,
      createTagWait: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const header = screen.getByTestId('mycowork-resources').querySelector('header') as HTMLElement;
    fireEvent.click(within(header).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText('新标签名');
    fireEvent.change(name, { target: { value: '保留创建草稿' } });
    const create = within(dialog).getByRole('button', { name: '新建' });
    fireEvent.click(create);
    expect(name).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(create);
    expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1);
    await act(async () => finish());
    expect(await within(dialog).findByText('已有同名标签，请换个名字')).toBeVisible();
    expect(name).toHaveValue('保留创建草稿');
    expect(name).toBeEnabled();
  });

  it('tag creation from the mobile portal keeps navigation open while using the dialog', async () => {
    bridge();
    const collapse = vi.fn();
    const { container } = render(
      <LayoutContext.Provider value={{ isMobile: true, siderCollapsed: false, setSiderCollapsed: collapse }}>
        <aside id='mycowork-space-sider' />
        <div onClick={() => collapse(true)}>
          <OfficeResourcesSlot />
        </div>
      </LayoutContext.Provider>
    );
    await screen.findByText('周报.md');
    const host = container.querySelector('#mycowork-space-sider') as HTMLElement;
    fireEvent.click(within(host).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('新标签名'));
    fireEvent.change(within(dialog).getByLabelText('新标签名'), { target: { value: '手机创建' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1));
    expect(collapse).not.toHaveBeenCalled();
  });

  it('header search keeps an IME-cancelling Escape and clears an ordinary Escape', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const header = screen.getByTestId('mycowork-resources').querySelector('header') as HTMLElement;
    const input = within(header).getByLabelText('搜索文件名或标签');
    fireEvent.change(input, { target: { value: '组合输入' } });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(input).toHaveValue('组合输入');
    fireEvent.keyDown(input, { key: 'Escape', isComposing: false });
    expect(input).toHaveValue('');
  });

  it('a smart group keeps condition editing and uses management for two-step deletion (D143)', async () => {
    bridge({
      views: [
        {
          view_id: 'view_1',
          name: '风险视图',
          filter: { tag_ids: ['tag_c'], include_descendants: true, source_ids: ['src_q'] },
          layout: 'list',
          revision: 5,
          missing_tag_ids: [],
        },
      ],
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(screen.getByText('智能分组')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '管理智能分组' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '编辑分组' }));
    const name = await screen.findByLabelText('分组名');
    expect(name).toHaveValue('风险视图');
    fireEvent.change(name, { target: { value: '青禾风险' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/saved-views/view_1')).toHaveLength(1));
    expect(bodyOf('PATCH', '/saved-views/view_1')).toEqual({
      expected_revision: 5,
      name: '青禾风险',
      filter: { tag_ids: ['tag_c'], source_ids: ['src_q'], include_descendants: true },
    });
    // 选中一个智能分组时，标题区也有“编辑分组”（负责人第 1 条：找得到编辑入口）
    fireEvent.click(screen.getByTestId('mycowork-nav-view-view_1'));
    fireEvent.click(await screen.findByRole('button', { name: '编辑分组' }));
    expect(await screen.findByLabelText('分组名')).toHaveValue('青禾风险');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '管理智能分组' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除“青禾风险”' }));
    expect(await screen.findByText('只删除这个分组本身；里面的文件、标签与知识库都不受影响。')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1) as HTMLElement);
    await waitFor(() => expect(calls('DELETE', '/bridge/v1/saved-views/view_1')).toHaveLength(1));
  });

  it('management renames with the revision, refreshes the label and offers child creation with the chosen parent', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    const manager = await screen.findByRole('dialog');
    fireEvent.click(within(manager).getByRole('button', { name: '改名“风险”' }));
    fireEvent.change(within(manager).getByLabelText('改名“风险”'), { target: { value: '新风险' } });
    fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/tags/tag_c')).toHaveLength(1));
    expect(bodyOf('PATCH', '/tags/tag_c')).toEqual({ expected_revision: 3, name: '新风险' });
    await within(manager).findByRole('button', { name: '改名“新风险”' });
    expect(screen.getByTestId('mycowork-nav-tag-tag_c')).toHaveTextContent('新风险');
    fireEvent.click(within(manager).getByRole('button', { name: '为“项目”添加子标签' }));
    const child = await screen.findByLabelText('新标签名');
    fireEvent.change(child, { target: { value: '子类' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '新建' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1));
    expect(bodyOf('POST', '/tags')).toEqual({ name: '子类', parent_id: 'tag_p' });
  });

  it('management retains rename input and conflict notice after stale revision', async () => {
    bridge({ tagPatchStatus: 409 });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    const manager = await screen.findByRole('dialog');
    fireEvent.click(within(manager).getByRole('button', { name: '改名“风险”' }));
    const input = within(manager).getByLabelText('改名“风险”');
    fireEvent.change(input, { target: { value: '保留草稿' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(calls('PATCH', '/bridge/v1/tags/tag_c')).toHaveLength(0);
    fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
    expect(await within(manager).findByText('已被其他地方修改，已重新读取，请再操作一次')).toBeVisible();
    expect(input).toHaveValue('保留草稿');
  });

  it.each([404, 409])('tag deletion %s keeps the second confirmation and failure notice', async (status) => {
    bridge({ tagDeleteStatus: status });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除“风险”' }));
    expect(calls('DELETE', '/bridge/v1/tags/tag_c')).toHaveLength(0);
    const confirm = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(calls('DELETE', '/bridge/v1/tags/tag_c')).toHaveLength(1));
    await waitFor(() => expect(within(confirm).getByRole('alert')).toBeVisible());
    if (status === 409) expect(within(confirm).getByText('这个标签还有子标签，请先移动或删除子标签。')).toBeVisible();
    if (status === 404) expect(within(confirm).getByText('这项内容已不可用，请刷新页面后重试。')).toBeVisible();
    expect(confirm).toBeVisible();
    expect(screen.getAllByTestId('mycowork-resource-item')).toHaveLength(2);
  });

  it('pending deletion cannot close or submit again, and failure preserves its confirmation', async () => {
    let finish!: () => void;
    bridge({
      tagDeleteStatus: 409,
      tagDeleteWait: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除“风险”' }));
    const confirm = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    const remove = within(confirm).getByRole('button', { name: '删除' });
    fireEvent.click(remove);
    expect(within(confirm).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(within(confirm).getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.keyDown(confirm, { key: 'Escape', keyCode: 27 });
    const mask = confirm.closest('.arco-modal-wrapper') as HTMLElement;
    fireEvent.mouseDown(mask);
    fireEvent.click(mask);
    fireEvent.click(remove);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(confirm).toBeVisible();
    expect(calls('DELETE', '/bridge/v1/tags/tag_c')).toHaveLength(1);
    await act(async () => finish());
    expect(await within(confirm).findByText('这个标签还有子标签，请先移动或删除子标签。')).toBeVisible();
    expect(within(confirm).getByRole('button', { name: 'Close' })).toBeVisible();
    expect(calls('DELETE', '/bridge/v1/tags/tag_c')).toHaveLength(1);
  });

  it('cancelling child creation resets the parent when adding a top-level tag', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '为“项目”添加子标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(screen.getByTestId('mycowork-resource-nav')).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    fireEvent.change(await screen.findByLabelText('新标签名'), { target: { value: '顶层' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '新建' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1));
    expect(bodyOf('POST', '/tags')).toEqual({ name: '顶层' });
  });

  it('deleting the selected tag refreshes navigation and returns to Recent while resource rows stay', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-tag-tag_c'));
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除“风险”' }));
    fireEvent.click(within(screen.getAllByRole('dialog').at(-1) as HTMLElement).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByTestId('mycowork-nav-tag-tag_c')).toBeNull());
    expect(screen.getByTestId('mycowork-nav-recent')).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByTestId('mycowork-resource-item')).toHaveLength(2);
  });

  it('renames an invalid smart group without resending its filter or altering missing tags', async () => {
    const filter = { tag_ids: ['deleted_tag'], include_descendants: false, source_ids: ['src_q'] };
    bridge({
      views: [
        { view_id: 'view_bad', name: '旧分组', filter, layout: 'list', revision: 7, missing_tag_ids: ['deleted_tag'] },
      ],
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理智能分组' }));
    const manager = await screen.findByRole('dialog');
    fireEvent.click(within(manager).getByRole('button', { name: '改名“旧分组”' }));
    fireEvent.change(within(manager).getByLabelText('改名“旧分组”'), { target: { value: '新分组' } });
    fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/saved-views/view_bad')).toHaveLength(1));
    expect(bodyOf('PATCH', '/saved-views/view_bad')).toEqual({ expected_revision: 7, name: '新分组' });
    await within(manager).findByRole('button', { name: '改名“新分组”' });
    expect(within(manager).getByText(/分组引用的标签已删除/)).toBeVisible();
  });

  it('condition editing preserves exact tag matching instead of adding descendants implicitly', async () => {
    bridge({
      views: [
        {
          view_id: 'view_strict',
          name: '严格分组',
          filter: { tag_ids: ['tag_c'], include_descendants: false, source_ids: ['src_q'] },
          layout: 'list',
          revision: 8,
          missing_tag_ids: [],
        },
      ],
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理智能分组' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '编辑分组' }));
    expect(await screen.findByLabelText('带这些标签的文件（任一，不含子标签）')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('分组名'), { target: { value: '改名仍严格' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/saved-views/view_strict')).toHaveLength(1));
    expect(bodyOf('PATCH', '/saved-views/view_strict')).toEqual({
      expected_revision: 8,
      name: '改名仍严格',
      filter: { tag_ids: ['tag_c'], source_ids: ['src_q'], include_descendants: false },
    });
  });

  it('shows at most two tags plus "+N"; an archive-only item offers "add to a knowledge base" (D145, D146)', async () => {
    bridge({ tags3: true });
    render(<OfficeResourcesSlot />);
    const draft = (await screen.findByText('工作稿.pptx')).closest(
      '[data-testid="mycowork-resource-item"]'
    ) as HTMLElement;
    const chips = within(draft).getByTestId('mycowork-item-tags');
    expect(within(chips).getAllByText(/^(项目|风险|第三个)$/)).toHaveLength(2);
    expect(within(chips).getByText('+1')).toBeInTheDocument();
    fireEvent.click(within(draft).getByRole('button', { name: '更多操作 工作稿.pptx' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '去版本页加入知识库…' }));
    expect(window.location.hash).toBe('#/office/resources/res_1/versions');
  });

  it('a knowledge base filtered by tags lists base ∩ tags, saves a smart group limited to it, and asks with it (D144)', async () => {
    bridge();
    render(
      <>
        <OfficeResourcesSlot />
        <ScopeChip lang='zh-CN' />
      </>
    );
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_q'));
    await screen.findByRole('heading', { name: '青禾库' });
    fireEvent.click(document.querySelector('.mcw-rc-tagfilter') as HTMLElement);
    fireEvent.click(await screen.findByText('风险', { selector: '.arco-tree-select-popup *' }));
    await waitFor(() => expect(calls('GET', 'source_id=src_q&tag_id=tag_c&page=1')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '存为智能分组' }));
    fireEvent.change(await screen.findByLabelText('分组名'), { target: { value: '青禾里的风险' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/saved-views')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/saved-views')).toEqual({
      name: '青禾里的风险',
      filter: { tag_ids: ['tag_c'], source_ids: ['src_q'] },
      layout: 'list',
    });
    const ask = screen.getByRole('link', { name: /用这些资料提问/ });
    expect(ask).toHaveAttribute('href', '#/guid');
    fireEvent.click(ask);
    expect(await screen.findByRole('button', { name: '资料范围：青禾库（按标签）' })).toBeInTheDocument();
  });

  it('no resources: the empty state leads to the import page', async () => {
    bridge({ empty: true });
    render(<OfficeResourcesSlot />);
    expect(await screen.findByText('最近没有变化的资料')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /导入资料/ });
    expect(links.every((a) => a.getAttribute('href') === '#/office/imports')).toBe(true);
    expect(links).toHaveLength(1); // 空状态保留直接引导，页头统一用新建菜单
    const header = screen.getByTestId('mycowork-resources').querySelector('header') as HTMLElement;
    fireEvent.click(within(header).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '上传文件' }));
    expect(window.location.hash).toBe('#/office/imports');
  });
});
