/**
 * [mycowork] ADR-0011: "scope this turn" strip above the conversation body (MyCowork PR03 spec §6 item 8, 01 §6.4).
 * Only external boundaries are mocked: Bridge = fetch, aioncore stream = ipcBridge.conversation.responseStream.
 * Covers the summary line, 404 = plain chat, used-sources list, refresh on turn finish, and error states;
 * "change sources": widening rebinds this conversation, strict narrowing (D19) opens the Guid page and the next
 * send uses the narrowed plan (once, kept across a failed token request); superseded and hand-off notices.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Same as renderer/main.tsx: Arco's global Message needs the React 19 adapter (tests load the CJS lib build).
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ConversationScopeSlot, withGuidScope } from '@/renderer/mycowork-slots';

type StreamMessage = { type: string; conversation_id: string };
const streamListeners = new Set<(m: StreamMessage) => void>();
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: (fn: (m: StreamMessage) => void) => {
          streamListeners.add(fn);
          return () => streamListeners.delete(fn);
        },
      },
    },
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock, useLocation: () => ({ state: null }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = (ready: number, indexing: number, failed: number, unavailable: number) => ({
  total: ready + indexing + failed + unavailable,
  ready,
  indexing,
  failed,
  unavailable,
});
const CONTEXT = {
  plan_id: 'plan_1',
  version: 1,
  status: 'OK',
  brief: {
    groups: [
      { source_id: 'src_a', source_name: '项目A资料', mode: 'whole', counts: counts(3, 1, 0, 0) },
      { source_id: 'src_b', source_name: '产品库', mode: 'whole', counts: counts(5, 0, 1, 1) },
    ],
    excluded: 0,
    unauthorized: 0,
    refs: {},
    policy: { strict: false, web: 'off' },
  },
  used: [
    { resource_id: 'r1', source_id: 'src_b', file_name: '产品手册.md', reads: 2, last_read_at: '2026-09-25T02:00:00Z' },
  ],
  withheld: 1,
  superseded: false,
};
const SUMMARY = '项目A资料 + 产品库；公网关闭；可检索 8 · 处理中 1 · 不可用 2';

const emit = (m: StreamMessage) => act(() => streamListeners.forEach((fn) => fn(m)));

describe('ConversationScopeSlot', () => {
  beforeEach(() => {
    streamListeners.clear();
    fetchMock.mockReset();
    navigateMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows sources, web policy and searchable/processing/unavailable counts', async () => {
    fetchMock.mockResolvedValue(reply(200, CONTEXT));
    render(<ConversationScopeSlot conversation_id='conv 1' />);
    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/bridge/v1/conversations/conv%201/context', {
      credentials: 'same-origin',
    });
  });

  it('says "plain chat only" when the conversation has no plan (404)', async () => {
    fetchMock.mockResolvedValue(reply(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    expect(await screen.findByText('未选择资料：仅普通对话')).toBeInTheDocument();
    expect(screen.queryByText(/查看本轮使用资料/)).toBeNull();
  });

  it('lists the used sources with source name and read count, and the withheld count', async () => {
    fetchMock.mockResolvedValue(reply(200, CONTEXT));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    fireEvent.click(await screen.findByRole('button', { name: '查看本轮使用资料（1）' }));
    expect(screen.getByText('产品手册.md')).toBeInTheDocument();
    expect(screen.getByText(/产品库 · 读取 2 次/)).toBeInTheDocument();
    expect(screen.getByText('另有 1 项因授权撤销不再列出')).toBeInTheDocument();
    expect(screen.getByText('只统计工具已返回的内容，不代表都已进入模型上下文')).toBeInTheDocument();
  });

  it('refetches when an assistant turn of this conversation finishes, not for other conversations', async () => {
    fetchMock.mockResolvedValue(reply(200, CONTEXT));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    await screen.findByText(SUMMARY);
    emit({ type: 'finish', conversation_id: 'conv-other' });
    emit({ type: 'content', conversation_id: 'conv-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit({ type: 'finish', conversation_id: 'conv-1' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('shows the Bridge error instead of pretending nothing was selected, and recovers on refresh', async () => {
    fetchMock.mockResolvedValueOnce(reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } }));
    fetchMock.mockResolvedValue(reply(200, CONTEXT));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    expect(await screen.findByText('资料服务暂不可用，请稍后重试')).toBeInTheDocument();
    expect(screen.queryByText('未选择资料：仅普通对话')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
  });

  it('treats a malformed context as a failure', async () => {
    fetchMock.mockResolvedValue(reply(200, { ...CONTEXT, used: [{ resource_id: 'r1' }] }));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    expect(await screen.findByText('资料范围处理失败（invalid context response）')).toBeInTheDocument();
  });

  it('marks an empty-scope plan and a web-allowed policy', async () => {
    const empty = {
      ...CONTEXT,
      status: 'EMPTY_SCOPE',
      brief: { ...CONTEXT.brief, policy: { strict: true, web: 'allowed' } },
    };
    fetchMock.mockResolvedValue(reply(200, empty));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    expect(await screen.findByText(/所选资料当前不可检索；可补充公开资料/)).toBeInTheDocument();
  });

  it('shows the superseded notice without a change action, and the hand-off summary of a narrowed conversation', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { ...CONTEXT, superseded: true }));
    const { unmount } = render(<ConversationScopeSlot conversation_id='conv-old' />);
    expect(
      await screen.findByText(/本会话的资料范围已严格收缩：不能再检索资料；如需继续，请新建会话/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更改范围' })).toBeNull();
    unmount();
    const carried = [{ resource_id: 'r1', source_id: 'src_a', file_name: '周报.md' }];
    fetchMock.mockResolvedValueOnce(
      reply(200, { ...CONTEXT, handoff: { from_plan_id: 'plan_0', carried, removed: 2, removed_revoked: 0 } })
    );
    render(<ConversationScopeSlot conversation_id='conv-new' />);
    expect(await screen.findByText(/由严格收缩新建：带入 1 份仍在范围内的已读资料，移出 2 份/)).toBeInTheDocument();
  });

  describe('change sources', () => {
    const SOURCES = ['src_a', 'src_b', 'src_c'].map((id, i) => ({
      source_id: id,
      name: ['项目A资料', '产品库', '新增库'][i],
      provider: 'weknora',
      counts: counts(1, 0, 0, 0),
    }));
    const TOKEN = {
      token: 't',
      expires_at: '2026-09-25T20:00:00Z',
      mcp: {},
      session_mcp_server: {
        id: 'mycowork_bridge',
        name: 'mycowork_bridge',
        transport: { type: 'streamable_http', url: 'u', headers: {} },
      },
      workspace: '/data/ws/1',
    };
    let tokenFailures = 0;
    /** Bridge by URL + method; the plan POST answers with the given succession. */
    const bridge = (succession: 'expanded' | 'shrunk') =>
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url.endsWith('/context')) return reply(200, CONTEXT);
        if (url === '/bridge/v1/scopes') return reply(200, { sources: SOURCES, projects: [] });
        if (url === '/bridge/v1/context-plans' && method === 'POST')
          return reply(201, { plan_id: 'plan_2', version: 2, status: 'OK', succession });
        if (url.endsWith('/tokens'))
          return tokenFailures-- > 0
            ? reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } })
            : reply(201, TOKEN);
        if (method === 'PUT') return reply(200, {});
        return reply(404, {});
      });
    const calls = (method: string, suffix: string) =>
      fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).endsWith(suffix));
    const openDrawer = async () => {
      render(<ConversationScopeSlot conversation_id='conv-1' />);
      fireEvent.click(await screen.findByRole('button', { name: '更改范围' }));
      await screen.findByText('新增库');
    };

    it('widening: a new plan version with the current plan as parent; the Bridge rebinds this conversation', async () => {
      bridge('expanded');
      await openDrawer();
      fireEvent.click(screen.getByText('新增库'));
      fireEvent.click(screen.getByRole('button', { name: '应用' }));
      await waitFor(() => expect(calls('GET', '/conversations/conv-1/context')).toHaveLength(2)); // refetched
      const [[, post]] = calls('POST', '/context-plans');
      expect(JSON.parse(String(post?.body))).toMatchObject({
        parent_plan_id: 'plan_1',
        scopes: ['src_a', 'src_b', 'src_c'].map((id) => ({ selector: 'knowledge_base', id })),
      });
      expect(calls('PUT', '/conversations/conv-1/plan')).toHaveLength(0); // no separate, non-atomic rebind
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('strict narrowing: opens the Guid page, and the next send uses the narrowed plan without freezing another', async () => {
      bridge('shrunk');
      await openDrawer();
      fireEvent.click(screen.getByText('产品库'));
      fireEvent.click(screen.getByRole('button', { name: '应用' }));
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/guid'));
      expect(calls('PUT', '/conversations/conv-1/plan')).toHaveLength(0);
      tokenFailures = 1;
      await expect(withGuidScope({})).rejects.toThrow(); // token failed: nothing sent, the narrowed plan is kept
      const extra = await withGuidScope({});
      expect(extra.selected_session_mcp_servers?.[0]?.name).toBe('mycowork_bridge');
      expect(calls('POST', '/context-plans/plan_2/tokens')).toHaveLength(2); // the retry still uses the narrowed plan
      expect(calls('POST', '/context-plans')).toHaveLength(1); // only the narrowing itself
      await withGuidScope({}); // the narrowed plan is used once: a later send freezes a fresh plan
      expect(calls('POST', '/context-plans')).toHaveLength(2);
    });

    it('refuses an empty selection and keeps the drawer open', async () => {
      bridge('shrunk');
      await openDrawer();
      fireEvent.click(screen.getByText('项目A资料'));
      fireEvent.click(screen.getByText('产品库'));
      fireEvent.click(screen.getByRole('button', { name: '应用' }));
      expect(await screen.findByText('至少选择一个知识库；只想普通对话请直接新建会话')).toBeInTheDocument();
      expect(calls('POST', '/context-plans')).toHaveLength(0);
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });
});
