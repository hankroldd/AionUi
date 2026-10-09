/**
 * [mycowork] 版本页正确性 C05：历史分页。后端每页 50 条，界面按页追加（“加载更早的版本”，带加载 / 失败重试 / 全部加载完的提示）；
 * “与上一版对比”用该版本的 parent_id，不用“已加载数组的下一条”；vN 标号按 total 倒数，追加分页后仍正确；覆盖 1 / 50 / 51 / 101 个版本。
 */
import React from 'react';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import { VersionsPage } from '@mycowork/ui/pages/versions/index.ts';
import { installBridge } from './versionsFixture';

configure({ asyncUtilTimeout: 4000 });
afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});
const open = (total: number, extra: Partial<Parameters<typeof installBridge>[0]> = {}) => {
  const bridge = installBridge({ total, ...extra });
  render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
  return bridge;
};
const timeline = () => screen.getByTestId('version-timeline');
const labels = () =>
  within(timeline())
    .getAllByTestId('version-item')
    .map((el) => el.querySelector('strong')?.textContent);
const diffCalls = (b: ReturnType<typeof installBridge>) =>
  b.calls.filter((c) => c.url.includes('/changes?')).map((c) => c.url.split('?')[1]);

describe('历史分页', () => {
  it.each([1, 50])('%i 个版本：不出现“加载更早的版本”，显示“已到最早的版本”', async (total) => {
    open(total);
    await screen.findByText('已到最早的版本');
    expect(screen.queryByRole('button', { name: '加载更早的版本' })).toBeNull();
    expect(labels()).toHaveLength(total);
    expect(labels()[0]).toBe(`v${total}`);
    expect(labels().at(-1)).toBe('v1');
  });

  it('51 个版本：首页只到 v2，点“加载更早的版本”后出现 v1 与“已到最早的版本”，标号不错位', async () => {
    const b = open(51);
    await screen.findByRole('button', { name: '加载更早的版本' });
    expect(labels().at(-1)).toBe('v2');
    expect(screen.getByText(/共 51 个版本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更早的版本' }));
    await screen.findByText('已到最早的版本');
    expect(labels()).toHaveLength(51);
    expect(labels().slice(-2)).toEqual(['v2', 'v1']);
    expect(b.calls.filter((c) => c.url.endsWith('?page=2'))).toHaveLength(1);
  });

  it('101 个版本：需要点两次，第二页之后标号仍按 total 倒数；中途不重复', async () => {
    open(101);
    fireEvent.click(await screen.findByRole('button', { name: '加载更早的版本' }));
    await waitFor(() => expect(labels()).toHaveLength(100));
    expect(labels()[99]).toBe('v2');
    fireEvent.click(screen.getByRole('button', { name: '加载更早的版本' }));
    await screen.findByText('已到最早的版本');
    expect(labels()).toHaveLength(101);
    expect(new Set(labels()).size).toBe(101);
    expect(labels().at(-1)).toBe('v1');
  });

  it('加载更早的版本失败：给人话原因和重试，已显示的不丢；重试成功后继续', async () => {
    const failPages = new Set([2]);
    open(60, { failPages });
    fireEvent.click(await screen.findByRole('button', { name: '加载更早的版本' }));
    await screen.findByText(/更早的版本没有读取成功/);
    expect(labels()).toHaveLength(50);
    failPages.delete(2);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('已到最早的版本');
    expect(labels()).toHaveLength(60);
  });

  it('“与上一版对比”用该版本的 parent_id：51 个版本时点 v2，对比的是 rev-1 → rev-2（v1 还没加载）', async () => {
    const b = open(51);
    await screen.findByRole('button', { name: '加载更早的版本' });
    fireEvent.click(within(timeline()).getAllByTestId('version-item')[49]!.querySelector('button.mcw-ver-pick')!);
    await waitFor(() => expect(diffCalls(b).at(-1)).toBe('from=rev-1&to=rev-2'));
    expect(screen.queryByText('这是最早的版本，没有上一版可对比。')).toBeNull();
  });

  it('真正的第一版（parent_id 为空）说“最早的版本，没有上一版”，不发对比请求', async () => {
    const b = open(3);
    await screen.findByText('已到最早的版本');
    const before = diffCalls(b).length;
    fireEvent.click(within(timeline()).getAllByTestId('version-item')[2]!.querySelector('button.mcw-ver-pick')!);
    await screen.findByText('这是最早的版本，没有上一版可对比。');
    expect(diffCalls(b)).toHaveLength(before);
  });

  it('对比区标题写明 vA → vB（上一版还没加载时也写 v1，不是短 id）', async () => {
    open(51);
    await screen.findByRole('button', { name: '加载更早的版本' });
    fireEvent.click(within(timeline()).getAllByTestId('version-item')[49]!.querySelector('button.mcw-ver-pick')!);
    expect(await screen.findByTestId('versions-compare-title')).toHaveTextContent('v1 → v2');
  });
});
