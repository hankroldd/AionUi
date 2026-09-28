/**
 * [mycowork] D125: the preview tab toolbar carries an "Edit" button (mount point in PreviewPanel's toolbar rightExtra).
 * The preview itself stays read-only; the button resolves the workspace file to a Bridge resource (registering it on the
 * user's behalf when needed) and opens a separate editor: md/txt → text editor page, docx/pptx/xlsx → ONLYOFFICE.
 * Renders the real PreviewPanel (removing the mount line makes these fail). Mocked: fetch (Bridge) and the AionUi IPC
 * bridge (same stubs as previewPanelNotices). Rendered under a router at `/conversation/conv_1` but outside any route
 * element, as the app Layout renders the panel (useParams is empty there; the slot must match the location).
 */

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';

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
// mount the panel into an already-open preview (PreviewPanel's hook count changes across closed → open)
const Harness: React.FC<{ showPanel: boolean }> = ({ showPanel }) => (
  <MemoryRouter initialEntries={['/conversation/conv_1']}>
    <PreviewProvider>
      <Probe />
      {showPanel ? <PreviewPanel /> : null}
    </PreviewProvider>
  </MemoryRouter>
);
const openTab = (content: string, type: 'code' | 'word', metadata: object) => {
  const view = render(<Harness showPanel={false} />);
  act(() => ctx.openPreview(content, type, metadata as never));
  view.rerender(<Harness showPanel />);
};

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const posts = (part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).includes(part));
const TIMEOUT_MS = 30000;

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

describe('preview "Edit" (D125)', () => {
  it(
    'md/txt: resolves the workspace file, opens a text session and goes to the text editor page',
    async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === '/bridge/v1/conversations/conv_1/edit-target')
          return reply(201, {
            resource_id: 'res_1',
            revision_id: 'rev_a',
            file_name: 'notes.txt',
            editor: 'text',
            registered: true,
          });
        if (url === '/bridge/v1/text-edit-sessions')
          return reply(201, { session_id: 'txe_1', resource_id: 'res_1', base_revision_id: 'rev_a', content: 'hi' });
        return reply(404, {});
      });
      // the Explorer's shape: only a project ref, no absolute path in the renderer
      openTab('hi', 'code', {
        title: 'notes.txt',
        file_name: 'notes.txt',
        fileRef: { kind: 'project', pe_id: 'peA', relative_path: 'notes.txt' },
      });
      fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
      await waitFor(() => expect(window.location.hash).toBe('#/office/edit-text/res_1'));
      expect(JSON.parse(String(posts('/edit-target')[0]?.[1]?.body))).toEqual({ relative_path: 'notes.txt' });
      expect(posts('/text-edit-sessions')).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    'docx: waits while the AI is modifying, retries by itself, then opens the ONLYOFFICE session',
    async () => {
      let opens = 0;
      fetchMock.mockImplementation(async (url: string) => {
        if (url === '/bridge/v1/conversations/conv_1/edit-target')
          return reply(200, {
            resource_id: 'res_2',
            revision_id: 'rev_x',
            file_name: 'memo.docx',
            editor: 'onlyoffice',
            registered: false,
          });
        if (url === '/bridge/v1/edit-sessions' && ++opens === 1)
          return reply(409, {
            error: {
              code: 'AI_EDITING',
              message: 'x',
              last_ai_write_at: new Date(Date.now() - 5000).toISOString(),
              editable_at: new Date(Date.now() + 200).toISOString(),
            },
          });
        if (url === '/bridge/v1/edit-sessions') return reply(201, { session_id: 'eds_9', state: 'editing' });
        return reply(404, {});
      });
      openTab('', 'word', {
        title: 'memo.docx',
        file_name: 'memo.docx',
        fileRef: { kind: 'project', pe_id: 'peA', relative_path: 'out/memo.docx' },
      });
      fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
      // the toolbar is narrow: a short countdown, the full sentence in the tooltip / accessible name
      const waiting = await screen.findByTestId('ai-wait');
      expect(waiting.textContent).toContain('AI 修改中');
      expect(waiting.getAttribute('aria-label')).toContain('AI 正在修改这个文件，请稍候');
      await waitFor(() => expect(window.location.hash).toBe('#/office/edit/eds_9'), { timeout: 3000 });
      expect(opens).toBe(2);
      expect(JSON.parse(String(posts('/edit-sessions')[1]?.[1]?.body))).toEqual({
        resource_id: 'res_2',
        base_revision_id: 'rev_x',
      });
    },
    TIMEOUT_MS
  );

  it(
    'a disk-path tab sends its workspace-relative path; a refused path gets a plain explanation; no relative path, no button',
    async () => {
      fetchMock.mockImplementation(async () =>
        reply(400, { error: { code: 'INVALID_REQUEST', message: 'relative_path must stay inside your session workspace' } })
      );
      openTab('x', 'code', { title: 'a.md', file_name: 'a.md', file_path: '/ws/sub/a.md', workspace: '/ws' });
      fireEvent.click(await screen.findByRole('button', { name: '编辑' }));
      expect(await screen.findByText('只能编辑本会话工作目录里的文件。')).toBeInTheDocument();
      expect(JSON.parse(String(posts('/edit-target')[0]?.[1]?.body))).toEqual({ relative_path: 'sub/a.md' });
      expect(window.location.hash).toBe('');
      cleanup();
      openTab('x', 'code', { title: 'b.log', file_name: 'b.log', file_path: '/elsewhere/b.log' });
      await screen.findByText('b.log');
      expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
    },
    TIMEOUT_MS
  );
});
