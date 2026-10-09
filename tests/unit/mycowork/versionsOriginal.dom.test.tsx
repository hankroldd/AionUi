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
  it('能在线看的类型（md）：“···”里是“查看这一版原件”链接，新标签页打开该版本自己的只读地址', async () => {
    installBridge({ total: 3, fileName: '虚构备忘.md' });
    const open = vi.spyOn(window, 'open');
    render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
    await screen.findByText('已到最早的版本');
    fireEvent.click(within(item(1)).getByRole('button', { name: '更多操作 v2' }));
    const link = await screen.findByRole('link', { name: '查看这一版原件' });
    expect(link).toHaveAttribute('href', '/bridge/v1/resources/resource-1/revisions/rev-2/content');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).not.toHaveAttribute('download');
    expect(open).not.toHaveBeenCalled();
  });

  it('点了原件链接后菜单关闭，不盖在下一行上', async () => {
    installBridge({ total: 3 });
    render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
    await screen.findByText('已到最早的版本');
    fireEvent.click(within(item(1)).getByRole('button', { name: '更多操作 v2' }));
    const link = await screen.findByRole('link', { name: '下载这一版' });
    link.addEventListener('click', (e) => e.preventDefault()); // jsdom 不做下载
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole('link', { name: '下载这一版' })).toBeNull()); // 隐藏的弹层不在可访问树里
  });

  it('docx 这类浏览器只会存到本机的类型：叫“下载这一版”，链接带 download，不开空白标签页', async () => {
    installBridge({ total: 3 });
    render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
    await screen.findByText('已到最早的版本');
    fireEvent.click(within(item(1)).getByRole('button', { name: '更多操作 v2' }));
    expect(screen.queryByText('查看这一版原件')).toBeNull();
    const link = await screen.findByRole('link', { name: '下载这一版' });
    expect(link).toHaveAttribute('href', '/bridge/v1/resources/resource-1/revisions/rev-2/content');
    expect(link).toHaveAttribute('download', '虚构文档.docx');
    expect(link).not.toHaveAttribute('target');
  });

  it('对比终点是历史版本：结果上的入口指向该版本（docx 叫“下载这一版”）；终点是当前版本：仍是“查看原件”指向当前内容预览', async () => {
    installBridge({ total: 3 });
    render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
    expect(await screen.findByRole('link', { name: '查看原件' })).toHaveAttribute(
      'href',
      '/bridge/v1/resources/resource-1/preview'
    );
    fireEvent.click(item(1).querySelector('button.mcw-ver-pick')!); // v2 相对上一版 → 终点是历史版本
    await waitFor(() => expect(screen.getByTestId('versions-compare-title')).toHaveTextContent('v1 → v2'));
    expect(await screen.findByRole('link', { name: '下载这一版' })).toHaveAttribute(
      'href',
      '/bridge/v1/resources/resource-1/revisions/rev-2/content'
    );
  });
});
