/**
 * [mycowork] PR04 切片 e（R027，D293）。文件：tests/unit/mycowork/officeKnowledgeTransfer.dom.test.tsx
 * 职责：空间行“更多”里的“移到其他知识库”：目标库只列本人已授权的其他库（不含原库）；确认框措辞固定（含权限、向量、标签三点，不含人数）；
 *       没选目标库不发请求；受理带 target_source_id，标签写“移动中”，轮询到结束重读列表；失败按原因说明且可重试；冲突提示。
 * 边界：只替换 Bridge HTTP（按 OpenAPI 的 knowledge-removals 形状）；Arco、菜单与弹窗均实用，不调用上游或模型。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';

// A518：整页渲染用例在并发负载下会超过默认 10 s，只对本文件放宽。
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'fixture-account' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => vi.fn(),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => structuredClone(body) });
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const removal = (status: string, error: string | null = null) => ({
  removal_id: 'krm_1',
  kind: 'resource',
  resource_id: 'res_kb',
  source_id: 'src_a',
  target_source_id: 'src_b',
  status,
  error,
  archive_source_id: null,
  removed_at: null,
  created_at: '2026-10-07T00:00:00Z',
  updated_at: '2026-10-07T00:00:00Z',
});
let polls: ReturnType<typeof removal>[];
let moved: boolean;
let onlyOneSource = false;
let rejectStart: { status: number; code: string } | undefined;
function bridge() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = String(url).split('?')[0];
    if (path === '/bridge/v1/scopes')
      return reply(200, {
        sources: [
          { source_id: 'src_a', name: '甲库', provider: 'weknora', counts },
          ...(onlyOneSource ? [] : [{ source_id: 'src_b', name: '乙库', provider: 'weknora', counts }]),
        ],
        projects: [],
      });
    if (path === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (path === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (path === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (path === '/bridge/v1/resources') {
      const items = moved
        ? []
        : [
            {
              resource_id: 'res_kb',
              file_name: '可移动.md',
              source_id: 'src_a',
              origin: 'knowledge_base',
              state: 'ready',
              tag_ids: [],
              secret: false,
              can_mark_secret: true,
              can_remove_from_kb: true,
              storage: 'weknora',
              updated_at: '2026-10-01T00:00:00Z',
              revision_count: 0,
            },
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
      const now = polls.shift() ?? removal('removed');
      if (now.status === 'removed') moved = true;
      return reply(200, now);
    }
    return reply(404, { error: { code: 'NOT_FOUND', message: 'unexpected fixture request' } });
  });
}
const posts = (suffix: string) =>
  fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).endsWith(suffix));
const LONG = { timeout: 8000 };
const openMove = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '更多操作 可移动.md' }, LONG));
  fireEvent.click(await screen.findByRole('menuitem', { name: '移到其他知识库' }, LONG));
  return screen.findByTestId('mycowork-move-confirm', undefined, LONG);
};
const pick = async (name: string) => {
  fireEvent.click(within(screen.getByTestId('mycowork-move-confirm')).getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name }, LONG));
};

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  polls = [];
  moved = false;
  rejectStart = undefined;
  onlyOneSource = false;
  vi.stubGlobal('fetch', fetchMock);
  bridge();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('.arco-modal-wrapper').forEach((n) => n.remove());
});
readRetry.delays = [0, 0];

describe('space: move to another knowledge base', () => {
  it('shows fixed wording without a headcount, lists only the other knowledge bases, and does not send without a choice', async () => {
    render(<OfficeResourcesSlot />);
    const confirm = await openMove();
    expect(confirm.textContent).toContain('只被授权使用原知识库的人，移动后将检索不到这份资料');
    expect(confirm.textContent).toContain('向量直接沿用、不重新解析');
    expect(confirm.textContent).toContain('标签，需要在目标知识库重新同步');
    expect(confirm.textContent).not.toMatch(/\d+\s*(人|位)/);
    fireEvent.click(within(confirm).getByRole('combobox'));
    expect(await screen.findByRole('option', { name: '乙库' }, LONG)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '甲库' })).toBeNull(); // 原库不在候选里
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    await new Promise((ok) => setTimeout(ok, 50));
    expect(posts('/knowledge-removals')).toHaveLength(0);
  });

  it('confirm is disabled until a target is chosen', async () => {
    render(<OfficeResourcesSlot />);
    await openMove();
    expect(screen.getByRole('button', { name: '移动' })).toBeDisabled();
    await pick('乙库');
    await waitFor(() => expect(screen.getByRole('button', { name: '移动' })).toBeEnabled(), LONG);
  });

  it('with no other knowledge base, shows the hint and keeps confirm disabled', async () => {
    onlyOneSource = true;
    render(<OfficeResourcesSlot />);
    const confirm = await openMove();
    expect(within(confirm).getByTestId('mycowork-move-no-target')).toHaveTextContent('没有其他可选的知识库');
    expect(screen.getByRole('button', { name: '移动' })).toBeDisabled();
  });

  it('sends target_source_id, shows "移动中", then reloads the list when the task ends', async () => {
    polls = [removal('archiving')];
    render(<OfficeResourcesSlot />);
    await openMove();
    await pick('乙库');
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    await waitFor(() => expect(posts('/knowledge-removals')).toHaveLength(1), LONG);
    const sent = JSON.parse(String(posts('/knowledge-removals')[0][1].body));
    expect([sent.source_id, sent.target_source_id, sent.expected_metadata_revision]).toEqual(['src_a', 'src_b', 7]);
    expect(await screen.findByTestId('mycowork-removal-pending', undefined, LONG)).toHaveTextContent('移动中');
    await waitFor(() => expect(screen.queryByTestId('mycowork-removal-pending')).toBeNull(), LONG);
  });

  it('a failed move says the item is still in the original base, and retry resumes the same task', async () => {
    polls = [removal('failed', 'move_failed')];
    render(<OfficeResourcesSlot />);
    await openMove();
    await pick('乙库');
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    const failed = await screen.findByTestId('mycowork-removal-failed', undefined, LONG);
    expect(failed.textContent).toContain('仍在原知识库里，没有被删除，也没有重新上传');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(posts('/knowledge-removals/krm_1/retry')).toHaveLength(1), LONG);
    expect(posts('/knowledge-removals')).toHaveLength(1);
  });

  it('a conflict at acceptance names the move-specific reasons', async () => {
    rejectStart = { status: 409, code: 'REMOVAL_STATE_CONFLICT' };
    render(<OfficeResourcesSlot />);
    await openMove();
    await pick('乙库');
    fireEvent.click(screen.getByRole('button', { name: '移动' }));
    expect(await screen.findByText(/已在目标库里或目标库正在被删除/, undefined, LONG)).toBeInTheDocument();
  });
});
