/**
 * 文件：tests/unit/mycowork/officeTaskRecovery.dom.test.tsx
 * 职责：真实发送框重新挂载时恢复本人办公任务，验证失败重试与迟到查询隔离。
 * 边界：只替换 HTTP/IPC；不替换发送框、持久草稿、任务客户端或恢复逻辑。
 * 关联：PR03 plan §14；task-states.md §6，D297。
 */
import '@arco-design/web-react/lib/_util/react-19-adapter';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import type { TaskRun } from '@mycowork/contracts';
import { resetAccountScopedState, restoreScope } from '@mycowork/ui';
import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { ThemeProvider } from '@/renderer/hooks/context/ThemeContext';
import { PreviewProvider } from '@/renderer/pages/conversation/Preview';
import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import { resetConversationRuntimeViewStoreForTest } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import { resetConversationCommandQueueBackgroundRunnerForTest } from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import enConversation from '@/renderer/services/i18n/locales/en-US/conversation.json';
import { count, fixture, fixtureFetch, idle, ipcCount, resetFixture } from './officeTaskSend.fixture';

vi.hoisted(() => {
  vi.stubGlobal('electronAPI', undefined);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
});
vi.mock('@/common', async () => (await import('./officeTaskSend.fixture')).createIPCFixture());
const completedListeners = vi.hoisted(() => new Set<(event: Record<string, unknown>) => void>());
vi.mock('@/common/adapter/httpBridge', async (original) => {
  const actual = await original<typeof import('@/common/adapter/httpBridge')>();
  return {
    ...actual,
    wsEmitter: (name: string) =>
      name === 'turn.completed'
        ? {
            on: (callback: (event: Record<string, unknown>) => void) => {
              completedListeners.add(callback);
              return () => completedListeners.delete(callback);
            },
          }
        : actual.wsEmitter(name),
  };
});
const i18n = createInstance();
void i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: { conversation: enConversation } } } });
const model = {
  current_model: { id: 'provider-fixture', use_model: 'model-fixture' },
  providers: [],
  getAvailableModels: (): string[] => [],
  formatModelLabel: () => '',
  handleSelectModel: async () => {},
} as never;
const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
const latestPath = () => `/bridge/v1/tasks/lookup?conversation_id=${fixture.conversation}`;
const endedTask = (extra: Partial<TaskRun> = {}): TaskRun => ({
  run_id: 'run-native',
  submission_id: 'e95cb7cf-b2c1-4d74-ac40-68d754d206d9',
  draft_id: 'old-draft',
  draft_revision: 1,
  created_at: '2026-10-21T00:00:00Z',
  conversation_id: fixture.conversation,
  msg_id: 'old-message',
  turn_id: 'old-host-turn',
  delivery_phase: 'accepted',
  status: 'running',
  runtime: idle(),
  ...extra,
});
function IdentityProbe() {
  const auth = useAuth();
  return <button onClick={() => void auth.refresh()}>Refresh identity {auth.user?.id}</button>;
}
function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AuthProvider>
            <IdentityProbe />
            <ThemeProvider>
              <ConversationProvider
                value={{
                  conversation_id: fixture.conversation,
                  type: 'aionrs',
                  workspace: '/fixture/native',
                  assistantId: fixture.scene ? 'mycowork-scene-ppt' : 'generic-fixture',
                }}
              >
                <PreviewProvider>
                  <AionrsSendBox conversation_id={fixture.conversation} modelSelection={model} />
                </PreviewProvider>
              </ConversationProvider>
            </ThemeProvider>
          </AuthProvider>
        </MemoryRouter>
      </I18nextProvider>
    </SWRConfig>
  );
}
beforeEach(() => {
  restoreScope({ items: [], views: [], origin: 'turn' });
  resetAccountScopedState();
  resetConversationRuntimeViewStoreForTest();
  resetConversationCommandQueueBackgroundRunnerForTest();
  sessionStorage.clear();
  localStorage.clear();
  resetFixture();
  completedListeners.clear();
  vi.stubGlobal('fetch', fixtureFetch);
});
afterEach(() => {
  cleanup();
  resetAccountScopedState();
  resetConversationCommandQueueBackgroundRunnerForTest();
  vi.unstubAllGlobals();
});
async function mount() {
  const mounted = render(<Page />);
  const input = await screen.findByTestId('sendbox-input');
  await waitFor(() => expect(input).not.toHaveAttribute('inert'));
  return { ...mounted, input };
}

