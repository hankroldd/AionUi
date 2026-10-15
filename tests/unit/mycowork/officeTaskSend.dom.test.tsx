/**
 * 文件：tests/unit/mycowork/officeTaskSend.dom.test.tsx
 * 职责：通过真实原生首页hook和对话发送框验证任务接线、输入保留与停止。
 * 边界：仅替换HTTP/IPC边界，不替换任务客户端、持久控制器、发送框或运行时hook。
 * 关联：ADR-0025第二片；PR03 plan §10 B。
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
import { count, fixture, fixtureFetch, idle, ipcCount, resetFixture } from './officeTaskSend.fixture';
import { resetAccountScopedState, restoreScope, usePersistentDraft } from '@mycowork/ui';
import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { ThemeProvider } from '@/renderer/hooks/context/ThemeContext';
import { PreviewProvider } from '@/renderer/pages/conversation/Preview';
import { useGuidSend } from '@/renderer/pages/guid/hooks/useGuidSend';
import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import { resetConversationRuntimeViewStoreForTest } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import { resetConversationCommandQueueBackgroundRunnerForTest } from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { captureOfficeDraftState } from '@/renderer/mycowork-task-send';

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
beforeEach(() => {
  restoreScope({ items: [], views: [], origin: 'turn' });
  resetAccountScopedState();
  resetConversationRuntimeViewStoreForTest();
  resetConversationCommandQueueBackgroundRunnerForTest();
  sessionStorage.clear();
  localStorage.clear();
  resetFixture();
  navigate.mockClear();
  vi.stubGlobal('fetch', fixtureFetch);
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
  const [state, setState] = useState<DraftState>({
    ...empty(),
    content: '虚构首页输入',
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
        onClick={() => void send.handleSend().catch(() => {})}
      >
        首页发送
      </button>
    </>
  );
}
const model = {
  current_model: { id: 'provider-fixture', use_model: 'model-fixture' },
  providers: [],
  getAvailableModels: (): string[] => [],
  formatModelLabel: () => '',
  handleSelectModel: async () => {},
} as never;
function Conversation({ team }: { team?: (payload: unknown) => Promise<void> }) {
  return (
    <ConversationProvider
      value={{
        conversation_id: fixture.conversation,
        type: 'aionrs',
        workspace: '/fixture/native',
        assistantId: fixture.scene ? 'mycowork-scene-ppt' : 'generic-fixture',
      }}
    >
      <PreviewProvider>
        <AionrsSendBox conversation_id={fixture.conversation} modelSelection={model} teamSendMessage={team} />
      </PreviewProvider>
    </ConversationProvider>
  );
}
async function mountConversation(team?: (payload: unknown) => Promise<void>) {
  render(
    <Providers>
      <Conversation team={team} />
    </Providers>
  );
  const input = await screen.findByTestId('sendbox-input');
  await waitFor(() => expect(input).not.toHaveAttribute('inert'));
  await waitFor(() => expect(ipcCount('conversation.get')).toBeGreaterThan(0));
  return input;
}
const sendCurrent = () => fireEvent.click(screen.getByRole('button', { name: /^Send now/ }));

it('后续快照记录当前可见配置，未就绪和未提供的能力ID不被清空或猜填', () => {
  const prior: DraftState = {
    ...empty(),
    workspace: '/fixture/old',
    choices: {
      model_provider_id: 'old-provider',
      model_id: 'old-model',
      permission: 'old-mode',
      thought_level: 'old-thought',
      mcp_ids: [],
    },
  };
  const current = captureOfficeDraftState(prior, {
    workspace: '/fixture/current',
    assistantId: 'current-assistant',
    model: { id: 'current-provider', use_model: 'current-model' },
    permission: 'default',
    thoughtLevel: 'high',
  });
  expect(current.workspace).toBe('/fixture/current');
  expect(current.choices).toEqual({
    backend: 'aionrs',
    assistant_id: 'current-assistant',
    model_provider_id: 'current-provider',
    model_id: 'current-model',
    permission: 'default',
    thought_level: 'high',
    mcp_ids: [],
  });
  expect(current.choices).not.toHaveProperty('skill_ids');
  expect(captureOfficeDraftState(prior, {}).choices).toEqual({ ...prior.choices, backend: 'aionrs' });
  expect(captureOfficeDraftState(prior, {}).workspace).toBe('/fixture/old');
});

it('首页办公由任务接口受理后导航，没有native create或initial交接', async () => {
  render(
    <Providers>
      <Home />
    </Providers>
  );
  await waitFor(() => expect(screen.getByText('首页发送')).not.toBeDisabled());
  fireEvent.click(screen.getByText('首页发送'));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/conversation/${fixture.conversation}`));
  expect(count('/bridge/v1/tasks')).toBe(1);
  expect(ipcCount('conversation.create')).toBe(0);
  expect(Object.keys(sessionStorage).filter((key) => key.startsWith('aionrs_initial_message_'))).toEqual([]);
  expect(fixture.docs.get('guid')?.state.content).toBe('');
});
it('普通首页仍创建会话并保留原首条交接', async () => {
  fixture.scene = false;
  render(
    <Providers>
      <Home />
    </Providers>
  );
  await waitFor(() => expect(screen.getByText('首页发送')).not.toBeDisabled());
  fireEvent.click(screen.getByText('首页发送'));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(ipcCount('conversation.create')).toBe(1);
  expect(count('/bridge/v1/tasks')).toBe(0);
  expect(sessionStorage.getItem(`aionrs_initial_message_${fixture.conversation}`)).not.toBeNull();
});
it('慢PUT期间续写中止原发送，原任务不混入新正文或附件', async () => {
  let release!: () => void;
  fixture.delayPut = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  render(
    <Providers>
      <Home />
    </Providers>
  );
  await waitFor(() => expect(screen.getByText('首页发送')).not.toBeDisabled());
  fireEvent.click(screen.getByText('首页发送'));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  fireEvent.change(screen.getByLabelText('首页输入'), { target: { value: '等待期间的新输入' } });
  fireEvent.click(screen.getByText('加入虚构附件'));
  fixture.delayPut = undefined;
  release();
  await waitFor(() => expect(fixture.docs.get('guid')?.state.content).toBe('等待期间的新输入'));
  expect(fixture.docs.get('guid')?.state.files).toEqual([{ kind: 'local', path: '/fixture/new-attachment.txt' }]);
  expect(count('/bridge/v1/tasks')).toBe(0);
  expect(ipcCount('conversation.create')).toBe(0);
  expect(screen.getByLabelText('首页输入')).toHaveValue('等待期间的新输入');
});
it('后续办公发送真实任务ACK进入原runtime UI，受理后清输入而不native再发', async () => {
  const input = await mountConversation();
  fireEvent.change(input, { target: { value: '虚构后续办公输入' } });
  sendCurrent();
  await waitFor(() => expect(count('/bridge/v1/tasks')).toBe(1));
  await waitFor(() => expect(fixture.docs.get(`conversation:${fixture.conversation}`)?.state.content).toBe(''));
  expect(fixture.docs.get(`conversation:${fixture.conversation}`)?.state).toMatchObject({
    workspace: '/fixture/native',
    choices: {
      assistant_id: 'mycowork-scene-ppt',
      backend: 'aionrs',
      model_provider_id: 'provider-fixture',
      model_id: 'model-fixture',
    },
  });
  expect(ipcCount('conversation.sendMessage')).toBe(0);
  expect(fixture.task?.turn_id).toBe('host-task-turn');
});
it('办公拒绝保留输入，办公加入队列也保留输入且没有投递', async () => {
  const input = await mountConversation();
  fireEvent.change(input, { target: { value: '保留的虚构办公输入' } });
  fireEvent.click(screen.getByRole('button', { name: /Save to Draft box/ }));
  await waitFor(() => expect(document.body).toHaveTextContent('队列发送尚未接通'));
  expect(input).toHaveValue('保留的虚构办公输入');
  expect(count('/bridge/v1/tasks')).toBe(0);
  fixture.rejectTask = true;
  sendCurrent();
  await waitFor(() => expect(count('/bridge/v1/tasks')).toBe(1));
  await waitFor(() => expect(document.body).toHaveTextContent('任务尚未受理'));
  expect(input).toHaveValue('保留的虚构办公输入');
  expect(ipcCount('conversation.sendMessage')).toBe(0);
});
it('普通对话与Team继续原native或Team发送，不进入任务接口', async () => {
  fixture.scene = false;
  let input = await mountConversation();
  fireEvent.change(input, { target: { value: '普通输入' } });
  sendCurrent();
  await waitFor(() => expect(ipcCount('conversation.sendMessage')).toBe(1));
  expect(count('/bridge/v1/tasks')).toBe(0);
  cleanup();
  resetConversationRuntimeViewStoreForTest();
  fixture.conversation = `team-native-${fixture.conversation}`;
  fixture.runtime = idle();
  const team = vi.fn(async () => {});
  input = await mountConversation(team);
  fireEvent.change(input, { target: { value: 'Team输入' } });
  sendCurrent();
  await waitFor(() => expect(team).toHaveBeenCalled());
  expect(count('/bridge/v1/tasks')).toBe(0);
});
it('刷新后停止按活动turn查任务，不确认的200不冒充已停止', async () => {
  const input = await mountConversation();
  fireEvent.change(input, { target: { value: '需要停止的虚构输入' } });
  sendCurrent();
  await waitFor(() => expect(fixture.task?.turn_id).toBe('host-task-turn'));
  await waitFor(() => expect(fixture.docs.get(`conversation:${fixture.conversation}`)?.state.content).toBe(''));
  cleanup();
  resetConversationRuntimeViewStoreForTest();
  sessionStorage.clear();
  await mountConversation();
  const stop = await waitFor(() => {
    const button = document.querySelector('.sendbox-stop-button');
    expect(button).not.toBeNull();
    return button!;
  });
  fireEvent.click(stop);
  await waitFor(() => expect(count('/bridge/v1/tasks/run-native/stop')).toBe(1));
  expect(
    fixture.requests.some(
      ({ path }) => path.includes(`conversation_id=${fixture.conversation}`) && path.includes('turn_id=host-task-turn')
    )
  ).toBe(true);
  expect(ipcCount('conversation.stop')).toBe(0);
  await waitFor(() => expect(document.body).toHaveTextContent('此步骤未确认完成'));
});
