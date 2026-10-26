/**
 * 文件：tests/unit/mycowork/branchAdapter.dom.test.tsx
 * 职责：核查分支适配的身份边界、明确消息正文、Skill 实际选择和独立会话配置。
 * 边界：仅模拟公开 AionUi API、身份与模型目录；不启动服务或运行模型。
 * 关联：PR10 C2/C3；renderer/mycowork-branches.tsx。
 */
import React, { StrictMode } from 'react';
import { createHash, webcrypto } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { useBranchAdapter } from '@/renderer/mycowork-branches';

const boundary = vi.hoisted(() => ({
  owner: 'fixture-owner',
  get: vi.fn(),
  message: vi.fn(),
  create: vi.fn(),
  assistants: vi.fn(),
  detail: vi.fn(),
  skills: vi.fn(),
  readSkill: vi.fn(),
  history: vi.fn(),
  providers: [
    {
      id: 'fixture-provider',
      platform: 'openai',
      name: 'fixture',
      base_url: '',
      api_key: '',
      models: ['first', 'preferred'],
    },
  ],
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { get: { invoke: boundary.get }, create: { invoke: boundary.create } },
    database: { getConversationMessage: { invoke: boundary.message } },
    assistants: { list: { invoke: boundary.assistants }, get: { invoke: boundary.detail } },
    fs: { listAvailableSkills: { invoke: boundary.skills }, readSkillFile: { invoke: boundary.readSkill } },
  },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: boundary.owner } }),
}));
vi.mock('@/renderer/hooks/agent/useGoogleAuthModels', () => ({ useGoogleAuthModels: () => ({ isGoogleAuth: false }) }));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: boundary.providers }),
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: boundary.history } }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN', t: (key: string) => key } }));

