/**
 * 文件：officePreviewIdentity.dom.test.tsx
 * 职责：A107 当前读取与父时间线版本身份分离，以及版本预览真实请求取消。
 * 边界：真实 React/Arco/版本页与读取链，只替换 Bridge HTTP；不推断历史版本字节。
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { VersionsPage } from '@mycowork/ui';

const fetchMock = vi.fn();
const response = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const page = (body: string) => ({ ...response(200, null), text: async () => body });
const markdown = (body: string) => <div>{body}</div>;
const revision = (id: string, current: boolean) => ({
  revision_id: id,
  parent_id: null,
  content_sha256: 'fixture',
  size: 1,
  created_at: '2026-10-04T00:00:00Z',
  origin: 'edit',
  current,
});
function fixture(preview: () => unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/revisions'))
      return response(200, {
        resource_id: 'res_identity',
        current_revision_id: 'rev_b',
        file_name: '虚构汇报.pptx',
        items: [revision('rev_b', true), revision('rev_a', false)],
        page: 1,
        page_size: 50,
        total: 2,
      });
    if (url.endsWith('/office/html')) return preview();
    if (url.includes('/changes?')) return response(422, { error: { code: 'UNSUPPORTED_FORMAT' } });
    if (url.endsWith('/metadata')) return response(200, { secret: false });
    if (url === '/bridge/v1/scopes') return response(200, { sources: [], projects: [] });
    if (url === '/bridge/v1/edit-sessions' || url.startsWith('/bridge/v1/publications?'))
      return response(200, { items: [] });
    return response(404, { error: { code: 'NOT_FOUND' } });
  });
}
const previewCall = () => fetchMock.mock.calls.find(([url]) => String(url).endsWith('/office/html'));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('A107/A321 — the preview title carries a version number only while it matches the list', () => {
  it('shows later current GET bytes while the parent timeline still says v2; the title carries the list\'s current version, the body is not claimed to be it', async () => {
    let finish!: (value: ReturnType<typeof page>) => void;
    const pending = new Promise<ReturnType<typeof page>>((resolve) => {
      finish = resolve;
    });
    fixture(() => pending);
    render(<VersionsPage lang='zh-CN' resourceId='res_identity' renderMarkdown={markdown} />);
    await waitFor(() => expect(previewCall()).toBeDefined());
    expect(screen.getAllByText('v2').length).toBeGreaterThan(0);
    await act(async () => {
      finish(page('<html><body>另一次保存后的当前内容（虚构 rev_c）</body></html>'));
    });
    const box = screen.getByTestId('versions-preview');
    await waitFor(() => expect(box.querySelector('iframe')).not.toBeNull());
    expect(box.querySelector('iframe')).toHaveAttribute('srcdoc', expect.stringContaining('虚构 rev_c'));
    expect(box.querySelector('.mcw-ver-preview-title')).toHaveTextContent(/^当前内容预览 · v2$/); // 负责人 2026-10-09 要看到版本号：取版本列表里的当前版本，正文仍读此刻的当前内容（最多 30 秒后与列表对齐）
  });

  it('passes a real AbortSignal through fetch and aborts an unfinished current GET when the version page unmounts', async () => {
    fixture(() => new Promise(() => {}));
    const mounted = render(<VersionsPage lang='zh-CN' resourceId='res_identity' renderMarkdown={markdown} />);
    await waitFor(() => expect(previewCall()).toBeDefined());
    const signal = previewCall()![1]?.signal as AbortSignal | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
    mounted.unmount();
    expect(signal!.aborted).toBe(true);
  });
});
