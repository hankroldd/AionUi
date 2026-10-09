/**
 * [mycowork] PR11 体验片 A：小动作不闪屏、处理中的行自己会更新、重复点击只发一次。只替换 Bridge 边界（fetch）。
 * 覆盖：空间页点收藏后重读同一查询时旧行一直可见、不出骨架屏；连点收藏只发一次 PATCH；当前页有“处理中”的行时每 5 秒静默重读、
 * 没有就停、页面不可见不读；集合 / 标签 / 分组读失败合成一条提示并给“重试”；记忆页接受后列表不退回骨架屏、连点接受只发一次。
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { OfficeMemorySlot } from '@/renderer/mycowork-slots';
import { deferred, fetchMock, fixture, item, list, reads, reply, reset } from './globalResourceFixture';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: null, pathname: '/' }) }));

readRetry.delays = [0, 0];
const proxy503 = () => ({ status: 503, ok: false, json: async () => Promise.reject(new Error('html')) });
const skeleton = () => document.querySelector('.arco-skeleton');

// 截下页面登记的轮询定时器（>= 5 秒的 setTimeout），用例手动触发 / 检查是否被清掉 / 看退避间隔
const timers = new Map<number, { fn: () => void; ms: number }>();
function capturePollTimers() {
  timers.clear();
  const real = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  let next = 1000;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    if (ms === undefined || ms < 5000 || ms > 30_000) return real(fn, ms); // 60 秒是请求自己的兜底超时
    timers.set(++next, { fn, ms });
    return next;
  }) as unknown as typeof setTimeout);
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: number) =>
    timers.has(id) ? timers.delete(id) : realClear(id)) as typeof clearTimeout);
}
/** 触发当前排着的那一拍（链式：一次只会有一个）。 */
const fire = async () => {
  const [id, t] = [...timers.entries()][0]!;
  timers.delete(id);
  await act(async () => t.fn());
};
// RTL 的 waitFor 默认超时也是 5 秒的 setTimeout，会混进来：用例里的 waitFor 一律给 4 秒以内的超时
const pending = () => [...timers.values()].map((t) => t.ms);

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

  it('当前页有“处理中”的行：5 秒起静默重读、无变化就退避、有变化回 5 秒、没有了就停；页面不可见不读；上一拍没返回不再发', async () => {
    capturePollTimers();
    let indexing = true;
    let hold: ReturnType<typeof deferred<ReturnType<typeof list>>> | undefined;
    const rows = () => list([item('res_1', '第一页-1.md', { state: indexing ? 'indexing' : 'ready' })], 1);
    fixture(() => hold?.promise ?? rows());
    await mount();
    expect(pending()).toEqual([5000]);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await fire();
    expect(reads()).toHaveLength(1);
    expect(pending()).toEqual([5000]); // 不可见：这一拍不读，照旧排下一拍
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await fire();
    await waitFor(() => expect(reads()).toHaveLength(2), { timeout: 4000 });
    expect(skeleton()).toBeNull();
    await waitFor(() => expect(pending()).toEqual([10_000]), { timeout: 4000 }); // 行没变化：退避
    // 慢库：这一拍的响应还没回来，不会排出下一拍，也不会因此丢掉结果
    hold = deferred();
    await fire();
    expect(pending()).toEqual([]);
    indexing = false;
    await act(async () => hold!.resolve(rows()));
    await waitFor(() => expect(screen.queryByText('AI 可引用')).not.toBeNull(), { timeout: 4000 });
    await waitFor(() => expect(pending()).toEqual([]), { timeout: 4000 }); // 没有处理中的行了：链停止
    expect(reads()).toHaveLength(3);
  });

  it('收藏按行记进行中：同一行连点一次，连点两行各一次；进行中的星标禁用', async () => {
    fixture(() => list([item('res_1', '第一页-1.md'), item('res_2', '第一页-2.md')], 2));
    const serve = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    const gate = deferred<ReturnType<typeof reply>>();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/bridge/v1/collections/col_case' && init?.method === 'PATCH') {
        patches++;
        return gate.promise;
      }
      return serve(url, init);
    });
    await mount();
    const one = screen.getByRole('button', { name: '取消收藏 第一页-1.md' });
    const two = screen.getByRole('button', { name: '收藏 第一页-2.md' });
    fireEvent.click(one);
    fireEvent.click(one);
    fireEvent.click(two);
    await waitFor(() => expect(patches).toBe(2));
    expect(one).toBeDisabled();
    expect(two).toBeDisabled();
    await act(async () =>
      gate.resolve(
        reply(200, { collection_id: 'col_case', name: '收藏', purpose: 'starred', resource_ids: [], revision: 2 })
      )
    );
    await waitFor(() => expect(one).toBeEnabled());
  });

  it('用户操作后的重读暂时失败：旧行留着并提示“可能不是最新”；404 不保留旧行', async () => {
    let mode: 'ok' | 'down' | 'gone' = 'ok';
    fixture(() => {
      if (mode === 'down')
        return { status: 503, ok: false, json: async () => Promise.reject(new Error('html')) } as never;
      if (mode === 'gone') return reply(404, { error: { code: 'NOT_FOUND', message: 'x' } }) as never;
      return list([item('res_1', '第一页-1.md')], 1);
    });
    const serve = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/bridge/v1/collections/col_case' && init?.method === 'PATCH'
        ? reply(200, { collection_id: 'col_case', name: '收藏', purpose: 'starred', resource_ids: [], revision: 2 })
        : serve(url, init)
    );
    await mount();
    mode = 'down';
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 第一页-1.md' }));
    await screen.findByText('没能刷新，显示的可能不是最新。');
    expect(screen.getByRole('button', { name: '第一页-1.md', exact: true })).toBeInTheDocument();
    mode = 'ok';
    fireEvent.click(
      within(screen.getByText('没能刷新，显示的可能不是最新。').closest('.arco-alert') as HTMLElement).getByRole(
        'button',
        { name: '重试' }
      )
    );
    await waitFor(() => expect(screen.queryByText('没能刷新，显示的可能不是最新。')).toBeNull());
    mode = 'gone';
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 第一页-1.md' }));
    await screen.findByText('资源列表没有读到');
    expect(screen.queryByRole('button', { name: '第一页-1.md', exact: true })).toBeNull();
  });

  it('多选在轮询带回新行 / 顺序变化时保留', async () => {
    capturePollTimers();
    let rows = [item('res_1', '第一页-1.md', { state: 'indexing' })];
    fixture(() => list(rows, rows.length));
    await mount();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 第一页-1.md', exact: true }));
    rows = [item('res_0', '新来的.md'), ...rows];
    await fire();
    await screen.findByRole('button', { name: '新来的.md', exact: true });
    expect(screen.getByRole('checkbox', { name: '选择 第一页-1.md', exact: true })).toBeChecked();
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

  it('忙到重读返回才放开；暂停状态在首次加载期间不闪“重试”，读失败后才出现', async () => {
    const pausedGate = deferred<ReturnType<typeof reply>>();
    let pausedFails = false;
    const serve = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/bridge/v1/memory-settings')
        return pausedFails ? { status: 503, ok: false, json: async () => ({}) } : pausedGate.promise;
      return serve(url, init);
    });
    render(<OfficeMemorySlot />);
    await screen.findByText('先写结论');
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull(); // 暂停状态还在读：不闪
    await act(async () => pausedGate.resolve(reply(200, { paused: false })));
    hold = deferred();
    fireEvent.click(screen.getByRole('button', { name: '接受' }));
    await waitFor(() => expect(accepts).toBe(1));
    expect(screen.getByRole('button', { name: '接受' })).toBeDisabled(); // 写已返回、重读还没回来：仍禁用
    await act(async () =>
      hold!.resolve(reply(200, { items: [mem('mem_1', '先写结论')], page: 1, page_size: 50, total: 1 }))
    );
    await waitFor(() => expect(screen.getByRole('button', { name: '接受' })).toBeEnabled());
  });
});
