/**
 * 文件：tests/unit/mycowork/capabilityReturnConversation.dom.test.tsx
 * 职责：R036 第二片（navigation-intent §9，D283）：对话页“更改范围”遇资料服务 503 → “去配置” → 能力中心核对对话归属后
 *       “回到原任务” → 回到同一对话，持久草稿恢复输入、范围条重读会话上下文，不自动发送、不重试改范围；
 *       负例：对话 id 格式/外部地址、非本人对话（404）、上下文读失败、别的账号、网络连不上。
 * 边界：只替换身份、HTTP 与 IPC 边界；草稿控制器、范围条、意图解析与能力中心均为真实实现；数据虚构。
 */
import React, { useCallback, useState } from 'react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message, Notification } from '@arco-design/web-react';
import type { DraftState } from '@mycowork/contracts';
import { capabilityReturnTarget, parseCapabilityReturn, resetAccountScopedState } from '@mycowork/ui';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import { useConversationPersistentDraft } from '@/renderer/mycowork-drafts';
import { ConversationScopeSlot, OfficeCapabilitiesSlot } from '@/renderer/mycowork-slots';

const edge = vi.hoisted(() => ({ owner: 'owner-a' as string | undefined }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: edge.owner }, status: edge.owner ? 'authenticated' : 'unauthenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: (k: string) => k }) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('@/common', async (original) => {
  const real = await original<typeof import('@/common')>();
  return {
    ...real,
    ipcBridge: { ...real.ipcBridge, conversation: { ...real.ipcBridge.conversation, responseStream: { on: () => () => {} } } },
  };
});
readRetry.delays = [0, 0];

const intent = { ownerKey: 'owner-a', capabilityId: 'knowledge.retrieval', origin: 'conversation', conversationId: 'conv-1' };
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const CONTEXT = {
  plan_id: 'plan_1',
  version: 1,
  status: 'OK',
  brief: {
    groups: [{ source_id: 'src_a', source_name: '项目A资料', mode: 'whole', counts }],
    excluded: 0,
    unauthorized: 0,
    refs: {},
    policy: { strict: false, web: 'off' },
  },
  used: [],
  withheld: 0,
  superseded: false,
};
const SOURCES = ['src_a', 'src_c'].map((source_id, i) => ({
  source_id,
  name: ['项目A资料', '新增库'][i],
  provider: 'weknora',
  counts,
}));
const savedState: DraftState = { content: '虚构：先列出第三季度周报的提纲', files: [], sessions: [] };

let planStatus = 503;
let contextStatus: Record<string, number> = {};
let calls: Array<{ url: string; method: string }> = [];
const docs = new Map<string, Record<string, unknown>>();
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const doc = (location: string, state: DraftState, revision: number) => ({
  draft_id: `draft-${location}`,
  input_location: location,
  revision,
  submission_id: '14a16b25-58d5-4f96-8739-c2b257cdb417',
  state,
  updated_at: '2026-10-17T00:00:00Z',
});

beforeEach(() => {
  edge.owner = 'owner-a';
  planStatus = 503;
  contextStatus = { 'conv-1': 200 };
  calls = [];
  docs.clear();
  docs.set('conversation:conv-1', doc('conversation:conv-1', savedState, 1));
  resetAccountScopedState();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.includes('/drafts/')) {
        const location = decodeURIComponent(url.split('/drafts/')[1] ?? '');
        if (new Headers(init?.headers).get('x-mycowork-draft-owner') !== edge.owner) return reply(403, {});
        if (method === 'PUT') {
          const value = JSON.parse(String(init?.body));
          const old = docs.get(location) as { revision: number } | undefined;
          if (value.expected_revision !== (old?.revision ?? 0)) return reply(409, { error: { code: 'REVISION_CONFLICT' } });
          docs.set(location, { ...doc(location, value.state, (old?.revision ?? 0) + 1), submission_id: value.submission_id });
          return reply(200, docs.get(location));
        }
        return docs.has(location) ? reply(200, docs.get(location)) : reply(404, {});
      }
      const conv = /\/conversations\/([^/]+)\/context$/.exec(url)?.[1];
      if (conv) {
        const status = contextStatus[conv] ?? 404;
        return status === 200 ? reply(200, CONTEXT) : reply(status, { error: { code: 'X' } });
      }
      if (url.includes('/memory-items')) return reply(200, { items: [], total: 0 });
      if (url === '/bridge/v1/scopes') return reply(200, { sources: SOURCES, projects: [] });
      if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
      if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
      if (url === '/bridge/v1/context-plans' && method === 'POST')
        return reply(planStatus, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'knowledge provider unavailable' } });
      if (url === '/bridge/v1/capabilities')
        return reply(200, {
          capabilities: [
            {
              id: 'knowledge.retrieval',
              state: 'not_configured',
              dependencies: [],
              allowedDataScopes: [],
              reason: '未配置',
              testedAt: new Date().toISOString(),
              version_verified: true,
            },
          ],
        });
      return reply(404, { error: { code: 'NOT_FOUND' } });
    })
  );
});
afterEach(() => {
  cleanup();
  Notification.clear();
  Message.clear();
  resetAccountScopedState();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 对话页的最小外形：真实持久草稿 hook 驱动的输入框 + 真实范围条挂载点。 */
function ConversationPage() {
  const id = useParams().id!;
  const [state, setState] = useState<DraftState>({ content: '', files: [], sessions: [] });
  const restore = useCallback((next: DraftState) => setState(next), []);
  useConversationPersistentDraft(id, state, restore, true);
  return (
    <>
      <textarea aria-label='对话输入' value={state.content} onChange={(e) => setState({ ...state, content: e.target.value })} />
      <ConversationScopeSlot conversation_id={id} />
    </>
  );
}
const renderApp = (entry: string | { pathname: string; state: unknown }) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path='/conversation/:id' element={<ConversationPage />} />
        <Route path='/office/capabilities' element={<OfficeCapabilitiesSlot />} />
      </Routes>
    </MemoryRouter>
  );
const contextReads = () => calls.filter((c) => c.method === 'GET' && c.url.endsWith('/conversations/conv-1/context')).length;
const planPosts = () => calls.filter((c) => c.method === 'POST' && c.url === '/bridge/v1/context-plans').length;
const changeScope = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '更改范围' }));
  fireEvent.click(await screen.findByText('新增库'));
  fireEvent.click(screen.getByRole('button', { name: '应用' }));
};

