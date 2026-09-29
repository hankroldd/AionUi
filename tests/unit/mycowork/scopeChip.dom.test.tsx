/**
 * [mycowork] ADR-0011: scope chip + centered picker dialog from @mycowork/ui (MyCowork packages/ui; D144 dialog since 2026-09-29).
 * Only the Bridge boundary (fetch) is mocked. Covers counts copy, apply, cancel-keeps-selection,
 * the unauthenticated / unavailable / no-source states (MyCowork PR03 spec §6 items 3, 11), and D144 narrowing:
 * search box filters knowledge bases, a knowledge base narrowed by tags shows the match count (0 = says it never falls back
 * to the whole base), picking files keeps only the checked ones, smart groups can be chosen.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Same as renderer/main.tsx: Arco's global Message needs the React 19 adapter (tests load the CJS lib build).
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ScopeChip, setScopeSelection } from '@mycowork/ui';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = (total: number, ready: number, indexing: number) => ({
  total,
  ready,
  indexing,
  failed: 0,
  unavailable: 0,
});
const CATALOG = {
  sources: [
    { source_id: 'src_a', name: '产品知识库', provider: 'weknora', counts: counts(12, 8, 4) },
    { source_id: 'src_b', name: '项目A资料', provider: 'weknora', counts: counts(3, 3, 0) },
  ],
  projects: [],
};

const TAGS = [
  {
    tag_id: 'tag_shop',
    name: '2026电商',
    parent_id: null,
    namespace: 'platform',
    aliases: [],
    revision: 1,
    updated_at: 't',
  },
  {
    tag_id: 'tag_rival',
    name: '竞品',
    parent_id: 'tag_shop',
    namespace: 'platform',
    aliases: [],
    revision: 1,
    updated_at: 't',
  },
];
const VIEWS = [
  {
    view_id: 'view_1',
    name: '电商竞品',
    filter: { tag_ids: ['tag_rival'], include_descendants: true },
    layout: 'list',
    icon: '',
    position: 0,
    revision: 1,
    missing_tag_ids: [],
    updated_at: 't',
  },
];
const file = (id: string, name: string) => ({
  resource_id: id,
  file_name: name,
  state: 'ready',
  tag_ids: ['tag_rival'],
});
// Bridge 按路径应答：目录、标签、智能分组、某库（按标签）的文件；catalog 可替换
const route = (catalog: unknown = CATALOG, files = [file('res_1', '竞品周报.md'), file('res_2', '价格带.xlsx')]) =>
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/scopes') return reply(200, catalog);
    if (url === '/bridge/v1/tags') return reply(200, { tags: TAGS });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: VIEWS });
    if (url.startsWith('/bridge/v1/resources?'))
      return reply(200, { page: 1, page_size: 50, total: files.length, items: files });
    return reply(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });

const openDialog = async () => {
  fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
  await screen.findByText('选择这次可以检索的资料范围');
};
const tick = (name: string) => fireEvent.click(screen.getByText(name));
const SEARCH = '搜索知识库、智能分组（含其标签）或已展开清单里的文件名';
const NONE_CHECKED = '一份都没勾：应用时这个知识库不会加入范围';

describe('ScopeChip', () => {
  beforeEach(() => {
    setScopeSelection([]);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows "未选择" on the chip and "尚未选择" in the dialog summary before any source is chosen; the search box gets focus', async () => {
    route();
    render(<ScopeChip lang='zh-CN' />);
    expect(screen.getByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
    await openDialog();
    expect(screen.getByTestId('mycowork-scope-summary')).toHaveTextContent(/^尚未选择$/);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: SEARCH })));
    expect(fetchMock).toHaveBeenCalledWith('/bridge/v1/scopes', { credentials: 'same-origin' });
  });

  it('lists sources with partial-processing counts', async () => {
    route();
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    expect(await screen.findByText('共 12 份，8 份 AI 可引用，4 份入库中')).toBeInTheDocument();
    expect(screen.getByText('共 3 份，3 份 AI 可引用')).toBeInTheDocument();
  });

  it('applies the checked sources to this round and shows them on the chip', async () => {
    route();
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    fireEvent.click(await screen.findByText('产品知识库'));
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    expect(await screen.findByRole('button', { name: '资料范围：产品知识库' })).toBeInTheDocument();
    expect(await screen.findByText('已更新本轮范围；未修改项目默认')).toBeInTheDocument();
    // R009: applying to this turn only reads; it never writes a project binding
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it('keeps the previous selection when the dialog is cancelled', async () => {
    route();
    setScopeSelection([{ source_id: 'src_b', name: '项目A资料' }]);
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    fireEvent.click(await screen.findByText('产品知识库'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '资料范围：项目A资料' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /产品知识库/ })).toBeNull();
  });

  it('drops a previously applied source that the Bridge no longer lists', async () => {
    route({ sources: [CATALOG.sources[0]], projects: [] });
    setScopeSelection([{ source_id: 'src_revoked', name: '已撤销库' }]);
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    await screen.findByText('产品知识库');
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    expect(await screen.findByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
  });

  it('shows the re-login copy when the Bridge answers 401', async () => {
    fetchMock.mockResolvedValue(reply(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    expect(await screen.findByText('需要重新登录才能打开资料')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用到本轮' })).toBeDisabled();
  });

  it('shows unavailable with retry when the Bridge cannot be reached, then recovers', async () => {
    route();
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    expect(await screen.findByText('资料服务暂不可用，请稍后重试')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('产品知识库')).toBeInTheDocument();
  });

  it('says so when there is no source to choose', async () => {
    route({ sources: [], projects: [] });
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    expect(await screen.findByText('当前没有可选择的知识库')).toBeInTheDocument();
  });

  it('treats a malformed catalog as a failure instead of an empty list', async () => {
    fetchMock.mockResolvedValue(reply(200, { sources: [{ source_id: 'src_a' }] }));
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    expect(await screen.findByText(/资料范围处理失败/)).toBeInTheDocument();
  });

  it('is a centered dialog with a search box that filters knowledge bases by name', async () => {
    route();
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    expect(screen.getByRole('dialog')).toHaveClass('mcw-scope-modal');
    await screen.findByText('产品知识库');
    fireEvent.change(screen.getByPlaceholderText(SEARCH), { target: { value: '项目A' } });
    expect(screen.queryByText('产品知识库')).toBeNull();
    expect(screen.getByText('项目A资料')).toBeInTheDocument();
  });

  it('a knowledge base narrowed by tags shows the match count and sends only those files (D144)', async () => {
    route();
    setScopeSelection([{ source_id: 'src_a', name: '产品知识库', tag_ids: ['tag_rival'] }]);
    render(<ScopeChip lang='zh-CN' />);
    expect(screen.getByRole('button', { name: '资料范围：产品知识库（按标签）' })).toBeInTheDocument();
    await openDialog();
    expect(await screen.findByText('符合条件 2 份')).toBeInTheDocument();
    const listing = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith('/bridge/v1/resources?'));
    expect(listing).toBe('/bridge/v1/resources?source_id=src_a&page=1&tag_id=tag_rival');
  });

  it('an empty tag intersection says it never falls back to the whole knowledge base (R010)', async () => {
    route(CATALOG, []);
    setScopeSelection([{ source_id: 'src_a', name: '产品知识库', tag_ids: ['tag_rival'] }]);
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    expect(await screen.findByText(/没有同时满足的文件：发送时会提示范围为空，不会退回整个知识库/)).toBeInTheDocument();
  });

  it('picking files keeps only the checked ones; unchecking all leaves the knowledge base out', async () => {
    route();
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    tick(await screen.findByText('产品知识库').then(() => '产品知识库'));
    fireEvent.click(await screen.findByRole('button', { name: '挑选文件' }));
    expect(await screen.findByText('已勾选 2 / 2 份')).toBeInTheDocument(); // 清单读到后默认全选，再去掉一份
    tick('价格带.xlsx');
    await waitFor(() => expect(screen.getByText(/已勾选/)).toHaveTextContent('已勾选 1 / 2 份'));
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    expect(await screen.findByRole('button', { name: '资料范围：产品知识库（挑选 1 份）' })).toBeInTheDocument();
    await openDialog();
    fireEvent.click(await screen.findByRole('button', { name: '全不选' }));
    expect(screen.getByText(NONE_CHECKED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    expect(await screen.findByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
  });

  it('a knowledge base with nothing checked stays warned after the list is hidden and is not counted as selected', async () => {
    route();
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    tick(await screen.findByText('产品知识库').then(() => '产品知识库'));
    expect(screen.getByTestId('mycowork-scope-summary')).toHaveTextContent('已选 1 个知识库');
    fireEvent.click(await screen.findByRole('button', { name: '挑选文件' }));
    expect(await screen.findByText('已勾选 2 / 2 份')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全不选' }));
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByText('价格带.xlsx')).toBeNull();
    expect(screen.getByText(NONE_CHECKED)).toBeInTheDocument();
    expect(screen.getByTestId('mycowork-scope-summary')).toHaveTextContent('尚未选择（另有 1 个库一份没勾，不会加入）');
  });

  it('checked files that no longer match are dropped from the selection, so the chip never promises files it cannot send', async () => {
    route(); // 按标签只列出 res_1、res_2
    setScopeSelection([
      { source_id: 'src_a', name: '产品知识库', tag_ids: ['tag_rival'], resource_ids: ['res_2', 'res_gone'] },
      { source_id: 'src_b', name: '项目A资料', tag_ids: ['tag_rival'], resource_ids: ['res_gone'] },
    ]);
    render(<ScopeChip lang='zh-CN' />);
    expect(
      screen.getByRole('button', { name: '资料范围：产品知识库（挑选 2 份）、项目A资料（挑选 1 份）' })
    ).toBeInTheDocument();
    await openDialog();
    await waitFor(() =>
      expect(screen.getAllByText(/已勾选/).map((e) => e.textContent)).toEqual(['已勾选 1 / 2 份', '已勾选 0 / 2 份'])
    );
    expect(await screen.findByText(NONE_CHECKED)).toBeInTheDocument(); // 清掉残留勾选是下一次渲染写回的
    await waitFor(() =>
      expect(screen.getByTestId('mycowork-scope-summary')).toHaveTextContent(
        '已选 1 个知识库（另有 1 个库一份没勾，不会加入）'
      )
    );
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    expect(await screen.findByRole('button', { name: '资料范围：产品知识库（挑选 1 份）' })).toBeInTheDocument();
  });

  it('smart groups can be chosen alongside knowledge bases and show on the chip', async () => {
    route();
    render(<ScopeChip lang='zh-CN' />);
    await openDialog();
    tick(await screen.findByText('电商竞品').then(() => '电商竞品'));
    expect(screen.getByText('2026电商 / 竞品')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    expect(await screen.findByRole('button', { name: '资料范围：电商竞品' })).toBeInTheDocument();
  });

  it('clears the round selection when the chip unmounts (leaving the page)', () => {
    setScopeSelection([{ source_id: 'src_a', name: '产品知识库' }]);
    const { unmount } = render(<ScopeChip lang='zh-CN' />);
    unmount();
    render(<ScopeChip lang='en-US' />);
    expect(screen.getByRole('button', { name: 'Sources: none' })).toBeInTheDocument();
  });
});
