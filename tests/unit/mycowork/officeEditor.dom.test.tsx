/**
 * [mycowork] ADR-0011: `/office/edit/:sessionId` (MyCowork PR07 slice 4, online editing with ONLYOFFICE).
 * Only the boundaries are mocked: fetch (Bridge) and window.DocsAPI (the Document Server's api.js).
 * Covers: the editor is created from the Bridge-signed config; "finish" closes the session first, then destroys the editor,
 * shows "save pending" and polls until the Bridge reports the new version; a recovery_required session can rejoin the
 * editor; the versions page "edit online" entry opens a session on the head revision and navigates to the editor.
 * Narrow screens (MyCowork 02 §8) neither open a session nor load the editor; when the editor cannot load (api.js fails),
 * "close and go back" closes, then discards (the Bridge refuses while someone is still connected) and returns to versions.
 * Cannot reach the service (network failure / 502) and "not configured or unavailable" (503) are told apart; the former offers Retry.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { settleTracker } from './saveTrackerTeardown';
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

// 读请求的自动重试在用例里免等退避（产品默认 300/900 ms）
readRetry.delays = [0, 0];

describe('OfficeEditSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    destroyEditor.mockReset();
    DocEditor.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('DocsAPI', { DocEditor });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    window.innerWidth = 1024;
    await settleTracker();
  });

  it('creates the editor from the signed config; "save and return" closes first, leaves at once, and the tracker reports the save', async () => {
    let gets = 0;
    window.location.hash = '#/office/edit/eds_1';
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
    expect(screen.getByTestId('office-editor-status').textContent).toContain('正在编辑。编辑期间 AI 不会改这个文件。');
    fireEvent.click(screen.getByRole('button', { name: '保存并返回' }));
    // 没有来处：立刻回该资源的版本页，不在原地等；编辑器随页面销毁
    await waitFor(() => expect(window.location.hash).toBe('#/office/resources/res_1/versions'));
    expect(calls('POST', '/edit-sessions/eds_1/close')).toHaveLength(1);
    await waitFor(() => expect(destroyEditor).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.body).toHaveTextContent('已保存为新版本。'), { timeout: 4000 });
  });

  it('a session needing recovery can rejoin the editor (same session)', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (/\/resources\/[^/]+\/revisions/.test(url)) return reply(200, { items: [], current_revision_id: 'rev_a' }); // 继续编辑前核当前版本
      if (url === '/bridge/v1/edit-sessions' && init?.method === 'POST') return reply(200, session('editing'));
      if (url === '/bridge/v1/edit-sessions/eds_1') return reply(200, session('recovery_required'));
      return reply(404, {});
    });
    render(<OfficeEditSlot />);
    expect(await screen.findByText('保存结果还没确认。可以继续编辑，或放弃这次修改。')).toBeInTheDocument();
    expect(DocEditor).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
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
          items: [
            { revision_id: 'rev_head', origin: 'original', current: true, created_at: '2026-09-26T00:00:00.000Z' },
          ],
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
          items: [
            { revision_id: 'rev_head', origin: 'original', current: true, created_at: '2026-09-26T00:00:00.000Z' },
          ],
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
    expect(screen.queryByRole('button', { name: '保存并返回' })).toBeNull();
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

  it('after the editor failed to load, a successful rejoin shows "finish editing" again', async () => {
    vi.stubGlobal('DocsAPI', undefined);
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      setTimeout(() => (node as HTMLScriptElement).onerror?.(new Event('error')), 0);
      return node;
    });
    let state = 'editing';
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/close') && init?.method === 'POST') {
        state = 'recovery_required';
        return reply(202, session('closing'));
      }
      if (url.endsWith('/discard') && init?.method === 'POST')
        return reply(409, { error: { code: 'EDIT_STATE_CONFLICT', message: 'x' } });
      if (/\/resources\/[^/]+\/revisions/.test(url)) return reply(200, { items: [], current_revision_id: 'rev_a' }); // 继续编辑前核当前版本
      if (url === '/bridge/v1/edit-sessions' && init?.method === 'POST') return reply(200, session('editing'));
      if (url === '/bridge/v1/edit-sessions/eds_1') return reply(200, session(state));
      return reply(404, {});
    });
    render(<OfficeEditSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '关闭并返回' }));
    expect(await screen.findByText('编辑器在别处仍打开：请先在那里保存并返回。')).toBeInTheDocument();
    append.mockRestore();
    vi.stubGlobal('DocsAPI', { DocEditor });
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
    expect(await screen.findByRole('button', { name: '保存并返回' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭并返回' })).toBeNull();
    await waitFor(() => expect(DocEditor).toHaveBeenCalledTimes(1));
  });

  it('tells "cannot reach the service" (network / 502, with Retry) apart from "not configured" (503)', async () => {
    for (let i = 0; i < 3; i++) fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')); // 读请求自动重试两次后才报错
    fetchMock.mockResolvedValueOnce({ status: 200, ok: true, json: async () => session('closed') });
    render(<OfficeEditSlot />);
    expect(await screen.findByText(/连不上 MyCowork 服务/)).toBeInTheDocument();
    expect(screen.queryByText(/未配置/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('编辑已结束，没有保存新版本（没有改动，或已放弃）。')).toBeInTheDocument();
    cleanup();
    for (const [status, expected] of [
      [502, /连不上 MyCowork 服务/],
      [503, /在线编辑未配置或编辑服务不可用/],
    ] as const) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue({ status, ok: false, json: async () => ({}) });
      const { unmount } = render(<OfficeEditSlot />);
      expect(await screen.findByText(expected)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '重试' }) !== null).toBe(status === 502); // 503 重试无用，不给
      unmount();
    }
  });
});
