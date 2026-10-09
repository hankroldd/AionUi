/**
 * [mycowork] PR11 W4-9 ③：所选范围里有资料还在处理中时，发送前的明确二选一（packages/ui/src/scope-picker，R011）。
 * 职责：withGuidScope（发送挂载点）冻结计划后若有 indexing 条目：弹“先用已就绪的 N 份 / 等全部就绪再问”；先用 → 照常签发令牌；
 *       等待（含 Esc）→ 拒发、不签发令牌、不留待绑定计划、输入由调用方保留；全部就绪不打扰；一份都没就绪只剩“等待”；焦点还给输入框；
 *       范围条（ScopeStrip）在有处理中资料时写“本轮未包含 M 份处理中的资料”，全部就绪不写。
 * 边界：只替换 Bridge（fetch）；真实 withGuidScope、prepareScopedSession、Arco Modal、ScopeStrip。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { setScopeSelection } from '@mycowork/ui';
import { bindGuidScope, ConversationScopeSlot, withGuidScope } from '@/renderer/mycowork-slots';

const lang = vi.hoisted(() => ({ value: 'zh-CN' }));
vi.mock('i18next', () => ({ default: { get language() { return lang.value; } } }));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { responseStream: { on: () => () => undefined } } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: lang.value } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ state: null }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = (ready: number, indexing: number) => ({ total: ready + indexing, ready, indexing, failed: 0, unavailable: 0 });
const plan = (...groups: Array<[number, number]>) => ({
  plan_id: 'plan_1',
  version: 1,
  status: 'OK',
  brief: {
    groups: groups.map(([r, i], n) => ({ source_id: `src_${n}`, source_name: `库${n}`, mode: 'whole', counts: counts(r, i) })),
    excluded: 0,
    unauthorized: 0,
    refs: {},
    policy: { strict: false, web: 'off' },
  },
});
const TOKEN = {
  token: 't',
  expires_at: '2026-09-25T20:00:00Z',
  mcp: {},
  session_mcp_server: { id: 'mycowork_bridge', name: 'mycowork_bridge', transport: { type: 'streamable_http', url: 'http://x/mcp', headers: {} } },
  workspace: '/data/ws/1',
};
const USE_READY = '先用已就绪的 5 份（另有 3 份处理中，现在读不到）';
const urls = () => fetchMock.mock.calls.map(([u]) => String(u));

function bridge(p: object) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/context-plans') return reply(201, p);
    if (url.endsWith('/tokens')) return reply(201, TOKEN);
    if (url.endsWith('/plan')) return reply(200, null);
    throw new Error(`未定义的虚构HTTP请求 ${url}`);
  });
}
/** 发起发送；返回尚未结算的 Promise，让弹窗可见。 */
async function send(): Promise<{ result: Promise<unknown>; settled: () => string; dialog: HTMLElement }> {
  let state = 'pending';
  const before = document.querySelectorAll('.arco-modal-wrapper').length;
  const result = withGuidScope({}).then(
    () => (state = 'sent'),
    (e: Error) => (state = e.message),
  );
  // 上一个用例的弹窗可能还在关闭动画里：新弹窗总在 body 末尾，取最后一个
  await waitFor(() => expect(document.querySelectorAll('.arco-modal-wrapper').length).toBeGreaterThan(before));
  const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement;
  return { result, settled: () => state, dialog };
}

