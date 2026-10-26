/**
 * 文件：tests/unit/mycowork/spaceHistoryReturn.dom.test.tsx
 * [mycowork] 职责：用真实空间页与 Router 复现提问后返回丢失查询现场。
 * 边界：只替换身份和 HTTP 边界；不发送模型消息，不写资源或权限。
 */
import React from 'react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetAccountScopedState } from '@mycowork/ui';
import { OfficeResourcesSlot } from '@/renderer/mycowork-office-pages';

const state = vi.hoisted(() => ({ owner: 'fixture-owner' }));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { get: { invoke: vi.fn() } } } }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: state.owner } }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => undefined }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('@/renderer/components/Markdown', () => ({ default: (): null => null }));
vi.mock('@/renderer/pages/conversation/Preview/components/editors', () => ({
  CodeEditor: (): null => null,
  MarkdownEditor: (): null => null,
}));
vi.mock('@/renderer/pages/conversation/Preview/components/viewers', () => ({ MarkdownViewer: (): null => null }));

const lists: string[] = [];
let navigate: ReturnType<typeof useNavigate>;
function LocationProbe() {
  navigate = useNavigate();
  const location = useLocation();
  return <output data-testid='route'>{location.pathname}</output>;
}
const search = () => screen.getByRole('textbox', { name: '搜索文件名或标签', exact: true });
const fileName = '验收-预算（虚构）.md';
const resource = {
  resource_id: 'res_budget',
  file_name: fileName,
  source_id: 'src_fixture',
  state: 'ready',
  origin: 'knowledge_base',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-26T00:00:00Z',
  revision_count: 1,
};
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  state.owner = 'fixture-owner';
  lists.length = 0;
  localStorage.clear();
  resetAccountScopedState();
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(String(url), 'http://fixture.invalid');
    if (parsed.pathname === '/bridge/v1/scopes')
      return response({
        sources: [
          {
            source_id: 'src_fixture',
            name: '验收库',
            provider: 'weknora',
            counts: { total: 2, ready: 2, indexing: 0, failed: 0, unavailable: 0 },
          },
        ],
        projects: [],
      });
    if (parsed.pathname === '/bridge/v1/tags') return response({ tags: [] });
    if (parsed.pathname === '/bridge/v1/saved-views') return response({ views: [] });
    if (parsed.pathname === '/bridge/v1/collections') return response({ collections: [] });
    if (parsed.pathname === '/bridge/v1/edit-sessions') return response({ items: [], next_page: null });
    if (parsed.pathname === '/bridge/v1/resources') {
      lists.push(String(url));
      return response({
        items: [resource],
        page: Number(parsed.searchParams.get('page') ?? 1),
        page_size: 1,
        total: 2,
        failed_source_ids: [],
      });
    }
    return new Response('{}', { status: 404 });
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: '/office/space', key: 'original-space' }]}>
      <Routes>
        <Route path='/office/space' element={<OfficeResourcesSlot />} />
        <Route path='/guid' element={<div>提问草稿</div>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetAccountScopedState();
});

async function filterSpace() {
  fireEvent.click(await screen.findByTestId('mycowork-nav-source-src_fixture'));
  fireEvent.change(search(), { target: { value: '验收-' } });
  fireEvent.click(screen.getByRole('combobox', { name: '类型', exact: true }));
  fireEvent.click(await screen.findByText('MD', { exact: true }));
  fireEvent.click(screen.getByRole('combobox', { name: '排序', exact: true }));
  fireEvent.click(await screen.findByText('按名称', { exact: true }));
  await waitFor(() => expect(document.querySelector('.arco-pagination-item-next')).not.toBeNull());
  fireEvent.click(document.querySelector('.arco-pagination-item-next')!);
  await waitFor(() => expect(new URL(lists.at(-1)!, 'http://fixture.invalid').searchParams.get('page')).toBe('2'));
  const scroller = document.querySelector<HTMLElement>('.mcw-rc-main')!;
  scroller.scrollTop = 120;
  fireEvent.scroll(scroller);
}

async function leaveForQuestion() {
  await filterSpace();
  fireEvent.click(await screen.findByRole('button', { name: `更多操作 ${fileName}`, exact: true }));
  fireEvent.click(await screen.findByText('用这份资料提问', { exact: true }));
  await screen.findByText('提问草稿');
  lists.length = 0;
}

it('在空间内主动进入新空间条目也清空旧条件', async () => {
  await filterSpace();
  lists.length = 0;
  await act(async () => {
    await navigate('/office/space');
  });
  await screen.findByRole('button', { name: fileName, exact: true });
  expect(search()).toHaveValue('');
  expect(new URL(lists[0]!, 'http://fixture.invalid').searchParams.get('source_id')).toBeNull();
});

it('相邻空间条目后退恢复原条目而不是后一条目的查询', async () => {
  await filterSpace();
  await act(async () => {
    await navigate('/office/space');
  });
  fireEvent.change(search(), { target: { value: '另一个' } });
  await waitFor(() => expect(lists.at(-1)).toContain(encodeURIComponent('另一个')));
  lists.length = 0;
  await act(async () => {
    await navigate(-1);
  });
  await screen.findByRole('button', { name: fileName, exact: true });
  expect(search()).toHaveValue('验收-');
  expect(new URL(lists[0]!, 'http://fixture.invalid').searchParams.get('page')).toBe('2');
});

it('从文件提问后退恢复查询、页码与滚动，首个请求就是原条件', async () => {
  await leaveForQuestion();
  await act(async () => {
    await navigate(-1);
  });
  await screen.findByRole('button', { name: fileName, exact: true });
  expect(search()).toHaveValue('验收-');
  expect(lists.map((url) => Object.fromEntries(new URL(url, 'http://fixture.invalid').searchParams))).toEqual([
    { source_id: 'src_fixture', q: '验收-', file_type: 'md', sort: 'name', page: '2' },
  ]);
  expect(document.querySelector<HTMLElement>('.mcw-rc-main')!.scrollTop).toBe(120);
});

it.each(['主动进入', '不同历史条目', '换账号', '退出登录', '过期'] as const)('%s 不恢复旧空间现场', async (mode) => {
  await leaveForQuestion();
  if (mode === '换账号') state.owner = 'fixture-other';
  if (mode === '退出登录') resetAccountScopedState();
  if (mode === '过期') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60_000);
  await act(async () => {
    if (mode === '主动进入' || mode === '不同历史条目') await navigate('/office/space');
    if (mode === '不同历史条目') {
      await navigate('/guid');
      await navigate(-1);
    }
    if (!['主动进入', '不同历史条目'].includes(mode)) await navigate(-1);
  });
  await screen.findByRole('button', { name: fileName, exact: true });
  expect(search()).toHaveValue('');
  expect(new URL(lists[0]!, 'http://fixture.invalid').searchParams.get('source_id')).toBeNull();
});
