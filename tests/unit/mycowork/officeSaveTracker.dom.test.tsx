/**
 * [mycowork] PR07 A275/A282 界面阶段。文件：tests/unit/mycowork/officeSaveTracker.dom.test.tsx
 * 职责：ONLYOFFICE 在线编辑的“保存并返回”与页面级保存跟踪器：close 失败留在页内；成功后立刻回来处，跟踪器接着轮询——
 *       正在保存 → 已保存（含写回说明）/ 没有改动 / 写回冲突与失败用不自动关闭的通知 / Secret 跳过写回并进提示 /
 *       recovery_required 两个按钮（继续编辑、二次确认后放弃，放弃不提示“没有改动”也不返回）/ 网络失败静默重试 /
 *       路由切换（页面卸载）不打断 / 只提示一次 / 保存后通知版本页重新取数；编辑页与版本页的恢复态。
 * 边界：只替换 fetch（Bridge）、react-router 参数与 DocsAPI；轮询用真实 800ms 节拍或伪造的 Date/定时器。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message, Notification } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { clearEditReturn, requestEditReturn } from '@mycowork/ui/pages/office-editor/edit-return.ts';
import { RESOURCE_CHANGED, trackSave } from '@mycowork/ui/pages/office-editor/save-tracker.tsx';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import { editorText } from '@mycowork/ui/pages/office-editor/messages.ts';
import { OfficeEditSlot, OfficeVersionsSlot } from '@/renderer/mycowork-slots';
import { settleTracker } from './saveTrackerTeardown';

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
  closing_at: null,
  reconcile: null,
  created_at: 't',
  updated_at: 't',
  ...over,
});
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));
const DocEditor = vi.fn(function (this: object) {
  return { destroyEditor: vi.fn() };
});
const text = editorText('zh-CN');
const body = () => document.body;
/** 轮询读到的会话序列：按顺序给，最后一个一直给。 */
function polls(id: string, ...states: object[]) {
  let i = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/close') && init?.method === 'POST') return reply(202, session('closing'));
    if (url === `/bridge/v1/edit-sessions/${id}` && !init?.method)
      return reply(200, states[Math.min(i++, states.length - 1)]);
    if (url.endsWith('/discard') && init?.method === 'POST') return reply(200, {});
    if (url === '/bridge/v1/edit-sessions' && init?.method === 'POST') return reply(200, session('editing'));
    return reply(404, {});
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  DocEditor.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('DocsAPI', { DocEditor });
  window.location.hash = '#/office/edit/eds_1';
  clearEditReturn();
  Message.clear();
  Notification.clear();
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  readRetry.delays = [300, 900];
  vi.unstubAllGlobals();
  window.innerWidth = 1024;
  await settleTracker(); // 页面级跟踪器是模块级单例：上一例的轮询与通知不能漏到下一例
});

describe('保存并返回', () => {
  it('close 失败：留在编辑页提示，不返回、不起跟踪器', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/close')) return reply(500, { error: { code: 'INTERNAL', message: 'x' } });
      if (url === '/bridge/v1/edit-sessions/eds_1' && !init?.method) return reply(200, session('editing'));
      return reply(404, {});
    });
    render(<OfficeEditSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '保存并返回' }));
    await waitFor(() => expect(calls('POST', '/close')).toHaveLength(1));
    await act(async () => undefined);
    expect(window.location.hash).toBe('#/office/edit/eds_1');
    expect(body()).not.toHaveTextContent('正在保存…');
    expect(screen.getByRole('button', { name: '保存并返回' })).toBeInTheDocument();
  });

  it('有来处：立刻回来处；页面卸载后跟踪器照常报告“已保存”，并通知版本页重新取数；只提示一次', async () => {
    requestEditReturn({ kind: 'space' });
    polls('eds_1', session('editing'), session('closed', { saved_revision_id: 'rev_b' }));
    const changed = vi.fn();
    window.addEventListener(RESOURCE_CHANGED, changed);
    const { unmount } = render(<OfficeEditSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '保存并返回' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/space'));
    unmount(); // 路由切换：编辑页没了
    await waitFor(() => expect(body()).toHaveTextContent('正在保存…'));
    await waitFor(() => expect(body()).toHaveTextContent('已保存为新版本。'), { timeout: 4000 });
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ resourceId: 'res_1' });
    const before = calls('GET', '/edit-sessions/eds_1').length;
    await new Promise((r) => setTimeout(r, 1800));
    expect(calls('GET', '/edit-sessions/eds_1').length).toBe(before); // 终态后不再轮询
    expect(body().textContent?.match(/已保存为新版本。/g)).toHaveLength(1);
    window.removeEventListener(RESOURCE_CHANGED, changed);
  });
});

