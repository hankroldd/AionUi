/**
 * 文件：tests/unit/mycowork/officeTaskRetry.dom.test.tsx
 * 职责：验证明确拒绝后的显式重试，以及未知受理和在途续写保护。
 * 边界：使用真实首页hook、任务客户端和持久控制器，只替换HTTP/IPC。
 * 关联：ADR-0025第二片；task-states.md §6。
 */
import '@arco-design/web-react/lib/_util/react-19-adapter';
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import type { DraftState } from '@mycowork/contracts';
import { count, fixture, fixtureFetch, ipcCount, resetFixture } from './officeTaskSend.fixture';
import { resetAccountScopedState, restoreScope, usePersistentDraft } from '@mycowork/ui';
import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';
import { ThemeProvider } from '@/renderer/hooks/context/ThemeContext';
import { useGuidSend } from '@/renderer/pages/guid/hooks/useGuidSend';
import { resetConversationRuntimeViewStoreForTest } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import { resetConversationCommandQueueBackgroundRunnerForTest } from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';

vi.hoisted(() => {
  vi.stubGlobal('electronAPI', undefined);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
});
vi.mock('@/common', async () => (await import('./officeTaskSend.fixture')).createIPCFixture());
const i18n = createInstance();
void i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: { translation: { conversation: { commandQueue: { sendNow: 'Send now', addToQueue: 'Save to Draft box' } } } },
  },
});
const empty = (): DraftState => ({ content: '', files: [], sessions: [] });
const navigate = vi.fn(async () => {});
let unknown = false;
let delayTask: (() => Promise<void>) | undefined;
const tasks = () => fixture.requests.filter(({ path }) => path === '/bridge/v1/tasks');
async function fetchTaskBoundary(raw: string, init?: RequestInit): Promise<Response> {
  const path = String(raw);
  if (
    path.startsWith('/bridge/v1/tasks/lookup?') &&
    fixture.task &&
    new URLSearchParams(path.split('?')[1]).get('submission_id') !== fixture.task.submission_id
  ) {
    fixture.requests.push({ path, init });
    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 });
  }
  const response = await fixtureFetch(path, init);
  if (path === '/bridge/v1/tasks') {
    if (delayTask) await delayTask();
    if (unknown) {
      fixture.task = { ...fixture.task!, status: 'recovery_required', delivery_phase: 'unknown' };
      return new Response(JSON.stringify(fixture.task), { status: 202 });
    }
  }
  return response;
}
beforeEach(() => {
  restoreScope({ items: [], views: [], origin: 'turn' });
  resetAccountScopedState();
  resetConversationRuntimeViewStoreForTest();
  resetConversationCommandQueueBackgroundRunnerForTest();
  sessionStorage.clear();
  localStorage.clear();
  resetFixture();
  unknown = false;
  delayTask = undefined;
  navigate.mockClear();
  vi.stubGlobal('fetch', fetchTaskBoundary);
});
afterEach(() => {
  cleanup();
  resetAccountScopedState();
  resetConversationCommandQueueBackgroundRunnerForTest();
  vi.unstubAllGlobals();
});

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AuthProvider>
            <ThemeProvider>{children}</ThemeProvider>
          </AuthProvider>
        </MemoryRouter>
      </I18nextProvider>
    </SWRConfig>
  );
}
function Home() {
  const auth = useAuth();
  const [error, setError] = useState('');
  const [state, setState] = useState<DraftState>({
    ...empty(),
    content: '虚构首页输入',
    workspace: '/fixture/retry',
    scope: { items: [], views: [], origin: 'turn' },
    choices: {
      assistant_id: fixture.scene ? 'mycowork-scene-ppt' : 'generic-fixture',
      backend: 'aionrs',
      model_provider_id: 'provider-fixture',
      model_id: 'model-fixture',
    },
  });
  const persistent = usePersistentDraft({ ownerKey: auth.user?.id, inputLocation: 'guid', state, onRestore: setState });
  const send = useGuidSend({
    persistentDraft: { ...persistent, ownerKey: auth.user?.id, isCurrent: () => auth.status === 'authenticated' },
    input: state.content,
    setInput: (content) => setState({ ...state, content: String(content) }),
    files: state.files,
    setFiles: vi.fn(),
    dir: '',
    setDir: vi.fn(),
    loading: false,
    setLoading: vi.fn(),
    selectedAssistantId: fixture.scene ? 'mycowork-scene-ppt' : 'generic-fixture',
    selectedAssistantBackend: 'aionrs',
    selectedMode: 'default',
    selectedAcpModel: null,
    current_model: { id: 'provider-fixture', use_model: 'model-fixture' } as never,
    guidDisabledBuiltinSkills: [],
    guidEnabledSkills: [],
    availableMcpServers: [],
    selectedMcpServerIds: [],
    isGoogleAuth: false,
    setMentionOpen: vi.fn(),
    setMentionQuery: vi.fn(),
    setMentionSelectorOpen: vi.fn(),
    setMentionActiveIndex: vi.fn(),
    navigate,
    t: ((key: string) => key) as never,
    localeKey: 'zh-CN',
  });
  return (
    <>
      <div role='alert'>{error}</div>
      <textarea
        aria-label='首页输入'
        value={state.content}
        onChange={(event) => setState({ ...state, content: event.target.value })}
      />
      <button onClick={() => setState({ ...state, files: [{ kind: 'local', path: '/fixture/new-attachment.txt' }] })}>
        加入虚构附件
      </button>
      <button
        disabled={auth.status !== 'authenticated' || !persistent.ready}
        onClick={() => void send.handleSend().catch((error: Error) => setError(error.message))}
      >
        首页发送
      </button>
    </>
  );
}
async function mountHome() {
  render(
    <Providers>
      <Home />
    </Providers>
  );
  await waitFor(() => expect(screen.getByText('首页发送')).not.toBeDisabled());
}
const send = () => fireEvent.click(screen.getByText('首页发送'));
const saved = () => fixture.docs.get('guid')!;
const submission = (index: number) => JSON.parse(String(tasks()[index].init?.body)).submission_id;

