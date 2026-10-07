/**
 * [mycowork] PR11 W4-3b。文件：tests/unit/mycowork/officeKbManage.dom.test.tsx
 * 职责：空间“知识库”标题旁的 ⚙：只有 /scopes 标了 can_manage_kbs 的人才有；新建只问名称；改名；删除两步确认（第一步写明“移出该库 N 条资料并保留原件”
 *       与“删除期间不要在 WeKnora 自带界面向该库上传”，第二步才发请求，请求体再写一次库 id）；受理后显示进度、结束后重读目录；
 *       失败按原因说明库没有删并可重试；重名、保留前缀、非 owner 等服务端拒绝给出可读提示。
 * 边界：只替换 Bridge HTTP（按 OpenAPI 的 knowledge-bases 与 knowledge-removals 形状）；Arco、弹窗与行组件均实用，不调用上游或模型。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'fixture-account' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => vi.fn(),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => structuredClone(body),
});
const counts = (total: number) => ({ total, ready: total, indexing: 0, failed: 0, unavailable: 0 });
const removal = (status: string, extra: Record<string, unknown> = {}) => ({
  removal_id: 'krm_kb',
  kind: 'knowledge_base',
  resource_id: null,
  source_id: 'src_a',
  status,
  error: null,
  archive_source_id: null,
  removed_at: null,
  created_at: '2026-10-08T00:00:00Z',
  updated_at: '2026-10-08T00:00:00Z',
  ...extra,
});
let canManage: boolean;
let sources: { source_id: string; name: string; provider: string; counts: ReturnType<typeof counts> }[];
let polls: ReturnType<typeof removal>[];
/** 写接口各自要回的失败；不设 = 正常。 */
let reject: { status: number; code: string; message?: string } | undefined;
function bridge() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url).split('?')[0];
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (path === '/bridge/v1/scopes') return reply(200, { sources, projects: [], can_manage_kbs: canManage });
    if (path === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (path === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (path === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (path === '/bridge/v1/resources') return reply(200, { items: [], page: 1, page_size: 50, total: 0 });
    if (path.startsWith('/bridge/v1/knowledge-bases')) {
      if (reject) return reply(reject.status, { error: { code: reject.code, message: reject.message ?? 'fixture' } });
      if (method === 'POST') {
        sources = [...sources, { source_id: 'src_new', name: String(body['name']), provider: 'weknora', counts: counts(0) }];
        return reply(201, { source_id: 'src_new', name: body['name'] });
      }
      if (method === 'PATCH') {
        sources = sources.map((s) => (path.endsWith(s.source_id) ? { ...s, name: String(body['name']) } : s));
        return reply(200, { source_id: path.split('/').at(-1), name: body['name'] });
      }
      if (method === 'DELETE') return reply(202, removal('queued'));
    }
    if (path === '/bridge/v1/knowledge-removals/krm_kb/retry') return reply(200, removal('queued'));
    if (path === '/bridge/v1/knowledge-removals/krm_kb') {
      const now = polls.shift() ?? removal('removed');
      if (now.status === 'removed') sources = sources.filter((s) => s.source_id !== 'src_a');
      return reply(200, now);
    }
    return reply(404, { error: { code: 'NOT_FOUND', message: 'unexpected fixture request' } });
  });
}
const sent = (method: string, suffix = '') =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).endsWith(suffix));
const LONG = { timeout: 8000 };
const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '管理知识库' }, LONG));
  await screen.findByTestId('mycowork-kb-manage', undefined, LONG);
  return manager();
};
/** 管理弹窗本身（页面上还有同名的“新建”菜单等，按钮在弹窗里找）。 */
const manager = () => within(document.querySelector('.arco-modal.mcw-manage') as HTMLElement);
const create = (name: string) => {
  fireEvent.change(manager().getByRole('textbox', { name: '新知识库的名称' }), { target: { value: name } });
  fireEvent.click(manager().getByRole('button', { name: '新建' }));
};

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  canManage = true;
  sources = [
    { source_id: 'src_a', name: '渠道库', provider: 'weknora', counts: counts(12) },
    { source_id: 'src_b', name: '财务库', provider: 'weknora', counts: counts(3) },
  ];
  polls = [];
  reject = undefined;
  vi.stubGlobal('fetch', fetchMock);
  bridge();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('.arco-modal-wrapper').forEach((n) => n.remove());
});

