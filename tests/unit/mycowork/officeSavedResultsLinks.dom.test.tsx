/**
 * [mycowork] A513 切片 2（R068）。文件：tests/unit/mycowork/officeSavedResultsLinks.dom.test.tsx
 * 职责：结果入口交出固定版本；排版预览与下载均使用该版本，失败不回退当前内容。
 * 边界：仅替换 HTTP，不替换 SavedResults、SavedResultPreview 或版本客户端。
 */
import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TaskRun } from '@mycowork/contracts';
import { SavedResultPreview, SavedResults } from '@mycowork/ui';

const saved = (resource_id: string, revision_id: string): NonNullable<TaskRun['saved_results']> => [
  {
    kind: 'output',
    resource_id,
    revision_id,
    file_name: '结果.docx',
    content_sha256: 'a'.repeat(64),
    created_at: '2026-10-17T00:00:00Z',
  },
];
const run = (s: TaskRun['saved_results']): TaskRun => ({
  run_id: 'r',
  submission_id: '00000000-0000-4000-8000-000000000000',
  status: 'failed',
  created_at: '2026-10-17T00:00:00Z',
  saved_results: s,
});
const contentUrl = '/bridge/v1/resources/res_saved/revisions/rev_saved/content';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([
  ['res/0', 'rev_0'],
  ['res_0', 'rev-0'],
])('id 格式不对（%s, %s）只有文件名，没有可点击入口', (res, rev) => {
  const onOpen = vi.fn();
  render(<SavedResults run={run(saved(res, rev))} lang='zh-CN' onOpen={onOpen} />);
  expect(screen.getByText('结果.docx')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
});
it('合法结果点击交出原始资源与版本，保持当前位置', () => {
  const onOpen = vi.fn();
  const result = saved('res_saved', 'rev_saved')[0]!;
  const before = window.location.href;
  const other = { ...result, resource_id: 'res_other', revision_id: 'rev_other', file_name: '另一个.docx' };
  render(<SavedResults run={run([result, other])} lang='zh-CN' onOpen={onOpen} />);
  expect(screen.getByText('已登记 2 个结果')).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  const entry = screen.getByRole('button', { name: '结果.docx' });
  entry.focus();
  expect(entry).toHaveFocus();
  fireEvent.click(entry);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(result);
  expect(window.location.href).toBe(before);
  expect(screen.queryByRole('link')).toBeNull();
});

it('纯文本读取任务保存的版本，下载同一版本', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url === contentUrl ? new Response('任务保存时的正文') : new Response('不应读取的当前正文')
  );
  vi.stubGlobal('fetch', fetcher);
  render(<SavedResultPreview identity='res_saved/rev_saved' fileName='结果.txt' lang='zh-CN' />);
  expect(await screen.findByText('任务保存时的正文')).toBeInTheDocument();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([contentUrl]);
  expect(screen.getByRole('link', { name: '下载这一版' })).toHaveAttribute('href', contentUrl);
  expect(screen.getByRole('link', { name: '下载这一版' })).toHaveAttribute('download', '结果.txt');
  expect(screen.queryByRole('textbox')).toBeNull();
});
it('切换结果时迟到的旧版本不会覆盖新版本', async () => {
  let release!: (response: Response) => void;
  const fetcher = vi.fn((url: string) =>
    url === contentUrl
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : Promise.resolve(new Response('另一份已保存正文'))
  );
  vi.stubGlobal('fetch', fetcher);
  const view = render(<SavedResultPreview identity='res_saved/rev_saved' fileName='结果.txt' lang='zh-CN' />);
  await waitFor(() => expect(release).toBeTypeOf('function'));
  view.rerender(<SavedResultPreview identity='res_other/rev_other' fileName='另一个.txt' lang='zh-CN' />);
  expect(await screen.findByText('另一份已保存正文')).toBeInTheDocument();
  await act(async () => {
    release(new Response('不应出现的旧正文'));
  });
  expect(screen.queryByText('不应出现的旧正文')).toBeNull();
  expect(screen.getByRole('link', { name: '下载这一版' })).toHaveAttribute(
    'href',
    '/bridge/v1/resources/res_other/revisions/rev_other/content'
  );
});
it.each(['docx', 'pptx', 'xlsx'])('Office %s 渲染固定版本，不读当前预览', async (extension) => {
  const html = '<html><body><p>已保存的 Office 正文</p></body></html>';
  const fetcher = vi.fn(async (_url: string) => new Response(html));
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <SavedResultPreview identity='res_saved/rev_saved' fileName={`结果.${extension}`} lang='zh-CN' />
  );
  await waitFor(() => expect(view.container.querySelector('iframe')).not.toBeNull());
  const frame = view.container.querySelector('iframe')!;
  expect(frame).toHaveAttribute('srcdoc', expect.stringContaining(html));
  expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/bridge/v1/resources/res_saved/office/html?revision_id=rev_saved',
  ]);
  expect(screen.getAllByRole('link', { name: '下载这一版' })).toHaveLength(1);
  expect(screen.getByRole('link', { name: '下载这一版' })).toHaveAttribute('href', contentUrl);
});
it.each(['txt', 'docx'])('固定 %s 版本 404 显示失败且不读取当前内容', async (extension) => {
  const fetcher = vi.fn(
    async (_url: string) =>
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } }), { status: 404 })
  );
  vi.stubGlobal('fetch', fetcher);
  render(<SavedResultPreview identity='res_saved/rev_saved' fileName={`结果.${extension}`} lang='zh-CN' />);
  expect(await screen.findByText('找不到这个资源或版本，或你没有权限查看。', { exact: false })).toBeInTheDocument();
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(fetcher.mock.calls[0]?.[0]).toContain(
    extension === 'txt' ? '/revisions/rev_saved/content' : 'revision_id=rev_saved'
  );
  expect(screen.getByRole('link', { name: '下载这一版' })).toHaveAttribute('href', contentUrl);
  expect(screen.queryByText('任务保存时的正文')).toBeNull();
});
it('PDF 降级视图只提供一个固定版本下载入口', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<SavedResultPreview identity='res_saved/rev_saved' fileName='结果.pdf' lang='zh-CN' />);
  const downloads = screen.getAllByRole('link', { name: '下载这一版' });
  expect(downloads).toHaveLength(1);
  expect(downloads[0]).toHaveAttribute('href', contentUrl);
  expect(downloads[0]).toHaveAttribute('download', '结果.pdf');
  expect(fetcher).not.toHaveBeenCalled();
});
it('无法解析的固定版本不触发任何读取', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<SavedResultPreview identity='res_saved/current' fileName='结果.txt' lang='zh-CN' />);
  expect(screen.getByText('无法打开这份已保存版本。')).toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});
