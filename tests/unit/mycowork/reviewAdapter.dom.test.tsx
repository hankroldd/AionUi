/**
 * 文件：tests/unit/mycowork/reviewAdapter.dom.test.tsx
 * 职责：核查独立 Reviewer 的配置、真实 ACK、消息边界与账号生命周期。
 * 边界：仅模拟公开 IPC；不启动服务、不执行模型或读取真实资料。
 * 关联：PR10 E1；renderer/mycowork-reviews.tsx。
 */
import React, { StrictMode } from 'react';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { useReviewAdapter } from '@/renderer/mycowork-reviews';
import { ReviewCreationNotStarted } from '@mycowork/ui';
import type { Review } from '@mycowork/contracts';

const api = vi.hoisted(() => ({
  owner: 'fixture-owner',
  create: vi.fn(),
  get: vi.fn(),
  send: vi.fn(),
  messages: vi.fn(),
  usage: vi.fn(),
  stop: vi.fn(),
  skills: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: { invoke: api.create },
      get: { invoke: api.get },
      sendMessage: { invoke: api.send },
      getUsage: { invoke: api.usage },
      stop: { invoke: api.stop },
    },
    database: { getConversationMessages: { invoke: api.messages } },
    fs: { listAvailableSkills: { invoke: api.skills }, readFile: { invoke: api.readFile } },
  },
}));
vi.mock('@/renderer/mycowork-resource-navigation', () => ({ useOwnerKey: () => api.owner }));
vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({
    current_model: { id: 'provider-fixture', use_model: 'model-fixture', api_key: 'discard-fixture-private' },
    modelList: [{ id: 'provider-fixture', name: '虚构网关', platform: 'custom', models: ['model-fixture'] }],
  }),
}));

const session = {
  review_id: 'review-fixture',
  plan_id: 'plan-fixture',
  workspace: '/fixture/MyCowork 审查 review-fixture',
  prompt: '仅审查固定版本',
  input_revision_id: 'revision-fixture',
  input_content_sha256: 'a'.repeat(64),
  session_mcp_server: {
    id: 'mycowork_bridge' as const,
    name: 'mycowork_bridge' as const,
    transport: { type: 'streamable_http' as const, url: '/bridge/mcp', headers: { Authorization: 'fixture' } },
  },
};
const review = {
  review_id: session.review_id,
  resource_id: 'resource-fixture',
  input_revision_id: session.input_revision_id,
} as Review;
const execution = { conversation_id: 'ack/chat', message_id: 'user-ack', turn_id: 'host-turn' };
const message = (id: string, content: string, position = 'left') => ({
  id,
  conversation_id: execution.conversation_id,
  type: 'text',
  position,
  content: { content },
  backend_turn_id: 'different-backend-turn',
  status: 'finish',
});
const conversation = () => ({
  id: execution.conversation_id,
  type: 'aionrs',
  model: { provider_id: 'provider-fixture', model: 'model-fixture', use_model: null },
  runtime: { state: 'idle', can_send_message: true, has_task: false, is_processing: false, turn_id: null },
  extra: {
    workspace: session.workspace,
    skills: [],
    mcp_server_ids: [],
    session_mcp_servers: [session.session_mcp_server],
  },
});
function mount() {
  return renderHook(() => useReviewAdapter());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.owner = 'fixture-owner';
  api.readFile.mockResolvedValue(
    JSON.stringify({
      resource_id: review.resource_id,
      input_revision_id: review.input_revision_id,
      format: 'text',
      render: null,
    })
  );
  api.create.mockResolvedValue({ id: execution.conversation_id });
  api.get.mockResolvedValue(conversation());
  api.send.mockResolvedValue({ msg_id: execution.message_id, turn_id: execution.turn_id });
  api.messages.mockResolvedValue({
    items: [
      message('old', '旧意见'),
      message('user-ack', '请求', 'right'),
      message('answer', '{"review_id":"review-fixture"}'),
    ],
    has_more_after: false,
    newest_cursor: 'cursor-1',
  });
  api.usage.mockResolvedValue({ used: 99000, size: 200000, _meta: { input_tokens: 42, output_tokens: 8 } });
  api.stop.mockResolvedValue({ runtime: { state: 'idle' } });
  api.skills.mockResolvedValue([
    { name: 'auto', source: 'builtin', is_auto_inject: true },
    { name: 'manual', source: 'builtin', is_auto_inject: false },
    { name: 'custom', source: 'custom' },
  ]);
});
afterEach(cleanup);

it('creates directly from the current model with no assistant, skills, files or old MCP', async () => {
  const { result } = mount();
  expect(await result.current.create(session)).toBe(execution.conversation_id);
  expect(api.create).toHaveBeenCalledExactlyOnceWith({
    type: 'aionrs',
    name: session.review_id,
    model: { id: 'provider-fixture', use_model: 'model-fixture', platform: '', name: '', base_url: '', api_key: '' },
    extra: {
      workspace: session.workspace,
      custom_workspace: true,
      default_files: [],
      preset_enabled_skills: [],
      exclude_auto_inject_skills: ['auto', 'manual'],
      selected_mcp_server_ids: [],
      selected_session_mcp_servers: [session.session_mcp_server],
    },
  });
  expect(api.get).not.toHaveBeenCalled();
});

