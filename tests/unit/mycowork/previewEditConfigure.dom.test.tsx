/**
 * [mycowork] R036: PreviewPanel "Edit" on a docx whose online-edit session creation answers 503 (online editor not
 * configured) offers "去配置" -> P15 `office` with a return to this conversation; other failures do not. Real PreviewPanel,
 * mocked fetch/IPC (same stubs as previewEdit).
 */

import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-a' }, status: 'authenticated' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({ useThemeContext: () => ({ theme: 'light' }) }));
vi.mock('@/common', () => ({
  ipcBridge: (() => {
    const officePreview = {
      status: { on: () => () => {} },
      start: { invoke: async () => ({ error: 'OFFICECLI_NOT_FOUND' }) },
      stop: { invoke: async () => undefined },
    };
    return {
      fileStream: { contentUpdate: { on: () => () => {} } },
      preview: { open: { on: () => () => {} } },
      shell: { openFile: { invoke: async () => undefined } },
      excelPreview: officePreview,
      wordPreview: officePreview,
      pptPreview: officePreview,
      conversation: { responseStream: { on: () => () => {} } },
      fs: {
        writeContent: { invoke: async () => true },
        getContentMetadata: { invoke: async () => null },
        readContent: { invoke: async () => null },
        openSystem: { invoke: async () => undefined },
        writeFile: { invoke: async () => true },
        getFileMetadata: { invoke: async () => null },
        getImageBase64: { invoke: async () => null },
      },
    };
  })(),
}));

import PreviewPanel from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel';
import {
  PreviewProvider,
  usePreviewContext,
  type PreviewContextValue,
} from '@/renderer/pages/conversation/Preview/context/PreviewContext';

let ctx: PreviewContextValue;
const Probe: React.FC = () => {
  ctx = usePreviewContext();
  return null;
};
const At: React.FC = () => {
  const l = useLocation();
  return <div data-testid='at'>{`${l.pathname}|${JSON.stringify(l.state)}`}</div>;
};
const Harness: React.FC<{ showPanel: boolean }> = ({ showPanel }) => (
  <MemoryRouter initialEntries={['/conversation/conv_1']}>
    <PreviewProvider>
      <Probe />
      {showPanel ? <PreviewPanel /> : null}
    </PreviewProvider>
    <At />
  </MemoryRouter>
);
const fetchMock = vi.fn();
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const openEdit = async (sessionReply: () => Response | Promise<Response>) => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/conversations/conv_1/edit-target')
      return reply(200, {
        resource_id: 'res_2',
        revision_id: 'rev_x',
        file_name: 'm.docx',
        editor: 'onlyoffice',
        registered: true,
      });
    if (url === '/bridge/v1/edit-sessions') return sessionReply();
    return reply(404, {});
  });
  const view = render(<Harness showPanel={false} />);
  act(() =>
    ctx.openPreview('', 'word', {
      title: 'm.docx',
      file_name: 'm.docx',
      fileRef: { kind: 'project', pe_id: 'p', relative_path: 'm.docx' },
    } as never)
  );
  view.rerender(<Harness showPanel />);
  fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
};

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('preview Edit: online editing not configured (R036)', () => {
  it('503 from session creation -> 去配置 goes to P15 office, returning to this conversation', async () => {
    await openEdit(() => reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'online editor not configured' } }));
    fireEvent.click(await screen.findByRole('button', { name: '去配置' }));
    const at = screen.getByTestId('at').textContent ?? '';
    expect(at.startsWith('/office/connections|')).toBe(true);
    expect(JSON.parse(at.split('|')[1]!)).toEqual({
      mycoworkConnectionsReturn: {
        ownerKey: 'owner-a',
        section: 'office',
        to: 'task',
        task: {
          ownerKey: 'owner-a',
          capabilityId: 'office.online-edit',
          origin: 'conversation',
          conversationId: 'conv_1',
        },
      },
    });
  }, 30000);

  it('other failures (not found, network down) show no 去配置', async () => {
    await openEdit(() => reply(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' })).not.toBeDisabled());
    expect(screen.queryByRole('button', { name: '去配置' })).toBeNull();
    cleanup();
    await openEdit(() => {
      throw new TypeError('Failed to fetch');
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' })).not.toBeDisabled());
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole('button', { name: '去配置' })).toBeNull();
  }, 30000);
});
