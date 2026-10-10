/**
 * [mycowork] PR07 收尾修复。文件：tests/unit/mycowork/officeSaveRecovery.dom.test.tsx
 * 职责：保存跟踪器与恢复态的最后一轮审查修复：recovery_required 不是终态（低频继续轮询、转 closed 撤通知并报结果）、
 *       非“暂时连不上”的错误（401 / 404）直接结束并清提示、总时长上限、继续编辑 / 放弃前先重读会话、放弃得到 409 译成人话并重读、
 *       放弃 / 继续后通知与版本页提示条同步、同字节保存不说“已保存为新版本”、“保存并返回”按钮 loading 防重复、版本页对 closing 显示“正在保存”、错误码人话。
 * 边界：只替换 fetch（Bridge）、react-router 参数与 DocsAPI；轮询用伪造的 Date / 定时器；每例结束 resetSaveTracker 并清 Arco 的 Message / Notification。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { clearEditReturn } from '@mycowork/ui/pages/office-editor/edit-return.ts';
import { resetSaveTracker, trackSave } from '@mycowork/ui/pages/office-editor/save-tracker.tsx';
import { editorFailure, editorText } from '@mycowork/ui/pages/office-editor/messages.ts';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import { OfficeEditSlot, OfficeVersionsSlot } from '@/renderer/mycowork-slots';
import { settleTracker, until } from './saveTrackerTeardown';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: 'eds_1', resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/' }),
}));

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
const posts = (part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).includes(part));
const gets = (id: string) =>
  fetchMock.mock.calls.filter(([url, init]) => !init?.method && String(url) === `/bridge/v1/edit-sessions/${id}`);
const note = () => document.querySelector('.arco-notification') as HTMLElement | null;
/** 会话当前状态由 cur() 决定；discard / 开会话的应答可覆盖。 */
function api(cur: () => object | Response, extra: (url: string, init?: RequestInit) => unknown = () => undefined) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const x = extra(url, init);
    if (x) return x;
    if (/\/edit-sessions\/[^/]+$/.test(url) && !init?.method) {
      const c = cur();
      return 'status' in c ? c : reply(200, c);
    }
    if (url.endsWith('/discard')) return reply(200, {});
    if (url.endsWith('/close')) return reply(202, session('closing'));
    if (/\/resources\/[^/]+\/revisions/.test(url)) return reply(200, { items: [], current_revision_id: 'rev_a' }); // 继续编辑前核当前版本
    if (url === '/bridge/v1/edit-sessions' && init?.method === 'POST') return reply(200, session('editing'));
    return reply(404, {});
  });
}
const fake = () => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
const noteGone = async () => expect(await until(() => note() === null)).toBe(true); // 提示撤掉后有退出动画
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // 页面用 new DocsAPI.DocEditor(...)：箭头函数不能当构造器，会在页面里抛未处理的错误
  const DocEditor = vi.fn(function (this: object) {
    return { destroyEditor: vi.fn() };
  });
  vi.stubGlobal('DocsAPI', { DocEditor });
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
  window.innerWidth = 1024;
});