it('returns the actual create ACK even if subsequent reads will fail', async () => {
  api.get.mockRejectedValue(new Error('fixture read unavailable'));
  const { result } = mount();
  expect(await result.current.create(session)).toBe('ack/chat');
  expect(api.get).not.toHaveBeenCalled();
});

it('identifies a failed builtin skill precheck as definitely before create POST', async () => {
  api.skills.mockRejectedValueOnce(new Error('fixture offline'));
  const { result } = mount();
  await expect(result.current.create(session)).rejects.toBeInstanceOf(ReviewCreationNotStarted);
  expect(api.create).not.toHaveBeenCalled();
  expect(await result.current.create(session)).toBe(execution.conversation_id);
  expect(api.create).toHaveBeenCalledTimes(1);
});

it.each(['', ' ', undefined])('rejects a create ACK with invalid id %s without retrying', async (id) => {
  api.create.mockResolvedValue({ id });
  const { result } = mount();
  await expect(result.current.create(session)).rejects.toThrow('review_create_ack_invalid');
  expect(api.create).toHaveBeenCalledTimes(1);
});

it('verifies the same acknowledged conversation, exact directory and dedicated MCP', async () => {
  const { result } = mount();
  await result.current.create(session);
  await result.current.verify(execution.conversation_id, session);
  expect(api.get).toHaveBeenCalledExactlyOnceWith({ id: 'ack%2Fchat' });
});

it.each([
  { workspace: '/fixture/old' },
  { skills: ['old-skill'] },
  { skills: undefined },
  { mcp_server_ids: ['old-mcp'] },
  { session_mcp_servers: [] },
  { session_mcp_servers: [session.session_mcp_server, { id: 'extra' }] },
  {
    session_mcp_servers: [
      {
        ...session.session_mcp_server,
        transport: { ...session.session_mcp_server.transport, headers: { Authorization: 'wrong' } },
      },
    ],
  },
  { session_mode: 'yolo' },
  { preset_assistant_id: 'old-assistant' },
])('rejects a mismatched isolation snapshot %#', async (extra) => {
  api.get.mockResolvedValue({ ...conversation(), extra: { ...conversation().extra, ...extra } });
  const { result } = mount();
  await expect(result.current.verify(execution.conversation_id, session)).rejects.toThrow('review_isolation_mismatch');
  expect(api.send).not.toHaveBeenCalled();
});

it('sends the prompt once with empty attachments, sessions and skills and returns real ACK ids', async () => {
  const { result } = mount();
  expect(await result.current.send(execution.conversation_id, session.prompt)).toEqual({
    message_id: execution.message_id,
    turn_id: execution.turn_id,
  });
  expect(api.send).toHaveBeenCalledExactlyOnceWith({
    conversation_id: 'ack%2Fchat',
    input: session.prompt,
    files: [],
    sessions: [],
    inject_skills: [],
  });
});

it.each([{ msg_id: 'user-ack' }, { turn_id: 'host-turn' }, { msg_id: '', turn_id: 'host-turn' }])(
  'rejects invalid send ACK %# without replay',
  async (ack) => {
    api.send.mockResolvedValue(ack);
    const { result } = mount();
    await expect(result.current.send(execution.conversation_id, session.prompt)).rejects.toThrow(
      'review_send_ack_invalid'
    );
    expect(api.send).toHaveBeenCalledTimes(1);
  }
);

it.each(['create', 'send'] as const)('does not replay an unknown %s response', async (phase) => {
  api[phase].mockRejectedValue(new Error('fixture connection lost'));
  const { result } = mount();
  const pending =
    phase === 'create'
      ? result.current.create(session)
      : result.current.send(execution.conversation_id, session.prompt);
  await expect(pending).rejects.toThrow('fixture connection lost');
  expect(api[phase]).toHaveBeenCalledTimes(1);
});

it('reads only assistant text after the ACK and does not mislabel context occupancy as consumed tokens', async () => {
  const { result } = mount();
  expect(await result.current.observe(execution, review)).toEqual({
    status: 'idle',
    outputs: ['{"review_id":"review-fixture"}'],
    tokensUsed: null,
    renderingVerifiedFrom: 0,
  });
  expect(api.messages).toHaveBeenCalledExactlyOnceWith({
    conversation_id: 'ack%2Fchat',
    anchor_message_id: execution.message_id,
    content_mode: 'full',
    limit: 100,
  });
});