describe('space: knowledge base management', () => {
  it('shows the gear only when the server marks the user as able to manage knowledge bases', async () => {
    canManage = false;
    const view = render(<OfficeResourcesSlot />);
    await screen.findByText('渠道库', undefined, LONG);
    expect(screen.queryByRole('button', { name: '管理知识库' })).toBeNull();
    view.unmount();
    canManage = true;
    render(<OfficeResourcesSlot />);
    expect(await screen.findByRole('button', { name: '管理知识库' }, LONG)).toBeInTheDocument();
  });

  it('creates with only a name, renames in place, and reloads the list', async () => {
    render(<OfficeResourcesSlot />);
    const dialog = await open();
    void dialog;
    create('新建的库');
    await waitFor(() => expect(sent('POST', '/knowledge-bases')).toHaveLength(1), LONG);
    expect(JSON.parse(String(sent('POST', '/knowledge-bases')[0][1].body))).toEqual({ name: '新建的库' });
    expect(await screen.findAllByText('新建的库', undefined, LONG)).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '改名“财务库”' }));
    const input = screen.getByRole('textbox', { name: '改名“财务库”' });
    fireEvent.change(input, { target: { value: '财务资料库' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(sent('PATCH', '/knowledge-bases/src_b')).toHaveLength(1), LONG);
    expect(JSON.parse(String(sent('PATCH', '/knowledge-bases/src_b')[0][1].body))).toEqual({ name: '财务资料库' });
    expect((await screen.findAllByText('财务资料库', undefined, LONG)).length).toBeGreaterThan(0);
  });

  it('two-step delete: step one states the count, keeps the originals and warns about uploads; nothing is sent until the second step', async () => {
    polls = [removal('archiving', { progress: { total: 12, moved: 5, preserved: 1, failed: 0 } }), removal('removing')];
    render(<OfficeResourcesSlot />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '删除“渠道库”' }));
    const step1 = await screen.findByTestId('mycowork-kb-delete-step1', undefined, LONG);
    expect(step1.textContent).toContain('移出该库 12 条资料并保留原件');
    expect(step1.textContent).toContain('删除期间不要在 WeKnora 自带界面向该库上传');
    expect(sent('DELETE')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(await screen.findByTestId('mycowork-kb-delete-step2', undefined, LONG)).toBeInTheDocument();
    expect(sent('DELETE')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '删除知识库' }));
    await waitFor(() => expect(sent('DELETE', '/knowledge-bases/src_a')).toHaveLength(1), LONG);
    const req = JSON.parse(String(sent('DELETE')[0][1].body));
    expect(req.confirm_knowledge_base_id).toBe('src_a');
    expect(req.submission_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText(/正在保全资料：已处理 6\/12/, undefined, LONG)).toBeInTheDocument();
    expect(await screen.findByText(/资料都已保全，正在删除知识库/, undefined, LONG)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('渠道库')).toBeNull(), LONG);
    expect(await screen.findByTestId('mycowork-kb-task-removed', undefined, LONG)).toBeInTheDocument();
  });

  it('cancelling either step sends nothing', async () => {
    render(<OfficeResourcesSlot />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '删除“财务库”' }));
    await screen.findByTestId('mycowork-kb-delete-step1', undefined, LONG);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByTestId('mycowork-kb-delete-step1')).toBeNull(), LONG);
    fireEvent.click(screen.getByRole('button', { name: '删除“财务库”' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续' }, LONG));
    await screen.findByTestId('mycowork-kb-delete-step2', undefined, LONG);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByTestId('mycowork-kb-delete-step2')).toBeNull(), LONG);
    expect(sent('DELETE')).toHaveLength(0);
  });

  it('a failed delete says the knowledge base was not deleted and retry resumes the same task', async () => {
    polls = [removal('failed', { error: 'baseline_failed' })];
    render(<OfficeResourcesSlot />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '删除“渠道库”' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续' }, LONG));
    fireEvent.click(await screen.findByRole('button', { name: '删除知识库' }, LONG));
    const failed = await screen.findByTestId('mycowork-kb-task-failed', undefined, LONG);
    expect(failed.textContent).toContain('库没有删');
    expect(screen.getAllByText('渠道库').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(sent('POST', '/knowledge-removals/krm_kb/retry')).toHaveLength(1), LONG);
    expect(sent('DELETE')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText('渠道库')).toBeNull(), LONG);
  });

  it.each([
    [409, 'NAME_CONFLICT', undefined, '已有同名知识库'],
    [400, 'INVALID_REQUEST', undefined, '不能以 mycowork-archive- 开头'],
    [403, 'FORBIDDEN', undefined, '只有管理员能管理知识库'],
    [409, 'REMOVAL_STATE_CONFLICT', 'removal_pending', '正在删除，或其中有资料正在移出'],
    [409, 'REMOVAL_STATE_CONFLICT', 'template_kb', '模板库，不能改名或删除'],
    [503, 'UPSTREAM_UNAVAILABLE', undefined, '没有配置，或知识库服务暂时不可用'],
  ])('maps the server rejection %s %s to a readable notice and sends no further request', async (status, code, message, text) => {
    render(<OfficeResourcesSlot />);
    const dialog = await open();
    reject = { status, code, ...(message ? { message } : {}) };
    void dialog;
    create('某个名称');
    expect(await screen.findByText(new RegExp(text), undefined, LONG)).toBeInTheDocument();
    expect(sent('POST', '/knowledge-bases')).toHaveLength(1);
  });

  it('a rejected delete (403 / pending) shows the reason and does not poll', async () => {
    reject = { status: 409, code: 'REMOVAL_STATE_CONFLICT', message: 'removal_pending' };
    render(<OfficeResourcesSlot />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '删除“财务库”' }));
    fireEvent.click(await screen.findByRole('button', { name: '继续' }, LONG));
    fireEvent.click(await screen.findByRole('button', { name: '删除知识库' }, LONG));
    expect(await screen.findByText(/正在删除，或其中有资料正在移出/, undefined, LONG)).toBeInTheDocument();
    expect(sent('GET', '/knowledge-removals/krm_kb')).toHaveLength(0);
  });
});
