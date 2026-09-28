/**
 * [mycowork] S10: the preview panel's refresh reaches an Office tab. The Office viewer registers a tab reloader that
 * restarts the officecli watch (stop the old process, start a new one that reads the file afresh), so a file changed
 * outside (e.g. saved from the online editor) can be seen without closing the tab. Only the backend boundary is mocked.
 * [mycowork] B4: the viewer probes the watch's /events stream; when the proxy no longer answers with text/event-stream
 * (the officecli process is gone) the stale iframe is replaced by a visible "disconnected" state whose action restarts the watch.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadViaViewer } from '@/renderer/pages/conversation/Preview/context/tabReloaderRegistry';
import PptViewer from '@/renderer/pages/conversation/Preview/components/viewers/PptViewer';

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

describe('Office preview refresh (S10)', () => {
  beforeEach(() => {
    start.mockClear();
    stop.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => stream('text/event-stream'));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('web: a watch whose event stream is gone shows a disconnected state; "reopen" restarts the watch', async () => {
    platform.electron = false;
    fetchMock.mockImplementation(async () => stream('text/html'));
    render(<PptViewer tabId='tab-2' file_path='/w/deck.pptx' workspace='/w' />);
    const gone = await screen.findByTestId('office-watch-error');
    expect(gone.textContent).toContain('Preview disconnected');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ppt-proxy/51234/events');
    fetchMock.mockImplementation(async () => stream('text/event-stream'));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen preview' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector('iframe[title="PPT Preview"]')).not.toBeNull());
    expect(screen.queryByTestId('office-watch-error')).toBeNull();
    platform.electron = true;
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