it('follows public message cursors and stops before any later user turn', async () => {
  api.messages
    .mockResolvedValueOnce({
      items: [message('user-ack', '请求', 'right')],
      has_more_after: true,
      newest_cursor: 'next',
    })
    .mockResolvedValueOnce({
      items: [
        message('answer', '新意见'),
        message('other-user', '下轮请求', 'right'),
        message('other-answer', '别轮意见'),
      ],
      has_more_after: false,
    });
  const { result } = mount();
  expect((await result.current.observe(execution, review)).outputs).toEqual(['新意见']);
  expect(api.messages.mock.calls[1]![0]).toEqual({
    conversation_id: 'ack%2Fchat',
    after: 'next',
    content_mode: 'full',
    limit: 100,
  });
});

it('missing ACK cannot turn old assistant text into this review result', async () => {
  api.messages.mockResolvedValue({ items: [message('old', '旧意见')], has_more_after: false });
  const { result } = mount();
  await expect(result.current.observe(execution, review)).rejects.toThrow('review_message_anchor_missing');
});

it('idle with no completed assistant output remains an empty observation', async () => {
  api.messages.mockResolvedValue({
    items: [
      message('user-ack', '请求', 'right'),
      { ...message('partial', '{"review_id":"review-fixture"}'), status: 'work' },
    ],
    has_more_after: false,
  });
  const { result } = mount();
  expect(await result.current.observe(execution, review)).toEqual({
    status: 'idle',
    outputs: [],
    tokensUsed: null,
    renderingVerifiedFrom: 0,
  });
});

it('rejects a message from a different conversation after the anchor', async () => {
  api.messages.mockResolvedValue({
    items: [message('user-ack', '请求', 'right'), { ...message('foreign', '其他会话'), conversation_id: 'other-chat' }],
    has_more_after: false,
  });
  const { result } = mount();
  await expect(result.current.observe(execution, review)).rejects.toThrow('review_message_scope_mismatch');
});

it('repeated cursors cannot loop forever or present an incomplete result', async () => {
  api.messages
    .mockResolvedValueOnce({
      items: [message('user-ack', '请求', 'right')],
      has_more_after: true,
      newest_cursor: 'same',
    })
    .mockResolvedValue({ items: [], has_more_after: true, newest_cursor: 'same' });
  const { result } = mount();
  await expect(result.current.observe(execution, review)).rejects.toThrow('review_messages_incomplete');
  expect(api.messages).toHaveBeenCalledTimes(2);
});

it('reports missing native conversation as executor lost', async () => {
  api.get.mockRejectedValue(
    new BackendHttpError({
      method: 'GET',
      path: '/fixture',
      status: 404,
      body: { code: 'NOT_FOUND', error: 'fixture missing' },
    })
  );
  const { result } = mount();
  await expect(result.current.observe(execution, review)).rejects.toThrow('review_executor_lost');
  expect(api.messages).not.toHaveBeenCalled();
});

it('cancels only the known original turn', async () => {
  const { result } = mount();
  await result.current.cancel(execution);
  expect(api.stop).toHaveBeenCalledExactlyOnceWith({ conversation_id: 'ack%2Fchat', turn_id: 'host-turn' });
  await expect(result.current.cancel({ conversation_id: execution.conversation_id })).rejects.toThrow(
    'review_turn_unknown'
  );
});

it('an unavailable usage endpoint does not discard readable review output', async () => {
  api.usage.mockRejectedValue(new Error('fixture usage unavailable'));
  const { result } = mount();
  expect((await result.current.observe(execution, review)).tokensUsed).toBeNull();
});

it('owner change during an awaited call rejects the stale result', async () => {
  const pending = deferred<{ id: string }>();
  api.create.mockReturnValue(pending.promise);
  const { result, rerender } = mount();
  const create = result.current.create(session);
  await Promise.resolve();
  api.owner = 'other-owner';
  rerender();
  pending.resolve({ id: 'created' });
  await expect(create).rejects.toThrow('review_identity_changed');
});

it('a stale adapter cannot operate after switching away and back', async () => {
  const { result, rerender } = mount();
  const old = result.current;
  api.owner = 'other-owner';
  rerender();
  api.owner = 'fixture-owner';
  rerender();
  await expect(old.send(execution.conversation_id, session.prompt)).rejects.toThrow('review_identity_changed');
  expect(api.send).not.toHaveBeenCalled();
});

it('unmount invalidates pending work and StrictMode still permits current work', async () => {
  const pending = deferred<ReturnType<typeof conversation>>();
  api.get.mockReturnValue(pending.promise);
  const { result, unmount } = mount();
  const verify = result.current.verify(execution.conversation_id, session);
  unmount();
  pending.resolve(conversation());
  await expect(verify).rejects.toThrow('review_identity_changed');
  api.get.mockResolvedValue(conversation());
  const current = renderHook(() => useReviewAdapter(), {
    wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
  });
  await current.result.current.create(session);
  await expect(current.result.current.verify(execution.conversation_id, session)).resolves.toBeUndefined();
});
