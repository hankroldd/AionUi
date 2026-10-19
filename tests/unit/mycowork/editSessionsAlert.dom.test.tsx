/**
 * [mycowork] PR07 R044。文件：tests/unit/mycowork/editSessionsAlert.dom.test.tsx
 * 职责：空间页“未结束的在线编辑”恢复入口：没有会话不出提示；recovery_required + editing 各列文件名与状态；
 *       “回到编辑”进入原会话的编辑页路由；“放弃”二次确认后调 discard 并从提示里移除。
 * 边界：只替换 fetch（Bridge）；路由用 location.hash（与 recovery.tsx 一致）。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'fixture-account' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/', key: 'k' }),
  useNavigate: () => vi.fn(),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const summary = (id: string, res: string, state: string) => ({
  session_id: id,
  resource_id: res,
  base_revision_id: 'rev_a',
  state,
  opened_at: 't',
  last_callback_at: null,
  last_callback_status: null,
  snapshot_count: 1,
});
const full = (id: string, res: string, state: string) => ({
  ...summary(id, res, state),
  saved_revision_id: null,
  document_server_url: 'http://127.0.0.1:28090',
  editor_config: { document: { key: 'k1' } },
  closing_at: null,
  reconcile: null,
  created_at: 't',
  updated_at: 't',
});
const NAMES: Record<string, string> = { res_a: '预算.docx', res_b: '方案.pptx' };

function bridge(initial: object[]) {
  let items = initial;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/bridge/v1/edit-sessions' && method === 'GET') return reply(200, { items, next_page: null });
    if (url === '/bridge/v1/edit-sessions' && method === 'POST') return reply(200, full('eds_b', 'res_b', 'editing'));
    const one = /^\/bridge\/v1\/edit-sessions\/(\w+)$/.exec(url);
    if (one) return reply(200, full(one[1] as string, one[1] === 'eds_a' ? 'res_a' : 'res_b', one[1] === 'eds_a' ? 'recovery_required' : 'editing'));
    if (url.endsWith('/discard')) {
      items = items.filter((i) => !url.includes(String((i as { session_id: string }).session_id)));
      return reply(200, {});
    }
    const rev = /resources\/(\w+)\/revisions/.exec(url);
    if (rev) return reply(200, { resource_id: rev[1], current_revision_id: 'rev_a', file_name: NAMES[rev[1] as string], items: [], page: 1, page_size: 50, total: 0 });
    if (url.startsWith('/bridge/v1/resources?')) return reply(200, { page: 1, page_size: 50, total: 0, items: [] });
    if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
    return reply(404, {});
  });
}
const ALERT = 'edit-sessions-alert';

describe('空间页未结束的在线编辑', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    window.location.hash = '#/office/resources';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('没有未结束的会话时不出提示', async () => {
    bridge([]);
    render(<OfficeResourcesSlot />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/bridge/v1/edit-sessions')).toBe(true));
    await waitFor(() => expect(screen.queryByTestId(ALERT)).toBeNull());
  });

  it('列出需要恢复与编辑中的两份文件及状态', async () => {
    bridge([summary('eds_a', 'res_a', 'recovery_required'), summary('eds_b', 'res_b', 'editing')]);
    render(<OfficeResourcesSlot />);
    const alert = await screen.findByTestId(ALERT);
    await within(alert).findByText('有 2 份文件的在线编辑还没结束');
    await within(alert).findByText('预算.docx');
    within(alert).getByText('需要恢复');
    within(alert).getByText('方案.pptx');
    within(alert).getByText('编辑中');
    expect(within(alert).getAllByRole('button', { name: '放弃' })).toHaveLength(1); // 只有需要恢复的给“放弃”（Bridge 不允许放弃 editing）
  });

  it('状态读取失败时给重试，重试后能找到文件', async () => {
    bridge([summary('eds_b', 'res_b', 'editing')]);
    const original = fetchMock.getMockImplementation()!;
    let failed = true;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/bridge/v1/edit-sessions' && failed) return Promise.reject(new Error('network'));
      return original(url, init);
    });
    render(<OfficeResourcesSlot />);
    const retry = await screen.findByRole('button', { name: '重试' });
    failed = false;
    fireEvent.click(retry);
    await screen.findByText('方案.pptx');
  });

  it('保存通知后重新读取，已经结束的编辑从提示里消失', async () => {
    bridge([summary('eds_b', 'res_b', 'editing')]);
    render(<OfficeResourcesSlot />);
    await screen.findByText('方案.pptx');
    bridge([]);
    fireEvent(window, new CustomEvent('mycowork:resource-changed', { detail: { resourceId: 'res_b' } }));
    await waitFor(() => expect(screen.queryByTestId(ALERT)).toBeNull());
  });

  it('刷新失败保留已知文件，并能打开版本记录', async () => {
    bridge([summary('eds_b', 'res_b', 'editing')]);
    render(<OfficeResourcesSlot />);
    await screen.findByText('方案.pptx');
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url === '/bridge/v1/edit-sessions'
      ? Promise.reject(new Error('network')) : original(url, init));
    fireEvent(window, new Event('focus'));
    await screen.findByText('暂时无法更新在线编辑状态');
    expect(screen.getByText('方案.pptx')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看版本' }).getAttribute('href')).toBe('#/office/resources/res_b/versions');
  });

  it('“回到编辑”进入该会话的编辑页', async () => {
    bridge([summary('eds_b', 'res_b', 'editing')]);
    render(<OfficeResourcesSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '回到编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit/eds_b'));
  });

  it('“放弃”确认后调 discard，条目从提示里消失', async () => {
    bridge([summary('eds_a', 'res_a', 'recovery_required')]);
    render(<OfficeResourcesSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '放弃' }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/discard'))).toBe(false); // 确认前不调
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/discard'))).toBe(true));
    await waitFor(() => expect(screen.queryByTestId(ALERT)).toBeNull());
  });
});
