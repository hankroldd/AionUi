/**
 * [mycowork] ADR-0011: `/office/edit/:sessionId` (MyCowork PR07 slice 4, online editing with ONLYOFFICE).
 * Only the boundaries are mocked: fetch (Bridge) and window.DocsAPI (the Document Server's api.js).
 * Covers: the editor is created from the Bridge-signed config; "finish" closes the session first, then destroys the editor,
 * shows "save pending" and polls until the Bridge reports the new version; a recovery_required session can rejoin the
 * editor; the versions page "edit online" entry opens a session on the head revision and navigates to the editor.
 * Narrow screens (MyCowork 02 §8) neither open a session nor load the editor; when the editor cannot load (api.js fails),
 * "close and go back" closes, then discards (the Bridge refuses while someone is still connected) and returns to versions.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeEditSlot, OfficeVersionsSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: 'eds_1', resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const config = { document: { key: 'k1' }, editorConfig: { mode: 'edit' }, token: 'signed' };
const session = (state: string, over: object = {}) => ({
  session_id: 'eds_1',
  resource_id: 'res_1',
  base_revision_id: 'rev_a',
  state,
  saved_revision_id: null,
  document_server_url: 'http://127.0.0.1:28090',
  editor_config: state === 'closed' ? null : config,
  created_at: 't',
  updated_at: 't',
  ...over,
});
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));
const destroyEditor = vi.fn();
const DocEditor = vi.fn(function (this: object) {
  return { destroyEditor };
});

describe('OfficeEditSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    destroyEditor.mockReset();
    DocEditor.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('DocsAPI', { DocEditor });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.innerWidth = 1024;
  });

  it('creates the editor from the signed config; finish closes first, then waits for the Bridge to report the save', async () => {
    let gets = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/close') && init?.method === 'POST') return reply(202, session('closing'));
      if (url === '/bridge/v1/edit-sessions/eds_1')
        return reply(200, ++gets === 1 ? session('editing') : session('closed', { saved_revision_id: 'rev_b' }));
      return reply(404, {});
    });
    render(<OfficeEditSlot />);
    await waitFor(() => expect(DocEditor).toHaveBeenCalledTimes(1));
    const [placeholder, cfg] = DocEditor.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(placeholder).toBe('mycowork-docs-eds_1');
    expect(cfg).toMatchObject({ ...config, width: '100%', height: '100%' });
    expect(screen.getByTestId('office-editor-status').textContent).toContain('正在在线编辑');
    fireEvent.click(screen.getByRole('button', { name: '结束编辑并保存' }));
    expect(await screen.findByText('保存待确认：正在等待编辑服务回传，先不要覆盖文件。')).toBeInTheDocument();
    expect(calls('POST', '/edit-sessions/eds_1/close')).toHaveLength(1);
    expect(destroyEditor).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('已保存为新版本。', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看版本与变化' }).getAttribute('href')).toBe(
      '#/office/resources/res_1/versions'
    );
  });

  it('a session needing recovery can rejoin the editor (same session)', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/bridge/v1/edit-sessions' && init?.method === 'POST') return reply(200, session('editing'));
      if (url === '/bridge/v1/edit-sessions/eds_1') return reply(200, session('recovery_required'));
      return reply(404, {});
    });
    render(<OfficeEditSlot />);
    expect(await screen.findByText(/保存未确认：编辑服务没有回传结果/)).toBeInTheDocument();
    expect(DocEditor).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '回到编辑器' }));
    await waitFor(() => expect(DocEditor).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(calls('POST', '/bridge/v1/edit-sessions')[0]?.[1]?.body))).toEqual({
      resource_id: 'res_1',
      base_revision_id: 'rev_a',
    });
  });

  it('the versions page "edit online" opens a session on the head revision and navigates to the editor', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/revisions'))
        return reply(200, {
          resource_id: 'res_1',
          current_revision_id: 'rev_head',
          items: [{ revision_id: 'rev_head', origin: 'original', current: true, created_at: 't' }],
        });
      if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [] });
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url === '/bridge/v1/edit-sessions' && init?.method === 'POST') return reply(201, session('editing'));
      return reply(404, {});
    });
    render(<OfficeVersionsSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '在线编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit/eds_1'));
    expect(JSON.parse(String(calls('POST', '/bridge/v1/edit-sessions')[0]?.[1]?.body))).toEqual({
      resource_id: 'res_1',
      base_revision_id: 'rev_head',
    });
  });

  it('narrow screens do not open a session or load the editor ("open on a desktop")', async () => {
    window.innerWidth = 500;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/revisions'))
        return reply(200, {
          resource_id: 'res_1',
          current_revision_id: 'rev_head',
          items: [{ revision_id: 'rev_head', origin: 'original', current: true, created_at: 't' }],
        });
      if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [] });
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url === '/bridge/v1/edit-sessions/eds_1') return reply(200, session('editing'));
      return reply(404, {});
    });
    const { unmount } = render(<OfficeVersionsSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '在线编辑' }));
    expect(await screen.findByText('在线编辑需要桌面浏览器：请在桌面打开。')).toBeInTheDocument();
    expect(calls('POST', '/bridge/v1/edit-sessions')).toHaveLength(0);
    unmount();
    render(<OfficeEditSlot />);
    expect(await screen.findByText('在线编辑需要桌面浏览器：请在桌面打开。')).toBeInTheDocument();
    expect(DocEditor).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '结束编辑并保存' })).toBeNull();
  });

  it('when api.js fails to load, "close and go back" closes then discards and returns to the versions page', async () => {
    vi.stubGlobal('DocsAPI', undefined);
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      setTimeout(() => (node as HTMLScriptElement).onerror?.(new Event('error')), 0);
      return node;
    });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/close') && init?.method === 'POST') return reply(202, session('closing'));
      if (url.endsWith('/discard') && init?.method === 'POST') return reply(200, {});
      if (url === '/bridge/v1/edit-sessions/eds_1') return reply(200, session('editing'));
      return reply(404, {});
    });
    render(<OfficeEditSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '关闭并返回' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/resources/res_1/versions'));
    expect(calls('POST', '/close')).toHaveLength(1);
    expect(JSON.parse(String(calls('POST', '/discard')[0]?.[1]?.body)).expected_state).toBe('closing');
    append.mockRestore();
  });
});