beforeEach(() => {
  lang.value = 'zh-CN';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setScopeSelection([{ source_id: 'src_0', name: '库0' }]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// 读请求的自动重试在用例里免等退避（产品默认 300/900 ms）
(globalThis as { __mcwReadRetryMs?: number[] }).__mcwReadRetryMs = [0, 0];

describe('发送前：资料还在处理中', () => {
  it('全部就绪：不弹窗、不打扰，照常签发令牌', async () => {
    bridge(plan([8, 0]));
    await expect(withGuidScope({})).resolves.toMatchObject({ workspace: '/data/ws/1' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('有处理中：弹二选一，写明就绪数与处理中数；先发送前不签发令牌', async () => {
    bridge(plan([2, 1], [3, 2]));
    const { settled, dialog } = await send();
    expect(dialog).toHaveTextContent('有资料还在处理中');
    expect(dialog).toHaveTextContent('你选的范围里有 3 份资料还在处理中，AI 现在读不到它们。');
    expect(within(dialog).getByRole('button', { name: USE_READY })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '等全部就绪再问' })).toBeInTheDocument();
    expect(settled()).toBe('pending');
    expect(urls().some((u) => u.endsWith('/tokens'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '等全部就绪再问' })); // 收尾：不留悬着的发送
  });

  it('选“先用已就绪的”：继续签发令牌，会话照常建立并绑定计划', async () => {
    bridge(plan([2, 1], [3, 2]));
    const { result, settled, dialog } = await send();
    fireEvent.click(within(dialog).getByRole('button', { name: USE_READY }));
    await act(async () => void (await result));
    expect(settled()).toBe('sent');
    expect(urls().filter((u) => u.endsWith('/tokens'))).toHaveLength(1);
    await bindGuidScope('conv-1');
    expect(urls()).toContain('/bridge/v1/conversations/conv-1/plan');
  });

  it('选“等全部就绪再问”：拒发并说明输入保留，不签发令牌、不留待绑定计划', async () => {
    bridge(plan([2, 1], [3, 2]));
    const { result, settled, dialog } = await send();
    fireEvent.click(within(dialog).getByRole('button', { name: '等全部就绪再问' }));
    await act(async () => void (await result));
    expect(settled()).toContain('未发送：资料还在处理中，已按你的选择等待');
    expect(settled()).toContain('输入已保留');
    expect(urls().some((u) => u.endsWith('/tokens'))).toBe(false);
    await bindGuidScope('conv-2');
    expect(urls().some((u) => u.endsWith('/plan'))).toBe(false);
  });

  it('点遮罩关闭按“等待”，不会误发（确认框没有右上角关闭键）', async () => {
    bridge(plan([2, 1], [3, 2]));
    const { result, settled, dialog } = await send();
    const wrapper = dialog.closest('.arco-modal-wrapper') as HTMLElement;
    fireEvent.mouseDown(wrapper);
    fireEvent.click(wrapper);
    await act(async () => void (await result));
    expect(settled()).toContain('已按你的选择等待');
    expect(urls().some((u) => u.endsWith('/tokens'))).toBe(false);
  });

  it('一份都没就绪：只剩“等全部就绪再问”，没有“先用已就绪”', async () => {
    bridge(plan([0, 4]));
    const { result, settled, dialog } = await send();
    expect(dialog).toHaveTextContent('你选的范围里的 4 份资料都还在处理中，AI 现在读不到。');
    expect(within(dialog).queryByRole('button', { name: /先用已就绪/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '等全部就绪再问' }));
    await act(async () => void (await result));
    expect(settled()).toContain('已按你的选择等待');
  });

  it('关闭弹窗后焦点回到弹出前的元素（输入框）', async () => {
    bridge(plan([2, 1], [3, 2]));
    const box = document.body.appendChild(document.createElement('textarea'));
    box.focus();
    const { result, dialog } = await send();
    fireEvent.click(within(dialog).getByRole('button', { name: '等全部就绪再问' }));
    await act(async () => void (await result));
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it('用户在答复前后把焦点放到了别处：不抢回来', async () => {
    bridge(plan([2, 1], [3, 2]));
    const box = document.body.appendChild(document.createElement('textarea'));
    const other = document.body.appendChild(document.createElement('input'));
    box.focus();
    const { result, dialog } = await send();
    fireEvent.click(within(dialog).getByRole('button', { name: '等全部就绪再问' }));
    await act(async () => void (await result));
    other.focus();
    await new Promise((r) => setTimeout(r, 450));
    expect(document.activeElement).toBe(other);
  });

  it('确认框带 mcw-modal 类名（窄屏不撑破视口）', async () => {
    bridge(plan([2, 1], [3, 2]));
    const { dialog } = await send();
    expect(dialog).toHaveClass('mcw-modal');
    fireEvent.click(within(dialog).getByRole('button', { name: '等全部就绪再问' }));
  });

  it('范围在弹窗期间被改动：不安装计划，按范围已变化拒发', async () => {
    bridge(plan([2, 1], [3, 2]));
    const { result, settled, dialog } = await send();
    act(() => setScopeSelection([{ source_id: 'src_9', name: '别的库' }]));
    fireEvent.click(within(dialog).getByRole('button', { name: USE_READY }));
    await act(async () => void (await result));
    expect(settled()).toContain('本轮资料范围或发送状态已变化');
    expect(urls().some((u) => u.endsWith('/tokens'))).toBe(false);
  });

  it('英文界面', async () => {
    lang.value = 'en';
    bridge(plan([2, 1], [3, 2]));
    const { result, settled, dialog } = await send();
    expect(within(dialog).getByRole('button', { name: 'Use the 5 ready now (3 more still processing, cannot be read yet)' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wait until all are ready' }));
    await act(async () => void (await result));
    expect(settled()).toContain('Not sent: Some sources are still processing');
  });
});

describe('范围条：发送时有资料还在处理中', () => {
  const context = (...groups: Array<[number, number]>) => ({
    ...plan(...groups),
    used: [],
    withheld: 0,
    superseded: false,
  });
  async function strip(body: object) {
    fetchMock.mockImplementation(async () => reply(200, body));
    render(<ConversationScopeSlot conversationId='c1' />);
    return screen.findByTestId('mycowork-scope-strip');
  }

  it('有处理中的资料：如实写“发送时有 M 份资料还在处理中（处理完后本轮可能读到）”', async () => {
    const el = await strip(context([5, 1], [2, 2]));
    await waitFor(() => expect(el).toHaveTextContent('发送时有 3 份资料还在处理中（处理完后本轮可能读到）'));
  });

  it('全部就绪：不写这句', async () => {
    const el = await strip(context([5, 0]));
    await waitFor(() => expect(el).toHaveTextContent('AI 可引用 5'));
    expect(el).not.toHaveTextContent('发送时有');
  });
});
