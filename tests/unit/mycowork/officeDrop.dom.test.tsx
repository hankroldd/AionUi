/**
 * [mycowork] ADR-0011: file drop intercept (useDragUpload → mycoworkDropIntercept, MyCowork PR04 slice f).
 * Only the Bridge boundary is mocked (fetch). "Import as resources" hands the files (in memory) to the import page,
 * which uploads them; "attach to this turn" (also on cancel) keeps AionUi's behaviour and hands nothing over.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { mycoworkDropIntercept, OfficeImportsSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: null, pathname: '/' }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const uploads = () => fetchMock.mock.calls.filter(([url]) => url === '/bridge/v1/uploads');

describe('mycoworkDropIntercept', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) =>
      url === '/bridge/v1/uploads'
        ? reply(201, { upload_id: 'up_1', file_name: 'x', size: 1, sha256: 's', duplicate_of: [] })
        : reply(200, { sources: [], projects: [] })
    );
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '#/guid';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('import as resources: opens the import queue and uploads the dropped file there', async () => {
    const taken = mycoworkDropIntercept([new File(['hi'], '拖入稿.pptx')]);
    await screen.findAllByRole('button', { name: '导入为资源' });
    fireEvent.click(screen.getAllByRole('button', { name: '导入为资源' }).at(-1) as HTMLElement); // 上一个确认框可能还在淡出
    await expect(taken).resolves.toBe(true);
    expect(window.location.hash).toBe('#/office/imports');
    render(<OfficeImportsSlot />);
    await waitFor(() => expect(uploads()).toHaveLength(1));
    expect(uploads()[0]?.[1]?.headers).toMatchObject({ 'x-file-name': encodeURIComponent('拖入稿.pptx') });
  });

  it('attach to this turn: AionUi keeps the drop, nothing is handed to the import queue', async () => {
    const taken = mycoworkDropIntercept([new File(['hi'], '只附加.pptx')]);
    await screen.findAllByRole('button', { name: '附加到本轮' });
    fireEvent.click(screen.getAllByRole('button', { name: '附加到本轮' }).at(-1) as HTMLElement); // 上一个确认框可能还在淡出
    await expect(taken).resolves.toBe(false);
    expect(window.location.hash).toBe('#/guid');
    await act(async () => void render(<OfficeImportsSlot />));
    expect(uploads()).toHaveLength(0);
  });
});
