/**
 * [mycowork] 文件：officeRowActions.dom.test.tsx
 * 职责：空间行“···”菜单与多选浮动条的提问 / 下载 / 删除（移入回收站）：资格、确认、写入与部分失败。
 * 边界：真实资源页与 Arco，只替换 Bridge HTTP 与 Host 导航回调；不 mock 选择与菜单逻辑。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { ResourceList } from '@mycowork/contracts';
import { ResourcesPage } from '@mycowork/ui';
import type { ScopeDraft } from '@mycowork/ui/scope-picker/index.ts';

type Item = ResourceList['items'][number];
const file = (id: string, over: Partial<Item> = {}): Item => ({
  resource_id: id,
  file_name: `${id.slice(4).toUpperCase()}.md`,
  source_id: null,
  state: 'stored',
  origin: 'imports',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-03T00:00:00Z',
  revision_count: 1,
  ...over,
});
const kb = (id: string, over: Partial<Item> = {}) =>
  file(id, { source_id: 'src_a', state: 'ready', origin: 'knowledge_base', ...over });
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fetchMock = vi.fn();
let items: Item[], failTrash: Set<string>;
const ask = vi.fn<(draft: ScopeDraft, signal: AbortSignal) => Promise<void>>(async () => {});
const calls = (method: string, suffix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith(suffix) && ((init as RequestInit | undefined)?.method ?? 'GET') === method
  );

function fixtures() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(String(url), 'http://fixture.invalid');
    const method = init?.method ?? 'GET';
    if (u.pathname === '/bridge/v1/scopes')
      return reply(200, {
        sources: [
          {
            source_id: 'src_a',
            name: '甲库',
            provider: 'weknora',
            counts: { total: 9, ready: 9, indexing: 0, failed: 0, unavailable: 0 },
          },
        ],
        projects: [],
      });
    if (u.pathname === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (u.pathname === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (u.pathname === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (u.pathname === '/bridge/v1/resources')
      return reply(200, { items, page: 1, page_size: 50, total: items.length, failed_source_ids: [] });
    const meta = /^\/bridge\/v1\/resources\/([^/]+)\/metadata$/.exec(u.pathname);
    if (meta) return reply(200, { metadata_revision: 7, tag_ids: [], secret: false });
    const trash = /^\/bridge\/v1\/resources\/([^/]+)\/trash$/.exec(u.pathname);
    if (trash && method === 'POST')
      return failTrash.has(trash[1] ?? '')
        ? reply(409, { error: { code: 'EDIT_LEASE_HELD', message: 'x' } })
        : reply(200, { resource_id: trash[1], file_name: 'x', trashed_at: '2026-10-07T00:00:00Z' });
    return reply(404, { error: { code: 'NOT_FOUND' } });
  });
}
const mount = () => render(<ResourcesPage lang='zh-CN' ownerKey='user-a' onAskScope={ask} />);
const openMenu = async (name: string) => {
  await screen.findByRole('button', { name, exact: true });
  fireEvent.click(screen.getByRole('button', { name: `更多操作 ${name}` }));
};
const pick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `选择 ${name}`, exact: true }));
const bar = () => screen.getByRole('region', { name: '所选资料的操作' });
const confirmDialog = () => screen.findByRole('dialog', { name: '移入回收站' });

beforeEach(() => {
  items = [file('res_a'), file('res_b'), kb('res_c'), file('res_d', { origin: 'outputs' })];
  failTrash = new Set();
  ask.mockClear();
  localStorage.clear();
  fetchMock.mockReset();
  fixtures();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('row ··· menu', () => {
  it('knowledge-base rows can be asked about and downloaded but have no 删除', async () => {
    mount();
    await openMenu('C.md');
    expect(await screen.findByRole('menuitem', { name: '用这份资料提问' })).not.toHaveClass('arco-dropdown-menu-disabled');
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('href', '/bridge/v1/resources/res_c/preview');
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('download', 'C.md');
    expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull();
  });

  it('ask: a knowledge-base file hands exactly that file to the host; outputs and archived files are disabled with a reason', async () => {
    mount();
    await openMenu('C.md');
    fireEvent.click(await screen.findByRole('menuitem', { name: '用这份资料提问' }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(ask.mock.calls[0]?.[0]).toEqual({
      items: [{ source_id: 'src_a', name: '甲库', resource_ids: ['res_c'] }],
      views: [],
      requiredResourceIds: ['res_c'],
    });
    cleanup();
    ask.mockClear();
    mount();
    await openMenu('D.md');
    const item = await screen.findByRole('menuitem', { name: /用这份资料提问/ });
    expect(item).toHaveClass('arco-dropdown-menu-disabled');
    expect(item).toHaveTextContent('产物与存档资料暂不能提问');
    fireEvent.click(item);
    expect(ask).not.toHaveBeenCalled();
  });

  it('ask: a Secret knowledge-base file is blocked with the Secret reason', async () => {
    items = [kb('res_c', { secret: true })];
    mount();
    await openMenu('C.md');
    const item = await screen.findByRole('menuitem', { name: /用这份资料提问/ });
    expect(item).toHaveClass('arco-dropdown-menu-disabled');
    expect(item).toHaveTextContent('已标为 Secret');
    fireEvent.click(item);
    expect(ask).not.toHaveBeenCalled();
  });

  it('delete: cancelling the confirm writes nothing; confirming POSTs trash with the freshly read metadata revision', async () => {
    mount();
    await openMenu('A.md');
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    const dialog = await confirmDialog();
    expect(dialog).toHaveTextContent('可在回收站恢复');
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '移入回收站' })).toBeNull());
    expect(calls('POST', '/trash')).toHaveLength(0);

    await openMenu('A.md');
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }));
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: '移入回收站' }));
    await waitFor(() => expect(calls('POST', '/resources/res_a/trash')).toHaveLength(1));
    expect(JSON.parse(String((calls('POST', '/resources/res_a/trash')[0]?.[1] as RequestInit).body))).toEqual({
      expected_metadata_revision: 7,
    });
  });
});

describe('multi-select bar', () => {
  it('ask with these files: exactly the picked ids; a Secret pick blocks it; no pick = no bar', async () => {
    items = [kb('res_c'), kb('res_e', { secret: true })];
    mount();
    await screen.findByRole('button', { name: 'C.md', exact: true });
    expect(screen.queryByRole('region', { name: '所选资料的操作' })).toBeNull();
    pick('C.md');
    fireEvent.click(within(bar()).getByRole('button', { name: '用这些资料提问' }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(ask.mock.calls[0]?.[0].requiredResourceIds).toEqual(['res_c']);
    pick('E.md');
    expect(within(bar()).getByRole('button', { name: '用这些资料提问' })).toBeDisabled();
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('delete: only own Bridge-only files are moved; knowledge-base rows are skipped and said so', async () => {
    mount();
    await screen.findByRole('button', { name: 'A.md', exact: true });
    for (const n of ['A.md', 'C.md', 'D.md']) pick(n);
    fireEvent.click(within(bar()).getByRole('button', { name: '删除' }));
    const dialog = await confirmDialog();
    expect(dialog).toHaveTextContent('将 2 项移入回收站');
    expect(dialog).toHaveTextContent('另有 1 项不能移入回收站');
    fireEvent.click(within(dialog).getByRole('button', { name: '移入回收站' }));
    await waitFor(() => expect(calls('POST', '/trash')).toHaveLength(2));
    expect(calls('POST', '/resources/res_c/trash')).toHaveLength(0);
  });

  it('delete is disabled when nothing selected can be trashed', async () => {
    mount();
    await screen.findByRole('button', { name: 'C.md', exact: true });
    pick('C.md');
    expect(within(bar()).getByRole('button', { name: '删除' })).toBeDisabled();
  });

  it('delete: a partial failure is reported by name and the rest still moved', async () => {
    failTrash = new Set(['res_b']);
    mount();
    await screen.findByRole('button', { name: 'A.md', exact: true });
    pick('A.md');
    pick('B.md');
    fireEvent.click(within(bar()).getByRole('button', { name: '删除' }));
    fireEvent.click(within(await confirmDialog()).getByRole('button', { name: '移入回收站' }));
    expect(await screen.findByText(/已移入 1 项；1 项没有成功：B\.md/)).toBeInTheDocument();
    expect(calls('POST', '/resources/res_a/trash')).toHaveLength(1);
  });

  it('download: one anchor per picked file pointing at the current-content address', async () => {
    const clicked: Array<[string, string]> = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push([this.getAttribute('href') ?? '', this.download]);
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount();
      await screen.findByRole('button', { name: 'A.md', exact: true });
      pick('A.md');
      pick('B.md');
      fireEvent.click(within(bar()).getByRole('button', { name: '下载' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(clicked).toEqual([
        ['/bridge/v1/resources/res_a/preview', 'A.md'],
        ['/bridge/v1/resources/res_b/preview', 'B.md'],
      ]);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });
});
