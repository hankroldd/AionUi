/**
 * [mycowork] PR11 W4-3c。文件：tests/unit/mycowork/officeKnowledgeRemoval.dom.test.tsx
 * 职责：空间行“更多”里的“移出知识库”：只有可移出的条目有这一项；确认框写明影响与被移出的库；受理后显示“移出中”、
 *       轮询到结束重读列表；失败按原因分别说明（删除已发出但没确认的不说成“没有删除”）并可重试；受理被拒与读不到进度分开提示；
 *       标 Secret 时对只挂存档库的资料提示“存档库里的副本会被删除”。
 * 边界：只替换 Bridge HTTP（按 OpenAPI 的 knowledge-removals 形状）；Arco、菜单与弹窗均实用，不调用上游或模型。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
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
const file = (id: string, name: string, over = {}) => ({
  resource_id: id,
  file_name: name,
  source_id: 'src_kb',
  origin: 'knowledge_base',
  state: 'ready',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  can_remove_from_kb: true,
  storage: 'weknora',
  updated_at: '2026-10-01T00:00:00Z',
  revision_count: 0,
  ...over,
});
const removal = (status: string, error: string | null = null) => ({
  removal_id: 'krm_1',
  kind: 'resource',
  resource_id: 'res_kb',
  source_id: 'src_kb',
  status,
  error,
  archive_source_id: null,
  removed_at: null,
  created_at: '2026-10-07T00:00:00Z',
  updated_at: '2026-10-07T00:00:00Z',
});
/** 轮询依次得到的任务状态；removed 之后列表里不再有这份资料。 */
let polls: ReturnType<typeof removal>[];
let removed: boolean;
/** 受理（POST）与读进度（GET）各自要回的失败；不设 = 正常。 */
let rejectStart: { status: number; code: string } | undefined;
let pollStatus: number | undefined;
function bridge() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url).split('?')[0];
    if (path === '/bridge/v1/scopes')
      return reply(200, {
        sources: [
          {
            source_id: 'src_kb',
            name: '虚构库',
            provider: 'weknora',
            counts: { total: 2, ready: 2, indexing: 0, failed: 0, unavailable: 0 },
          },
        ],
        projects: [],
      });
    if (path === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (path === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (path === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (path === '/bridge/v1/resources') {
      const items = [
        ...(removed ? [] : [file('res_kb', '可移出.md')]),
        file('res_other', '别人的库.md', { can_remove_from_kb: false }),
        file('res_arch', '存档里的.md', {
          source_id: null,
          origin: 'imports',
          state: 'stored',
          storage: 'both',
          can_remove_from_kb: false,
        }),
        file('res_local', '只在本机.md', {
          source_id: null,
          origin: 'imports',
          state: 'stored',
          storage: 'bridge',
          can_remove_from_kb: false,
        }),
      ];
      return reply(200, { items, page: 1, page_size: 50, total: items.length });
    }
    if (path === '/bridge/v1/resources/res_kb/metadata')
      return reply(200, { resource_id: 'res_kb', metadata_revision: 7, tag_ids: [], secret: false });
    if (path === '/bridge/v1/resources/res_kb/knowledge-removals' && method === 'POST')
      return rejectStart
        ? reply(rejectStart.status, { error: { code: rejectStart.code, message: 'fixture' } })
        : reply(202, removal('queued'));
    if (path === '/bridge/v1/knowledge-removals/krm_1/retry' && method === 'POST') return reply(200, removal('queued'));
    if (path === '/bridge/v1/knowledge-removals/krm_1') {
      if (pollStatus) return reply(pollStatus, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'fixture' } });
      const now = polls.shift() ?? removal('removed');
      if (now.status === 'removed') removed = true;
      return reply(200, now);
    }
    return reply(404, { error: { code: 'NOT_FOUND', message: 'unexpected fixture request' } });
  });
}
const posts = (suffix: string) =>
  fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).endsWith(suffix));
// 机器忙时首屏与轮询（1.5 秒一次）都慢：等待给足，不放松断言
const LONG = { timeout: 8000 };
/** 列表里某份资料的那一行在不在：按行首的选择框认（名称是链接还是按钮随界面切片变化）。 */
const row = (name: string) => screen.queryByRole('checkbox', { name: `选择 ${name}` });
const menu = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `更多操作 ${name}` }, LONG));
  await screen.findAllByRole('menuitem', { name: '编辑标签' }, LONG);
};

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  polls = [];
  removed = false;
  rejectStart = undefined;
  pollStatus = undefined;
  vi.stubGlobal('fetch', fetchMock);
  bridge();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('.arco-modal-wrapper').forEach((n) => n.remove());
});

