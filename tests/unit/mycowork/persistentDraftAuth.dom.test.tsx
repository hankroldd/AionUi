/**
 * 文件：tests/unit/mycowork/persistentDraftAuth.dom.test.tsx
 * 职责：用真实AuthProvider区分独立组件兼容与未登录拒发，核对Team和明确prefill边界。
 * 边界：只替换HTTP、桌面壳、会话IPC与无关导航；不替换Auth hook或持久草稿适配。
 */
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';
import { useGuidPersistentDraft, useConversationPersistentDraft } from '@/renderer/mycowork-drafts';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';
import { resetAccountScopedState } from '@mycowork/ui';
import type { DraftState } from '@mycowork/contracts';

const boundary = vi.hoisted(() => {
  vi.stubGlobal('electronAPI', undefined);
  return { create: vi.fn() };
});
vi.mock('@/common', () => ({ ipcBridge: { conversation: { create: { invoke: boundary.create } } } }));
vi.mock('@/renderer/mycowork-slots', () => ({
  withGuidScope: async (extra: unknown) => extra,
  bindGuidScope: async () => {},
  notifyCapabilityBlocked: () => false, // R036：发送失败不走“去配置”通知，原错误分支照旧
  handoffGuidDraft: vi.fn(),
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));
vi.mock('swr', () => ({ mutate: async () => {} }));
vi.mock('@arco-design/web-react', async (original) => ({
  ...(await original<typeof import('@arco-design/web-react')>()),
  Message: { warning: vi.fn(), error: vi.fn() },
}));

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const user = { success: true, user: { id: 'owner-a', username: 'fixture-a' } };
const empty: DraftState = { content: '', files: [], sessions: [] };
let loginStatus: 'checking' | 'authenticated' | 'unauthenticated';
let stored: DraftState | undefined;
beforeEach(() => {
  resetAccountScopedState();
  sessionStorage.clear();
  stored = undefined;
  loginStatus = 'authenticated';
  boundary.create.mockReset().mockResolvedValue({ id: 'created-a' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url) === '/api/auth/user') {
        if (loginStatus === 'checking') return new Promise<Response>(() => {});
        return loginStatus === 'authenticated' ? reply(200, user) : reply(403, {});
      }
      if (String(url).includes('/drafts/'))
        return stored
          ? reply(200, {
              draft_id: 'draft-a',
              input_location: 'guid',
              revision: 1,
              submission_id: '81cf20c8-2070-45d4-bb4e-b323e1f9cb7f',
              state: stored,
              updated_at: '2026-10-15T01:00:00Z',
            })
          : reply(404, { error: { code: 'NOT_FOUND' } });
      return reply(200, {});
    })
  );
});
afterEach(() => {
  cleanup();
  resetAccountScopedState();
  vi.unstubAllGlobals();
});
const draftCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/drafts/'));

function GuidHarness({ navigation = null }: { navigation?: Record<string, unknown> | null }) {
  const [input, setInput] = useState('虚构输入');
  const [dir, setDir] = useState('/initial');
  const draft = useGuidPersistentDraft({
    input: { input, setInput, files: [], setFiles: vi.fn(), dir, setDir } as never,
    agent: {} as never,
    model: {} as never,
    skills: [],
    servers: [],
    choices: {},
    setSkills: vi.fn(),
    setDisabledSkills: vi.fn(),
    setMcp: vi.fn(),
    navigation,
  });
  const send = useGuidSend({
    persistentDraft: draft.enabled ? draft : undefined,
    input,
    setInput,
    files: [],
    setFiles: vi.fn(),
    dir,
    setDir,
    setLoading: vi.fn(),
    loading: false,
    selectedAssistantId: 'assistant-a',
    selectedAssistantBackend: 'aionrs',
    selectedMode: 'default',
    selectedAcpModel: null,
    current_model: { id: 'provider-a', use_model: 'model-a', models: ['model-a'] } as never,
    guidDisabledBuiltinSkills: [],
    guidEnabledSkills: [],
    availableMcpServers: [],
    selectedMcpServerIds: [],
    isGoogleAuth: false,
    setMentionOpen: vi.fn(),
    setMentionQuery: vi.fn(),
    setMentionSelectorOpen: vi.fn(),
    setMentionActiveIndex: vi.fn(),
    navigate: vi.fn(async () => {}),
    t: ((key: string) => key) as never,
    localeKey: 'zh-CN',
  } satisfies GuidSendDeps);
  return (
    <>
      <output data-testid='auth'>
        {JSON.stringify({ ready: draft.ready, enabled: draft.enabled, provider: draft.hasAuthProvider })}
      </output>
      <output data-testid='workspace'>{dir}</output>
      <output data-testid='body'>{input}</output>
      <button onClick={() => void send.handleSend().catch(() => {})}>直接尝试发送</button>
    </>
  );
}
function TeamHarness() {
  const draft = useConversationPersistentDraft('team-a', empty, vi.fn(), false);
  return (
    <output data-testid='auth'>
      {JSON.stringify({ ready: draft.ready, enabled: draft.enabled, provider: draft.hasAuthProvider })}
    </output>
  );
}
function Logout() {
  const auth = useAuth();
  return <button onClick={() => void auth.logout()}>退出</button>;
}