describe('保存跟踪器', () => {
  it('同一会话重复 trackSave 只起一个轮询', async () => {
    polls('eds_t1', session('closing'));
    trackSave(text, 'eds_t1');
    trackSave(text, 'eds_t1');
    await waitFor(() => expect(calls('GET', '/edit-sessions/eds_t1').length).toBeGreaterThanOrEqual(1), {
      timeout: 3000,
    });
    const n1 = calls('GET', '/edit-sessions/eds_t1').length;
    await new Promise((r) => setTimeout(r, 1700));
    const per = calls('GET', '/edit-sessions/eds_t1').length - n1;
    expect(per).toBeLessThanOrEqual(3); // 800ms 一次的单个轮询，不是两个
    polls('eds_t1', session('closed', { saved_revision_id: 'rev_b' })); // 收尾，免得影响后面的用例
    await waitFor(() => expect(body()).toHaveTextContent('已保存为新版本。'), { timeout: 3000 });
  });

  it('超过约 10 秒仍在等：提示改成“还在确认保存结果…”', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    polls('eds_t2', session('closing'));
    trackSave(text, 'eds_t2');
    await vi.advanceTimersByTimeAsync(2000);
    expect(body()).toHaveTextContent('正在保存…');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(body()).toHaveTextContent('还在确认保存结果…');
  });

  it('网络失败：静默重试，不弹“连不上 MyCowork 服务”；连续超过约 15 秒才改提示；恢复后继续报告', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    readRetry.delays = []; // 读请求自带的真实退避不参与这里的假时钟推进
    let down = true;
    fetchMock.mockImplementation(async () => {
      if (down) throw new TypeError('Failed to fetch');
      return reply(200, session('closed', { saved_revision_id: 'rev_b' }));
    });
    trackSave(text, 'eds_t3');
    await vi.advanceTimersByTimeAsync(8000);
    expect(body()).not.toHaveTextContent('连不上 MyCowork 服务');
    expect(body()).not.toHaveTextContent('网络不通');
    await vi.advanceTimersByTimeAsync(9000);
    expect(body()).toHaveTextContent('网络不通，恢复后会自动继续确认保存结果。');
    down = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(body()).toHaveTextContent('已保存为新版本。');
  });

  it('没有改动：info 提示“没有改动，未新增版本。”', async () => {
    polls('eds_t4', session('closed'));
    trackSave(text, 'eds_t4');
    await waitFor(() => expect(body()).toHaveTextContent('没有改动，未新增版本。'), { timeout: 3000 });
  });

  it('写回冲突 / 失败：不自动关闭的通知完整显示，带“查看版本与变化”', async () => {
    polls(
      'eds_t5',
      session('closed', {
        saved_revision_id: 'rev_b',
        workspace_writeback: { relative_path: '方案.docx', outcome: 'conflict', saved_as: '方案.人工编辑-1.docx' },
      })
    );
    trackSave(text, 'eds_t5');
    await waitFor(() => expect(body()).toHaveTextContent('另存为 方案.人工编辑-1.docx'), { timeout: 3000 });
    const n = document.querySelector('.arco-notification') as HTMLElement;
    expect(within(n).getByRole('link', { name: '查看版本与变化' }).getAttribute('href')).toBe(
      '#/office/resources/res_1/versions'
    );
    await new Promise((r) => setTimeout(r, 1500));
    expect(document.querySelector('.arco-notification')).toHaveTextContent('另存为'); // 没有自动消失
    Notification.clear();
    Message.clear();
    polls(
      'eds_t5',
      session('closed', {
        saved_revision_id: 'rev_c',
        workspace_writeback: { relative_path: '方案.docx', outcome: 'failed', saved_as: null },
      })
    );
    trackSave(text, 'eds_t5');
    await waitFor(() => expect(document.querySelector('.arco-notification')).toHaveTextContent('没能写回'), {
      timeout: 3000,
    });
  });

  it('Secret 跳过写回：说明并进成功提示；写回成功：成功提示带写回说明', async () => {
    polls(
      'eds_t6',
      session('closed', {
        saved_revision_id: 'rev_b',
        workspace_writeback: { relative_path: '方案.docx', outcome: 'skipped', saved_as: null, reason: 'secret' },
      })
    );
    trackSave(text, 'eds_t6');
    await waitFor(() => expect(body()).toHaveTextContent('因是 Secret'), { timeout: 3000 });
    expect(document.querySelector('.arco-notification')).toBeNull();
    Message.clear();
    polls(
      'eds_t6',
      session('closed', {
        saved_revision_id: 'rev_c',
        workspace_writeback: { relative_path: '方案.docx', outcome: 'written', saved_as: null },
      })
    );
    trackSave(text, 'eds_t6');
    await waitFor(() => expect(body()).toHaveTextContent('已写回会话工作目录中的 方案.docx'), { timeout: 3000 });
  });

  it('recovery_required：通知给“继续编辑 / 放弃这次修改”；继续编辑加入原会话并进编辑页', async () => {
    window.location.hash = '#/office/space';
    polls('eds_t7', session('recovery_required', { session_id: 'eds_t7' }));
    trackSave(text, 'eds_t7');
    await waitFor(() => expect(document.querySelector('.arco-notification')).toHaveTextContent('保存结果还没确认'), {
      timeout: 3000,
    });
    const n = document.querySelector('.arco-notification') as HTMLElement;
    fireEvent.click(within(n).getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit/eds_1'));
    expect(JSON.parse(String(calls('POST', '/bridge/v1/edit-sessions')[0]?.[1]?.body))).toEqual({
      resource_id: 'res_1',
      base_revision_id: 'rev_a',
    });
  });

  it('recovery_required：放弃要二次确认并写明后果；确认后调 discard，提示“已放弃”，不说“没有改动”、不返回', async () => {
    window.location.hash = '#/office/space';
    polls('eds_t8', session('recovery_required', { session_id: 'eds_t8' }));
    trackSave(text, 'eds_t8');
    await waitFor(() => expect(document.querySelector('.arco-notification')).toBeTruthy(), { timeout: 3000 });
    const n = document.querySelector('.arco-notification') as HTMLElement;
    fireEvent.click(within(n).getByRole('button', { name: '放弃这次修改' }));
    expect(await screen.findByText(/不会成为新版本；已保存的版本不受影响/)).toBeInTheDocument();
    expect(calls('POST', '/discard')).toHaveLength(0); // 还没确认
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(calls('POST', '/discard')).toHaveLength(1));
    expect(JSON.parse(String(calls('POST', '/discard')[0]?.[1]?.body)).expected_state).toBe('recovery_required');
    await waitFor(() => expect(body()).toHaveTextContent('已放弃这次修改。'));
    expect(body()).not.toHaveTextContent('没有改动');
    expect(window.location.hash).toBe('#/office/space');
  });
});

