/**
 * [mycowork] PR11 体验片 B-1：多选删除不锁人。只替换 Bridge 边界（fetch），真实资源页与 Arco。
 * 覆盖：点确认后确认框立即关闭（请求还没回来）；进度提示的数字与并发上限 3；部分失败只重试失败项且给人话原因；
 * 进行中再次删除被拒绝、不并发第二批；离开页面（卸载）后任务继续完成、完成提示仍出现；完成后列表重读一次。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import type { ResourceList } from '@mycowork/contracts';
import { ResourcesPage } from '@mycowork/ui';

type Item = ResourceList['items'][number];
const file = (id: string): Item => ({
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
});
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
configure({ asyncUtilTimeout: 4000 }); // 整机高负载时默认 1 秒的 findBy 会误报
const fetchMock = vi.fn();
let items: Item[];
let gates: Map<string, () => void>; // 卡住 POST …/trash，直到用例放行
let failOnce: Map<string, 'lease' | 'network' | 'state' | 'rev'>;
let inFlight = 0;
let maxInFlight = 0;
let listReads = 0;
const trashCalls = (id?: string) =>
  fetchMock.mock.calls.filter(([u, i]) => /\/trash$/.test(String(u)) && (i as RequestInit)?.method === 'POST' && (!id || String(u).includes(id)));

function serve() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(String(url), 'http://fixture.invalid');
    const method = init?.method ?? 'GET';
    if (u.pathname === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (u.pathname === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (u.pathname === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (u.pathname === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (u.pathname === '/bridge/v1/resources') {
      listReads++;
      return reply(200, { items, page: 1, page_size: 50, total: items.length, failed_source_ids: [] });
    }
    if (/\/metadata$/.test(u.pathname)) return reply(200, { metadata_revision: 7, tag_ids: [], secret: false });
    const m = /^\/bridge\/v1\/resources\/([^/]+)\/trash$/.exec(u.pathname);
    if (m && method === 'POST') {
      const id = m[1] ?? '';
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        const gate = gates.get(id);
        if (gate !== undefined) await new Promise<void>((r) => gates.set(id, r));
        const fail = failOnce.get(id);
        if (fail) {
          failOnce.delete(id);
          if (fail === 'network') throw new TypeError('Failed to fetch');
          const code = { lease: 'EDIT_LEASE_HELD', state: 'TRASH_STATE_CONFLICT', rev: 'REVISION_CONFLICT', network: '' }[fail];
          return reply(409, { error: { code, message: 'x' } });
        }
        return reply(200, { resource_id: id, file_name: 'x', trashed_at: '2026-10-09T00:00:00Z' });
      } finally {
        inFlight--;
      }
    }
    return reply(404, { error: { code: 'NOT_FOUND' } });
  });
}
const hold = (...ids: string[]) => ids.forEach((id) => gates.set(id, () => undefined));
const release = (id: string) => gates.get(id)?.();
const mount = () => render(<ResourcesPage lang='zh-CN' ownerKey='user-a' onAskScope={async () => {}} />);
const pick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `选择 ${name}`, exact: true }));
const bar = () => screen.getByRole('region', { name: '所选资料的操作' });
async function trashSelected(...names: string[]) {
  await screen.findByRole('button', { name: names[0]!, exact: true });
  for (const n of names) pick(n);
  fireEvent.click(within(bar()).getByRole('button', { name: '删除' }));
  const dialog = await screen.findByRole('dialog', { name: '移入回收站' });
  fireEvent.click(within(dialog).getByRole('button', { name: '移入回收站' }));
}
const dialogGone = () => screen.queryByRole('dialog', { name: '移入回收站' }) === null;
const settle = () => waitFor(() => expect(document.body.textContent).not.toMatch(/正在移入回收站/));

beforeEach(() => {
  items = ['res_a', 'res_b', 'res_c', 'res_d', 'res_e'].map(file);
  gates = new Map();
  failOnce = new Map();
  inFlight = maxInFlight = listReads = 0;
  fetchMock.mockReset();
  serve();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  for (const id of [...gates.keys()]) release(id);
  gates.clear();
  await settle();
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});

describe('多选删除不锁人', () => {
  it('点确认后确认框立即关闭，请求还没回来也看得到进度', async () => {
    hold('res_a', 'res_b');
    mount();
    await trashSelected('A.md', 'B.md');
    await waitFor(() => expect(dialogGone()).toBe(true));
    expect(await screen.findByText('正在移入回收站 0 / 2')).toBeInTheDocument();
    release('res_a');
    expect(await screen.findByText('正在移入回收站 1 / 2')).toBeInTheDocument();
    release('res_b');
    expect(await screen.findByText(/已移入回收站 2 项/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看回收站' })).toBeInTheDocument();
  });

  it('同时最多 3 项在飞；完成后列表重读一次', async () => {
    hold('res_a', 'res_b', 'res_c', 'res_d', 'res_e');
    mount();
    await trashSelected('A.md', 'B.md', 'C.md', 'D.md', 'E.md');
    await waitFor(() => expect(trashCalls()).toHaveLength(3));
    expect(maxInFlight).toBe(3);
    const before = listReads;
    for (const id of ['res_a', 'res_b', 'res_c', 'res_d', 'res_e']) {
      await waitFor(() => expect(trashCalls(id)).toHaveLength(1));
      release(id);
    }
    expect(await screen.findByText(/已移入回收站 5 项/)).toBeInTheDocument();
    expect(maxInFlight).toBeLessThanOrEqual(3);
    await waitFor(() => expect(listReads).toBe(before + 1));
  });

  it('部分失败：不自动消失，写人话原因，“重试失败项”只重发失败的那一项', async () => {
    failOnce.set('res_b', 'lease');
    mount();
    await trashSelected('A.md', 'B.md');
    expect(await screen.findByText(/1 项没移成功/)).toBeInTheDocument();
    expect(document.body.textContent).toContain('B.md');
    expect(document.body.textContent).not.toMatch(/EDIT_LEASE_HELD|HTTP|请刷新后重试/);
    expect(trashCalls('res_a')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '重试失败项' }));
    expect(await screen.findByText(/已移入回收站 1 项/)).toBeInTheDocument();
    expect(trashCalls('res_a')).toHaveLength(1);
    expect(trashCalls('res_b')).toHaveLength(2);
  });

  it('进行中再次发起删除被拒绝，不并发第二批', async () => {
    hold('res_a');
    mount();
    await trashSelected('A.md');
    await waitFor(() => expect(trashCalls('res_a')).toHaveLength(1));
    pick('B.md');
    fireEvent.click(within(bar()).getByRole('button', { name: '删除' }));
    expect(await screen.findByText(/上一批还在处理/)).toBeInTheDocument();
    await waitFor(() => expect(dialogGone()).toBe(true));
    release('res_a');
    await screen.findByText(/已移入回收站 1 项/);
    expect(trashCalls('res_b')).toHaveLength(0);
  });

  it('离开页面（卸载）后任务继续，完成提示仍然出现', async () => {
    hold('res_a', 'res_b');
    const view = mount();
    await trashSelected('A.md', 'B.md');
    await waitFor(() => expect(trashCalls()).toHaveLength(2));
    view.unmount();
    act(() => {
      release('res_a');
      release('res_b');
    });
    expect(await screen.findByText(/已移入回收站 2 项/)).toBeInTheDocument();
  });
});

describe('失败原因与已完成', () => {
  it('已经在回收站（状态冲突）算完成，不进失败项', async () => {
    failOnce.set('res_b', 'state');
    mount();
    await trashSelected('A.md', 'B.md');
    expect(await screen.findByText(/已移入回收站 2 项/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/没移成功/);
  });

  it('版本号冲突不说成“正在被编辑”', async () => {
    failOnce.set('res_b', 'rev');
    mount();
    await trashSelected('A.md', 'B.md');
    expect(await screen.findByText(/1 项没移成功/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/正在被编辑/);
    expect(document.body.textContent).toMatch(/刚被改动过/);
  });
});
