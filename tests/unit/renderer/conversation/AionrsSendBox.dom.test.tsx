import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import type { AionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import type { TeamSendBoxRuntime } from '@/renderer/pages/team/components/teamSendRuntime';
import type { IMessagePermission, TMessage } from '@/common/chat/chatLib';
import { transformMessage } from '@/common/chat/chatLib';
import {
  MessageListProvider,
  useMessageList,
  useUpdateMessageList,
} from '@/renderer/pages/conversation/Messages/hooks';
import { removePermissionMessage } from '@/renderer/pages/conversation/Messages/usePendingConfirmationsRecovery';
import type { TaskRun } from '@mycowork/contracts';

const {
  ensureConversationRuntimeMock,
  sendMessageInvokeMock,
  translateMock,
  useTeamPermissionMock,
  setSendBoxHandlerMock,
  markSendFailedMock,
  markSendStartedMock,
  markSendAcceptedMock,
  sendBoxPropsSpy,
  enqueueMock,
  clearFilesMock,
  draftMutateMock,
  draftContentRef,
  runtimeViewIsProcessingRef,
  aionrsActivity,
  runtimeSnapshot,
  stopInvokeMock,
  recoveredRun,
} = vi.hoisted(() => ({
  ensureConversationRuntimeMock: vi.fn().mockResolvedValue({ recovered: false, config_options: [], runtime: null }),
  sendMessageInvokeMock: vi.fn().mockResolvedValue(undefined),
  translateMock: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  useTeamPermissionMock: vi.fn(),
  setSendBoxHandlerMock: vi.fn(),
  markSendFailedMock: vi.fn(),
  markSendStartedMock: vi.fn(),
  markSendAcceptedMock: vi.fn(),
  sendBoxPropsSpy: vi.fn(),
  enqueueMock: vi.fn(),
  clearFilesMock: vi.fn(),
  draftMutateMock: vi.fn(),
  draftContentRef: { current: '' },
  runtimeViewIsProcessingRef: { current: false },
  aionrsActivity: { running: false, thought: { subject: '', description: '' } },
  runtimeSnapshot: {
    state: 'idle',
    activeTurnId: null as string | null,
    hasBackendRuntime: false,
    localSubmitting: false,
    localStopping: false,
    pendingConfirmations: 0,
  },
  stopInvokeMock: vi.fn(),
  recoveredRun: { current: undefined as ((run: TaskRun, ended: boolean) => void) | undefined },
}));

vi.mock('@/renderer/mycowork-task-recovery', () => ({
  useOfficeTaskRecovery: ({ onRecovered }: { onRecovered: (run: TaskRun, ended: boolean) => void }) => {
    recoveredRun.current = onRecovered;
    return { invalidate: vi.fn() };
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      sendMessage: {
        invoke: sendMessageInvokeMock,
      },
      stop: {
        invoke: stopInvokeMock,
      },
    },
  },
}));