describe('跟踪器：recovery_required 不是终态', () => {
  it('低频继续轮询；之后保存成功 → 撤掉恢复通知并报“已保存为新版本”', async () => {
    fake();
    let state: object = session('recovery_required');
    api(() => state);
    trackSave(text, 'eds_1');
    await advance(900);
    expect(note()).toHaveTextContent('保存结果还没确认');
    const n1 = gets('eds_1').length;
    await advance(3000);
    expect(gets('eds_1').length).toBe(n1); // 5 秒内不再读（低频）
    state = session('closed', { saved_revision_id: 'rev_b' });
    await advance(6400);
    expect(body()).toHaveTextContent('已保存为新版本。');
    await noteGone(); // 恢复通知已撤
    const n2 = gets('eds_1').length;
    await advance(12_000);
    expect(gets('eds_1').length).toBe(n2); // 终态后不再轮询
  });

  it('之后被对账释放（closed、无新版本）→ 撤通知并报“没有改动”', async () => {
    fake();
    let state: object = session('recovery_required');
    api(() => state);
    trackSave(text, 'eds_1');
    await advance(900);
    expect(note()).not.toBeNull();
    state = session('closed');
    await advance(6400);
    expect(body()).toHaveTextContent('没有改动，未新增版本。');
    await noteGone();
  });

  it('同字节保存（saved_revision_id = base_revision_id）：说“内容没有变化，未新增版本”，不说已保存为新版本', async () => {
    fake();
    api(() => session('closed', { saved_revision_id: 'rev_a' }));
    const changed = vi.fn();
    window.addEventListener('mycowork:resource-changed', changed);
    trackSave(text, 'eds_1');
    await advance(900);
    expect(body()).toHaveTextContent('保存完成，内容没有变化，未新增版本。');
    expect(body()).not.toHaveTextContent('已保存为新版本');
    expect(changed).not.toHaveBeenCalled();
    window.removeEventListener('mycowork:resource-changed', changed);
  });

  it('总时长超过 10 分钟：停止轮询，换成可关闭的“可到版本页查看”', async () => {
    fake();
    api(() => session('closing'));
    trackSave(text, 'eds_1');
    await advance(10 * 60_000 + 3000);
    expect(body()).toHaveTextContent('还没确认保存结果，可到该文件的版本页查看。');
    const n = gets('eds_1').length;
    await advance(10_000);
    expect(gets('eds_1').length).toBe(n);
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [404, 'NOT_FOUND'],
  ])('轮询得到 %i：直接结束并清掉本会话发出的提示，不再轮询', async (status, code) => {
    fake();
    let down = false;
    api(() => (down ? err(status, code) : session('recovery_required')));
    trackSave(text, 'eds_1');
    await advance(900);
    expect(note()).not.toBeNull(); // 先有一条含内容的恢复通知
    down = true;
    await advance(6400);
    await noteGone();
    const n = gets('eds_1').length;
    await advance(12_000);
    expect(gets('eds_1').length).toBe(n);
    expect(body()).not.toHaveTextContent('正在保存');
  });

  it('resetSaveTracker：停掉所有轮询并清掉它发出的提示', async () => {
    fake();
    api(() => session('recovery_required'));
    trackSave(text, 'eds_1');
    await advance(900);
    expect(note()).not.toBeNull();
    resetSaveTracker();
    await noteGone();
    const n = gets('eds_1').length;
    await advance(12_000);
    expect(gets('eds_1').length).toBe(n);
  });

  it('resetSaveTracker 后在途请求以网络失败返回（距上次成功已超 15 秒）：不再弹“网络不通”', async () => {
    fake();
    let fail: (e: Error) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise((_, rej) => (fail = rej))); // 第一拍一直挂着
    trackSave(text, 'eds_1');
    await advance(16_000); // 在途那一拍已超过 NET_DOWN_MS
    resetSaveTracker();
    await act(async () => fail(new TypeError('Failed to fetch')));
    await advance(1000);
    expect(body()).not.toHaveTextContent(text.netDown);
    expect(note()).toBeNull();
  });
});

