/**
 * 文件/职责：测试预览面板刷新到达 Office 标签：watch 断开显示断开态并可重开，刷新重启 watch。
 * [mycowork] S10: the preview panel's refresh reaches an Office tab. The Office viewer registers a tab reloader that
 * restarts the officecli watch (stop the old process, start a new one that reads the file afresh), so a file changed
 * outside (e.g. saved from the online editor) can be seen without closing the tab. Only the backend boundary is mocked.
 * [mycowork] B4: the viewer probes the finite OfficeCLI page; after two misses it offers to reopen.
 * Idle SSE is not a liveness check: the native proxy can time it out while the page is healthy.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadViaViewer } from '@/renderer/pages/conversation/Preview/context/tabReloaderRegistry';
import PptViewer from '@/renderer/pages/conversation/Preview/components/viewers/PptViewer';
import { isWatchAlive } from '@mycowork/ui';

const { start, stop, preview, i18n, platform } = vi.hoisted(() => {
  const start = vi.fn(async () => ({ url: 'http://127.0.0.1:51234/' }));
  const stop = vi.fn(async () => undefined);
  const t = (k: string) => k; // stable like the real hook: the viewer's effect depends on it
  return {
    start,
    stop,
    preview: { start: { invoke: start }, stop: { invoke: stop }, status: { on: () => () => {} } },
    i18n: { t },
    platform: { electron: true }, // the probe only runs on the web (same-origin proxy); Electron loads the URL directly
  };
});
vi.mock('@/common', () => ({ ipcBridge: { pptPreview: preview, wordPreview: preview, excelPreview: preview } }));
vi.mock('react-i18next', () => ({ useTranslation: () => i18n }));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => platform.electron,
  openExternalUrl: async () => undefined,
}));
vi.mock('@/renderer/components/media/WebviewHost', () => ({
  default: ({ url }: { url: string }) => <div data-testid='watch'>{url}</div>,
}));

const fetchMock = vi.fn();
const stream = (type: string) => new Response('', { status: 200, headers: { 'content-type': type } });
const watchPage = () =>
  new Response('<html><script>window._watchEs = new EventSource("/events");</script></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

describe('Office preview refresh (S10)', () => {
  beforeEach(() => {
    platform.electron = true;
    start.mockClear();
    stop.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => watchPage());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('web: an unavailable watch shows a disconnected state; "reopen" restarts the watch', async () => {
    platform.electron = false;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementation(async () => stream('text/html'));
    render(<PptViewer tabId='tab-2' file_path='/w/deck.pptx' workspace='/w' />);
    // one miss is not enough (a single network hiccup must not tear the preview down)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('office-watch-error')).toBeNull();
    await vi.advanceTimersByTimeAsync(15_000);
    const gone = await screen.findByTestId('office-watch-error');
    vi.useRealTimers();
    expect(gone.textContent).toContain('Preview disconnected');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ppt-proxy/51234');
    fetchMock.mockImplementation(async () => watchPage());
    fireEvent.click(screen.getByRole('button', { name: 'Reopen preview' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector('iframe[title="PPT Preview"]')).not.toBeNull());
    expect(screen.queryByTestId('office-watch-error')).toBeNull();
    platform.electron = true;
  });

  it('probes the finite page when idle SSE times out, preserving the session and bypassing cache', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/events') ? new Response('', { status: 502 }) : watchPage()
    );
    expect(await isWatchAlive('/api/ppt-proxy/51234/')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ppt-proxy/51234',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'text/html' },
      })
    );
  });

  it('does not mistake the SPA, HTTP failures, a different content type or a network error for a watch', async () => {
    const realHtml = await watchPage().text();
    for (const response of [
      new Response('<html><div id="root"></div></html>', { headers: { 'content-type': 'text/html' } }),
      new Response(realHtml, { status: 403, headers: { 'content-type': 'text/html' } }),
      new Response(realHtml, { headers: { 'content-type': 'text/plain' } }),
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      expect(await isWatchAlive('/api/ppt-proxy/51234')).toBe(false);
    }
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await isWatchAlive('/api/ppt-proxy/51234')).toBe(false);
  });

  it('refresh restarts the watch for the tab; a tab without a viewer still reports "not registered"', async () => {
    const { findByTestId, unmount } = render(<PptViewer tabId='tab-1' file_path='/w/deck.pptx' workspace='/w' />);
    await findByTestId('watch');
    expect(start).toHaveBeenCalledTimes(1);
    expect(reloadViaViewer('tab-1')).toBe(true);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    // the old watch is stopped before the new start (a start racing an unfinished stop got the stale process back)
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[1] as number);
    expect(reloadViaViewer('tab-other')).toBe(false);
    unmount();
    expect(reloadViaViewer('tab-1')).toBe(false);
  });
});
