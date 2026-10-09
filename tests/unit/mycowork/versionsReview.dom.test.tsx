/**
 * [mycowork] 版本页正确性审查跟进：翻页期间出了新版本（标号对、无重复、请求有上限、零进展不循环）；恢复遇到版本已变 / 结果未知后放弃 / 内容相同都重读时间线；
 * 同一拍连点“恢复”只发一个请求；换资源收起恢复弹窗；“有新版本”提示只在看的就是最新版时撤掉。
 */
import React from 'react';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import { VersionsPage } from '@mycowork/ui/pages/versions/index.ts';
import { RESOURCE_CHANGED } from '@mycowork/ui/pages/office-editor/index.ts';
import { installBridge, json, revItem, RES } from './versionsFixture';

configure({ asyncUtilTimeout: 4000 });
afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});
const ui = (id = 'resource-1') => <VersionsPage resourceId={id} lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />;
const items = () => within(screen.getByTestId('version-timeline')).getAllByTestId('version-item');
const labels = () => items().map((el) => el.querySelector('strong')?.textContent);
const timelineGets = (b: ReturnType<typeof installBridge>) =>
  b.calls.filter((c) => c.method === 'GET' && /\/revisions(\?page=\d+)?$/.test(c.url)).length;
const pageCalls = (b: ReturnType<typeof installBridge>) => b.calls.filter((c) => /\?page=\d+$/.test(c.url)).length;
async function openRestore(label: string) {
  fireEvent.click(
    within(await screen.findByTestId('version-timeline')).getByRole('button', { name: `更多操作 ${label}` })
  );
  fireEvent.click(await screen.findByRole('menuitem', { name: '恢复为新版本' }));
  return screen.findByRole('dialog');
}

describe('翻页期间出了新版本', () => {
  it('已加载第一页 → 新增一版 → 点“加载更早”：标号对、没有重复、请求次数有上限', async () => {
    const b = installBridge({ total: 60 });
    render(ui());
    await screen.findByRole('button', { name: '加载更早的版本' });
    b.hooks.total = 61; // 此时文件出了新版本
    fireEvent.click(screen.getByRole('button', { name: '加载更早的版本' }));
    await screen.findByText('已到最早的版本');
    await waitFor(() => expect(labels()).toHaveLength(61));
    expect(new Set(labels()).size).toBe(61);
    expect(labels()[0]).toBe('v61');
    expect(labels().at(-1)).toBe('v1');
    expect(screen.getByText(/共 61 个版本/)).toBeInTheDocument();
    expect(pageCalls(b)).toBeLessThanOrEqual(2);
  });

  it('这页一条新的都没有（服务端异常）：不连续请求，也不死循环', async () => {
    const b = installBridge({ total: 51 });
    const orig = globalThis.fetch;
    let page2 = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (!url.endsWith('?page=2')) return orig(url, init);
      page2++;
      return json(b.timelinePage(1));
    });
    render(ui());
    await screen.findByRole('button', { name: '加载更早的版本' });
    fireEvent.click(items()[49]!.querySelector('button.mcw-ver-pick')!); // 上一版 v1 还没加载 → 自动取下一页
    await waitFor(() => expect(page2).toBeGreaterThanOrEqual(1));
    await new Promise((r) => setTimeout(r, 400));
    const n = page2;
    await new Promise((r) => setTimeout(r, 400));
    expect(page2).toBe(n);
    expect(n).toBeLessThanOrEqual(2);
    expect(labels()).toHaveLength(50);
  });
});

describe('恢复后重读', () => {
  it('版本已变（REVISION_CONFLICT）：重读时间线，当前版本跟上', async () => {
    const b = installBridge({ total: 3, restore: () => json({ error: { code: 'REVISION_CONFLICT' } }, 409) });
    render(ui());
    const dialog = await openRestore('v1');
    const before = timelineGets(b);
    b.hooks.total = 4;
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    await within(dialog).findByText(/文件刚刚出了新版本/);
    await waitFor(() => expect(timelineGets(b)).toBeGreaterThan(before));
    await waitFor(() => expect(items()).toHaveLength(4));
  });

  it('结果未知后放弃（关闭弹窗）：重读时间线', async () => {
    const b = installBridge({
      total: 3,
      restore: () => {
        throw new TypeError('network down');
      },
    });
    render(ui());
    const dialog = await openRestore('v1');
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    await within(dialog).findByText(/没有收到恢复结果/);
    const before = timelineGets(b);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(timelineGets(b)).toBeGreaterThan(before));
  });

  it('服务端说内容相同：重读时间线', async () => {
    const b = installBridge({ total: 3, restore: () => json({ created: false, revision: revItem(3, 3) }, 200) });
    render(ui());
    const dialog = await openRestore('v1');
    const before = timelineGets(b);
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    await within(dialog).findByText('这一版和当前版本内容相同，不需要恢复。');
    await waitFor(() => expect(timelineGets(b)).toBeGreaterThan(before));
  });

  it('同一拍连点两次“恢复”只发一个请求', async () => {
    let release!: (r: Response) => void;
    const b = installBridge({ total: 3, restore: () => new Promise<Response>((r) => (release = r)) });
    render(ui());
    const dialog = await openRestore('v1');
    const ok = within(dialog).getByRole('button', { name: '恢复为新版本' });
    act(() => {
      ok.click();
      ok.click();
    });
    await waitFor(() => expect(b.calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    await act(async () => release(json({ error: { code: 'REVISION_CONFLICT' } }, 409)));
  });

  it('换资源时收起恢复弹窗，旧资源迟到的响应不再报“已恢复”', async () => {
    let release!: (r: Response) => void;
    installBridge({ total: 3, restore: () => new Promise<Response>((r) => (release = r)) });
    const view = render(ui('resource-1'));
    const dialog = await openRestore('v1');
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    await within(dialog).findByText('正在恢复…');
    view.rerender(ui('resource-2'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () =>
      release(json({ created: true, revision: revItem(4, 4, { origin: 'restore', restored_from: 'rev-1' }) }, 201))
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText(/已恢复为新版本/)).toBeNull();
  });
});

describe('“有新版本”提示', () => {
  const pick = (n: number) => items()[n]!.querySelector('button.mcw-ver-pick')!;
  it('手动选过后到来的新版本：对比别的版本不撤提示，看的就是最新版才撤', async () => {
    const b = installBridge({ total: 3 });
    render(ui());
    await waitFor(() => expect(screen.getByTestId('versions-compare-title')).toHaveTextContent('v2 → v3'));
    fireEvent.click(pick(2)); // 手动选过
    b.hooks.total = 4;
    await act(
      async () => void window.dispatchEvent(new CustomEvent(RESOURCE_CHANGED, { detail: { resourceId: RES } }))
    );
    const hint = await screen.findByRole('button', { name: '有新版本 v4，查看最新变化' });
    fireEvent.click(pick(2)); // 另一个旧版本
    expect(hint).toBeInTheDocument();
    fireEvent.click(pick(0)); // 最新版
    await waitFor(() => expect(screen.queryByRole('button', { name: /有新版本/ })).toBeNull());
  });
});
