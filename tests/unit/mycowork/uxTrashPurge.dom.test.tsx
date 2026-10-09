/**
 * [mycowork] PR11 体验片 B-2/B-3：清空回收站 / 永久删除不锁人，恢复有反馈。只替换 Bridge 边界（fetch），TrashPage 与 Arco 是真的。
 * 覆盖：D176 的勾选 + 最终按钮保留，确认后关框；页面内“已永久删除 n / N”进度（可关闭）；同时最多 3 项；
 * 明确被拒绝的项给人话原因并可重试（重试仍要再确认）；结果未知的项先“确认结果”（只读列表），不盲目重试、不写；
 * 离开页面后批次继续；恢复成功给“已恢复”轻提示。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import { TrashPage } from '@mycowork/ui/pages/trash/index.ts';

configure({ asyncUtilTimeout: 4000 }); // 整机高负载时默认 1 秒的 findBy 会误报
const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const item = (n: number) => ({
  resource_id: 'res_' + n,
  file_name: '虚构资料' + n + '.md',
  trashed_at: '2026-10-02T00:00:00Z',
  metadata_revision: 3,
  impact: { publications: 0, memory_items: 0, collections: 0, plans: 0 },
});
let rows: ReturnType<typeof item>[];
let reject: Record<string, number>; // id → 明确的 HTTP 拒绝
let lost: Set<string>; // id → 服务端已执行但响应丢了（断线）
let gates: Map<string, () => void>;
let inFlight = 0;
let maxInFlight = 0;
const purges = (id?: string) =>
  fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/purge') && i?.method === 'POST' && (!id || String(u).includes(id + '/')));
const listReads = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/bridge/v1/trash?')).length;

beforeEach(() => {
  rows = [item(1), item(2), item(3)];
  reject = {};
  lost = new Set();
  gates = new Map();
  inFlight = maxInFlight = 0;
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/bridge/v1/trash?')) {
      const page = Number(new URL(url, 'http://fixture.test').searchParams.get('page'));
      return reply(200, { items: structuredClone(rows.slice((page - 1) * 50, page * 50)), page, page_size: 50, total: rows.length });
    }
    if (init?.method !== 'POST') return reply(404, { error: { code: 'NOT_FOUND' } });
    const id = url.split('/').at(-2) ?? '';
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (gates.has(id)) await new Promise<void>((r) => gates.set(id, r));
      if (reject[id]) return reply(reject[id], { error: { code: reject[id] === 409 ? 'REVISION_CONFLICT' : 'NOT_FOUND' } });
      const row = rows.find((r) => r.resource_id === id);
      if (!row) return reply(404, { error: { code: 'NOT_FOUND' } });
      rows = rows.filter((r) => r.resource_id !== id);
      if (lost.has(id)) throw new TypeError('Failed to fetch');
      if (url.endsWith('/untrash')) return reply(200, { ...row, metadata_revision: 4, trashed_at: null });
      return reply(200, { resource_id: id, purged_at: '2026-10-09T00:01:00Z', blobs_removed: 1 });
    } finally {
      inFlight--;
    }
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  for (const id of [...gates.keys()]) gates.get(id)?.();
  gates.clear();
  await waitFor(() => expect(screen.queryByText(/已永久删除 \d+ \/ \d+/) === null || inFlight === 0).toBe(true));
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});
const hold = (...ids: string[]) => ids.forEach((id) => gates.set(id, () => undefined));
const mount = () => render(<TrashPage lang='zh-CN' onBack={vi.fn()} />);
const dialog = () => within(screen.getByRole('dialog'));
const acknowledge = () => fireEvent.click(dialog().getByRole('checkbox', { name: '我知道永久删除后无法恢复' }));
const confirmAll = async () => {
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByRole('dialog');
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '确认永久删除' }));
};
const panel = () => screen.getByTestId('mycowork-purge-progress');

it('确认后关框，页面内显示进度，可继续浏览；进度可关闭而批次继续', async () => {
  hold('res_1', 'res_2', 'res_3');
  mount();
  await confirmAll();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('已永久删除 0 / 3')).toBeInTheDocument();
  expect(screen.getByText('虚构资料1.md')).toBeInTheDocument();
  gates.get('res_1')?.();
  expect(await screen.findByText('已永久删除 1 / 3')).toBeInTheDocument();
  fireEvent.click(within(panel()).getByRole('button', { name: '关闭' }));
  expect(screen.queryByTestId('mycowork-purge-progress')).toBeNull();
  gates.get('res_2')?.();
  gates.get('res_3')?.();
  await waitFor(() => expect(rows).toHaveLength(0));
});

it('同时最多 3 项在飞；做完后列表重读', async () => {
  rows = [1, 2, 3, 4, 5].map(item);
  hold('res_1', 'res_2', 'res_3', 'res_4', 'res_5');
  mount();
  await confirmAll();
  await waitFor(() => expect(purges()).toHaveLength(3));
  expect(maxInFlight).toBe(3);
  const before = listReads();
  for (const id of ['res_1', 'res_2', 'res_3', 'res_4', 'res_5']) {
    await waitFor(() => expect(purges(id)).toHaveLength(1));
    gates.get(id)?.();
  }
  expect(await screen.findByText('已永久删除 5 / 5')).toBeInTheDocument();
  expect(maxInFlight).toBeLessThanOrEqual(3);
  await waitFor(() => expect(listReads()).toBeGreaterThan(before));
});

it('明确被拒绝：写人话原因，不说“未能确认”；重试失败项仍要再勾选再点最终按钮，且只含失败项', async () => {
  reject.res_2 = 409;
  mount();
  await confirmAll();
  const retry = await screen.findByRole('button', { name: '重试失败项' });
  expect(panel()).toHaveTextContent('虚构资料2.md');
  expect(panel()).toHaveTextContent('1 项没删成功');
  expect(document.body.textContent).not.toMatch(/未能确认操作结果|REVISION_CONFLICT/);
  expect(purges()).toHaveLength(3);
  reject = {};
  fireEvent.click(retry);
  await screen.findByRole('dialog');
  expect(dialog().getByRole('button', { name: '确认永久删除' })).toBeDisabled();
  expect(dialog().getByText('虚构资料2.md')).toBeInTheDocument();
  expect(dialog().queryByText('虚构资料1.md')).toBeNull();
  expect(purges()).toHaveLength(3);
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '确认永久删除' }));
  await waitFor(() => expect(purges()).toHaveLength(4));
  expect(purges('res_2')).toHaveLength(2);
  expect(purges('res_1')).toHaveLength(1);
});

it('结果未知（响应丢了）：不盲目重试；“确认结果”只读列表，已不在 = 算删成功', async () => {
  lost.add('res_1');
  mount();
  await confirmAll();
  const check = await screen.findByRole('button', { name: '确认结果' });
  expect(panel()).toHaveTextContent('1 项没能确认结果');
  expect(screen.queryByRole('button', { name: '重试失败项' })).toBeNull();
  const writes = purges().length;
  fireEvent.click(check);
  await waitFor(() => expect(panel()).toHaveTextContent('已永久删除 3 / 3'));
  expect(screen.queryByRole('button', { name: '重试失败项' })).toBeNull();
  expect(purges()).toHaveLength(writes);
});

it('结果未知且列表里还在：才允许重试', async () => {
  lost.add('res_1');
  mount();
  await confirmAll();
  const check = await screen.findByRole('button', { name: '确认结果' });
  rows = [item(1), ...rows]; // 实际没删掉（服务端回滚），列表里还在
  lost.delete('res_1');
  fireEvent.click(check);
  expect(await screen.findByRole('button', { name: '重试失败项' })).toBeInTheDocument();
  expect(purges()).toHaveLength(3);
});

it('离开页面后批次继续做完', async () => {
  hold('res_1', 'res_2', 'res_3');
  const view = mount();
  await confirmAll();
  await waitFor(() => expect(purges()).toHaveLength(3));
  view.unmount();
  act(() => ['res_1', 'res_2', 'res_3'].forEach((id) => gates.get(id)?.()));
  await waitFor(() => expect(rows).toHaveLength(0));
  expect(purges()).toHaveLength(3);
});

it('恢复成功给“已恢复”轻提示', async () => {
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(within(screen.getByTestId('mycowork-trash-row-res_1')).getByRole('button', { name: '恢复 虚构资料1.md' }));
  expect(await screen.findByText(/已恢复「虚构资料1\.md」/)).toBeInTheDocument();
});