describe('意图解析：对话来源', () => {
  it('只认合法对话 id，回程路由由来源查表拼出', () => {
    const ok = parseCapabilityReturn({ mycoworkCapabilityReturn: intent }, 'owner-a');
    expect(ok).toEqual(intent);
    expect(capabilityReturnTarget(ok!)).toEqual({
      path: '/conversation/conv-1',
      state: { mycoworkCapabilityReturned: { ownerKey: 'owner-a' } },
    });
    for (const conversationId of [undefined, '', '../guid', 'a/b', 'https://example.invalid/x', 'x'.repeat(129), 7, ['conv-1']])
      expect(parseCapabilityReturn({ mycoworkCapabilityReturn: { ...intent, conversationId } }, 'owner-a')).toBeNull();
    expect(parseCapabilityReturn({ mycoworkCapabilityReturn: intent }, 'owner-b')).toBeNull();
    expect(parseCapabilityReturn({ mycoworkCapabilityReturn: { ...intent, origin: 'conversations' } }, 'owner-a')).toBeNull();
  });
});

describe('对话页 → 去配置 → 回到同一对话', () => {
  it('更改范围遇 503：通知带去配置；回来后输入恢复、上下文重读，不发送也不重试改范围', async () => {
    const error = vi.spyOn(Message, 'error');
    renderApp('/conversation/conv-1');
    const box = await screen.findByRole('textbox', { name: '对话输入' });
    await waitFor(() => expect(box).toHaveValue(savedState.content));
    fireEvent.change(box, { target: { value: '虚构：提纲再加一节风险' } });
    await changeScope();
    fireEvent.click(await screen.findByRole('button', { name: '去配置' }));
    expect(error).not.toHaveBeenCalled();
    const tip = await screen.findByTestId('mycowork-capability-return'); // 读上下文核对归属后才出现
    const readsBeforeReturn = contextReads();
    fireEvent.click(await screen.findByRole('button', { name: '回到原任务' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: '对话输入' })).toHaveValue('虚构：提纲再加一节风险'));
    await waitFor(() => expect(contextReads()).toBe(readsBeforeReturn + 1)); // 范围条重挂载即重读
    expect(tip).not.toBeInTheDocument();
    expect(planPosts()).toBe(1);
    expect(calls.some((c) => c.url.includes('/tasks'))).toBe(false);
  });

  it('网络连不上（502）不当作缺能力：照原样报错、不给去配置', async () => {
    planStatus = 502;
    await waitFor(() => expect(screen.queryByRole('button', { name: '去配置' })).toBeNull()); // 上一例的通知已关
    const error = vi.spyOn(Message, 'error');
    renderApp('/conversation/conv-1');
    await changeScope();
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '去配置' })).toBeNull();
  });
});

describe('能力中心：对话来源的归属核对', () => {
  it('非本人或未绑定（404）、上下文读失败、别的账号都不显示返回动作', async () => {
    contextStatus = { 'conv-foreign': 404, 'conv-broken': 500 };
    const cases: Array<[string, string | undefined]> = [
      ['conv-foreign', 'owner-a'],
      ['conv-broken', 'owner-a'],
      ['conv-1', 'owner-b'],
    ];
    for (const [conversationId, owner] of cases) {
      edge.owner = owner;
      if (owner === 'owner-b') contextStatus['conv-1'] = 200;
      const { unmount } = renderApp({
        pathname: '/office/capabilities',
        state: { mycoworkCapabilityReturn: { ...intent, conversationId } },
      });
      await screen.findByTestId('capability-knowledge.retrieval');
      if (owner === 'owner-a')
        await waitFor(() => expect(calls.some((c) => c.url.includes(`/conversations/${conversationId}/context`))).toBe(true));
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByTestId('mycowork-capability-return')).toBeNull();
      unmount();
    }
  });
});
