/**
 * 文件：tests/unit/mycowork/officeMemoryNavigation.dom.test.tsx
 * 职责：真实记忆页的状态导航、过期读响应与原生二级栏接线。
 * 边界：只替代Bridge HTTP边界，保持真实状态与Arco控件；数据均虚构。
 * 关联：PR11 W4-7 A；ADR-0022；knowledge-precipitation.md。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { MemoryPage } from '@mycowork/ui';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const item = (status: string, text: string) => ({
  memory_id: 'mem_fixture_' + status,
  kind: 'fact',
  scope: { type: 'personal' },
  text,
  sources: { resource_ids: [] },
  status,
  revision: 2,
  exportable: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

it('one portal owns the four real statuses; selection and collapse use separate callbacks', async () => {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/memory-items?')) {
      const status = new URL(url, 'http://fixture.test').searchParams.get('status') ?? '';
      return Promise.resolve(reply(200, { items: [item(status, '记忆状态（虚构） ' + status)], total: 1 }));
    }
    return Promise.resolve(reply(200, { paused: false }));
  });
  const host = document.createElement('aside');
  document.body.append(host);
  const onSelect = vi.fn(),
    onCollapse = vi.fn();
  const view = render(
    <MemoryPage lang='zh-CN' navigationContainer={host} onSelect={onSelect} onCollapse={onCollapse} />
  );
  try {
    await screen.findByText('记忆状态（虚构） candidate');
    const nav = within(host).getByRole('navigation', { name: '记忆' });
    expect(view.container.querySelector('nav')).toBeNull();
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['', '待确认', '已生效', '已停用', '已拒绝']);
    expect(within(nav).queryByText('以后增强')).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: '已停用' }));
    await screen.findByText('记忆状态（虚构） disabled');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(within(nav).getByRole('button', { name: '已停用' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(within(nav).getByRole('button', { name: '收起侧栏' }));
    expect(onCollapse).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
    host.remove();
  }
});

it('a failed list has one readable error and Retry; an expired login hides memory rows', async () => {
  let code = 503;
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/memory-items?')
        ? reply(code, code === 200 ? { items: [], total: 0 } : {})
        : reply(code === 401 ? 401 : 200, { paused: false })
    )
  );
  render(<MemoryPage lang='zh-CN' />);
  await screen.findByText('没有读到记忆');
  expect(screen.getAllByText('资料服务暂不可用，请稍后重试；已保存的内容不受影响。')).toHaveLength(1);
  code = 200;
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('这一栏还没有条目');
  code = 401;
  fireEvent.click(screen.getByRole('button', { name: '已生效' }));
  await screen.findByText('请登录后查看记忆');
  expect(screen.queryByTestId('memory-item')).toBeNull();
  await waitFor(() => expect(screen.getByRole('switch', { name: '暂停自动沉淀' })).toBeDisabled());
  code = 200;
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('这一栏还没有条目');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.body)).toHaveLength(0);
});

it('modify409 keeps its draft and submits the revision returned by the explicit reload', async () => {
  let revision = 2,
    status = 409;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/actions')) {
      revision = 3;
      return reply(status, { error: { code: 'MEMORY_STATE_CONFLICT' } });
    }
    if (url.includes('/memory-items?'))
      return reply(200, {
        items: url.includes('status=candidate') ? [{ ...item('candidate', '原事实（虚构）'), revision }] : [],
        total: 1,
      });
    return reply(200, { paused: false });
  });
  render(<MemoryPage lang='zh-CN' />);
  await screen.findByText('原事实（虚构）');
  fireEvent.click(screen.getByRole('button', { name: '修改' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留的修改（虚构）' } });
  fireEvent.click(screen.getByRole('button', { name: '待确认' }));
  expect(screen.getByRole('textbox')).toHaveValue('保留的修改（虚构）');
  fireEvent.click(screen.getByRole('button', { name: '已生效' }));
  await screen.findByText('这一栏还没有条目');
  fireEvent.click(screen.getByRole('button', { name: '待确认' }));
  expect(await screen.findByRole('textbox')).toHaveValue('保留的修改（虚构）');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('条目已被更新，已重新读取；请再操作一次。');
  expect(await screen.findByRole('textbox')).toHaveValue('保留的修改（虚构）');
  status = 200;
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.includes('/actions'))).toHaveLength(2));
  const writes = fetchMock.mock.calls
    .filter(([url]) => url.includes('/actions'))
    .map(([, init]) => JSON.parse(String(init.body)));
  expect(writes).toEqual([
    { action: 'modify', expected_revision: 2, text: '保留的修改（虚构）' },
    { action: 'modify', expected_revision: 3, text: '保留的修改（虚构）' },
  ]);
});
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

it('a late candidate response cannot replace the current active view', async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('status=candidate')) return new Promise((resolve) => (finish = resolve));
    if (url.includes('status=active')) {
      const items = [item('active', '当前已生效的事实（虚构）')];
      return Promise.resolve(reply(200, { items, total: 1, page: 1, page_size: 50 }));
    }
    return Promise.resolve(reply(200, { paused: false }));
  });
  render(<MemoryPage lang='zh-CN' />);
  expect(fetchMock.mock.calls.filter(([url]) => url.includes('status=candidate'))).toHaveLength(1);
  fireEvent.click(screen.getByText('已生效'));
  expect(await screen.findByText('当前已生效的事实（虚构）')).toBeInTheDocument();
  const items = [item('candidate', '迟到的候选（虚构）')];
  await act(async () => finish(reply(200, { items, total: 1, page: 1, page_size: 50 })));
  expect(screen.queryByText('迟到的候选（虚构）')).toBeNull();
  expect(screen.getByText('当前已生效的事实（虚构）')).toBeInTheDocument();
});