describe('继续编辑 / 放弃：动作前先重读会话', () => {
  const recoveryNote = async (cur: () => object, extra?: (url: string, init?: RequestInit) => unknown) => {
    fake();
    api(cur, extra);
    trackSave(text, 'eds_1');
    await advance(900);
    return within(note() as HTMLElement);
  };

  it('会话其实已保存：点“继续编辑”不开新会话，直接报结果并撤通知', async () => {
    let state: object = session('recovery_required');
    const n = await recoveryNote(() => state);
    state = session('closed', { saved_revision_id: 'rev_b' });
    vi.useRealTimers();
    fireEvent.click(n.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(body()).toHaveTextContent('已保存为新版本。'));
    expect(posts('/bridge/v1/edit-sessions')).toHaveLength(0);
    expect(window.location.hash).toBe('#/office/space');
    await noteGone();
  });

  it('会话已结束：点“放弃这次修改”确认后不调 discard，报结果', async () => {
    let state: object = session('recovery_required');
    const n = await recoveryNote(() => state);
    state = session('closed', { saved_revision_id: 'rev_b' });
    vi.useRealTimers();
    fireEvent.click(n.getByRole('button', { name: '放弃这次修改' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(body()).toHaveTextContent('已保存为新版本。'));
    expect(posts('/discard')).toHaveLength(0);
  });

  it('放弃得到 409 EDIT_STATE_CONFLICT：显示人话（不直出错误码）、重读会话并报最终结果', async () => {
    let state: object = session('recovery_required');
    const n = await recoveryNote(
      () => state,
      (url) => {
        if (url.endsWith('/discard')) {
          state = session('closed', { saved_revision_id: 'rev_b' }); // 放弃失败时会话恰好已保存
          return err(409, 'EDIT_STATE_CONFLICT');
        }
      }
    );
    vi.useRealTimers();
    const before = gets('eds_1').length;
    fireEvent.click(n.getByRole('button', { name: '放弃这次修改' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(body()).toHaveTextContent('这次编辑已经结束了'));
    expect(body()).not.toHaveTextContent('EDIT_STATE_CONFLICT');
    await waitFor(() => expect(gets('eds_1').length).toBeGreaterThanOrEqual(before + 2)); // 确认前读一次 + 409 后再读一次
    await waitFor(() => expect(body()).toHaveTextContent('已保存为新版本。'));
    await noteGone();
  });

  it('继续编辑得到 REVISION_STALE：不说“已重新读取”', async () => {
    const n = await recoveryNote(
      () => session('recovery_required'),
      (url, init) =>
        url === '/bridge/v1/edit-sessions' && init?.method === 'POST' ? err(409, 'REVISION_STALE') : undefined
    );
    vi.useRealTimers();
    fireEvent.click(n.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(body()).toHaveTextContent('不能再接着这次编辑'));
    expect(body()).not.toHaveTextContent('已重新读取');
  });

  it('通知里“继续编辑”成功：撤掉恢复通知并进编辑页', async () => {
    const n = await recoveryNote(() => session('recovery_required'));
    vi.useRealTimers();
    fireEvent.click(n.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit/eds_1'));
    await noteGone();
  });
});

describe('版本页提示条与通知同步', () => {
  const versions = (editing: () => object[]) =>
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
      if (url === '/bridge/v1/edit-sessions' && !init?.method) return reply(200, { items: editing(), next_page: null });
      if (url === '/bridge/v1/edit-sessions/eds_1' && !init?.method)
        return reply(200, session(editing()[0] ? 'recovery_required' : 'closed'));
      if (url.endsWith('/discard')) {
        gone = true;
        return reply(200, {});
      }
      return reply(404, {});
    });
  let gone = false;
  const row = () => [
    { session_id: 'eds_1', resource_id: 'res_1', base_revision_id: 'rev_a', state: 'recovery_required' },
  ];

  it('在跟踪器通知里放弃：版本页提示条立刻消失', async () => {
    gone = false;
    versions(() => (gone ? [] : row()));
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('保存结果还没确认。')).toBeInTheDocument();
    trackSave(text, 'eds_1');
    await waitFor(() => expect(note()).not.toBeNull(), { timeout: 3000 });
    fireEvent.click(within(note() as HTMLElement).getByRole('button', { name: '放弃这次修改' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(posts('/discard')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('保存结果还没确认。')).toBeNull());
  });

  it('在版本页提示条放弃：撤掉跟踪器的通知', async () => {
    gone = false;
    versions(() => (gone ? [] : row()));
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('保存结果还没确认。')).toBeInTheDocument();
    trackSave(text, 'eds_1');
    await waitFor(() => expect(note()).not.toBeNull(), { timeout: 3000 });
    fireEvent.click(screen.getAllByRole('button', { name: '放弃这次修改' })[0] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(posts('/discard')).toHaveLength(1));
    await noteGone();
  });

  it('会话在 closing：预览标签写“正在保存”，不是“编辑中”', async () => {
    versions(() => [{ ...row()[0], state: 'closing' }]);
    render(<OfficeVersionsSlot />);
    expect(await screen.findByTestId('versions-preview-editing')).toHaveTextContent('正在保存');
  });
});

describe('编辑页', () => {
  it('“保存并返回”：close 应答前显示 loading 并忽略重复点击；close 失败恢复可点', async () => {
    window.location.hash = '#/office/edit/eds_1';
    let resolveClose: (v: unknown) => void = () => undefined;
    let failClose = true;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/close')) return failClose ? err(500, 'INTERNAL') : new Promise((r) => (resolveClose = r));
      if (url === '/bridge/v1/edit-sessions/eds_1' && !init?.method) return reply(200, session('editing'));
      return reply(404, {});
    });
    render(<OfficeEditSlot />);
    const btn = () => screen.getByRole('button', { name: '保存并返回' });
    fireEvent.click(await screen.findByRole('button', { name: '保存并返回' }));
    await waitFor(() => expect(posts('/close')).toHaveLength(1));
    await waitFor(() => expect(btn().className).not.toContain('arco-btn-loading'));
    expect(body()).toHaveTextContent('操作没有成功'); // 错误码收进“详情”
    failClose = false;
    fireEvent.click(btn());
    fireEvent.click(btn());
    fireEvent.click(btn());
    expect(btn().className).toContain('arco-btn-loading');
    await waitFor(() => expect(posts('/close')).toHaveLength(2));
    await act(async () => undefined);
    expect(posts('/close')).toHaveLength(2);
    resolveClose(reply(202, session('closing')));
    await waitFor(() => expect(window.location.hash).toBe('#/office/resources/res_1/versions'));
  });

  it('会话读到同字节保存：结果页写“内容没有变化，未新增版本”', async () => {
    window.location.hash = '#/office/edit/eds_1';
    api(() => session('closed', { saved_revision_id: 'rev_a' }));
    render(<OfficeEditSlot />);
    await waitFor(() =>
      expect(screen.getByTestId('office-editor-status')).toHaveTextContent('保存完成，内容没有变化，未新增版本。')
    );
  });
});

describe('文案', () => {
  it.each([
    ['EDIT_STATE_CONFLICT', '这次编辑已经结束了'],
    ['EDIT_LEASE_HELD', '这个文件正在别处编辑'],
    ['REVISION_STALE', '文件有了更新的版本'],
  ])('%s 译成人话', (code, part) => {
    const m = editorFailure(text, new Error(code));
    expect(m).toContain(part);
    expect(m).not.toContain(code);
    expect(m).not.toContain('写入权');
  });

  it('其余错误码收进“详情”；英文 closing 含“不用手动操作”的意思', () => {
    expect(editorFailure(text, new Error('SOMETHING_ODD'))).toBe('操作没有成功，请稍后重试。详情：SOMETHING_ODD');
    expect(editorText('en').closing).toContain('no action needed');
  });
});