// 读请求的自动重试在用例里免等退避（产品默认 300/900 ms）
readRetry.delays = [0, 0];

describe('space: remove from knowledge base', () => {
  it('offers the menu item only for items the owner can remove', async () => {
    render(<OfficeResourcesSlot />);
    // 三行的菜单依次打开（Arco 的下拉层都留在文档里）：三份“编辑标签”，只有一份“移出知识库”
    const open = async (name: string, menus: number) => {
      fireEvent.click(await screen.findByRole('button', { name: `更多操作 ${name}` }, LONG));
      await waitFor(() => expect(screen.getAllByRole('menuitem', { name: '编辑标签' })).toHaveLength(menus), LONG);
      expect(screen.getAllByRole('menuitem', { name: '移出知识库' })).toHaveLength(1);
    };
    await open('可移出.md', 1);
    await open('别人的库.md', 2);
    await open('存档里的.md', 3);
  });

  it('confirms with the effects and the knowledge base name, shows progress, then reloads the list', async () => {
    polls = [removal('archiving')];
    render(<OfficeResourcesSlot />);
    await menu('可移出.md');
    fireEvent.click(screen.getByRole('menuitem', { name: '移出知识库' }));
    const confirm = await screen.findByTestId('mycowork-removal-confirm', undefined, LONG);
    expect(confirm.textContent).toContain('虚构库');
    expect(confirm.textContent).toContain('只保留原件、不再被检索；其他有权限的人也检索不到');
    expect(posts('/knowledge-removals')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '移出' }));
    await waitFor(() => expect(posts('/knowledge-removals')).toHaveLength(1), LONG);
    const sent = JSON.parse(String(posts('/knowledge-removals')[0][1].body));
    expect(sent.source_id).toBe('src_kb');
    expect(sent.expected_metadata_revision).toBe(7);
    expect(sent.submission_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByTestId('mycowork-removal-pending', undefined, LONG)).toHaveTextContent('移出中');
    expect(screen.queryByRole('button', { name: '更多操作 可移出.md' })).toBeNull();
    await waitFor(() => expect(row('可移出.md')).toBeNull(), LONG);
    expect(screen.queryByTestId('mycowork-removal-pending')).toBeNull();
    await waitFor(() => expect(row('别人的库.md')).toBeInTheDocument(), LONG);
  });

  it('a failed removal says why, keeps the item, and retry resumes the same task', async () => {
    polls = [removal('failed', 'baseline_too_large')];
    render(<OfficeResourcesSlot />);
    await menu('可移出.md');
    fireEvent.click(screen.getByRole('menuitem', { name: '移出知识库' }));
    fireEvent.click(await screen.findByRole('button', { name: '移出' }, LONG));
    const failed = await screen.findByTestId('mycowork-removal-failed', undefined, LONG);
    expect(failed.textContent).toContain('超过 50 MB');
    expect(failed.textContent).toContain('没有删除知识库里的条目');
    // 列表在提示出现后可能正重读一轮，行会短暂不在；等它回来再断言（机器忙时偶发）
    await waitFor(() => expect(row('可移出.md')).toBeInTheDocument(), LONG);
    expect(screen.queryByTestId('mycowork-removal-pending')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(posts('/knowledge-removals/krm_1/retry')).toHaveLength(1), LONG);
    expect(posts('/knowledge-removals')).toHaveLength(1);
    await waitFor(() => expect(row('可移出.md')).toBeNull(), LONG);
  });

  it('a delete that was requested but not confirmed is not described as "nothing was deleted"', async () => {
    polls = [removal('failed', 'delete_timeout')];
    render(<OfficeResourcesSlot />);
    await menu('可移出.md');
    fireEvent.click(screen.getByRole('menuitem', { name: '移出知识库' }));
    fireEvent.click(await screen.findByRole('button', { name: '移出' }, LONG));
    const failed = await screen.findByTestId('mycowork-removal-failed', undefined, LONG);
    expect(failed.textContent).toContain('删除请求也已发出');
    expect(failed.textContent).toContain('可能稍后才消失');
    expect(failed.textContent).not.toContain('没有被删除');
  });

  it('a conflict at acceptance says the file is busy; losing the progress poll neither claims failure nor stops, and the list updates itself', async () => {
    rejectStart = { status: 409, code: 'EDIT_LEASE_HELD' };
    const view = render(<OfficeResourcesSlot />);
    await menu('可移出.md');
    fireEvent.click(screen.getByRole('menuitem', { name: '移出知识库' }));
    fireEvent.click(await screen.findByRole('button', { name: '移出' }, LONG));
    expect(await screen.findByText(/正在被编辑、导入或发布/, undefined, LONG)).toBeInTheDocument();
    expect(screen.queryByTestId('mycowork-removal-pending')).toBeNull();
    // 列表在提示出现后可能正重读一轮，行会短暂不在；等它回来再断言（机器忙时偶发）
    await waitFor(() => expect(row('可移出.md')).toBeInTheDocument(), LONG);
    view.unmount();

    // 受理成功，之后读进度时网络断了：不说成“没能移出”，也不停下——退避后接着读，恢复后列表自己更新
    rejectStart = undefined;
    pollStatus = 502;
    render(<OfficeResourcesSlot />);
    await menu('可移出.md');
    fireEvent.click(screen.getAllByRole('menuitem', { name: '移出知识库' }).at(-1)!);
    fireEvent.click(await screen.findByRole('button', { name: '移出' }, LONG));
    const polled = () => fetchMock.mock.calls.filter(([url]) => /knowledge-removals\/[^/]+$/.test(String(url))).length;
    await waitFor(() => expect(polled()).toBeGreaterThan(0), LONG);
    expect(screen.queryByTestId('mycowork-removal-failed')).toBeNull();
    await screen.findByText(/正在自动重试/, undefined, LONG); // 第一次读不到就说出来，不静默空转
    pollStatus = undefined;
    await waitFor(() => expect(row('可移出.md')).toBeNull(), LONG);
    expect(screen.queryByText(/正在被编辑、导入或发布/)).toBeNull();
    expect(screen.queryByTestId('mycowork-removal-failed')).toBeNull();
  }, 30_000); // 含一次进度读失败后的退避等待（1.5 秒 + 3 秒）

  it('读进度得到 404 这类不是暂时连不上的错误：停下并提示，不再轮询', async () => {
    pollStatus = 404;
    render(<OfficeResourcesSlot />);
    await menu('可移出.md');
    fireEvent.click(screen.getAllByRole('menuitem', { name: '移出知识库' }).at(-1)!);
    fireEvent.click(await screen.findByRole('button', { name: '移出' }, LONG));
    expect(await screen.findByText(/读不到移出进度。移出仍在后台进行，刷新页面/, undefined, LONG)).toBeInTheDocument();
    const polled = () => fetchMock.mock.calls.filter(([url]) => /knowledge-removals\/[^/]+$/.test(String(url))).length;
    const n = polled();
    await new Promise((r) => setTimeout(r, 2500));
    expect(polled()).toBe(n);
  }, 30_000);

  it('the menu follows the agreed order: ... edit tags, star, remove from knowledge base, Secret, delete', async () => {
    render(<OfficeResourcesSlot />);
    await menu('可移出.md');
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
    const at = (label: string) => items.findIndex((text) => text.includes(label));
    expect(at('移出知识库')).toBeGreaterThan(at('编辑标签'));
    expect(at('移出知识库')).toBeLessThan(at('标为 Secret'));
  });

  it('marking an archived file Secret warns that its archive copy will be deleted; a local-only file does not', async () => {
    render(<OfficeResourcesSlot />);
    await menu('存档里的.md');
    fireEvent.click(screen.getAllByRole('menuitem', { name: '标为 Secret' }).at(-1)!);
    expect(await screen.findByText(/存档库里的副本会被删除/, undefined, LONG)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByText(/存档库里的副本会被删除/)).toBeNull(), LONG);
    await menu('只在本机.md');
    fireEvent.click(screen.getAllByRole('menuitem', { name: '标为 Secret' }).at(-1)!);
    await screen.findByText(/把“只在本机.md”标为 Secret？/, undefined, LONG);
    expect(screen.queryByText(/存档库里的副本会被删除/)).toBeNull();
  });
});
