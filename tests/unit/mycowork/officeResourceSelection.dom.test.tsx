/**
 * [mycowork] 文件：officeResourceSelection.dom.test.tsx（adapted统一查询fixture）
 * 职责：真实空间控件的明确ID选择、批量标签预览与乐观锁/部分失败恢复。
 * 边界：只替换Bridge HTTP；Arco、选择状态与原生Slot均实用，不调用上游或模型。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';

// 空间页按登录账号取“来源对话”名称：这里只替掉 AionUi 的登录上下文，账号固定为已登录
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'fixture-account' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => vi.fn(),
}));
const fetchMock = vi.fn();
const tag = (id: string, name: string) => ({
  tag_id: id,
  name,
  parent_id: null,
  namespace: 'platform',
  aliases: [],
  revision: 1,
  updated_at: '2026-10-01T00:00:00Z',
});
const tags = [tag('tag_keep', '原标签'), tag('tag_new', '新标签'), tag('tag_other', '其他标签')];
const response = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => structuredClone(body),
});
type Meta = { resource_id: string; metadata_revision: number; tag_ids: string[]; secret: boolean };
let metadata: Record<string, Meta>,
  blockedRead: string | undefined,
  delayPatch: Promise<void> | undefined,
  total = 2;
let savedView: {
  view_id: string;
  name: string;
  filter: { tag_ids: string[] };
  layout: string;
  revision: number;
  missing_tag_ids: string[];
};
function updateLayout(init?: RequestInit) {
  const patch = JSON.parse(String(init?.body));
  expect(patch.expected_revision).toBe(savedView.revision);
  savedView = { ...savedView, layout: patch.layout, revision: savedView.revision + 1 };
  return response(200, savedView);
}
const file = (id: string, name: string, source: string | null) => ({
  resource_id: id,
  file_name: name,
  source_id: source,
  origin: source ? 'knowledge_base' : 'imports',
  state: source ? 'ready' : 'stored',
  tag_ids: metadata[id].tag_ids,
  secret: metadata[id].secret,
  can_mark_secret: true,
  updated_at: '2026-10-01T00:00:00Z',
  revision_count: 1,
});
function fixture() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET',
      path = String(url).split('?')[0];
    if (path === '/bridge/v1/scopes')
      return response(200, {
        sources: [
          {
            source_id: 'src_kb',
            name: '虚构库',
            provider: 'weknora',
            counts: { total, ready: total, indexing: 0, failed: 0, unavailable: 0 },
          },
        ],
        projects: [],
      });
    if (path === '/bridge/v1/tags') return response(200, { tags });
    if (path === '/bridge/v1/saved-views') return response(200, { views: [savedView] });
    if (path === '/bridge/v1/saved-views/view_batch' && method === 'PATCH') return updateLayout(init);
    if (path === '/bridge/v1/collections') return response(200, { collections: [] });
    if (path === '/bridge/v1/resources') {
      const q = new URLSearchParams(String(url).split('?')[1]);
      let items =
        q.get('origin') === 'imports'
          ? [file('res_i', '导入.md', null)]
          : q.get('page') === '2'
            ? [file('res_c', 'C.md', 'src_kb')]
            : [
                file('res_a', 'A.md', 'src_kb'),
                file('res_b', 'B.md', 'src_kb'),
                ...(q.has('source_id') ? [] : [file('res_i', '导入.md', null)]),
              ];
      if (q.has('q')) items = items.filter((r) => r.file_name.includes(q.get('q')!));
      if (q.has('view_id')) items = items.filter((r) => r.tag_ids.includes('tag_keep'));
      return response(200, {
        items,
        page: Number(q.get('page') ?? 1),
        page_size: 50,
        total: q.has('source_id') ? total : q.get('origin') === 'all' && !q.has('view_id') ? total + 1 : items.length,
      });
    }
    const match = path.match(/^\/bridge\/v1\/resources\/(res_[a-z])\/metadata$/);
    if (match) {
      const id = match[1],
        meta = metadata[id];
      if (method === 'GET')
        return id === blockedRead
          ? response(404, { error: { code: 'NOT_FOUND', message: 'fixture' } })
          : response(200, meta);
      if (delayPatch) await delayPatch;
      const body = JSON.parse(String(init?.body));
      if (body.expected_metadata_revision !== meta.metadata_revision)
        return response(409, { error: { code: 'REVISION_CONFLICT', message: 'fixture' } });
      meta.tag_ids = [...new Set(meta.tag_ids.filter((t) => !body.tags.remove.includes(t)).concat(body.tags.add))];
      meta.metadata_revision += 1;
      return response(200, meta);
    }
    return response(404, { error: { code: 'NOT_FOUND', message: 'unexpected fixture request' } });
  });
}
const calls = (method: string, id?: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => (init?.method ?? 'GET') === method && String(url).endsWith(id ? `/${id}/metadata` : '/metadata')
  );
const body = (id: string, at = 0) => JSON.parse(String(calls('PATCH', id)[at][1].body));
const pick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `选择 ${name}`, exact: true }));
async function openBulk(names = ['A.md', 'B.md']) {
  for (const name of names) pick(name);
  fireEvent.click(screen.getByRole('button', { name: '批量编辑标签' }));
  const dialog = await screen.findByRole('dialog', { name: '批量编辑标签' });
  await waitFor(() => expect(calls('GET')).toHaveLength(names.length));
  return dialog;
}
async function choose(dialog: HTMLElement, name = '新标签') {
  fireEvent.click(within(dialog).getByLabelText('选择要增删的标签'));
  const option = await screen.findByRole('option', { name, exact: true });
  fireEvent.click(within(option).getByText(name));
}
beforeEach(() => {
  savedView = {
    view_id: 'view_batch',
    name: '虚构分组',
    filter: { tag_ids: ['tag_keep'] },
    layout: 'list',
    revision: 1,
    missing_tag_ids: [],
  };
  localStorage.clear();
  fetchMock.mockReset();
  blockedRead = undefined;
  delayPatch = undefined;
  total = 2;
  metadata = Object.fromEntries(
    ['i', 'a', 'b', 'c'].map((id, i) => [
      `res_${id}`,
      {
        resource_id: `res_${id}`,
        metadata_revision: i + 2,
        tag_ids: [id === 'b' ? 'tag_other' : 'tag_keep'],
        secret: id === 'a',
      },
    ])
  );
  vi.stubGlobal('fetch', fetchMock);
  fixture();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('space selection and batch tags', () => {
  it('saved-view layout updates retain selection and advance the view revision without reloading resources', async () => {
    render(<OfficeResourcesSlot />);
    await screen.findByRole('link', { name: 'A.md' });
    fireEvent.click(screen.getByTestId('mycowork-nav-view-view_batch'));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'B.md' })).toBeNull());
    pick('A.md');
    const reads = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/bridge/v1/resources?')).length;
    const before = reads();
    fireEvent.click(screen.getByLabelText('网格'));
    await waitFor(() => expect(document.querySelector('.mcw-rc-grid')).not.toBeNull());
    expect(screen.getByRole('checkbox', { name: '选择 A.md' })).toBeChecked();
    fireEvent.click(screen.getByLabelText('列表'));
    await waitFor(() => expect(savedView.layout).toBe('list'));
    expect(screen.getByRole('checkbox', { name: '选择 A.md' })).toBeChecked();
    expect(savedView.revision).toBe(3);
    expect(reads()).toBe(before);
  });
  it('selects only this visible page, preserves layout switches, and clears query changes without resurrecting IDs', async () => {
    total = 60;
    render(<OfficeResourcesSlot />);
    await screen.findByRole('link', { name: 'A.md' });
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_kb'));
    await waitFor(() => expect(screen.queryByRole('link', { name: '导入.md' })).toBeNull());
    expect(screen.getByText('用这些资料提问')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择本页' }));
    expect(screen.getByText('已选 2 项')).toBeInTheDocument();
    expect(screen.queryByText('用这些资料提问')).toBeNull();
    fireEvent.click(screen.getByLabelText('网格'));
    expect(screen.getByRole('checkbox', { name: '选择 A.md' })).toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索文件名或标签' }), { target: { value: 'A' } });
    expect(screen.queryByRole('region', { name: '所选资料的操作' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索文件名或标签' }), { target: { value: '' } });
    expect(await screen.findByRole('checkbox', { name: '选择 A.md' })).not.toBeChecked();
    expect(screen.getByText('用这些资料提问')).toBeInTheDocument();
    expect(calls('PATCH')).toHaveLength(0);
  });
  it('changing page clears a selected file rather than selecting the next page or whole knowledge base', async () => {
    total = 60;
    render(<OfficeResourcesSlot />);
    await screen.findByRole('link', { name: 'A.md' });
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_kb'));
    await waitFor(() => expect(screen.queryByRole('link', { name: '导入.md' })).toBeNull());
    pick('A.md');
    fireEvent.click(screen.getByText('2', { selector: '.arco-pagination-item' }));
    await screen.findByRole('link', { name: 'C.md' });
    expect(screen.queryByRole('region', { name: '所选资料的操作' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: '选择 C.md' })).not.toBeChecked();
  });
  it('previews changes for exactly the selected IDs and cancel makes no metadata writes', async () => {
    render(<OfficeResourcesSlot />);
    await screen.findByRole('link', { name: 'A.md' });
    const dialog = await openBulk();
    await choose(dialog);
    expect(within(dialog).getByText('原标签 → 原标签 · 新标签')).toBeInTheDocument();
    expect(within(dialog).getByText('其他标签 → 其他标签 · 新标签')).toBeInTheDocument();
    expect(calls('GET', 'res_i')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('PATCH')).toHaveLength(0);
  });
  it('keeps successful results and a conflicted draft, reloads only failed items, and retries their preview revision', async () => {
    render(<OfficeResourcesSlot />);
    await screen.findByRole('link', { name: 'A.md' });
    const dialog = await openBulk();
    await choose(dialog);
    metadata.res_b.metadata_revision += 1;
    metadata.res_b.tag_ids.push('tag_keep');
    fireEvent.click(within(dialog).getByRole('button', { name: '应用预览' }));
    await within(dialog).findByText('此文件已改变，请重新读取失败项并确认预览。');
    expect(within(dialog).getByText('已完成')).toBeInTheDocument();
    expect(body('res_a')).toEqual({ expected_metadata_revision: 3, tags: { add: ['tag_new'], remove: [] } });
    expect(body('res_b')).toEqual({ expected_metadata_revision: 4, tags: { add: ['tag_new'], remove: [] } });
    expect(calls('PATCH', 'res_i')).toHaveLength(0);
    expect(metadata.res_a.secret).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: '重新读取失败项' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '应用预览' })).toBeEnabled());
    expect(calls('GET', 'res_a')).toHaveLength(1);
    expect(calls('GET', 'res_b')).toHaveLength(2);
    expect(calls('PATCH', 'res_b')).toHaveLength(1);
    expect(within(dialog).getByText('其他标签 · 原标签 → 其他标签 · 原标签 · 新标签')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '应用预览' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('PATCH', 'res_a')).toHaveLength(1);
    expect(body('res_b', 1).expected_metadata_revision).toBe(5);
    expect(metadata.res_b.tag_ids).toEqual(['tag_other', 'tag_keep', 'tag_new']);
  });
  it('removes the chosen tag only from selected files and preserves unrelated tags', async () => {
    render(<OfficeResourcesSlot />);
    await screen.findByRole('link', { name: '导入.md' });
    const dialog = await openBulk(['导入.md']);
    fireEvent.click(within(dialog).getByLabelText('移除标签'));
    await choose(dialog, '原标签');
    expect(within(dialog).getByText('原标签 → 无标签')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '应用预览' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(body('res_i')).toEqual({ expected_metadata_revision: 2, tags: { add: [], remove: ['tag_keep'] } });
    expect(metadata.res_a.tag_ids).toEqual(['tag_keep']);
    expect(calls('GET', 'res_a')).toHaveLength(0);
  });
  it('a metadata read404 prevents writes without dropping the selected file and can be reread', async () => {
    blockedRead = 'res_b';
    render(<OfficeResourcesSlot />);
    await screen.findByRole('link', { name: 'A.md' });
    const dialog = await openBulk();
    await choose(dialog);
    expect(within(dialog).getByRole('button', { name: '应用预览' })).toBeDisabled();
    expect(within(dialog).getByText('B.md')).toBeInTheDocument();
    expect(calls('PATCH')).toHaveLength(0);
    blockedRead = undefined;
    fireEvent.click(within(dialog).getByRole('button', { name: '重新读取失败项' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '应用预览' })).toBeEnabled());
    expect(calls('GET', 'res_a')).toHaveLength(1);
    expect(calls('GET', 'res_b')).toHaveLength(2);
    expect(calls('PATCH')).toHaveLength(0);
  });
  it('pending metadata writes cannot be dismissed through Close, cancel, Escape or mask', async () => {
    let release!: () => void;
    delayPatch = new Promise<void>((r) => {
      release = r;
    });
    render(<OfficeResourcesSlot />);
    await screen.findByRole('link', { name: 'A.md' });
    const dialog = await openBulk();
    await choose(dialog);
    const wrapper = document.querySelector('.arco-modal-wrapper')!;
    fireEvent.mouseDown(wrapper);
    fireEvent.click(wrapper);
    fireEvent.click(within(dialog).getByRole('button', { name: '应用预览' }));
    await waitFor(() => expect(calls('PATCH')).toHaveLength(2));
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape', keyCode: 27 });
    fireEvent.mouseDown(wrapper);
    fireEvent.click(wrapper);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(screen.getByRole('dialog', { name: '批量编辑标签' })).toBeVisible();
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
