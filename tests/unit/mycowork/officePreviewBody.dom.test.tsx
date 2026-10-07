/**
 * 文件：officePreviewBody.dom.test.tsx
 * 职责：共用只读正文的格式降级、安全覆盖、错误恢复与真实 AbortSignal 生命周期。
 * 边界：不替换被测正文/读取模块；仅提供 Bridge HTTP 与 Markdown Host 边界。
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { PreviewBody, versionsText, type RenderMarkdown } from '@mycowork/ui';

const text = versionsText('zh-CN');
const fetchMock = vi.fn();
const response = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const page = (body: string) => ({ ...response(200, null), text: async () => body });
const props = { text, resourceId: 'res_a', fileName: '虚构汇报.pptx' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
const signalAt = (at = 0) => fetchMock.mock.calls[at][1]?.signal as AbortSignal;
const frame = () => screen.getByTestId('preview-body').querySelector('iframe')!;
const markdown: RenderMarkdown = (content, overrides) => (
  <ReactMarkdown components={overrides}>{content}</ReactMarkdown>
);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('shared preview body — format and safety', () => {
  it.each(['docx', 'PPTX', 'xlsx'])(
    'reads %s through session Bridge HTML in a script-only opaque iframe',
    async (ext) => {
      const html = '<html><body><script>fixture()</script><p>虚构内容</p></body></html>';
      fetchMock.mockResolvedValue(page(html));
      render(<PreviewBody {...props} fileName={`虚构.${ext}`} />);
      await waitFor(() => expect(frame()).toHaveAttribute('srcdoc', html));
      expect(frame()).toHaveAttribute('sandbox', 'allow-scripts');
      expect(fetchMock.mock.calls).toHaveLength(1);
      expect(fetchMock.mock.calls[0][0]).toBe('/bridge/v1/resources/res_a/office/html');
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' });
      expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
      expect(signalAt()).toBeInstanceOf(AbortSignal);
    }
  );

  it('previews an upstream original without a Bridge head or filename, leaving format detection to Bridge', async () => {
    fetchMock.mockResolvedValue(page('<html><body>上游原件（虚构）</body></html>'));
    render(<PreviewBody {...props} resourceId='res upstream' fileName={null} />);
    await waitFor(() => expect(frame()).toHaveAttribute('srcdoc', expect.stringContaining('上游原件')));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/bridge/v1/resources/res%20upstream/office/html']);
  });

  it('renders txt as escaped text rather than executing HTML', async () => {
    const content = '<img src="https://fixture.invalid/track" onerror="alert(1)"><script>fixture()</script>';
    fetchMock.mockResolvedValue(page(content));
    render(<PreviewBody {...props} fileName='虚构.txt' />);
    await screen.findByText(content);
    expect(screen.getByTestId('preview-body').querySelector('pre')).toHaveTextContent(content);
    expect(screen.getByTestId('preview-body').querySelector('img,script,iframe')).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/bridge/v1/resources/res_a/preview');
  });
});

describe('shared preview body — Markdown and unsupported formats', () => {
  it('uses Host Markdown with blocked remote/local images and plain code including mermaid markup', async () => {
    const content =
      '# 虚构方案\n\n![追踪](https://fixture.invalid/track)\n![本机](/tmp/private.png)\n\n```mermaid\nflowchart TD\n A[<img src="https://fixture.invalid/chart">]\n```';
    fetchMock.mockResolvedValue(page(content));
    const host = vi.fn(markdown);
    render(<PreviewBody {...props} fileName='虚构.md' renderMarkdown={host} />);
    await screen.findByRole('heading', { name: '虚构方案' });
    expect(screen.getByText('［图片：追踪——预览不加载图片］')).toBeInTheDocument();
    expect(screen.getByText('［图片：本机——预览不加载图片］')).toBeInTheDocument();
    expect(screen.getByTestId('preview-body').querySelector('code')).toHaveTextContent(
      'A[<img src="https://fixture.invalid/chart">]'
    );
    expect(screen.getByTestId('preview-body').querySelector('img,svg,canvas,iframe')).toBeNull();
    expect(host).toHaveBeenCalledWith(
      content,
      expect.objectContaining({ img: expect.any(Function), code: expect.any(Function) })
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/bridge/v1/resources/res_a/preview']);
  });

  it('falls back to escaped Markdown text when the Host supplies no renderer', async () => {
    const content = '# 虚构方案\n<img src="https://fixture.invalid/track">';
    fetchMock.mockResolvedValue(page(content));
    render(<PreviewBody {...props} fileName='虚构.markdown' />);
    await waitFor(() =>
      expect(screen.getByTestId('preview-body').querySelector('pre')).toHaveTextContent('# 虚构方案')
    );
    expect(screen.getByTestId('preview-body').querySelector('pre')!.textContent).toBe(content);
    expect(screen.getByTestId('preview-body').querySelector('img,h1')).toBeNull();
  });

  it.each(['pdf', 'png', 'svg'])('explains unsupported %s without any rendering or content read', (ext) => {
    render(<PreviewBody {...props} fileName={`虚构.${ext}`} />);
    expect(screen.getByText('暂不支持在这里预览')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载当前内容' })).toHaveAttribute(
      'href',
      '/bridge/v1/resources/res_a/preview'
    );
    expect(screen.getByTestId('preview-body').querySelector('iframe,pre,img')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('limits only displayed text to one million characters and reports the truncation', async () => {
    fetchMock.mockResolvedValue(page('x'.repeat(1_000_000) + '不可见尾部'));
    render(<PreviewBody {...props} fileName='虚构.txt' />);
    await screen.findByText('文件较大，只显示前 100 万个字符。');
    expect(screen.getByTestId('preview-body').querySelector('pre')!.textContent).toHaveLength(1_000_000);
    expect(screen.queryByText(/不可见尾部/)).toBeNull();
  });
});

describe('shared preview body — failures and retry', () => {
  it.each([
    [404, 'NOT_FOUND', '找不到这个资源或版本，或你没有权限查看。', true],
    [401, 'UNAUTHENTICATED', '登录已过期，请重新登录后再试。', true],
    [422, 'UNSUPPORTED_FORMAT', '文件已加密，无法预览。', false],
    [503, 'UPSTREAM_UNAVAILABLE', '预览工具未配置或暂不可用，请稍后重试；文件本身不受影响。', true],
  ])(
    'classifies HTTP %s, keeps error body out of content, and exposes the matching recovery',
    async (status, code, message, retry) => {
      fetchMock.mockResolvedValue(response(status as number, { error: { code, message: 'preflight: encrypted' } }));
      render(<PreviewBody {...props} />);
      await screen.findByText(message as string);
      expect(screen.getByTestId('preview-body').querySelector('iframe,pre')).toBeNull();
      expect(screen.queryByRole('button', { name: '重试' }) !== null).toBe(retry);
      if (!retry) expect(screen.getByRole('link', { name: '下载当前内容' })).toBeInTheDocument();
    }
  );

  it('retries a failed read with a fresh signal and never creates an editor session, plan or write', async () => {
    fetchMock
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(page('<html><body>重试成功（虚构）</body></html>'));
    render(<PreviewBody {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '重试' }));
    await waitFor(() => expect(frame()).toHaveAttribute('srcdoc', expect.stringContaining('重试成功')));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(Array(2).fill('/bridge/v1/resources/res_a/office/html'));
    expect(signalAt(0).aborted).toBe(true);
    expect(signalAt(1).aborted).toBe(false);
    expect(signalAt(0)).not.toBe(signalAt(1));
    expect(fetchMock.mock.calls.every(([, init]) => !init.body && !init.method)).toBe(true);
  });
});

describe('shared preview body — cancellation and stale responses', () => {
  it('aborts fetch when unmounted', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const mounted = render(<PreviewBody {...props} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(signalAt().aborted).toBe(false);
    mounted.unmount();
    expect(signalAt().aborted).toBe(true);
  });

  it('aborts the old resource read and rejects its late response after another resource has rendered', async () => {
    const late = deferred<ReturnType<typeof page>>();
    fetchMock.mockReturnValueOnce(late.promise).mockResolvedValueOnce(page('<html><body>B（虚构）</body></html>'));
    const mounted = render(<PreviewBody {...props} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const old = signalAt();
    mounted.rerender(<PreviewBody {...props} resourceId='res_b' />);
    expect(old.aborted).toBe(true);
    await waitFor(() => expect(frame()).toHaveAttribute('srcdoc', expect.stringContaining('B（虚构）')));
    await act(async () => {
      late.resolve(page('<html><body>A迟到（虚构）</body></html>'));
    });
    expect(frame()).toHaveAttribute('srcdoc', expect.stringContaining('B（虚构）'));
    expect(frame()).not.toHaveAttribute('srcdoc', expect.stringContaining('A迟到'));
  });

  it('refresh replaces an unfinished request with a new real signal and ignores the old text body arriving late', async () => {
    const lateBody = deferred<string>();
    fetchMock
      .mockResolvedValueOnce({ ...response(200, null), text: () => lateBody.promise })
      .mockResolvedValueOnce(page('<html><body>刷新后（虚构）</body></html>'));
    const mounted = render(<PreviewBody {...props} refreshKey={0} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    mounted.rerender(<PreviewBody {...props} refreshKey={1} />);
    expect(signalAt(0).aborted).toBe(true);
    await waitFor(() => expect(frame()).toHaveAttribute('srcdoc', expect.stringContaining('刷新后')));
    await act(async () => {
      lateBody.resolve('<html><body>旧正文迟到（虚构）</body></html>');
    });
    expect(frame()).toHaveAttribute('srcdoc', expect.stringContaining('刷新后'));
    expect(signalAt(1).aborted).toBe(false);
  });

  it('a changed head cancels the old read without using the head as a body version identity', async () => {
    const late = deferred<ReturnType<typeof page>>();
    fetchMock
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(page('<html><body>当前内容（虚构）</body></html>'));
    const mounted = render(<PreviewBody {...props} head='rev_old' />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    mounted.rerender(<PreviewBody {...props} head='rev_new' />);
    expect(signalAt(0).aborted).toBe(true);
    await waitFor(() => expect(frame()).toHaveAttribute('srcdoc', expect.stringContaining('当前内容')));
    await act(async () => {
      late.resolve(page('<html><body>旧 head 的迟到正文</body></html>'));
    });
    expect(frame()).not.toHaveAttribute('srcdoc', expect.stringContaining('旧 head'));
    expect(screen.queryByText('rev_new')).toBeNull();
  });
});
