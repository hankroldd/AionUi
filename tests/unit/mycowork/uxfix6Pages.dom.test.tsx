/**
 * [mycowork] PR11 验收修复（空间/版本/编辑/模板弹窗等页面，2026-10-21）：一次性 DOM 核对，放进 fork tests/unit/mycowork/ 后跑 `vitest run --project dom`（不提交到 fork）。
 * 覆盖：预览层把 {{title}}/{{subtitle}} 换成示例文字；对话预览进编辑后保存回对话；有存档副本的资料标 Secret 要写“存档库里的副本会被删除”；
 *       回收站多选后批量恢复；不存在的页面计划只有一个空态；连接页指引默认一句话。数据虚构。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { AssetPreview } from '@mycowork/ui/template-picker/AssetPreview.tsx';
import { pickerText } from '@mycowork/ui/template-picker/messages.ts';
import { goEditReturn, peekEditReturn, requestEditReturn, clearEditReturn } from '@mycowork/ui/pages/office-editor/edit-return.ts';
import { TrashPage } from '@mycowork/ui/pages/trash/index.ts';
import { OfficeCompositionSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ decisionId: 'tdec_none' }),
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => vi.fn(),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('预览占位符', () => {
  it('标题/副标题换示例文字，其余变量留空，不动其他文字', async () => {
    vi.stubGlobal('IntersectionObserver', undefined); // 没有视口观察器时挂载即请求
    const html = '<h1>{{title}}</h1><p>{{ subtitle }}</p><i>{{date}}</i>正文';
    const { container } = render(
      <AssetPreview text={pickerText('zh-CN')} assetId='a' version={1} title='模板' fetchPreview={async () => html} />
    );
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toBe(
      '<h1>标题示例</h1><p>副标题示例</p><i></i>正文'
    );
  });
});

describe('编辑后回到来源对话', () => {
  it('从对话预览进编辑：返回意图是该对话，保存后落到 #/conversation/<id>', () => {
    clearEditReturn();
    requestEditReturn({ kind: 'conversation', id: 'conv 1' });
    const to = peekEditReturn();
    expect(to).toEqual({ kind: 'conversation', id: 'conv 1' });
    goEditReturn(to!);
    expect(window.location.hash).toBe('#/conversation/conv%201');
    clearEditReturn();
  });
});

describe('空间标为 Secret', () => {
  const item = (over: object) => ({
    resource_id: 'res_1',
    file_name: '进过存档库.md',
    source_id: 'kb_1', // 当前挂在普通库，但有存档副本（storage=both）
    origin: 'knowledge_base',
    purpose: 'working',
    state: 'ready',
    storage: 'both',
    tag_ids: [],
    secret: false,
    can_mark_secret: true,
    updated_at: '2026-09-27T02:13:22.409Z',
    revision_count: 1,
    ...over,
  });
  it('有存档副本时确认框写“存档库里的副本会被删除”，不看当前挂在哪', async () => {
    const items = [item({}), item({ resource_id: 'res_2', file_name: '只在本地.md', storage: 'bridge', source_id: null })];
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url.startsWith('/bridge/v1/resources?')) return reply(200, { page: 1, page_size: 50, total: 2, items });
      if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
      if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
      if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
      return reply(404, {});
    });
    render(<ResourcesPage lang='zh-CN' />);
    await screen.findByText('进过存档库.md');
    fireEvent.click(screen.getByRole('button', { name: '更多操作 进过存档库.md' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '标为 Secret' }));
    expect(await screen.findByText(/存档库里的副本会被删除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByText(/存档库里的副本会被删除/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '更多操作 只在本地.md' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '标为 Secret' }));
    await screen.findByText(/不会进入任何 AI 上下文/);
    expect(screen.queryByText(/存档库里的副本会被删除/)).toBeNull();
  });
});

describe('回收站多选', () => {
  it('勾选两项后“恢复所选”逐项带各自 revision 恢复', async () => {
    const row = (id: string, rev: number) => ({
      resource_id: id,
      file_name: `虚构${id}.md`,
      trashed_at: '2026-10-02T00:00:00Z',
      metadata_revision: rev,
      impact: { publications: 0, memory_items: 0, collections: 0, plans: 0 },
    });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/bridge/v1/trash?'))
        return reply(200, { items: [row('a', 3), row('b', 5)], page: 1, page_size: 50, total: 2 });
      if (url.endsWith('/untrash')) return reply(200, {});
      return reply(404, {});
    });
    render(<TrashPage lang='zh-CN' onBack={vi.fn()} />);
    await screen.findByText('虚构a.md');
    expect(screen.queryByText('恢复所选')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 虚构a.md' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 虚构b.md' }));
    expect(screen.getByText('已选 2 项')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '恢复所选' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/untrash'))).toHaveLength(2));
    const bodies = fetchMock.mock.calls
      .filter(([u]) => String(u).endsWith('/untrash'))
      .map(([, init]) => JSON.parse(String(init?.body)).expected_metadata_revision);
    expect(bodies).toEqual([3, 5]);
  });
});

describe('不存在的页面计划', () => {
  beforeEach(() => fetchMock.mockReset());
  it('只显示一个空态和“返回首页”，不叠“正在读取”与错误码', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async () => reply(404, { error: { code: 'NOT_FOUND' } }));
    render(<OfficeCompositionSlot />);
    expect(await screen.findByText('找不到这个页面计划，可能已被删除。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NOT_FOUND|正在读取/);
  });
});
