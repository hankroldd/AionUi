/**
 * [mycowork] PR11 体验片 A：小动作不闪屏、处理中的行自己会更新、重复点击只发一次。只替换 Bridge 边界（fetch）。
 * 覆盖：空间页点收藏后重读同一查询时旧行一直可见、不出骨架屏；连点收藏只发一次 PATCH；当前页有“处理中”的行时每 5 秒静默重读、
 * 没有就停、页面不可见不读；集合 / 标签 / 分组读失败合成一条提示并给“重试”；记忆页接受后列表不退回骨架屏、连点接受只发一次。
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { OfficeMemorySlot } from '@/renderer/mycowork-slots';
import { deferred, fetchMock, fixture, item, list, reads, reply, reset } from './globalResourceFixture';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: null, pathname: '/' }) }));

(globalThis as { __mcwReadRetryMs?: number[] }).__mcwReadRetryMs = [0, 0];
const proxy503 = () => ({ status: 503, ok: false, json: async () => Promise.reject(new Error('html')) });
const skeleton = () => document.querySelector('.arco-skeleton');

// 截下页面登记的定时器（ms 匹配的），用例手动触发 / 检查是否被清掉
const timers = new Map<number, () => void>();
function captureIntervals(ms: number) {
  timers.clear();
  const real = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  let next = 1000;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, delay?: number) => {
    if (delay !== ms) return real(fn, delay);
    timers.set(++next, fn);
    return next;
  }) as typeof setInterval);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id: number) =>
    timers.has(id) ? timers.delete(id) : realClear(id)) as typeof clearInterval);
}
const fire = () => act(async () => [...timers.values()].forEach((fn) => fn()));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('空间页：重读同一查询不闪屏', () => {
  const mount = async () => {
    render(<ResourcesPage lang='zh-CN' />);
    await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  };
  let hold: ReturnType<typeof deferred<ReturnType<typeof list>>> | undefined;
  let patches = 0;
  beforeEach(() => {
    reset();
    hold = undefined;
    patches = 0;
    fixture(() => (hold ? hold.promise : list([item('res_1', '第一页-1.md'), item('res_2', '第一页-2.md')], 2)));
    const serve = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/bridge/v1/collections/col_case' && init?.method === 'PATCH') {
        patches++;
        return reply(200, {
          collection_id: 'col_case',
          name: '收藏',
          purpose: 'starred',
          resource_ids: [],
          revision: 2,
        });
      }
      return serve(url, init);
    });
  });

  it('点收藏后列表重读：旧行一直可见，不出骨架屏，新数据到了再换', async () => {
    await mount();
    hold = deferred();
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 第一页-1.md' }));
    await waitFor(() => expect(reads()).toHaveLength(2)); // 重读已发出、响应被扣住
    expect(skeleton()).toBeNull();
    expect(screen.getByRole('button', { name: '第一页-1.md', exact: true })).toBeInTheDocument();
    await act(async () => hold!.resolve(list([item('res_1', '第一页-1.md'), item('res_9', '新到的.md')], 2)));
    await screen.findByRole('button', { name: '新到的.md', exact: true });
    expect(skeleton()).toBeNull();
  });

  it('连点收藏只发一次请求', async () => {
    await mount();
    const star = screen.getByRole('button', { name: '取消收藏 第一页-1.md' });
    fireEvent.click(star);
    fireEvent.click(star);
    fireEvent.click(star);
    await waitFor(() => expect(reads().length).toBeGreaterThan(1));
    expect(patches).toBe(1);
  });

  it('当前页有“处理中”的行：每 5 秒静默重读，没有了就停；页面不可见不读', async () => {
    captureIntervals(5000);
    let indexing = true;
    fixture(() => list([item('res_1', '第一页-1.md', { state: indexing ? 'indexing' : 'ready' })], 1));
    await mount();
    expect(timers.size).toBe(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await fire();
    expect(reads()).toHaveLength(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await fire();
    await waitFor(() => expect(reads()).toHaveLength(2));
    expect(skeleton()).toBeNull();
    indexing = false;
    await fire();
    await waitFor(() => expect(reads()).toHaveLength(3));
    await waitFor(() => expect(timers.size).toBe(0)); // 没有处理中的行：轮询停掉
  });

  it('集合 / 标签 / 分组读失败：合成一条提示并给“重试”，点了重读', async () => {
    const serve = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    let down = true;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      down && (url === '/bridge/v1/tags' || url === '/bridge/v1/saved-views') ? proxy503() : serve(url, init)
    );
    await mount();
    const notice = (await screen.findAllByRole('alert')).find((a) => a.querySelector('button'));
    expect(notice).toBeDefined();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    down = false;
    const before = fetchMock.mock.calls.filter(([u]) => u === '/bridge/v1/tags').length;
    fireEvent.click(notice!.querySelector('button')!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => u === '/bridge/v1/tags').length).toBeGreaterThan(before)
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('记忆页', () => {
  const mem = (id: string, text: string) => ({
    memory_id: id,
    kind: 'fact',
    scope: { type: 'personal' },
    text,
    sources: { resource_ids: [] },
    status: 'candidate',
    revision: 2,
    exportable: false,
    created_at: 't',
    updated_at: 't',
  });
  let hold: ReturnType<typeof deferred<ReturnType<typeof reply>>> | undefined;
  let accepts = 0;
  beforeEach(() => {
    hold = undefined;
    accepts = 0;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/bridge/v1/memory-items?'))
        return hold
          ? hold.promise
          : reply(200, { items: [mem('mem_1', '先写结论')], page: 1, page_size: 50, total: 1 });
      if (url.endsWith('/actions')) {
        accepts++;
        return reply(200, {});
      }
      if (url === '/bridge/v1/memory-settings') return reply(200, { paused: false });
      return reply(404, {});
    });
  });

  it('接受后重读：列表留着、不退回骨架屏；连点接受只发一次', async () => {
    render(<OfficeMemorySlot />);
    await screen.findByText('先写结论');
    hold = deferred();
    const accept = screen.getByRole('button', { name: '接受' });
    fireEvent.click(accept);
    fireEvent.click(accept);
    await waitFor(() => expect(accepts).toBe(1));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/bridge/v1/memory-items?'))).toHaveLength(2)
    );
    expect(skeleton()).toBeNull();
    expect(screen.getByText('先写结论')).toBeInTheDocument();
    expect(accepts).toBe(1);
    await act(async () =>
      hold!.resolve(reply(200, { items: [mem('mem_1', '先写结论（新）')], page: 1, page_size: 50, total: 1 }))
    );
    await screen.findByText('先写结论（新）');
  });
});