vi.mock('@/renderer/components/chat/SendBox', () => ({
  default: ({
    onSend,
    onChange,
    active,
    onFocused,
    disabled,
    sendDisabled,
    rightTools,
    sendButtonPrefix,
    topRightOverlay,
    onAddToDraft,
    addToDraftDisabled,
    selectedSessions,
    onSelectedSessionsChange,
    crossSessionEnabled,
    isTeamConversation,
    onStop,
  }: {
    onSend: (message: string) => Promise<void>;
    onChange?: (value: string) => void;
    active?: boolean;
    onFocused?: () => void;
    disabled?: boolean;
    sendDisabled?: boolean;
    rightTools?: React.ReactNode;
    sendButtonPrefix?: React.ReactNode;
    topRightOverlay?: React.ReactNode;
    onAddToDraft?: () => void;
    addToDraftDisabled?: boolean;
    selectedSessions?: Array<{ id: string }>;
    onSelectedSessionsChange?: (sessions: Array<{ id: string }>) => void;
    crossSessionEnabled?: boolean;
    isTeamConversation?: boolean;
    onStop?: () => Promise<void>;
  }) => {
    sendBoxPropsSpy({
      active,
      onFocused,
      disabled,
      sendDisabled,
      onAddToDraft,
      addToDraftDisabled,
      selectedSessions,
      onSelectedSessionsChange,
      crossSessionEnabled,
      isTeamConversation,
      onStop,
    });
    return (
      <div>
        {rightTools}
        {sendButtonPrefix}
        {topRightOverlay}
        <button type='button' onClick={() => onChange?.('hello')}>
          change
        </button>
        <button
          type='button'
          onClick={() => {
            // Models the Enter-key submit path: in the real component Enter
            // reaches `onSend` regardless of the button's visual `sendDisabled`
            // state — the parent decides whether to block+toast.
            void onSend('Hello').catch(() => {});
          }}
        >
          send
        </button>
      </div>
    );
  },
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/MobileActionSheet', () => ({
  default: () => null,
  useAttachEntry: () => ({ entries: [], hiddenFileInput: null }),
}));
vi.mock('@/renderer/components/media/FileAttachButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FilePreview', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/HorizontalFileList', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  classifyConfigSetError: () => 'unknown',
  useAcpConfigOptions: () => ({
    setStatus: { state: 'idle' },
    mode: null,
    model: null,
    thoughtLevel: null,
    reload: vi.fn(),
    setConfigOption: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    loadedSkills: [],
    loadedMcpStatuses: [],
  }),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({
  useAutoTitle: () => ({
    checkAndUpdateTitle: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxDraft', () => ({
  getSendBoxDraftHook: () => () => ({
    data: {
      atPath: [],
      uploadFile: [],
      content: draftContentRef.current,
    },
    mutate: draftMutateMock,
  }),
}));
vi.mock('@/renderer/hooks/chat/useSendBoxFiles', () => ({
  useSendBoxFiles: () => ({
    handleFilesAdded: vi.fn(),
    clearFiles: clearFilesMock,
  }),
  createSetUploadFile: () => vi.fn(),
}));
vi.mock('@/renderer/hooks/chat/useSlashCommands', () => ({
  useSlashCommands: () => [],
}));
vi.mock('@/renderer/hooks/file/useOpenFileSelector', () => ({
  useOpenFileSelector: () => ({
    openFileSelector: vi.fn(),
    onSlashBuiltinCommand: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/ui/useLatestRef', () => ({
  useLatestRef: <T,>(value: T) => ({ current: value }),
}));
vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  useConversationCommandQueue: () => ({
    items: [],
    isPaused: false,
    isInteractionLocked: false,
    hasPendingCommands: false,
    enqueue: enqueueMock,
    remove: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    lockInteraction: vi.fn(),
    unlockInteraction: vi.fn(),
    resetActiveExecution: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => ({
    hydrated: true,
    canSendMessage: true,
    get isProcessing() {
      return runtimeViewIsProcessingRef.current;
    },
    state: runtimeSnapshot.state,
    activeTurnId: runtimeSnapshot.activeTurnId,
    view: runtimeSnapshot,
    markSendStarted: markSendStartedMock,
    markSendAccepted: markSendAcceptedMock,
    markSendFailed: markSendFailedMock,
    markStopRequested: vi.fn(),
    markStopAcknowledged: vi.fn(),
    resetLocalGate: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn().mockResolvedValue({
    extra: {
      workspace: '/tmp/workspace',
    },
  }),
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCreateError', () => ({
  getConversationRuntimeWorkspaceErrorMessage: () => 'workspace failed',
}));
vi.mock('@/renderer/pages/conversation/utils/ensureConversationRuntime', () => ({
  ensureConversationRuntime: ensureConversationRuntimeMock,
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: setSendBoxHandlerMock,
  }),
}));
vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: useTeamPermissionMock,
}));
vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: [],
}));
vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
  useAddEventListener: vi.fn(),
}));
vi.mock('@/renderer/utils/file/fileSelection', () => ({
  mergeFileSelectionItems: vi.fn((items: unknown[]) => items),
}));
vi.mock('@/renderer/utils/file/messageFiles', () => ({
  collectChatFileRefs: () => [],
  splitChatFileRefs: () => ({ uploadFiles: [], atPath: [] }),
}));
vi.mock('@arco-design/web-react', () => ({
  Message: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  Tag: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Spin: () => <span role='progressbar' />,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('@icon-park/react', () => ({
  Brain: () => null,
  MagicHat: () => null,
  Shield: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translateMock }),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage', () => ({
  useAionrsMessage: () => ({
    thought: aionrsActivity.thought,
    running: aionrsActivity.running,
    setActiveMsgId: vi.fn(),
    setWaitingResponse: vi.fn(),
    resetState: vi.fn(),
  }),
}));

const modelSelection = {
  current_model: {
    provider_id: 'openai',
    model: 'gpt-4.1',
    use_model: 'openai/gpt-4.1',
  },
} as AionrsModelSelection;

const pendingConfirmation: IMessagePermission = {
  id: 'permission-1',
  conversation_id: 'conv-1',
  type: 'permission',
  content: { id: 'call-1', call_id: 'call-1', description: 'Copy file', options: [] },
};

function renderConfirmationSendBox(
  teamRuntime?: TeamSendBoxRuntime,
  confirmations: TMessage[] = [pendingConfirmation]
) {
  let updateMessages: ReturnType<typeof useUpdateMessageList>;
  let currentMessages: TMessage[] = [];
  const CaptureUpdates: React.FC = () => {
    updateMessages = useUpdateMessageList();
    currentMessages = useMessageList();
    return null;
  };
  const view = render(
    <MessageListProvider value={confirmations}>
      <CaptureUpdates />
      <AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} teamRuntime={teamRuntime} />
    </MessageListProvider>
  );
  return {
    ...view,
    pendingCards: () => currentMessages.filter((message) => message.type === 'permission' || message.type === 'ask'),
    refresh: () => act(() => updateMessages((list) => [...list])),
    addConfirmation: (message: TMessage = pendingConfirmation) =>
      act(() => updateMessages((list) => [...list, message])),
    removeConfirmation: () => act(() => updateMessages((list) => removePermissionMessage(list, { id: 'call-1' }))),
    stop: () =>
      act(async () => {
        await sendBoxPropsSpy.mock.calls.at(-1)?.[0].onStop();
      }),
  };
}