it('缺少AuthProvider的独立原生组件保留原发送，且不读写草稿或清别人的交接', async () => {
  sessionStorage.setItem('aionrs_initial_message_other', '独立组件不能清理的交接');
  render(<GuidHarness />);
  expect(screen.getByTestId('auth')).toHaveTextContent('"provider":false');
  expect(screen.getByTestId('auth')).toHaveTextContent('"ready":true');
  fireEvent.click(screen.getByText('直接尝试发送'));
  await waitFor(() => expect(boundary.create).toHaveBeenCalledTimes(1));
  expect(draftCalls()).toHaveLength(0);
  expect(sessionStorage.getItem('aionrs_initial_message_other')).toBe('独立组件不能清理的交接');
});
it.each(['checking', 'unauthenticated'] as const)('真实AuthProvider的%s状态仍拒绝发送', async (status) => {
  loginStatus = status;
  render(
    <AuthProvider>
      <GuidHarness />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('"provider":true'));
  fireEvent.click(screen.getByText('直接尝试发送'));
  expect(screen.getByTestId('auth')).toHaveTextContent('"ready":false');
  expect(boundary.create).not.toHaveBeenCalled();
  expect(draftCalls()).toHaveLength(0);
});
it('真实登录的Team关闭持久层且不做任何草稿HTTP', async () => {
  render(
    <AuthProvider>
      <TeamHarness />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('"ready":true'));
  expect(screen.getByTestId('auth')).toHaveTextContent('"provider":true');
  expect(screen.getByTestId('auth')).toHaveTextContent('"enabled":false');
  expect(draftCalls()).toHaveLength(0);
});
it('Team排除持久化也不绕过真实AuthProvider的未登录状态', async () => {
  loginStatus = 'unauthenticated';
  render(
    <AuthProvider>
      <TeamHarness />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('"provider":true'));
  expect(screen.getByTestId('auth')).toHaveTextContent('"ready":false');
  expect(draftCalls()).toHaveLength(0);
});
it('真实AuthProvider退出仍清交接，独立兼容不影响登出隔离', async () => {
  render(
    <AuthProvider>
      <TeamHarness />
      <Logout />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('"ready":true'));
  sessionStorage.setItem('aionrs_initial_message_other', JSON.stringify({ ownerKey: 'owner-a' }));
  fireEvent.click(screen.getByText('退出'));
  await waitFor(() => expect(sessionStorage.getItem('aionrs_initial_message_other')).toBeNull());
  expect(screen.getByTestId('auth')).toHaveTextContent('"ready":false');
});
it.each([
  ['普通prefill清工作目录', { prefillPrompt: '新问题' }, ''],
  ['preservePrefill保留工作目录', { prefillPrompt: '新问题', preservePrefillDraft: true }, '/saved'],
  ['明确路由目录优先', { prefillPrompt: '新问题', workspace: '/explicit' }, '/explicit'],
])('%s', async (_label, navigation, expected) => {
  stored = { ...empty, content: '旧问题', workspace: '/saved' };
  render(
    <AuthProvider>
      <GuidHarness navigation={navigation as Record<string, unknown>} />
    </AuthProvider>
  );
  await waitFor(() => expect(screen.getByTestId('body')).toHaveTextContent('新问题'));
  expect(screen.getByTestId('workspace').textContent).toBe(expected);
});