it('返回或刷新后找回已结束轮次，原草稿不清空且不自动完成或重发', async () => {
  fixture.task = endedTask();
  await mount();
  expect(await screen.findByRole('button', { name: 'Mark this turn complete' })).toBeInTheDocument();
  expect(count(latestPath())).toBe(1);
  expect(count('/bridge/v1/tasks/run-native')).toBe(1);
  expect(count('/bridge/v1/tasks')).toBe(0);
  expect(ipcCount('conversation.sendMessage')).toBe(0);
  expect(fixture.requests.filter(({ init }) => init?.method === 'POST')).toHaveLength(0);
  expect(fixture.task.status).toBe('running');
  cleanup();
  resetConversationRuntimeViewStoreForTest();
  await mount();
  expect(await screen.findByRole('button', { name: 'Mark this turn complete' })).toBeInTheDocument();
});

it('已完成任务恢复原结论，较新任务不会被重查成更早状态', async () => {
  fixture.task = endedTask({ status: 'completed' });
  await mount();
  expect(await screen.findByText('Turn marked complete')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark this turn complete' })).toBeNull();
  expect(count('/bridge/v1/tasks')).toBe(0);
});

it.each([
  [
    { status: 'failed', delivery_phase: 'rejected', failure: { kind: 'rate_limited' } },
    'This message was not accepted; your input is kept.',
  ],
  [
    { status: 'recovery_required', delivery_phase: 'unknown' },
    'The send result is not confirmed. It will not be sent again automatically.',
  ],
  [{ status: 'cancelled', stop_confirmed: true }, 'This turn has stopped.'],
] as const)('恢复最新失败、未知、停止任务：%j', async (status, text) => {
  fixture.task = endedTask(status);
  await mount();
  expect(await screen.findByText(text, { exact: false })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark this turn complete' })).toBeNull();
  expect(count('/bridge/v1/tasks')).toBe(0);
});

it('仍等待批准的轮次恢复真实运行信号，不把 idle 旧快照当完成', async () => {
  fixture.runtime = {
    ...idle(),
    state: 'waiting_confirmation',
    turn_id: 'old-host-turn',
    has_task: true,
    is_processing: true,
    can_send_message: false,
    pending_confirmations: 1,
  };
  fixture.task = endedTask({ status: 'waiting_approval', runtime: fixture.runtime });
  await mount();
  await waitFor(() => expect(count('/bridge/v1/tasks/run-native')).toBe(1));
  await act(async () =>
    completedListeners.forEach((callback) => {
      callback({ conversation_id: 'other-conversation', turn_id: 'old-host-turn' });
      callback({ conversation_id: fixture.conversation, turn_id: 'other-turn' });
    })
  );
  expect(screen.queryByRole('button', { name: 'Mark this turn complete' })).toBeNull();
  expect(count('/bridge/v1/tasks')).toBe(0);
});

it('恢复等待批准后继续接收同轮结束事件，回复结束仍可标记完成', async () => {
  fixture.runtime = {
    ...idle(),
    state: 'waiting_confirmation',
    turn_id: 'old-host-turn',
    has_task: true,
    is_processing: true,
    can_send_message: false,
    pending_confirmations: 1,
  };
  fixture.task = endedTask({ status: 'waiting_approval', runtime: fixture.runtime });
  await mount();
  await waitFor(() => expect(count('/bridge/v1/tasks/run-native')).toBe(1));
  fixture.task = { ...fixture.task, runtime: idle() };
  await act(async () =>
    completedListeners.forEach((callback) =>
      callback({ conversation_id: fixture.conversation, turn_id: 'old-host-turn' })
    )
  );
  expect(await screen.findByRole('button', { name: 'Mark this turn complete' })).toBeInTheDocument();
  expect(fixture.requests.some(({ path }) => path.endsWith('/turn-end'))).toBe(false);
});

it('没有办公任务返回404不报错；普通会话不查办公run', async () => {
  await mount();
  await waitFor(() => expect(count(latestPath())).toBe(1));
  expect(screen.queryByTestId('mycowork-task-completion')).toBeNull();
  cleanup();
  resetConversationRuntimeViewStoreForTest();
  fixture.scene = false;
  fixture.requests.length = 0;
  await mount();
  await waitFor(() => expect(fixture.requests.some(({ path }) => path.endsWith('/context'))).toBe(true));
  expect(count(latestPath())).toBe(0);
});

it('查询故障显示重试，重试成功只恢复状态不发送', async () => {
  let unavailable = true;
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) =>
    path === latestPath() && unavailable
      ? reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE' } })
      : fixtureFetch(path, init)
  );
  fixture.task = endedTask({ status: 'completed' });
  await mount();
  const retry = await screen.findByRole('button', { name: 'Retry task status' });
  unavailable = false;
  fireEvent.click(retry);
  expect(await screen.findByText('Turn marked complete')).toBeInTheDocument();
  expect(count('/bridge/v1/tasks')).toBe(0);
});