describe('AionrsSendBox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureConversationRuntimeMock.mockResolvedValue({ recovered: false, config_options: [], runtime: null });
    useTeamPermissionMock.mockReturnValue(null);
    draftContentRef.current = '';
    runtimeViewIsProcessingRef.current = false;
    aionrsActivity.running = false;
    aionrsActivity.thought = { subject: '', description: '' };
    Object.assign(runtimeSnapshot, {
      state: 'idle',
      activeTurnId: null,
      hasBackendRuntime: false,
      localSubmitting: false,
      localStopping: false,
      pendingConfirmations: 0,
    });
    stopInvokeMock.mockReset().mockResolvedValue({
      runtime: {
        state: 'idle',
        can_send_message: true,
        has_task: true,
        is_processing: false,
        pending_confirmations: 0,
        turn_id: null,
      },
    });
  });

  it('shows a static confirmation hint instead of a running thought until the answer arrives', () => {
    aionrsActivity.running = true;
    aionrsActivity.thought = { subject: 'Copying file', description: 'Preparing a working copy' };
    const view = renderConfirmationSendBox(undefined, []);
    expect(screen.getByRole('progressbar')).toBeVisible();
    view.addConfirmation();
    expect(screen.getByText(/messages.toolActivity.waitingForConfirmation/)).toBeVisible();
    expect(screen.getByText(/messages.toolActivity.confirmationHint/)).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();

    view.removeConfirmation();
    expect(screen.getByText('Copying file')).toBeVisible();
    expect(screen.getByRole('progressbar')).toBeVisible();
  });

  it('shows a recovered confirmation card even without a running thought', () => {
    renderConfirmationSendBox();
    expect(screen.getByText(/messages.toolActivity.waitingForConfirmation/)).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('does not display a waiting hint for another conversation', () => {
    runtimeSnapshot.hasBackendRuntime = true;
    aionrsActivity.running = true;
    const view = renderConfirmationSendBox(undefined, [{ ...pendingConfirmation, conversation_id: 'conv-2' }]);
    expect(screen.queryByText(/messages.toolActivity.waitingForConfirmation/)).toBeNull();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(view.pendingCards()).toHaveLength(1);
  });

  it('preserves the existing team failure status when a confirmation card is present', () => {
    runtimeSnapshot.hasBackendRuntime = true;
    const view = renderConfirmationSendBox({ loading: false, statusText: 'Team failed' } as TeamSendBoxRuntime);
    expect(screen.getByText('Team failed')).toBeVisible();
    expect(screen.queryByText(/messages.toolActivity.waitingForConfirmation/)).toBeNull();
    expect(view.pendingCards()).toHaveLength(1);
  });

  it('removes only the confirmed stopped turn cards, including a late approval', async () => {
    Object.assign(runtimeSnapshot, { state: 'running', activeTurnId: 'turn-1', hasBackendRuntime: true });
    runtimeViewIsProcessingRef.current = true;
    const view = renderConfirmationSendBox(undefined, [
      { ...pendingConfirmation, runtime_turn_id: 'turn-1' },
      {
        id: 'ask-1',
        conversation_id: 'conv-1',
        type: 'ask',
        runtime_turn_id: 'turn-1',
        content: { session_id: 'conv-1', request_id: 'ask-1', questions: [] },
      },
    ]);
    expect(view.pendingCards()).toHaveLength(2);

    await view.stop();
    expect(view.pendingCards()).toHaveLength(0);
    expect(screen.queryByText(/messages.toolActivity.waitingForConfirmation/)).toBeNull();

    view.addConfirmation({ ...pendingConfirmation, id: 'late-card', runtime_turn_id: 'turn-1' });
    expect(view.pendingCards()).toHaveLength(0);
    view.addConfirmation({ ...pendingConfirmation, id: 'new-card', runtime_turn_id: 'turn-2' });
    expect(view.pendingCards()).toHaveLength(1);
  });

  it('only clears captured untagged cards and preserves unknown cards after stopping', async () => {
    runtimeSnapshot.activeTurnId = 'turn-1';
    let completeStop!: (result: unknown) => void;
    stopInvokeMock.mockReturnValue(
      new Promise((resolve) => {
        completeStop = resolve;
      })
    );
    const view = renderConfirmationSendBox();
    const stopping = sendBoxPropsSpy.mock.calls.at(-1)?.[0].onStop();
    view.addConfirmation({
      ...pendingConfirmation,
      id: 'unknown-card',
      content: { ...pendingConfirmation.content, call_id: 'new-call' },
    });
    await act(async () => {
      completeStop({ runtime: { turn_id: null, is_processing: false } });
      await stopping;
    });
    expect(view.pendingCards()).toHaveLength(1);
    view.addConfirmation({ ...pendingConfirmation, id: 'recovered-known-card' });
    expect(view.pendingCards()).toHaveLength(1);
  });

  it.each(['live', 'recovered'])('preserves a real %s card while this tab still has an old idle snapshot', (origin) => {
    runtimeSnapshot.hasBackendRuntime = true;
    const message = { ...pendingConfirmation, ...(origin === 'live' ? { runtime_turn_id: 'remote-turn' } : {}) };
    const view = renderConfirmationSendBox(undefined, origin === 'recovered' ? [message] : []);
    if (origin === 'live') view.addConfirmation(message);
    expect(view.pendingCards()).toHaveLength(1);
    expect(screen.getByText(/messages.toolActivity.waitingForConfirmation/)).toBeVisible();
    view.refresh();
    expect(view.pendingCards()).toHaveLength(1);
  });

  it('does not clear cards when the stop response still reports the target turn active', async () => {
    runtimeSnapshot.activeTurnId = 'turn-1';
    stopInvokeMock.mockResolvedValue({ runtime: { state: 'cancelling', is_processing: true, turn_id: 'turn-1' } });
    const view = renderConfirmationSendBox();
    await view.stop();
    expect(view.pendingCards()).toHaveLength(1);
  });

  it('clears the requested turn when its stop is confirmed later by the existing task observer', async () => {
    runtimeSnapshot.activeTurnId = 'turn-1';
    stopInvokeMock.mockResolvedValue({ runtime: { state: 'cancelling', is_processing: true, turn_id: 'turn-1' } });
    const view = renderConfirmationSendBox(undefined, [
      { ...pendingConfirmation, runtime_turn_id: 'turn-1' },
      { ...pendingConfirmation, id: 'remote-card', runtime_turn_id: 'turn-2' },
    ]);
    await view.stop();
    expect(view.pendingCards()).toHaveLength(2);

    const confirmed = {
      conversation_id: 'conv-1',
      turn_id: 'turn-2',
      status: 'cancelled',
      stop_confirmed: true,
    } as TaskRun;
    await act(() => recoveredRun.current?.(confirmed, true));
    expect(view.pendingCards()).toHaveLength(2);
    await act(() => recoveredRun.current?.({ ...confirmed, turn_id: 'turn-1' }, true));
    expect(view.pendingCards().map((message) => message.id)).toEqual(['remote-card']);
  });

  it.each(['permission', 'ask'])('keeps the live runtime turn separate from the %s fork anchor', (type) => {
    const message = transformMessage({
      type,
      conversation_id: 'conv-1',
      msg_id: 'msg-1',
      turn_id: 'live-turn',
      backend_turn_id: 'fork-turn',
      data:
        type === 'permission'
          ? pendingConfirmation.content
          : { session_id: 'conv-1', request_id: 'ask-1', questions: [] },
    });
    expect(message?.runtime_turn_id).toBe('live-turn');
    expect(message?.backend_turn_id).toBe('fork-turn');
  });

  it.each(['submitting', 'active'])('keeps the next turn approval while the new turn is %s', (phase) => {
    Object.assign(runtimeSnapshot, {
      hasBackendRuntime: true,
      activeTurnId: phase === 'active' ? 'turn-new' : null,
      localSubmitting: phase === 'submitting',
      state: phase === 'active' ? 'running' : 'starting',
    });
    runtimeViewIsProcessingRef.current = true;
    const view = renderConfirmationSendBox();
    expect(view.pendingCards()).toHaveLength(1);
    expect(screen.getByText(/messages.toolActivity.waitingForConfirmation/)).toBeVisible();
  });

  it('does not warm up team session when draft content changes', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    warmupSession.mockClear();

    await act(async () => {
      screen.getByRole('button', { name: 'change' }).click();
    });

    expect(warmupSession).not.toHaveBeenCalled();
  });

  it('still warms up team session before sending', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    warmupSession.mockClear();

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalledTimes(1);
    });
  });

  it('does not start standalone runtime while preparing a team conversation', async () => {
    const warmupSession = vi.fn().mockResolvedValue(undefined);
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conv-1',
      allConversationIds: ['conv-1'],
      propagateMode: vi.fn(),
      warmupSession,
    });

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    await waitFor(() => {
      expect(warmupSession).toHaveBeenCalled();
    });
    expect(ensureConversationRuntimeMock).not.toHaveBeenCalled();
  });

  it('uses runtime ensure instead of legacy warmup for standalone runtime preparation', async () => {
    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);

    await waitFor(() => {
      expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1');
    });
  });

  it('suppresses visible error and preserves runtime gate for active-turn busy conflicts', async () => {
    sendMessageInvokeMock.mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/conversations/conv-1/messages',
        status: 409,
        body: { success: false, code: 'CONFLICT', error: 'conversation conv-1 is already running' },
      })
    );

    render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
    await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

    await act(async () => {
      screen.getByRole('button', { name: 'send' }).click();
    });

    await waitFor(() => {
      expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1);
    });
    expect(markSendFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'busy_conflict', busyKind: 'active_turn' })
    );
    expect(Message.error).not.toHaveBeenCalled();
  });

  it('passes teamRuntime.isActive and onFocus down to SendBox as active/onFocused', () => {
    const onFocus = vi.fn();
    render(
      <AionrsSendBox
        conversation_id='conv-1'
        modelSelection={modelSelection}
        teamRuntime={{ loading: false, startedAtMs: null, isActive: true, onFocus } as unknown as TeamSendBoxRuntime}
      />
    );
    const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { active?: boolean; onFocused?: () => void };
    expect(props.active).toBe(true);
    props.onFocused?.();
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  describe('mid-turn interjection controls', () => {
    it('disables the send button and blocks Enter with a toast while replying, without implicitly enqueuing', async () => {
      runtimeViewIsProcessingRef.current = true;
      draftContentRef.current = 'hello world';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { sendDisabled?: boolean };
      expect(props.sendDisabled).toBe(true);

      await act(async () => {
        screen.getByRole('button', { name: 'send' }).click();
      });

      expect(sendMessageInvokeMock).not.toHaveBeenCalled();
      expect(enqueueMock).not.toHaveBeenCalled();
      expect(clearFilesMock).not.toHaveBeenCalled();
      expect(Message.warning).toHaveBeenCalledWith(
        'This agent is still working, so the message can’t be sent directly. Save it to Draft box and send it later.'
      );
    });

    it('sends normally while idle', async () => {
      runtimeViewIsProcessingRef.current = false;

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { sendDisabled?: boolean };
      expect(props.sendDisabled).toBe(false);

      await act(async () => {
        screen.getByRole('button', { name: 'send' }).click();
      });

      await waitFor(() => {
        expect(sendMessageInvokeMock).toHaveBeenCalledTimes(1);
      });
      expect(enqueueMock).not.toHaveBeenCalled();
      expect(Message.warning).not.toHaveBeenCalled();
    });

    it('shows the add-to-draft-box entry with a non-empty draft while replying, and clicking it enqueues without executing', async () => {
      runtimeViewIsProcessingRef.current = true;
      draftContentRef.current = 'hello world';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { onAddToDraft?: () => void };
      expect(props.onAddToDraft).toBeDefined();
      await act(async () => {
        props.onAddToDraft?.();
      });

      expect(enqueueMock).toHaveBeenCalledWith({ input: 'hello world', files: [], sessions: undefined });
      expect(sendMessageInvokeMock).not.toHaveBeenCalled();
      expect(clearFilesMock).toHaveBeenCalled();
      const updater = draftMutateMock.mock.calls.at(-1)?.[0] as (prev: { content: string }) => { content: string };
      expect(updater({ content: 'hello world' })).toEqual(expect.objectContaining({ content: '' }));
    });

    it('carries `@@` session references into the draft box and clears them from the send box', async () => {
      // The draft box is where the references are most likely to be lost:
      // enqueue rebuilds the item, and a message that reaches the agent without
      // its session block fails silently on both sides.
      runtimeViewIsProcessingRef.current = true;
      draftContentRef.current = 'hello world';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      type SessionProps = {
        onAddToDraft?: () => void;
        onSelectedSessionsChange?: (sessions: Array<{ id: string }>) => void;
        selectedSessions?: Array<{ id: string }>;
      };
      const latestProps = (): SessionProps => sendBoxPropsSpy.mock.calls.at(-1)?.[0] as SessionProps;

      await act(async () => {
        latestProps().onSelectedSessionsChange?.([{ id: 'conv_target' }]);
      });
      // Re-read: picking a session re-renders, so the previous props snapshot
      // holds a stale `onAddToDraft` closure over the empty selection.
      await act(async () => {
        latestProps().onAddToDraft?.();
      });

      expect(enqueueMock).toHaveBeenCalledWith(expect.objectContaining({ sessions: [{ id: 'conv_target' }] }));
      expect(latestProps().selectedSessions).toEqual([]);
    });

    it('shows the add-to-draft-box option while idle, as long as the draft is non-empty', async () => {
      // Visibility is keyed only to the draft, not to the agent's busy state —
      // clicking while idle is semantically fine (the queue's own mode governs).
      runtimeViewIsProcessingRef.current = false;
      draftContentRef.current = 'hello world';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as { onAddToDraft?: () => void };
      expect(props.onAddToDraft).toBeDefined();
    });

    it('disables the Draft box action with an empty draft, even while replying', async () => {
      runtimeViewIsProcessingRef.current = true;
      draftContentRef.current = '';

      render(<AionrsSendBox conversation_id='conv-1' modelSelection={modelSelection} />);
      await waitFor(() => expect(ensureConversationRuntimeMock).toHaveBeenCalledWith('conv-1'));

      const props = sendBoxPropsSpy.mock.calls.at(-1)?.[0] as {
        onAddToDraft?: () => void;
        addToDraftDisabled?: boolean;
      };
      expect(props.onAddToDraft).toBeDefined();
      expect(props.addToDraftDisabled).toBe(true);
    });
  });
});
