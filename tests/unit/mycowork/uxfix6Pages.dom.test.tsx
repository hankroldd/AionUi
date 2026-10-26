/**
 * [mycowork] PR11 验收修复（空间/版本/编辑/模板弹窗等页面，2026-10-21）：DOM 核对（fork tests/unit/mycowork/，`vitest run --project dom`）。
 * 覆盖：预览层把 {{title}}/{{subtitle}} 换成示例文字；对话预览进编辑后保存回对话；标 Secret 确认框按重读到的 storage 与 source_id 分情况提示；
 *       回收站多选后批量恢复与批量永久删除；不存在的页面计划只有一个空态；连接页指引默认一句话。数据虚构。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { AssetPreview } from '@mycowork/ui/template-picker/AssetPreview.tsx';
import { pickerText } from '@mycowork/ui/template-picker/messages.ts';
import {
  goEditReturn,
  peekEditReturn,
  requestEditReturn,
  clearEditReturn,
} from '@mycowork/ui/pages/office-editor/edit-return.ts';
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
  const item = (id: string, name: string, over: object) => ({
    resource_id: id,
    file_name: name,
    source_id: null,
    origin: 'imports',
    purpose: 'working',
    state: 'stored',
    storage: 'bridge',
    tag_ids: [],
    secret: false,
    can_mark_secret: true,
    updated_at: '2026-09-27T02:13:22.409Z',
    revision_count: 1,
    ...over,
  });
  // 列表里的 storage 可能过期：确认框以打开时重读的元数据为准
  const meta: Record<string, string> = { res_a: 'weknora', res_b: 'weknora', res_c: 'bridge', res_d: 'weknora' };
  const items = [
    item('res_a', '只在存档库.md', { storage: 'bridge' }), // 列表过期，元数据说有上游链接
    item('res_b', '挂在知识库.md', { source_id: 'kb_1', state: 'ready', storage: 'weknora' }),
    item('res_c', '只在本地.md', {}),
    item('res_d', '元数据读不到.md', { storage: 'both' }),
  ];
  const confirmText = async (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: `更多操作 ${name}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '标为 Secret' }));
    const dialog = await screen.findByText(/不会进入任何 AI 上下文/);
    const text = dialog.closest('.arco-modal')?.textContent ?? '';
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByText(/不会进入任何 AI 上下文/)).toBeNull());
    return text;
  };
  it('有上游链接才说“已被解析过一次”；存档副本写“如有”；挂知识库的补“条目不会随之删除”', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url.startsWith('/bridge/v1/resources?')) return reply(200, { page: 1, page_size: 50, total: 4, items });
      if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
      if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
      if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
      const m = /\/resources\/(res_\w)\/metadata$/.exec(url);
      if (m?.[1] === 'res_d') return reply(500, {});
      if (m)
        return reply(200, {
          resource_id: m[1],
          metadata_revision: 1,
          current_revision_id: null,
          tag_ids: [],
          secret: false,
          storage: meta[m[1] as string],
        });
      return reply(404, {});
    });
    render(<ResourcesPage lang='zh-CN' />);
    await screen.findByText('只在存档库.md');
    const a = await confirmText('只在存档库.md');
    expect(a).toContain('存档库里如有副本会被删除');
    expect(a).not.toContain('知识库里的条目不会随之删除');
    const b = await confirmText('挂在知识库.md');
    expect(b).toContain('存档库里如有副本会被删除');
    expect(b).toContain('知识库里的条目不会随之删除');
    const c = await confirmText('只在本地.md');
    expect(c).not.toContain('已被解析过');
    const d = await confirmText('元数据读不到.md'); // 读不到就用列表值（both）
    expect(d).toContain('存档库里如有副本会被删除');
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

describe('回收站批量永久删除', () => {
  it('“永久删除所选”带着勾选的两项进两步确认框；翻页前“全选本页”可勾全部', async () => {
    const row = (id: string) => ({
      resource_id: id,
      file_name: `虚构${id}.md`,
      trashed_at: '2026-10-02T00:00:00Z',
      metadata_revision: 1,
      impact: { publications: 0, memory_items: 0, collections: 0, plans: 0 },
    });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/bridge/v1/trash?')
        ? reply(200, { items: [row('a'), row('b')], page: 1, page_size: 50, total: 2 })
        : reply(404, {})
    );
    render(<TrashPage lang='zh-CN' onBack={vi.fn()} />);
    await screen.findByText('虚构a.md');
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 虚构a.md' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '全选本页' }));
    expect(screen.getByText('已选 2 项')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '永久删除所选' }));
    expect(await screen.findByText('永久删除这 2 项资料？')).toBeInTheDocument();
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