it('新发送开始后，迟到的旧查询不能覆盖刚受理的新轮次', async () => {
  let release: (() => void) | undefined;
  const old = endedTask({ status: 'completed' });
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path === latestPath())
      return new Promise<Response>((resolve) => {
        release = () => resolve(reply(200, old));
      });
    return fixtureFetch(path, init);
  });
  const { input } = await mount();
  await waitFor(() => expect(release).toBeDefined());
  fireEvent.change(input, { target: { value: '虚构新一轮要求' } });
  fireEvent.click(screen.getByRole('button', { name: /^Send now/ }));
  await waitFor(() => expect(count('/bridge/v1/tasks')).toBe(1));
  await act(async () => release!());
  expect(screen.queryByText('Turn marked complete')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Mark this turn complete' })).toBeNull();
  expect(fixture.task?.turn_id).toBe('host-task-turn');
});

it('新一轮发送被拒后，不保留上一轮已完成提示来掩盖失败', async () => {
  fixture.task = endedTask({ status: 'completed' });
  const { input } = await mount();
  await screen.findByText('Turn marked complete');
  fixture.rejectTask = true;
  fireEvent.change(input, { target: { value: '会被拒绝的虚构新要求' } });
  fireEvent.click(screen.getByRole('button', { name: /^Send now/ }));
  await waitFor(() => expect(document.body).toHaveTextContent('任务尚未受理'));
  expect(screen.queryByText('Turn marked complete')).toBeNull();
  expect(input).toHaveValue('会被拒绝的虚构新要求');
});

it('切到另一会话后迟到查询不覆盖新会话状态', async () => {
  let release: (() => void) | undefined;
  const old = endedTask({ status: 'failed', delivery_phase: 'rejected' });
  const oldPath = latestPath();
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path === oldPath)
      return new Promise<Response>((resolve) => {
        release = () => resolve(reply(200, old));
      });
    return fixtureFetch(path, init);
  });
  const { rerender } = await mount();
  await waitFor(() => expect(release).toBeDefined());
  fixture.conversation = 'another-conversation';
  fixture.task = endedTask({ status: 'completed' });
  rerender(<Page />);
  expect(await screen.findByText('Turn marked complete')).toBeInTheDocument();
  await act(async () => release!());
  expect(screen.getByText('Turn marked complete')).toBeInTheDocument();
  expect(screen.queryByText(/This message was not accepted/)).toBeNull();
});

it('更换登录账号后旧账号的迟到任务不显示', async () => {
  let identity = 'owner-native';
  let release: (() => void) | undefined;
  const old = endedTask({ status: 'completed' });
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path === '/api/auth/user') return reply(200, { success: true, user: { id: identity, username: 'fixture' } });
    if (path === latestPath()) {
      if (identity !== 'owner-native') return reply(404, { error: { code: 'NOT_FOUND' } });
      return new Promise<Response>((resolve) => {
        release = () => resolve(reply(200, old));
      });
    }
    return fixtureFetch(path, init);
  });
  await mount();
  await waitFor(() => expect(release).toBeDefined());
  identity = 'another-owner';
  fireEvent.click(screen.getByRole('button', { name: 'Refresh identity owner-native' }));
  await screen.findByRole('button', { name: 'Refresh identity another-owner' });
  await act(async () => release!());
  expect(screen.queryByText('Turn marked complete')).toBeNull();
  expect(screen.queryByTestId('mycowork-task-completion')).toBeNull();
});

it.each(['read', 'lookup'])('审查复现：结束事件先于恢复 %s 响应到达时仍显示完成入口', async (step) => {
  let release: (() => void) | undefined;
  fixture.runtime = {
    ...idle(),
    state: 'waiting_confirmation',
    turn_id: 'old-host-turn',
    has_task: true,
    is_processing: true,
    can_send_message: false,
    pending_confirmations: 1,
  };
  fixture.task = endedTask({ status: 'waiting_approval', runtime: fixture.runtime });
  const stale = structuredClone(fixture.task);
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path === (step === 'read' ? '/bridge/v1/tasks/run-native' : latestPath()))
      return new Promise<Response>((resolve) => {
        release = () => resolve(reply(200, stale));
      });
    if (path === '/bridge/v1/tasks/run-native') return reply(200, stale);
    return fixtureFetch(path, init);
  });
  await mount();
  await waitFor(() => expect(release).toBeDefined());
  fixture.runtime = idle();
  fixture.task = { ...fixture.task, runtime: fixture.runtime };
  await act(async () =>
    completedListeners.forEach((callback) =>
      callback({ conversation_id: fixture.conversation, turn_id: 'old-host-turn' })
    )
  );
  await act(async () => release!());
  await waitFor(() => expect(completedListeners.size).toBeGreaterThan(0));
  expect(screen.queryByRole('button', { name: 'Mark this turn complete' })).toBeInTheDocument();
  expect(fixture.requests.some(({ path }) => path.endsWith('/turn-end') || path.endsWith('/accept'))).toBe(false);
});
