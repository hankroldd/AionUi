/**
 * [mycowork] 版本页正确性 C07：历史版本也能查看原件。时间线每个版本的“···”里有“查看这一版原件”，指向只读的 revisions/{id}/content；
 * 对比区终点是历史版本时“查看原件”指向它自己的字节，终点是当前版本时仍指向当前内容预览。
 */
import React from 'react';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { VersionsPage } from '@mycowork/ui/pages/versions/index.ts';
import { installBridge } from './versionsFixture';

configure({ asyncUtilTimeout: 4000 });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const item = (n: number) => within(screen.getByTestId('version-timeline')).getAllByTestId('version-item')[n]!;

describe('历史版本的原件入口', () => {
  it('“···”里“查看这一版原件”打开该版本自己的只读地址（不是当前内容）', async () => {
    installBridge({ total: 3 });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
    await screen.findByText('已到最早的版本');
    fireEvent.click(within(item(1)).getByRole('button', { name: '更多操作 v2' }));
    fireEvent.click(await screen.findByText('查看这一版原件'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toBe('/bridge/v1/resources/resource-1/revisions/rev-2/content');
    expect(open.mock.calls[0]?.[1]).toBe('_blank');
  });

  it('对比终点是历史版本：对比结果上的“查看原件”指向该版本；终点是当前版本：指向当前内容预览', async () => {
    installBridge({ total: 3 });
    render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
    const link = () => screen.findByRole('link', { name: '查看原件' });
    expect(await link()).toHaveAttribute('href', '/bridge/v1/resources/resource-1/preview'); // 自动对比 v2 → v3
    fireEvent.click(item(1).querySelector('button.mcw-ver-pick')!); // v2 相对上一版 → 终点是历史版本
    await waitFor(() => expect(screen.getByTestId('versions-compare-title')).toHaveTextContent('v1 → v2'));
    expect(await link()).toHaveAttribute('href', '/bridge/v1/resources/resource-1/revisions/rev-2/content');
  });
});