it('明确拒绝保留全部输入并换UUID，只有再次明确点击才创建新提交', async () => {
  fixture.rejectTask = true;
  await mountHome();
  fireEvent.click(screen.getByText('加入虚构附件'));
  send();
  await waitFor(() => expect(count('/bridge/v1/tasks')).toBe(1));
  const rejected = submission(0);
  await waitFor(() => expect(saved().submission_id).not.toBe(rejected));
  expect(saved().state.content).toBe('虚构首页输入');
  expect(saved().state.workspace).toBe('/fixture/retry');
  expect(saved().state.scope).toEqual({ items: [], views: [], origin: 'turn' });
  expect(saved().state.files).toEqual([{ kind: 'local', path: '/fixture/new-attachment.txt' }]);
  expect(screen.getByLabelText('首页输入')).toHaveValue('虚构首页输入');
  expect(navigate).not.toHaveBeenCalled();
  expect(count('/bridge/v1/tasks')).toBe(1);
  fixture.rejectTask = false;
  send();
  await waitFor(() => expect(count('/bridge/v1/tasks')).toBe(2));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(submission(1)).not.toBe(rejected);
  expect(ipcCount('conversation.create')).toBe(0);
});

it('未知受理保留原UUID，后续明确点击只查原run且不自动重投', async () => {
  unknown = true;
  await mountHome();
  send();
  await waitFor(() => expect(fixture.task?.delivery_phase).toBe('unknown'));
  await waitFor(() => expect(document.body).toHaveTextContent('受理结果尚未确认'));
  const original = submission(0);
  expect(saved().submission_id).toBe(original);
  fireEvent.change(screen.getByLabelText('首页输入'), { target: { value: '未知期间续写' } });
  send();
  await waitFor(() =>
    expect(fixture.requests.filter(({ path }) => path.startsWith('/bridge/v1/tasks/lookup?')).length).toBe(2)
  );
  expect(count('/bridge/v1/tasks')).toBe(1);
  expect(saved().submission_id).toBe(original);
  expect(screen.getByLabelText('首页输入')).toHaveValue('未知期间续写');
  expect(navigate).not.toHaveBeenCalled();
});

it('拒绝响应在途续写不被换UUID或覆盖，下次点击结算原拒绝再由新点击投递', async () => {
  fixture.rejectTask = true;
  let release!: () => void;
  delayTask = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  await mountHome();
  send();
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const original = submission(0);
  fireEvent.change(screen.getByLabelText('首页输入'), { target: { value: '拒绝响应期间的新正文' } });
  fireEvent.click(screen.getByText('加入虚构附件'));
  await waitFor(() => expect(saved().state.content).toBe('拒绝响应期间的新正文'));
  const continued = saved().state;
  delayTask = undefined;
  release();
  await waitFor(() => expect(document.body).toHaveTextContent('任务尚未受理'));
  expect(saved().submission_id).toBe(original);
  expect(saved().state).toEqual(continued);
  expect(saved().state.files).toEqual([{ kind: 'local', path: '/fixture/new-attachment.txt' }]);
  expect(screen.getByLabelText('首页输入')).toHaveValue('拒绝响应期间的新正文');
  expect(count('/bridge/v1/tasks')).toBe(1);
  send();
  await waitFor(() => expect(saved().submission_id).not.toBe(original));
  expect(saved().state).toEqual(continued);
  expect(count('/bridge/v1/tasks')).toBe(1);
  fixture.rejectTask = false;
  send();
  await waitFor(() => expect(count('/bridge/v1/tasks')).toBe(2));
  expect(submission(1)).not.toBe(original);
  await waitFor(() => expect(navigate).toHaveBeenCalled());
});
