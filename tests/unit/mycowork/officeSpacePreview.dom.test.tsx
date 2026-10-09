/**
 * 文件：officeSpacePreview.dom.test.tsx
 * 职责：真实资源名称、全屏 Arco 壳、页面现场保持与关闭/账号切换读取取消。
 * 边界：只替换 Bridge HTTP；不用 jsdom 的几何或键盘模拟冒充真实浏览器焦点锁验收。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';

const fetchMock = vi.fn();
const response = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const page = (body: string) => ({ ...response(200, null), text: async () => body });
const name = '虚构长文件名——项目汇报与修订意见——没有Bridge版本也能预览.pptx';
const resources = [name, '虚构备忘.txt'].map((file_name, i) => ({
  resource_id: `res_${i}`,
  file_name,
  source_id: null,
  origin: 'imports',
  state: 'stored',
  tag_ids: [],
  secret: i === 0,
  can_mark_secret: true,
  revision_count: 0,
  updated_at: '2026-10-04T00:00:00Z',
}));
function fixture(preview: () => unknown = () => page('<html><body>当前原件（虚构）</body></html>')) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/scopes') return response(200, { sources: [], projects: [] });
    if (url === '/bridge/v1/tags') return response(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return response(200, { views: [] });
    if (url === '/bridge/v1/collections') return response(200, { collections: [] });
    if (url.startsWith('/bridge/v1/resources?')) {
      const query = new URLSearchParams(url.split('?')[1]);
      const items = resources.filter((r) => r.file_name.includes(query.get('q') ?? ''));
      return response(200, { items, page: 1, page_size: 50, total: items.length });
    }
    if (/\/resources\/res_\d\/(office\/html|preview)$/.test(url)) return preview();
    return response(404, { error: { code: 'NOT_FOUND', message: 'unexpected fixture read' } });
  });
}
const contentCalls = () =>
  fetchMock.mock.calls.filter(([url]) => /\/res_\d\/(office\/html|preview)$/.test(String(url)));
const listCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/bridge/v1/resources?'));
const open = async () => {
  const trigger = await screen.findByRole('button', { name });
  trigger.focus();
  fireEvent.click(trigger);
  return { trigger, dialog: await screen.findByRole('dialog', { name: '当前内容预览' }) };
};

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/office/space';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fixture();
});
afterEach(() => vi.unstubAllGlobals());

describe('space names and read-only fullscreen shell', () => {
  it.each(['card', 'list', 'table'])(
    'opens the same real Arco preview from the %s layout preference instead of navigating',
    async (layout) => {
      localStorage.setItem('mycowork.resources.layout', layout);
      render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
      const { trigger, dialog } = await open();
      expect(trigger).not.toHaveAttribute('href');
      expect(dialog).toHaveClass('mcw-modal', 'mcw-space-preview');
      await waitFor(() =>
        expect(within(dialog).getByTitle(`${name} 的只读预览`)).toHaveAttribute('sandbox', 'allow-scripts')
      );
      expect(window.location.hash).toBe('#/office/space');
      expect(contentCalls()).toHaveLength(1);
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/revisions'))).toBe(false);
      expect(fetchMock.mock.calls.every(([, init]) => !init.method && !init.body)).toBe(true);
    }
  );

  it('keeps query, selection, layout and list requests unchanged when the preview opens and closes', async () => {
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    await screen.findByRole('button', { name });
    const search = screen.getByRole('textbox', { name: '搜索文件名或标签' });
    fireEvent.change(search, { target: { value: '虚构' } });
    await waitFor(() => expect(listCalls().at(-1)![0]).toContain('q=%E8%99%9A%E6%9E%84'));
    fireEvent.click(await screen.findByRole('checkbox', { name: `选择 ${name}` }));
    fireEvent.click(screen.getByLabelText('网格'));
    const listBefore = listCalls().length;
    const storedBefore = { ...localStorage };
    const { trigger, dialog } = await open();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭预览' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '当前内容预览' })).toBeNull());
    expect(search).toHaveValue('虚构');
    expect(screen.getByRole('checkbox', { name: `选择 ${name}` })).toBeChecked();
    expect(document.querySelector('.mcw-rc-grid')).not.toBeNull();
    expect(listCalls()).toHaveLength(listBefore);
    expect({ ...localStorage }).toEqual(storedBefore);
    expect(trigger).toHaveFocus();
  });
});

describe('space preview toolbar', () => {
  it('provides complete filename and current-content links while zooming only the display', async () => {
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    const { dialog } = await open();
    await waitFor(() => expect(contentCalls()).toHaveLength(1));
    const reads = fetchMock.mock.calls.length;
    expect(dialog.querySelector('.mcw-space-preview-name')).toHaveTextContent(name);
    expect(within(dialog).getByRole('link', { name: '下载' })).toHaveAttribute(
      'href',
      '/bridge/v1/resources/res_0/preview'
    );
    expect(within(dialog).getByRole('link', { name: '版本与变化' })).toHaveAttribute(
      'href',
      '#/office/resources/res_0/versions'
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '放大' }));
    expect(within(dialog).getByRole('button', { name: '重置缩放' })).toHaveTextContent('125%');
    expect(dialog.querySelector('.mcw-space-preview-scale')).toHaveStyle({ transform: 'scale(1.25)' });
    fireEvent.click(within(dialog).getByRole('button', { name: '缩小' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '缩小' }));
    expect(within(dialog).getByRole('button', { name: '重置缩放' })).toHaveTextContent('75%');
    fireEvent.click(within(dialog).getByRole('button', { name: '重置缩放' }));
    expect(dialog.querySelector('.mcw-space-preview-scale')).toHaveStyle({ transform: 'scale(1)' });
    expect(fetchMock.mock.calls).toHaveLength(reads);
  });

  it('uses English names for every toolbar action without exposing an unconnected question input', async () => {
    render(<ResourcesPage lang='en-US' ownerKey='fixture_a' />);
    fireEvent.click(await screen.findByRole('button', { name }));
    const dialog = await screen.findByRole('dialog', { name: 'Current content preview' });
    for (const action of ['Zoom out', 'Zoom in', 'Reset zoom', 'Close preview'])
      expect(within(dialog).getByRole('button', { name: action })).toBeInTheDocument();
    for (const action of ['Download', 'Versions and changes'])
      expect(within(dialog).getByRole('link', { name: action })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });
});

describe('space preview request cancellation', () => {
  it('close immediately aborts the fetch signal and unmounts the body before the Arco exit animation, rejecting late bytes', async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    fixture(
      () =>
        new Promise<ReturnType<typeof page>>((resolve) => {
          finish = resolve;
        })
    );
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    const { dialog } = await open();
    await waitFor(() => expect(contentCalls()).toHaveLength(1));
    const signal = contentCalls()[0][1].signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭预览' }));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByTestId('preview-body')).toBeNull();
    await act(async () => {
      finish(page('<html><body>关闭后迟到（虚构）</body></html>'));
    });
    expect(document.querySelector('iframe')).toBeNull();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('an owner change synchronously clears the independent page preview and aborts the old request without returning old focus', async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    fixture(
      () =>
        new Promise<ReturnType<typeof page>>((resolve) => {
          finish = resolve;
        })
    );
    const mounted = render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    const { trigger } = await open();
    await waitFor(() => expect(contentCalls()).toHaveLength(1));
    const signal = contentCalls()[0][1].signal as AbortSignal;
    const focus = vi.spyOn(trigger, 'focus');
    mounted.rerender(<ResourcesPage lang='zh-CN' ownerKey='fixture_b' />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByTestId('preview-body')).toBeNull();
    await act(async () => {
      finish(page('<html><body>旧账号迟到（虚构）</body></html>'));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('iframe')).toBeNull();
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });
});
