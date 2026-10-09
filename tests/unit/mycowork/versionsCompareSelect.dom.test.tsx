/**
 * [mycowork] 版本页正确性 C06：比较结果必须属于当前选择。下拉改选立即作废在途对比并清掉旧结果；响应的资源 id / 版本对与当前选择不一致不渲染；
 * 新版本到来（保存事件 / 30 秒重读）时，没手动选过版本对 → 跟随到“上一版 → 最新版”，手动选过 → 不动，对比区顶部给可点的“有新版本 vN，查看最新变化”。
 */
import React from 'react';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import { VersionsPage } from '@mycowork/ui/pages/versions/index.ts';
import { RESOURCE_CHANGED } from '@mycowork/ui/pages/office-editor/index.ts';
import { diffOf, installBridge, json, RES } from './versionsFixture';

configure({ asyncUtilTimeout: 4000 });
afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const page = <VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />;
const title = () => screen.queryByTestId('versions-compare-title')?.textContent;
const diffUrls = (b: ReturnType<typeof installBridge>) => b.calls.filter((c) => c.url.includes('/changes?')).map((c) => c.url.split('?')[1]);
const withChange = (from: string, to: string, text: string) => ({
  ...diffOf(from, to),
  changes: [{ kind: 'modified', node_type: 'paragraph', to_path: '/body/p[1]', aspects: ['text'], text_before: '旧', text_after: text }],
});
async function choose(label: '对比起点' | '对比终点', option: RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByText(option, { selector: '.arco-select-option' }));
}
const pick = (n: number) => within(screen.getByTestId('version-timeline')).getAllByTestId('version-item')[n]!.querySelector('button.mcw-ver-pick')!;

describe('改选作废在途对比', () => {
  it('自动对比还没回来时在下拉里改选：旧结果迟到也不渲染，也不会把选择改回去', async () => {
    let release!: (r: Response) => void;
    const b = installBridge({
      total: 4,
      diff: (from, to) => (from === 'rev-3' ? new Promise<Response>((r) => (release = r)) : json(diffOf(from, to))),
    });
    render(page);
    await waitFor(() => expect(diffUrls(b)).toEqual(['from=rev-3&to=rev-4']));
    await choose('对比起点', /^v1 /);
    expect(title()).toBe('v1 → v4');
    await act(async () => release(json(withChange('rev-3', 'rev-4', '迟到的结果'))));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/迟到的结果/)).toBeNull();
    expect(title()).toBe('v1 → v4');
    expect(screen.getByRole('combobox', { name: '对比起点' }).textContent).toContain('v1');
    expect(screen.queryByTestId('version-diff')).toBeNull();
    expect(screen.getByText(/点“对比这两个版本”/)).toBeInTheDocument();
  });

  it('改选后旧的对比结果立即清掉，点“对比这两个版本”才出新结果', async () => {
    const b = installBridge({ total: 4, diff: (f, t) => json(withChange(f, t, `${f}到${t}`)) });
    render(page);
    await screen.findByText(/rev-3到rev-4/);
    await choose('对比起点', /^v2 /);
    expect(screen.queryByText(/rev-3到rev-4/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '对比这两个版本' }));
    await screen.findByText(/rev-2到rev-4/);
    expect(title()).toBe('v2 → v4');
    expect(diffUrls(b).at(-1)).toBe('from=rev-2&to=rev-4');
  });

  it('响应里的版本对与当前选择不一致：不渲染，给“对比没有完成”', async () => {
    installBridge({ total: 3, diff: () => json(withChange('rev-x', 'rev-y', '别人的结果')) });
    render(page);
    await screen.findByText('这次对比没有完成');
    expect(screen.queryByText(/别人的结果/)).toBeNull();
    expect(screen.queryByTestId('version-diff')).toBeNull();
  });

  it('点时间线条目时在途的旧对比同样作废', async () => {
    let release!: (r: Response) => void;
    installBridge({
      total: 4,
      diff: (from, to) => (to === 'rev-4' ? new Promise<Response>((r) => (release = r)) : json(withChange(from, to, `改成${to}`))),
    });
    render(page);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.click(pick(1)); // v3 相对上一版
    await screen.findByText(/改成rev-3/);
    await act(async () => release(json(withChange('rev-3', 'rev-4', '迟到的结果'))));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/迟到的结果/)).toBeNull();
    expect(title()).toBe('v2 → v3');
  });
});

describe('新版本到来', () => {
  const publish = (b: ReturnType<typeof installBridge>, total: number) => {
    b.hooks.total = total;
  };
  const changed = () => act(async () => void window.dispatchEvent(new CustomEvent(RESOURCE_CHANGED, { detail: { resourceId: RES } })));

  it('没手动选过：跟随到“上一版 → 最新版”并重新对比', async () => {
    const b = installBridge({ total: 3 });
    render(page);
    await waitFor(() => expect(title()).toBe('v2 → v3'));
    publish(b, 4);
    await changed();
    await waitFor(() => expect(title()).toBe('v3 → v4'));
    expect(diffUrls(b).at(-1)).toBe('from=rev-3&to=rev-4');
    expect(screen.queryByRole('button', { name: /有新版本/ })).toBeNull();
  });

  it('手动选过：保持不变，只在对比区顶部提示；点提示才跳到最新变化', async () => {
    const b = installBridge({ total: 3 });
    render(page);
    await waitFor(() => expect(title()).toBe('v2 → v3'));
    fireEvent.click(pick(2)); // 手动看 v1 …
    await waitFor(() => expect(title()).not.toBe('v2 → v3'));
    await choose('对比起点', /^v1 /);
    await choose('对比终点', /^v2 /);
    fireEvent.click(screen.getByRole('button', { name: '对比这两个版本' }));
    await waitFor(() => expect(title()).toBe('v1 → v2'));
    const calls = diffUrls(b).length;
    publish(b, 4);
    await changed();
    const hint = await screen.findByRole('button', { name: '有新版本 v4，查看最新变化' });
    expect(title()).toBe('v1 → v2');
    expect(diffUrls(b)).toHaveLength(calls);
    fireEvent.click(hint);
    await waitFor(() => expect(title()).toBe('v3 → v4'));
    expect(screen.queryByRole('button', { name: /有新版本/ })).toBeNull();
  });

  it('30 秒重读读到新版本，同样遵守“跟随 / 提示”', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const b = installBridge({ total: 3 });
    render(page);
    await waitFor(() => expect(title()).toBe('v2 → v3'));
    publish(b, 4);
    await act(async () => void vi.advanceTimersByTime(30_000));
    await waitFor(() => expect(title()).toBe('v3 → v4'));
  });
});
