/**
 * [mycowork] S10: the preview panel's refresh reaches an Office tab. The Office viewer registers a tab reloader that
 * restarts the officecli watch (stop the old process, start a new one that reads the file afresh), so a file changed
 * outside (e.g. saved from the online editor) can be seen without closing the tab. Only the backend boundary is mocked.
 */

import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { reloadViaViewer } from '@/renderer/pages/conversation/Preview/context/tabReloaderRegistry';
import PptViewer from '@/renderer/pages/conversation/Preview/components/viewers/PptViewer';

const { start, stop, preview, i18n } = vi.hoisted(() => {
  const start = vi.fn(async () => ({ url: 'http://127.0.0.1:51234/' }));
  const stop = vi.fn(async () => undefined);
  const t = (k: string) => k; // stable like the real hook: the viewer's effect depends on it
  return {
    start,
    stop,
    preview: { start: { invoke: start }, stop: { invoke: stop }, status: { on: () => () => {} } },
    i18n: { t },
  };
});
vi.mock('@/common', () => ({ ipcBridge: { pptPreview: preview, wordPreview: preview, excelPreview: preview } }));
vi.mock('react-i18next', () => ({ useTranslation: () => i18n }));
vi.mock('@/renderer/components/media/WebviewHost', () => ({
  default: ({ url }: { url: string }) => <div data-testid='watch'>{url}</div>,
}));

describe('Office preview refresh (S10)', () => {
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