const anchor = {
  conversation_id: 'source/chat',
  message_id: 'message-fixture',
  is_last_message: true,
  has_turn_anchor: true,
};
const session = {
  plan_id: 'plan-fixture',
  workspace: '/fixture/branch',
  session_mcp_server: {
    id: 'bridge-fixture',
    name: 'Bridge',
    transport: { type: 'streamable_http' as const, url: '/bridge/mcp', headers: {} },
  },
};
const source = () => ({
  id: anchor.conversation_id,
  type: 'aionrs',
  name: '虚构来源',
  assistant: { id: 'assistant-fixture', source: 'generated', name: '虚构助手', backend: 'aionrs' },
  model: { id: 'fixture-provider', use_model: 'preferred', api_key: 'discard-fixture-private' },
  extra: {
    workspace: '/fixture/original',
    skills: ['chosen'],
    session_mcp_servers: [{ id: 'old-mcp' }],
    acp_session_id: 'old-session',
    preset_rules: 'old-rules',
    system_prompt: 'old-profile-must-not-be-copied',
  },
});
const profileToken = 'fixture-Profile_token-0123';
const profileMcp = (headers: Record<string, string> = { Authorization: `Bearer ${profileToken}` }) => ({
  id: 'mycowork_bridge',
  name: 'mycowork_bridge',
  transport: { type: 'streamable_http', url: '/bridge/mcp', headers },
});
const detail = () => ({
  id: 'assistant-fixture',
  state: { enabled: true },
  engine: { agent: { type: 'aionrs' } },
  profile: { name: '虚构助手' },
  defaults: {
    model: { mode: 'fixed', value: 'preferred' },
    skills: { mode: 'fixed', value: ['chosen'] },
    permission: { mode: 'fixed', value: 'yolo' },
    mcps: { mode: 'fixed', value: ['old-mcp'] },
  },
  capabilities: { default_disabled_builtin_skill_ids: ['auto-drop'] },
  preferences: { last_skill_ids: [], last_disabled_builtin_skill_ids: [], last_mcp_ids: [] },
});
const catalog = [
  { name: 'chosen', location: '/fixture/chosen/SKILL.md', source: 'custom', is_auto_inject: false },
  { name: 'auto-keep', location: '/fixture/keep', source: 'builtin', is_auto_inject: true },
  { name: 'auto-drop', location: '/fixture/drop', source: 'builtin', is_auto_inject: true },
];
function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}
function mount() {
  return renderHook(() => useBranchAdapter(), { wrapper });
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
  vi.stubGlobal('crypto', webcrypto);
  boundary.owner = 'fixture-owner';
  boundary.providers = [
    {
      id: 'fixture-provider',
      platform: 'openai',
      name: 'fixture',
      base_url: '',
      api_key: '',
      models: ['first', 'preferred'],
    },
  ];
  boundary.get.mockImplementation(async ({ id }: { id: string }) =>
    id === encodeURIComponent(anchor.conversation_id)
      ? source()
      : { id, type: 'aionrs', extra: { workspace: session.workspace, skills: ['chosen'] } }
  );
  boundary.message.mockResolvedValue({
    id: anchor.message_id,
    conversation_id: anchor.conversation_id,
    type: 'text',
    content: { content: '仅所选正文\r\n不包含其他消息' },
  });
  boundary.create.mockResolvedValue({ id: 'ack-fixture' });
  boundary.assistants.mockResolvedValue([
    { id: 'assistant-fixture', enabled: true, source: 'generated', agent: { type: 'aionrs' } },
  ]);
  boundary.detail.mockResolvedValue(detail());
  boundary.skills.mockResolvedValue(catalog);
  boundary.readSkill.mockResolvedValue('# 虚构 Skill\r\n');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('only the selected message becomes draft content; creation carries the new directory and Bridge MCP', async () => {
  const { result } = mount();
  const prepared = await result.current.prepare(anchor);
  boundary.get.mockRejectedValue(new Error('fixture lookup unavailable'));
  const system_prompt = 'fixture frozen writing rules';
  const conversationId = await prepared.createConversation('new-fixture', { ...session, system_prompt });
  expect({ conversationId, content: prepared.content, skills: prepared.skills }).toEqual({
    conversationId: 'ack-fixture',
    content: '仅所选正文\r\n不包含其他消息',
    skills: [{ skill_id: 'chosen', content: '# 虚构 Skill\r\n' }],
  });
  expect(boundary.create.mock.calls[0]![0]).toEqual({
    id: 'new-fixture',
    name: '虚构来源',
    model: { id: 'fixture-provider', use_model: 'preferred', platform: '', name: '', base_url: '', api_key: '' },
    assistant: {
      id: 'assistant-fixture',
      locale: 'zh-CN',
      conversation_overrides: {
        model: 'preferred',
        permission: 'default',
        skill_ids: ['chosen'],
        disabled_builtin_skill_ids: ['auto-keep', 'auto-drop'],
        mcp_ids: [],
      },
    },
    extra: {
      system_prompt,
      workspace: session.workspace,
      custom_workspace: true,
      selected_mcp_server_ids: [],
      selected_session_mcp_servers: [session.session_mcp_server],
      preset_enabled_skills: ['chosen'],
      exclude_auto_inject_skills: ['auto-keep', 'auto-drop'],
    },
  });
  expect(boundary.message).toHaveBeenCalledWith({ conversation_id: 'source%2Fchat', message_id: anchor.message_id });
});

it('version-only preparation uses assistant model defaults and only enabled automatic skills', async () => {
  const { result } = mount();
  const prepared = await result.current.prepare(null);
  boundary.get.mockResolvedValue({
    id: 'ack-fixture',
    type: 'aionrs',
    extra: { workspace: session.workspace, skills: ['auto-keep', 'chosen'] },
  });
  const conversationId = await prepared.createConversation('new-fixture', session);
  const workspace = await result.current.readWorkspace(
    conversationId,
    prepared.skills.map((skill) => skill.skill_id)
  );
  expect({
    profileTokenSha256: prepared.profileTokenSha256,
    label: prepared.label,
    content: prepared.content,
    ids: prepared.skills.map((item) => item.skill_id),
    workspace,
  }).toEqual({
    profileTokenSha256: null,
    label: '虚构助手',
    content: '基于本分支工作目录中的所选文件版本继续处理。本会话不继承原会话的资料范围；不要自动执行。',
    ids: ['chosen', 'auto-keep'],
    workspace: session.workspace,
  });
  expect(boundary.create.mock.calls[0]![0].model).toMatchObject({ id: 'fixture-provider', use_model: 'preferred' });
  expect(boundary.message).not.toHaveBeenCalled();
  expect(boundary.create.mock.calls[0]![0].extra).not.toHaveProperty('system_prompt');
});

it('hashes only the exact source Bridge token and never forwards the bearer', async () => {
  boundary.get.mockResolvedValue({
    ...source(),
    extra: {
      ...source().extra,
      session_mcp_servers: [{ id: 'unrelated' }, profileMcp({ authorization: `bEaReR ${profileToken}` })],
    },
  });
  const { result } = mount();
  const prepared = await result.current.prepare(anchor);
  expect(prepared.profileTokenSha256).toBe(createHash('sha256').update(profileToken).digest('hex'));
  await prepared.createConversation('new-fixture', session);
  expect(JSON.stringify({ prepared, requests: boundary.create.mock.calls })).not.toContain(profileToken);
});

it.each([
  ['multiple entries', [profileMcp(), profileMcp()]],
  ['mismatched name', [{ ...profileMcp(), name: 'different-service' }]],
  ['wrong transport', [{ ...profileMcp(), transport: { type: 'stdio' } }]],
  ['missing authorization', [profileMcp({})]],
  ['wrong scheme', [profileMcp({ Authorization: 'Basic fixture-secret' })]],
  ['malformed bearer', [profileMcp({ Authorization: `Bearer ${profileToken} ` })]],
  ['duplicate authorization', [profileMcp({ Authorization: 'Bearer first', authorization: 'Bearer second' })]],
  ['invalid list', {}],
])('rejects %s without exposing credentials or creating a conversation', async (_label, servers) => {
  boundary.get.mockResolvedValue({ ...source(), extra: { ...source().extra, session_mcp_servers: servers } });
  const { result } = mount();
  await expect(result.current.prepare(anchor)).rejects.toMatchObject({
    message: 'conversation.createFailed',
    cause: { message: 'BRANCH_PROFILE_UNAVAILABLE' },
  });
  expect(boundary.create).not.toHaveBeenCalled();
});

it('a source without a Bridge MCP explicitly freezes no Profile', async () => {
  const { result } = mount();
  await expect(result.current.prepare(anchor)).resolves.toMatchObject({ profileTokenSha256: null });
});

it('an ACP source cannot be prepared as an aionrs branch', async () => {
  boundary.get.mockResolvedValue({ ...source(), type: 'acp' });
  const { result } = mount();
  await expect(result.current.prepare(anchor)).rejects.toMatchObject({
    cause: { message: 'BRANCH_SOURCE_UNAVAILABLE' },
  });
  await expect(result.current.readWorkspace(anchor.conversation_id, ['chosen'])).rejects.toMatchObject({
    cause: { message: 'BRANCH_WORKSPACE_SKILLS_MISMATCH' },
  });
  expect(boundary.message).not.toHaveBeenCalled();
});

it('a message from another conversation never becomes the new draft', async () => {
  boundary.message.mockResolvedValue({
    id: anchor.message_id,
    conversation_id: 'other-fixture',
    type: 'text',
    content: { content: '不得复制' },
  });
  const { result } = mount();
  await expect(result.current.prepare(anchor)).rejects.toMatchObject({
    cause: { message: 'BRANCH_MESSAGE_UNAVAILABLE' },
  });
  expect(boundary.create).not.toHaveBeenCalled();
});

it('identity change while reading source metadata stops preparation before further reads', async () => {
  const pending = deferred<ReturnType<typeof source>>();
  boundary.get.mockReturnValueOnce(pending.promise);
  const { result, rerender } = mount();
  const preparing = result.current.prepare(anchor);
  await act(async () => {
    await Promise.resolve();
    boundary.owner = 'other-owner';
    rerender();
  });
  pending.resolve(source());
  await expect(preparing).rejects.toMatchObject({ cause: { message: 'BRANCH_IDENTITY_CHANGED' } });
  expect(boundary.message).not.toHaveBeenCalled();
});

it('prepared work from an old identity cannot create or navigate after switching away and back', async () => {
  const { result, rerender } = mount();
  const oldAdapter = result.current;
  const prepared = await oldAdapter.prepare(anchor);
  boundary.owner = 'other-owner';
  rerender();
  boundary.owner = 'fixture-owner';
  rerender();
  await expect(prepared.createConversation('new-fixture', session)).rejects.toMatchObject({
    cause: { message: 'BRANCH_IDENTITY_CHANGED' },
  });
  expect(boundary.create).not.toHaveBeenCalled();
});

it('a legacy source still resolves its assistant and reports unavailable skill content without freezing it', async () => {
  boundary.get.mockResolvedValue({
    ...source(),
    assistant: undefined,
    extra: { ...source().extra, preset_assistant_id: 'assistant-fixture' },
  });
  boundary.readSkill.mockRejectedValue(new Error('fixture unavailable'));
  const { result } = mount();
  const prepared = await result.current.prepare(anchor);
  expect(prepared.skills).toEqual([{ skill_id: 'chosen' }]);
});

it.each(['skills', 'ack'])('invalid %s cannot complete an acknowledged creation', async (kind) => {
  const { result } = mount();
  const prepared = await result.current.prepare(anchor);
  if (kind === 'ack') {
    boundary.create.mockResolvedValue({ id: '' });
    await expect(prepared.createConversation('new-fixture', session)).rejects.toMatchObject({
      cause: { message: 'BRANCH_CREATE_ACK_INVALID' },
    });
    expect(boundary.get).toHaveBeenCalledTimes(1);
  } else {
    const conversationId = await prepared.createConversation('new-fixture', session);
    expect(conversationId).toBe('ack-fixture');
    boundary.get.mockResolvedValue({
      id: conversationId,
      type: 'aionrs',
      extra: { workspace: session.workspace, skills: ['chosen', 'extra-skill'] },
    });
    await expect(result.current.readWorkspace(conversationId, ['chosen'])).rejects.toMatchObject({
      cause: { message: 'BRANCH_WORKSPACE_SKILLS_MISMATCH' },
    });
  }
  expect(boundary.history).not.toHaveBeenCalled();
});

it('only a native 404 NOT_FOUND becomes a missing workspace; unavailable reads remain errors', async () => {
  const { result } = mount();
  boundary.get.mockRejectedValueOnce(
    new BackendHttpError({
      method: 'GET',
      path: '/api/conversations/missing-fixture',
      status: 404,
      body: { code: 'NOT_FOUND', error: 'fixture' },
    })
  );
  await expect(result.current.readWorkspace('missing-fixture', ['chosen'])).resolves.toBeNull();
  boundary.get.mockRejectedValueOnce(new Error('fixture unavailable'));
  await expect(result.current.readWorkspace('new-fixture', ['chosen'])).rejects.toThrow('fixture unavailable');
});

it('unmount invalidates a prepared creation', async () => {
  const { result, unmount } = mount();
  const prepared = await result.current.prepare(anchor);
  unmount();
  await expect(prepared.createConversation('new-fixture', session)).rejects.toMatchObject({
    cause: { message: 'BRANCH_IDENTITY_CHANGED' },
  });
  expect(boundary.create).not.toHaveBeenCalled();
});

it('StrictMode lifecycle replay leaves the current owner usable', async () => {
  const { result } = renderHook(() => useBranchAdapter(), {
    wrapper: ({ children }) => (
      <StrictMode>
        <MemoryRouter>{children}</MemoryRouter>
      </StrictMode>
    ),
  });
  await expect(result.current.prepare(anchor)).resolves.toMatchObject({ content: '仅所选正文\r\n不包含其他消息' });
});
