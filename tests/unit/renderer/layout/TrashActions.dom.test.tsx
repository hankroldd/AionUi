/**
 * [mycowork] D103/D176: trash restore and explicitly confirmed deletion.
 * Bridge HTTP is the only substitute; React state, Arco controls and pagination are real.
 * Permanent deletion takes two different controls: tick "cannot be recovered", then the final button; no single
 * gesture (double-click included) may delete.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { TrashPage } from '@mycowork/ui/pages/trash/index.ts';

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
let size: number, fail: Record<string, number>, listStatus: number;
let waitWrite: Promise<void> | undefined;
const calls = (part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).includes(part) && init?.method === 'POST');
beforeEach(() => {
  rows = [item(1), item(2), item(3)];
  size = 2;
  fail = {};
  listStatus = 200;
  waitWrite = undefined;
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/bridge/v1/trash?')) {
      if (listStatus !== 200) return reply(listStatus, { error: { code: 'UNAUTHENTICATED' } });
      const page = Number(new URL(url, 'http://fixture.test').searchParams.get('page'));
      return reply(200, {
        items: structuredClone(rows.slice((page - 1) * size, page * size)),
        page,
        page_size: size,
        total: rows.length,
      });
    }
    const id = url.split('/').at(-2) ?? '',
      row = rows.find((r) => r.resource_id === id);
    await waitWrite;
    if (fail[id]) return reply(fail[id], { error: { code: fail[id] === 409 ? 'REVISION_CONFLICT' : 'NOT_FOUND' } });
    if (!row) return reply(404, { error: { code: 'NOT_FOUND' } });
    rows = rows.filter((r) => r.resource_id !== id);
    if (url.endsWith('/untrash')) return reply(200, { ...row, metadata_revision: 4, trashed_at: null });
    return reply(200, { resource_id: id, purged_at: '2026-10-02T00:01:00Z', blobs_removed: 1 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const mount = () => render(<TrashPage lang='zh-CN' onBack={vi.fn()} />);
const dialog = () => within(screen.getByRole('dialog'));
const row = (n: number) => within(screen.getByTestId('mycowork-trash-row-res_' + n));
const acknowledge = () => fireEvent.click(dialog().getByRole('checkbox', { name: '我知道永久删除后无法恢复' }));
const finalButton = () => dialog().getByRole('button', { name: '确认永久删除' });

it('restore sends the read revision and reloads; no purge request', async () => {
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(row(1).getByRole('button', { name: '恢复 虚构资料1.md' }));
  await waitFor(() => expect(rows.map((r) => r.resource_id)).toEqual(['res_2', 'res_3']));
  expect(JSON.parse(String(calls('/untrash')[0][1].body))).toEqual({ expected_metadata_revision: 3 });
  expect(calls('/purge')).toHaveLength(0);
  await screen.findByText('虚构资料3.md');
});
it('purge cancellation does not write, including after ticking the acknowledgement', async () => {
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(row(1).getByRole('button', { name: '永久删除 虚构资料1.md' }));
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls('/purge')).toHaveLength(0);
});
it('purge writes only after the acknowledgement and the final button, and repeats the confirmed id', async () => {
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(row(1).getByRole('button', { name: '永久删除 虚构资料1.md' }));
  expect(finalButton()).toBeDisabled();
  fireEvent.click(finalButton());
  expect(calls('/purge')).toHaveLength(0);
  acknowledge();
  expect(calls('/purge')).toHaveLength(0);
  fireEvent.click(dialog().getByRole('button', { name: '确认永久删除' }));
  await waitFor(() => expect(calls('/purge')).toHaveLength(1));
  expect(JSON.parse(String(calls('/purge')[0][1].body))).toEqual({ confirm_resource_id: 'res_1' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('clear reads all pages then freezes ids; new arrivals are excluded', async () => {
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByRole('dialog');
  expect(dialog().getByText('虚构资料3.md')).toBeTruthy();
  expect(calls('/purge')).toHaveLength(0);
  rows.push(item(4));
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '确认永久删除' }));
  await waitFor(() => expect(calls('/purge')).toHaveLength(3));
  expect(rows.map((r) => r.resource_id)).toEqual(['res_4']);
});
it('partial failure retry contains only the original failed ids', async () => {
  fail.res_2 = 409;
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByRole('dialog');
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '确认永久删除' }));
  await screen.findByText('1 项未确认成功，请查看原因；只重试这些项，不包含新资料。');
  rows.push(item(4));
  fail = {};
  // a failed round is a new list: the acknowledgement must be ticked again before retrying
  expect(dialog().getByRole('button', { name: '重试未成功项' })).toBeDisabled();
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '重试未成功项' }));
  await waitFor(() => expect(calls('/purge')).toHaveLength(4));
  expect(calls('/purge').map(([url]) => String(url).split('/').at(-2))).toEqual(['res_1', 'res_2', 'res_3', 'res_2']);
  expect(rows.map((r) => r.resource_id)).toEqual(['res_4']);
});
it('pending prevents duplicate submits and cancellation; leaving stops later ids', async () => {
  let release!: () => void;
  waitWrite = new Promise<void>((r) => {
    release = r;
  });
  const view = mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByRole('dialog');
  acknowledge();
  const confirm = dialog().getByRole('button', { name: '确认永久删除' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(calls('/purge')).toHaveLength(1);
  expect(dialog().getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true);
  view.unmount();
  await act(async () => {
    release();
  });
  expect(calls('/purge')).toHaveLength(1);
  expect(rows.map((r) => r.resource_id)).toEqual(['res_2', 'res_3']);
});
it.each([401, 503])('list status %s gives error, no stale row or deletion', async (status) => {
  listStatus = status;
  mount();
  await screen.findByText('回收站读取失败');
  expect(screen.queryByText('虚构资料1.md')).toBeNull();
  expect(calls('/purge')).toHaveLength(0);
});
it('a changing total during enumeration does not open confirmation or write', async () => {
  const original = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url, init) => {
    const r = await original?.(url, init);
    if (String(url).endsWith('page=2')) return reply(200, { items: [item(3)], page: 2, page_size: 2, total: 4 });
    return r;
  });
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByText('回收站内容已变化，请刷新后重新确认。');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls('/purge')).toHaveLength(0);
});

it('uses 50-item pages and returns to the valid page after restoring the last item', async () => {
  rows = Array.from({ length: 51 }, (_, n) => item(n + 1));
  size = 50;
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByText('2', { selector: '.arco-pagination-item' }));
  await screen.findByText('虚构资料51.md');
  expect(screen.queryByText('虚构资料1.md')).toBeNull();
  fireEvent.click(row(51).getByRole('button', { name: '恢复 虚构资料51.md' }));
  await screen.findByText('虚构资料1.md');
  expect(rows).toHaveLength(50);
  expect(calls('/untrash')).toHaveLength(1);
});

it.each([401, 404, 409])('restore failure %s is visible and does not discard the item', async (status) => {
  fail.res_1 = status;
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(row(1).getByRole('button', { name: '恢复 虚构资料1.md' }));
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  await screen.findByText('虚构资料1.md');
  expect(rows).toHaveLength(3);
  expect(calls('/untrash')).toHaveLength(1);
  expect(calls('/purge')).toHaveLength(0);
});

it('duplicate ids across pages block confirmation and deletion', async () => {
  const original = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url, init) =>
    String(url).endsWith('page=2')
      ? reply(200, { items: [item(1)], total: 3, page: 2, page_size: 2 })
      : original?.(url, init)
  );
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByText('回收站内容已变化，请刷新后重新确认。');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls('/purge')).toHaveLength(0);
});

it('leaving during enumeration stops later pages and never writes', async () => {
  rows = Array.from({ length: 5 }, (_, n) => item(n + 1));
  const original = fetchMock.getMockImplementation();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).endsWith('page=2')) await held;
    return original?.(url, init);
  });
  const view = mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('page=2'))).toBe(true));
  view.unmount();
  await act(async () => {
    release();
  });
  expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('page=3'))).toBe(false);
  expect(calls('/purge')).toHaveLength(0);
});

it('late list response from a departed page cannot replace the current list', async () => {
  const original = fetchMock.getMockImplementation();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchMock.mockImplementationOnce(async () => {
    await held;
    return reply(200, { items: [item(99)], page: 1, page_size: 2, total: 1 });
  });
  const previous = mount();
  await screen.findByLabelText('正在读取回收站');
  previous.unmount();
  fetchMock.mockImplementation(original!);
  mount();
  await screen.findByText('虚构资料1.md');
  await act(async () => {
    release();
  });
  expect(screen.queryByText('虚构资料99.md')).toBeNull();
  expect(screen.getByText('虚构资料1.md')).toBeTruthy();
});

it('enumeration401 reloads and removes stale rows and writable controls', async () => {
  const original = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith('page=2')) listStatus = 401;
    return original?.(url);
  });
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByText('回收站读取失败');
  expect(screen.queryByText('虚构资料1.md')).toBeNull();
  expect(screen.getByRole('button', { name: '清空回收站' })).toBeDisabled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls('/purge')).toHaveLength(0);
});

it('a failed post-enumeration read invalidates the pending confirmation', async () => {
  const original = fetchMock.getMockImplementation();
  let count = 0,
    release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith('page=1') && ++count === 3) {
      await held;
      return reply(401, { error: { code: 'UNAUTHENTICATED' } });
    }
    return original?.(url);
  });
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByRole('dialog');
  await act(async () => {
    release();
  });
  await screen.findByText('回收站读取失败');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls('/purge')).toHaveLength(0);
});

it.each(['500', 'disconnect'])('purge response %s after commit stays unconfirmed; retry 404 = done', async (mode) => {
  const original = fetchMock.getMockImplementation();
  let first = true;
  fetchMock.mockImplementation(async (url) => {
    const response = await original?.(url);
    if (String(url).endsWith('/purge') && first) {
      first = false;
      if (mode === 'disconnect') throw new Error('synthetic connection lost after commit');
      return reply(500, { error: { code: 'INTERNAL_ERROR' } });
    }
    return response;
  });
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(row(1).getByRole('button', { name: '永久删除 虚构资料1.md' }));
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '确认永久删除' }));
  await screen.findByText('1 项未确认成功，请查看原因；只重试这些项，不包含新资料。');
  expect(screen.getByText(/未能确认操作结果，资料可能已恢复或删除/)).toBeTruthy();
  expect(rows.map((r) => r.resource_id)).toEqual(['res_2', 'res_3']);
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '重试未成功项' }));
  // the first request did delete it: the retry's 404 means done, not another failure to retry forever
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText(/资料已不在回收站，或你已无权操作/)).toBeNull();
  expect(calls('/purge')).toHaveLength(2);
  expect(calls('/purge').every(([url]) => String(url).includes('/res_1/'))).toBe(true);
});

it('clear enumeration network failure never implies a write was submitted', async () => {
  const original = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith('page=2')) throw new Error('synthetic read failure');
    return original?.(url);
  });
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(screen.queryByText(/资料可能已恢复或删除/)).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls('/purge')).toHaveLength(0);
});

it('read failure arriving during deletion stops later ids and never reopens a trapped confirmation', async () => {
  const original = fetchMock.getMockImplementation();
  let count = 0,
    releaseRead!: () => void,
    releaseWrite!: () => void;
  const heldRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  waitWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  fail.res_1 = 409;
  fetchMock.mockImplementation(async (url) => {
    if (String(url).endsWith('page=1') && ++count === 3) {
      await heldRead;
      return reply(401, { error: { code: 'UNAUTHENTICATED' } });
    }
    return original?.(url);
  });
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByRole('dialog');
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '确认永久删除' }));
  expect(calls('/purge')).toHaveLength(1);
  await act(async () => {
    releaseRead();
  });
  await screen.findByText('回收站读取失败');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await act(async () => {
    releaseWrite();
  });
  expect(calls('/purge')).toHaveLength(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
});

it.each(['永久删除 虚构资料1.md', '清空回收站'])(
  'double-click on "%s" opens the confirmation but deletes nothing',
  async (name) => {
    mount();
    await screen.findByText('虚构资料1.md');
    await userEvent.dblClick(screen.getByRole('button', { name }));
    await screen.findByRole('dialog');
    expect(finalButton()).toBeDisabled();
    fireEvent.click(finalButton());
    expect(calls('/purge')).toHaveLength(0);
    expect(rows).toHaveLength(3);
  }
);

it('double-click on the acknowledgement leaves it unticked, so the final button stays disabled', async () => {
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(screen.getByRole('button', { name: '清空回收站' }));
  await screen.findByRole('dialog');
  await userEvent.dblClick(dialog().getByRole('checkbox'));
  expect(dialog().getByRole('checkbox')).not.toBeChecked();
  expect(finalButton()).toBeDisabled();
  fireEvent.click(finalButton());
  expect(calls('/purge')).toHaveLength(0);
});

it('the acknowledgement does not carry over to the next confirmation', async () => {
  mount();
  await screen.findByText('虚构资料1.md');
  fireEvent.click(row(1).getByRole('button', { name: '永久删除 虚构资料1.md' }));
  acknowledge();
  fireEvent.click(dialog().getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(row(2).getByRole('button', { name: '永久删除 虚构资料2.md' }));
  expect(dialog().getByRole('checkbox')).not.toBeChecked();
  expect(finalButton()).toBeDisabled();
  expect(calls('/purge')).toHaveLength(0);
});

it.each([
  ['an object without items', async () => ({})],
  [
    'a body that is not JSON',
    async () => {
      throw new SyntaxError('synthetic non-JSON body');
    },
  ],
])('a 200 list response with %s shows the read failure and retry instead of a blank page', async (_, json) => {
  fetchMock.mockImplementation(async () => ({ status: 200, ok: true, json }));
  mount();
  await screen.findByText('回收站读取失败');
  expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
  expect(screen.queryByText('回收站是空的')).toBeNull();
  expect(screen.getByRole('button', { name: '清空回收站' })).toBeDisabled();
});

it.each([
  ['永久删除 虚构资料1.md', 'zh-CN', '如果它进过存档库，那里的副本也会一并删除；删除前已被解析过一次的内容无法追回。'],
  ['清空回收站', 'zh-CN', '如果它进过存档库，那里的副本也会一并删除；删除前已被解析过一次的内容无法追回。'],
  [
    'Delete permanently 虚构资料1.md',
    'en-US',
    'If it was ever in the archive, its copy there is deleted too; content already parsed once before deletion cannot be recovered.',
  ],
  [
    'Empty trash',
    'en-US',
    'If it was ever in the archive, its copy there is deleted too; content already parsed once before deletion cannot be recovered.',
  ],
])('confirmation of %s says archive copies go too and parsed content is unrecoverable', async (name, lang, hint) => {
  render(<TrashPage lang={lang} onBack={vi.fn()} />);
  await screen.findByText('虚构资料1.md');
  const target = name.includes('虚构') ? row(1) : within(document.body);
  fireEvent.click(target.getByRole('button', { name }));
  await waitFor(() => expect(dialog().getByText(hint)).toBeTruthy());
  expect(calls('/purge')).toHaveLength(0);
});
