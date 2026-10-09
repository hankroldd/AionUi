/**
 * [mycowork] PR07 保存收尾余项（A371/A372）。文件：tests/unit/mycowork/officeSaveTail.dom.test.tsx
 * 职责：跟踪器在 pending 之后回到非 pending 的 closing 时复位“正在同步”；恢复态之后迟到的成功撤通知并报已保存；
 *       “继续编辑”先核资源当前版本（已不是会话基线 → 不重开、提示并去版本页；仍是基线 → 照常重开）；
 *       放弃得到 EDIT_ALREADY_SAVED 译成人话并重读报“已保存”；同一会话放弃的重试复用同一个 submission_id（结果已定才换新的）。
 * 边界：只替换 fetch（Bridge）；轮询用伪造的 Date / setInterval；每例结束 settleTracker。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { clearEditReturn } from '@mycowork/ui/pages/office-editor/edit-return.ts';
import { trackSave } from '@mycowork/ui/pages/office-editor/save-tracker.tsx';
import { editorText } from '@mycowork/ui/pages/office-editor/messages.ts';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import { settleTracker, until } from './saveTrackerTeardown';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const err = (status: number, code: string) => reply(status, { error: { code, message: code } });
const session = (state: string, over: object = {}) => ({
  session_id: 'eds_1',
  resource_id: 'res_1',
  base_revision_id: 'rev_a',
  state,
  saved_revision_id: null,
  document_server_url: 'http://127.0.0.1:28090',
  editor_config: state === 'closed' ? null : { document: { key: 'k1' }, editorConfig: { mode: 'edit' }, token: 't' },
  closing_at: null,
  reconcile: null,
  created_at: 't',
  updated_at: 't',
  ...over,
});
const text = editorText('zh-CN');
const body = () => document.body;
const note = () => document.querySelector('.arco-notification') as HTMLElement | null;
const posts = (part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).includes(part));
const submissionIds = () => posts('/discard').map(([, init]) => JSON.parse(String(init?.body)).submission_id as string);
/** 会话由 cur() 决定；head = 资源当前版本；discard 的应答可由 onDiscard 覆盖。 */
function api(
  cur: () => object,
  opt: { head?: () => string; onDiscard?: () => ReturnType<typeof reply> } = {}
) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (/\/resources\/[^/]+\/revisions/.test(url)) return reply(200, { items: [], current_revision_id: opt.head?.() ?? 'rev_a' });
    if (/\/edit-sessions\/[^/]+$/.test(url) && !init?.method) return reply(200, cur());
    if (url.endsWith('/discard')) return opt.onDiscard?.() ?? reply(200, {});
    if (url === '/bridge/v1/edit-sessions' && init?.method === 'POST') return reply(200, session('editing'));
    return reply(404, {});
  });
}
const fake = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const noteGone = async () => expect(await until(() => note() === null)).toBe(true);
/** 进恢复态并拿到通知里的按钮区。 */
async function recoveryNote() {
  fake();
  trackSave(text, 'eds_1');
  await advance(900);
  vi.useRealTimers();
  return within(note() as HTMLElement);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.location.hash = '#/office/space';
  clearEditReturn();
  readRetry.delays = [];
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await settleTracker();
  readRetry.delays = [300, 900];
  vi.unstubAllGlobals();
});

describe('跟踪器', () => {
  it('pending 之后回到非 pending 的 closing：“正在同步”提示复位成“正在保存…”', async () => {
    fake();
    let st: object = session('closing', { workspace_writeback_status: 'pending' });
    api(() => st);
    trackSave(text, 'eds_1');
    await advance(900);
    expect(body()).toHaveTextContent(text.syncing);
    st = session('closing', { workspace_writeback_status: 'none' });
    await advance(900);
    expect(body()).not.toHaveTextContent(text.syncing);
    expect(body()).toHaveTextContent(text.saving);
  });

  it('恢复态（此时视图仍是 pending）之后迟到的成功：撤掉恢复通知并报“已保存为新版本”', async () => {
    fake();
    let st: object = session('recovery_required', { workspace_writeback_status: 'pending' });
    api(() => st);
    trackSave(text, 'eds_1');
    await advance(900);
    expect(note()).toHaveTextContent('保存结果还没确认');
    st = session('closed', { saved_revision_id: 'rev_b', workspace_writeback_status: 'not_applicable' });
    await advance(6400);
    expect(body()).toHaveTextContent('已保存为新版本。');
    await noteGone();
  });
});

describe('继续编辑先核当前版本', () => {
  it('当前版本已不是会话基线：不开新会话，提示并去版本页', async () => {
    api(() => session('recovery_required'), { head: () => 'rev_b' });
    const n = await recoveryNote();
    fireEvent.click(n.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(body()).toHaveTextContent(text.moved));
    expect(posts('/bridge/v1/edit-sessions')).toHaveLength(0);
    expect(window.location.hash).toBe('#/office/resources/res_1/versions');
  });

  it('当前版本仍是基线：照常加入原会话', async () => {
    api(() => session('recovery_required'), { head: () => 'rev_a' });
    const n = await recoveryNote();
    fireEvent.click(n.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit/eds_1'));
    expect(posts('/bridge/v1/edit-sessions')).toHaveLength(1);
  });

  it('读不到资源当前版本：报错、不重开（不带着未核对的基线开会话）', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (/\/resources\//.test(url)) return err(503, 'UPSTREAM_UNAVAILABLE');
      if (/\/edit-sessions\/[^/]+$/.test(url) && !init?.method) return reply(200, session('recovery_required'));
      return reply(404, {});
    });
    const n = await recoveryNote();
    fireEvent.click(n.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => /\/resources\//.test(String(u)))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(posts('/bridge/v1/edit-sessions')).toHaveLength(0);
    expect(window.location.hash).toBe('#/office/space');
  });
});

describe('放弃', () => {
  it('EDIT_ALREADY_SAVED：提示“已保存为新版本”的人话（不直出错误码），重读后报已保存', async () => {
    let st: object = session('recovery_required');
    api(() => st, {
      onDiscard: () => {
        st = session('closed', { saved_revision_id: 'rev_b', workspace_writeback_status: 'written' });
        return err(409, 'EDIT_ALREADY_SAVED');
      },
    });
    const n = await recoveryNote();
    fireEvent.click(n.getByRole('button', { name: '放弃这次修改' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(body()).toHaveTextContent(text.alreadySaved));
    expect(body()).not.toHaveTextContent('EDIT_ALREADY_SAVED');
    await waitFor(() => expect(body()).toHaveTextContent('已保存为新版本。'));
    await noteGone();
  });

  it('同一会话放弃重试（上次连不上）复用同一个 submission_id；成功后才换新的', async () => {
    let fail = true;
    api(() => session('recovery_required'), { onDiscard: () => (fail ? reply(502, {}) : reply(200, {})) });
    const n = await recoveryNote();
    const click = async () => {
      fireEvent.click(n.getByRole('button', { name: '放弃这次修改' }));
      fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    };
    await click();
    await waitFor(() => expect(posts('/discard')).toHaveLength(1));
    await until(() => document.querySelector('.arco-modal') === null);
    fail = false;
    await click();
    await waitFor(() => expect(posts('/discard')).toHaveLength(2));
    const [first, second] = submissionIds();
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });
});