describe('编辑页与版本页的恢复态', () => {
  it('编辑页：recovery_required 给两个按钮；放弃确认后页面写“已放弃这次修改”，不是“没有改动”', async () => {
    let state = 'recovery_required';
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/discard') && init?.method === 'POST') {
        state = 'closed';
        return reply(200, {});
      }
      if (url === '/bridge/v1/edit-sessions/eds_1') return reply(200, session(state));
      return reply(404, {});
    });
    render(<OfficeEditSlot />);
    const page = within(await screen.findByTestId('mycowork-office-editor'));
    expect(await page.findByRole('button', { name: '继续编辑' })).toBeInTheDocument();
    fireEvent.click(page.getByRole('button', { name: '放弃这次修改' }));
    fireEvent.click((await screen.findAllByRole('button', { name: '放弃修改' })).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('office-editor-status')).toHaveTextContent('已放弃这次修改。'));
    expect(screen.getByTestId('office-editor-status')).not.toHaveTextContent('没有改动');
    expect(window.location.hash).toBe('#/office/edit/eds_1');
  });

  const versionsApi = (editing: object[]) => {
    let revCalls = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/revisions')) {
        revCalls++;
        return reply(200, {
          resource_id: 'res_1',
          current_revision_id: 'rev_head',
          items: [
            { revision_id: 'rev_head', origin: 'original', current: true, created_at: '2026-09-26T00:00:00.000Z' },
          ],
        });
      }
      if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [] });
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url === '/bridge/v1/edit-sessions' && !init?.method) return reply(200, { items: editing, next_page: null });
      if (url === '/bridge/v1/edit-sessions/eds_1' && !init?.method) return reply(200, session('recovery_required')); // 放弃 / 继续前先重读
      if (url.endsWith('/discard')) return reply(200, {});
      return reply(404, {});
    });
    return () => revCalls;
  };

  it('版本页：本人有 recovery_required 会话时出现提示条，带“继续编辑 / 放弃这次修改”；放弃后重新取数', async () => {
    const revs = versionsApi([
      { session_id: 'eds_1', resource_id: 'res_1', base_revision_id: 'rev_a', state: 'recovery_required' },
    ]);
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('保存结果还没确认。')).toBeInTheDocument();
    const before = revs();
    fireEvent.click(screen.getByRole('button', { name: '放弃这次修改' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(calls('POST', '/discard')).toHaveLength(1));
    await waitFor(() => expect(revs()).toBeGreaterThan(before));
  });

  it('版本页：editing 或 closing 的会话不出现提示条；保存完成事件触发重新取数', async () => {
    const revs = versionsApi([
      { session_id: 'eds_1', resource_id: 'res_1', base_revision_id: 'rev_a', state: 'closing' },
    ]);
    render(<OfficeVersionsSlot />);
    await screen.findByRole('button', { name: '在线编辑' });
    expect(screen.queryByText('保存结果还没确认。')).toBeNull();
    const before = revs();
    window.dispatchEvent(new CustomEvent(RESOURCE_CHANGED, { detail: { resourceId: 'res_other' } }));
    await act(async () => undefined);
    expect(revs()).toBe(before); // 别的资源的事件不触发
    window.dispatchEvent(new CustomEvent(RESOURCE_CHANGED, { detail: { resourceId: 'res_1' } }));
    await waitFor(() => expect(revs()).toBeGreaterThan(before));
  });
});
