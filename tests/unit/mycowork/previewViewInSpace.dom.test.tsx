/**
 * [mycowork] PR11 W4-6：对话页预览“编辑”旁的“在空间中查看”（ADR-0022 决策 7）。
 * 渲染真实 PreviewPanel（同 previewEdit）；预览打开时只读定位该文件（GET output-resource），已登记产物才出现按钮，
 * 点击进空间并带定位意图；未登记、出错都不出现、也不影响“编辑”。空间页收到意图后切到“产物”按名称查并让该行可见，找不到给提示。
 * 替身：fetch（Bridge）与 AionUi IPC；其余组件真实。
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
const locateCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/output-resource'));

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


const doc = { title: 'report.docx', file_name: 'report.docx', fileRef: { kind: 'project', pe_id: 'peA', relative_path: 'out/report.docx' } };

describe('preview "View in Space" (W4-6)', () => {
  it(
    'registered output: the button appears next to Edit, the lookup is a read-only GET, and clicking carries the intent to Space',
    async () => {
      fetchMock.mockImplementation(async (url: string) =>
        String(url).startsWith('/bridge/v1/conversations/conv_1/output-resource?') ? reply(200, { resource_id: 'res_9' }) : reply(404, {})
      );
      openTab('', 'word', doc);
      const button = await screen.findByRole('button', { name: '在空间中查看' });
      expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
      expect(locateCalls()).toHaveLength(1);
      const [url, init] = locateCalls()[0]!;
      expect(new URL(String(url), 'http://x').searchParams.get('relative_path')).toBe('out/report.docx');
      expect(init?.method).toBeUndefined();
      expect(fetchMock.mock.calls.every(([, i]) => !i?.method && !i?.body)).toBe(true); // nothing written just by opening
      fireEvent.click(button);
      expect(window.location.hash).toBe('#/office/space?resource=res_9&name=report.docx');
    },
    TIMEOUT_MS
  );

  it.each([
    ['not registered (404)', () => reply(404, { error: { code: 'NOT_FOUND', message: 'not found' } })],
    ['server error (500)', () => reply(500, { error: { code: 'INTERNAL', message: 'x' } })],
    ['network failure', () => Promise.reject(new TypeError('offline'))],
  ])('%s: no button, Edit still there', async (_name, answer) => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/output-resource') ? answer() : reply(404, {})));
    openTab('', 'word', doc);
    await screen.findByRole('button', { name: '编辑' });
    await waitFor(() => expect(locateCalls()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: '在空间中查看' })).toBeNull();
  }, TIMEOUT_MS);

  it('no relative path (a disk path outside the workspace): no lookup at all', async () => {
    fetchMock.mockImplementation(async () => reply(404, {}));
    openTab('x', 'code', { title: 'b.log', file_name: 'b.log', file_path: '/elsewhere/b.log' });
    await screen.findByText('b.log');
    expect(locateCalls()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '在空间中查看' })).toBeNull();
  }, TIMEOUT_MS);
});
