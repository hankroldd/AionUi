/**
 * 文件：tests/unit/mycowork/officeWatchLifecycle.dom.test.tsx
 * 职责：用迟到的后端 start/stop 验证重复打开、重开、切文件与卸载的预览生命周期；
 *       并区分“预览连接断开、文件仍在”与“文件不存在”，重开后回到同一文件同一位置（A528）。
 * 边界：渲染真实查看器，只替换后端、平台与 Webview 边界；虚构文件，不启动进程。
 * 关联：PR11 重复打开预览修复（A524）；A528；navigation-intent.md §2。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import PptViewer from '@/renderer/pages/conversation/Preview/components/viewers/PptViewer';

const { start, stop, preview, translation, platform, fs } = vi.hoisted(() => {
  const startMock = vi.fn(async () => ({ url: 'http://127.0.0.1:51234/' }));
  const stopMock = vi.fn(async () => undefined);
  return {
    start: startMock,
    stop: stopMock,
    preview: { start: { invoke: startMock }, stop: { invoke: stopMock }, status: { on: () => () => {} } },
    translation: { t: (key: string) => key },
    platform: { electron: true },
    fs: {
      getFileMetadata: { invoke: vi.fn() },
      getContentMetadata: { invoke: vi.fn() },
    },
  };
});
vi.mock('@/common', () => ({ ipcBridge: { pptPreview: preview, wordPreview: preview, excelPreview: preview, fs } }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => platform.electron,
  openExternalUrl: async () => undefined,
}));
vi.mock('@/renderer/components/media/WebviewHost', () => ({
  default: ({ url }: { url: string }) => <div data-testid='watch'>{url}</div>,
}));

const releases: (() => void)[] = [];
const fetchMock = vi.fn();
function deferred<T>(value: T) {
  let release!: () => void;
  const promise = new Promise<T>((resolve) => {
    release = () => resolve(value);
  });
  releases.push(release);
  return { promise, release };
}
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

const notFound = () =>
  new BackendHttpError({ method: 'POST', path: '/api/fs/metadata', status: 404, body: { code: 'FILE_NOT_FOUND' } });
const frame = () => document.querySelector<HTMLIFrameElement>('iframe[title="PPT Preview"]');
// 网页模式：等 iframe 出现，设好阅读位置，再让两次探活失败。
async function disconnectAt(scrollY: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  Object.defineProperty(frame()!.contentWindow!, 'scrollY', { value: scrollY, configurable: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
}

describe('Office 预览生命周期', () => {
  beforeEach(() => {
    start.mockReset().mockResolvedValue({ url: 'http://127.0.0.1:51234/' });
    stop.mockReset().mockResolvedValue(undefined);
    platform.electron = true;
    fetchMock.mockReset().mockImplementation(
      async () =>
        new Response('', {
          headers: { 'content-type': 'text/html' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    fs.getFileMetadata.invoke.mockReset().mockResolvedValue({ name: 'demo.pptx' });
    fs.getContentMetadata.invoke.mockReset().mockResolvedValue({ name: 'demo.pptx' });
  });
  afterEach(async () => {
    cleanup();
    releases.splice(0).forEach((release) => release());
    await flush();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('重复打开同文件的新 fileRef 对象时，旧 stop 完成前不复用旧进程', async () => {
    const file = { kind: 'project' as const, pe_id: 'fixture-pe', relative_path: 'deck/demo.pptx' };
    const { rerender } = render(<PptViewer fileRef={file} />);
    await screen.findByTestId('watch');
    const stopped = deferred(undefined);
    stop.mockImplementationOnce(() => stopped.promise);
    rerender(<PptViewer fileRef={{ ...file }} />);
    await flush();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    stopped.release();
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    await screen.findByTestId('watch');
  });

  it('断开后点击重新打开，也等待旧 stop 完成再 start', async () => {
    platform.electron = false;
    vi.useFakeTimers();
    render(<PptViewer file_path='/fixture/demo.pptx' />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    const stopped = deferred(undefined);
    stop.mockImplementationOnce(() => stopped.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen preview' }));
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    stopped.release();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(document.querySelector('iframe[title="PPT Preview"]')).not.toBeNull();
  });

  it('切文件时停旧文件后再启动新文件，迟到清理保留原身份', async () => {
    const { rerender } = render(<PptViewer file_path='/fixture/old.pptx' />);
    await screen.findByTestId('watch');
    const stopped = deferred(undefined);
    stop.mockImplementationOnce(() => stopped.promise);
    rerender(<PptViewer file_path='/fixture/new.pptx' />);
    await flush();
    expect(stop).toHaveBeenCalledWith({ file_path: '/fixture/old.pptx', file: undefined });
    expect(start).toHaveBeenCalledTimes(1);
    stopped.release();
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start).toHaveBeenLastCalledWith({ file_path: '/fixture/new.pptx', workspace: undefined, file: undefined });
    await screen.findByTestId('watch');
  });

  it('卸载后旧 start 才返回时，等待它结束再 stop 且不恢复旧视图', async () => {
    const started = deferred({ url: 'http://127.0.0.1:51234/' });
    start.mockImplementationOnce(() => started.promise);
    const { unmount } = render(<PptViewer file_path='/fixture/late.pptx' />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    unmount();
    await flush();
    expect(stop).not.toHaveBeenCalled();
    started.release();
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('watch')).toBeNull();
  });

  it('卸载并重挂同文件时，新查看器等待旧实例的迟到 stop', async () => {
    const { unmount } = render(<PptViewer file_path='/fixture/remount.pptx' />);
    await screen.findByTestId('watch');
    const stopped = deferred(undefined);
    stop.mockImplementationOnce(() => stopped.promise);
    unmount();
    render(<PptViewer file_path='/fixture/remount.pptx' />);
    await flush();
    expect(start).toHaveBeenCalledTimes(1);
    stopped.release();
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    await screen.findByTestId('watch');
  });

  // ---- A528：断开后的两种状态与恢复位置 ----

  it('预览连接断开但文件仍在：说明文件还在，保留同一文件并提供重开', async () => {
    platform.electron = false;
    vi.useFakeTimers();
    render(<PptViewer file_path='/fixture/demo.pptx' />);
    await disconnectAt(1200);
    expect(fs.getFileMetadata.invoke).toHaveBeenCalledWith({ path: '/fixture/demo.pptx', workspace: undefined });
    expect(screen.getByRole('alert').textContent).toMatch(/connection lost.*file is still there/i);
    expect(screen.getByRole('button', { name: 'Reopen preview' })).toBeTruthy();
  });

  it('断开后文件已不存在：显示文件不存在，不提供重开', async () => {
    platform.electron = false;
    vi.useFakeTimers();
    fs.getContentMetadata.invoke.mockRejectedValue(notFound());
    const file = { kind: 'project' as const, pe_id: 'fixture-pe', relative_path: 'deck/gone.pptx' };
    render(<PptViewer fileRef={file} />);
    await disconnectAt(0);
    expect(fs.getContentMetadata.invoke).toHaveBeenCalledWith({ file });
    expect(screen.getByRole('alert').textContent).toMatch(/file not found/i);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('重开时后端回文件不存在：同样显示文件不存在，不提供重试', async () => {
    start.mockRejectedValueOnce(notFound());
    render(<PptViewer file_path='/fixture/deleted.pptx' />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/file not found/i));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('重新打开后回到同一文件、同一阅读位置', async () => {
    platform.electron = false;
    vi.useFakeTimers();
    render(<PptViewer file_path='/fixture/demo.pptx' />);
    await disconnectAt(1200);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen preview' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(start).toHaveBeenLastCalledWith({ file_path: '/fixture/demo.pptx', workspace: undefined, file: undefined });
    const win = frame()!.contentWindow!;
    const scrollTo = vi.fn();
    win.scrollTo = scrollTo as typeof win.scrollTo;
    fireEvent.load(frame()!);
    expect(scrollTo).toHaveBeenCalledWith(0, 1200);
  });
});
