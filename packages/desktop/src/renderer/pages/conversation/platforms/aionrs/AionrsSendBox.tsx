/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IConversationMcpStatus } from '@/common/config/storage';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import CommandQueuePanel from '@/renderer/components/chat/CommandQueuePanel';
import MobileActionSheet, {
  type MobileActionSheetEntry,
  type MobileActionSheetOption,
  useAttachEntry,
} from '@/renderer/components/chat/MobileActionSheet';
import SendBox from '@/renderer/components/chat/SendBox';
import ThoughtDisplay from '@/renderer/components/chat/ThoughtDisplay';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';
import FilePreview from '@/renderer/components/media/FilePreview';
import HorizontalFileList from '@/renderer/components/media/HorizontalFileList';
import { classifyConfigSetError, useAcpConfigOptions } from '@/renderer/hooks/agent/useAcpConfigOptions';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useAutoTitle } from '@/renderer/hooks/chat/useAutoTitle';
import { getSendBoxDraftHook, type FileOrFolderItem } from '@/renderer/hooks/chat/useSendBoxDraft';
import { createSetUploadFile, useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';
import { useSlashCommands } from '@/renderer/hooks/chat/useSlashCommands';
import { useOpenFileSelector } from '@/renderer/hooks/file/useOpenFileSelector';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import {
  useConversationCommandQueue,
  type ConversationCommandQueueItem,
} from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { getConversationRuntimeWorkspaceErrorMessage } from '@/renderer/pages/conversation/utils/conversationCreateError';
import { getChatSurfaceWidthClass } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import { ensureConversationRuntime } from '@/renderer/pages/conversation/utils/ensureConversationRuntime';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import type { TeamSendBoxRuntime } from '@/renderer/pages/team/components/teamSendRuntime';
import { allSupportedExts } from '@/renderer/services/FileService';
import { iconColors } from '@/renderer/styles/colors';
import type { SessionRef } from '@/common/adapter/ipcBridge';
import CrossSessionDisabledBanner from '@/renderer/components/chat/CrossSessionDisabledBanner';
import { useCrossSessionMessageEnabled } from '@/renderer/hooks/chat/useCrossSessionMessageEnabled';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { type ChatFileRef } from '@/common/types/chatFile';
import { localSelectionItems, mergeFileSelectionItems } from '@/renderer/utils/file/fileSelection';
import { collectChatFileRefs, splitChatFileRefs } from '@/renderer/utils/file/messageFiles';
import type { AgentModeOption } from '@/renderer/utils/model/agentTypes';
import { Button, Message, Tag } from '@arco-design/web-react';
import { acceptOfficeTask, SavedResults, TaskCompletion } from '@mycowork/ui';
import { Brain, Lightning, MagicHat, Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { classifyConversationBusyError } from '../conversationBusyError';
import { useAionrsMessage } from './useAionrsMessage';
import type { AionrsModelSelection } from './useAionrsModelSelection';
import { captureOfficeDraftState, DraftStatus, hydrateOfficeTaskRuntime, isOfficeConversation, officeTaskRuntime, sendOfficeDraft, stopOfficeTurn, useConversationPersistentDraft, officeTaskOwner, watchTurnEnd, watchTurnEnded } from '@/renderer/mycowork-slots';
import type { DraftDocument, DraftState, TaskRun } from '@mycowork/contracts';
import { withoutYolo } from '@/renderer/mycowork-approval-guard';
import { useSendFailure } from '@/renderer/mycowork-send-failure';

const configErrorMessageKey = (error: unknown) => {
  const errorKind = classifyConfigSetError(error);
  if (errorKind === 'command_ack') return 'agent.config.commandAck';
  if (errorKind === 'confirmation_timeout') return 'agent.config.timeout';
  if (errorKind === 'config_update_in_progress') return 'agent.config.busy';
  return 'agent.config.failed';
};

const toModeLabel = (value: string): string =>
  value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const modeOptionsFromCapabilities = (modes: string[]): AgentModeOption[] =>
  modes.map((value) => ({ value, label: toModeLabel(value) }));

const useAionrsSendBoxDraft = getSendBoxDraftHook('aionrs', {
  _type: 'aionrs',
  atPath: [],
  content: '',
  uploadFile: [],
});

const EMPTY_AT_PATH: Array<string | FileOrFolderItem> = [];
const EMPTY_UPLOAD_FILES: string[] = [];

const useSendBoxDraft = (conversation_id: string) => {
  const { data, mutate } = useAionrsSendBoxDraft(conversation_id);

  const atPath = data?.atPath ?? EMPTY_AT_PATH;
  const uploadFile = data?.uploadFile ?? EMPTY_UPLOAD_FILES;
  const content = data?.content ?? '';

  const setAtPath = useCallback(
    (nextAtPath: Array<string | FileOrFolderItem>) => {
      mutate((prev) => ({ ...prev, atPath: nextAtPath }));
    },
    [data, mutate]
  );

  const setUploadFile = createSetUploadFile(mutate, data);

  const setContent = useCallback(
    (nextContent: string) => {
      mutate((prev) => ({ ...prev, content: nextContent }));
    },
    [data, mutate]
  );

  return {
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
    content,
    setContent,
  };
};

const AionrsSendBox: React.FC<{
  conversation_id: string;
  modelSelection: AionrsModelSelection;
  session_mode?: string;
  agent_name?: string;
  teamSendMessage?: (payload: { input: string; files: ChatFileRef[] }) => Promise<void>;
  teamRuntime?: TeamSendBoxRuntime;
}> = ({ conversation_id, modelSelection, session_mode, agent_name, teamSendMessage, teamRuntime }) => {
  const [dynamicModes, setDynamicModes] = useState<AgentModeOption[]>([]);
  const [currentMode, setCurrentMode] = useState<string | undefined>(session_mode);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const layout = useLayoutContext();
  const isMobile = Boolean(layout?.isMobile);
  const conversationContext = useConversationContextSafe();
  const loadedSkills = conversationContext?.loadedSkills ?? [];
  const loadedMcpStatuses =
    conversationContext?.loadedMcpStatuses ??
    (conversationContext?.loadedMcpServers ?? []).map<IConversationMcpStatus>((name) => ({
      id: name,
      name,
      status: 'loaded',
    }));
  const { t, i18n } = useTranslation();
  const { checkAndUpdateTitle } = useAutoTitle();
  const { current_model } = modelSelection;
  const teamPermission = useTeamPermission();
  const propagateMode = teamPermission?.propagateMode;

  const { thought, running, turnStartedAtMs, setActiveMsgId, setWaitingResponse, resetState } = useAionrsMessage(
    conversation_id,
    {
      onConfigChanged: (capabilities) => {
        const modes = (capabilities as { modes?: string[] })?.modes;
        if (modes && modes.length > 0) {
          setDynamicModes(modeOptionsFromCapabilities(modes));
        }
      },
    }
  );
  const runtimeView = useConversationRuntimeView(conversation_id);
  const { markSendStarted, markSendAccepted, markSendFailed } = runtimeView;

  const { atPath, uploadFile, setAtPath, setUploadFile, content, setContent } = useSendBoxDraft(conversation_id);

  const [selectedSessions, setSelectedSessions] = useState<SessionRef[]>([]);
  const sendFailure = useSendFailure(i18n?.language); // [mycowork] S40：未受理原因常驻
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  const [draftContext, setDraftContext] = useState<Pick<DraftState, 'workspace' | 'scope' | 'choices'>>({});
  const onRestoreDraft = useCallback((state: DraftState) => {
    const restored = splitChatFileRefs(state.files);
    setContent(state.content);
    setUploadFile(restored.uploadFiles);
    setAtPath(restored.atPath);
    setSessionNames(Object.fromEntries(state.sessions.map(({ id, name }) => [id, name])));
    setSelectedSessions(state.sessions.map(({ id }) => ({ id })));
    setDraftContext({ workspace: state.workspace, scope: state.scope, choices: state.choices });
  }, [setAtPath, setContent, setUploadFile]);
  const handleContentChange = useCallback(
    (val: string) => {
      setContent(val);
    },
    [setContent]
  );

  const [agentWarmed, setAgentWarmed] = useState(false);
  const prepareRuntimeConfig = useCallback(async () => {
    if (teamPermission) return;
  }, [teamPermission]);
  const prepareRuntimeSync = useCallback(async () => {
    if (teamPermission) {
      await teamPermission.warmupSession();
      return;
    }
    await ensureConversationRuntime(conversation_id);
  }, [conversation_id, teamPermission]);
  const runtimeConfig = useAcpConfigOptions({
    conversation_id,
    prepareRuntime: prepareRuntimeConfig,
    prepareSetRuntime: teamPermission?.warmupSession,
    configOptionsPort: teamPermission?.configOptionsPort,
    enabled: Boolean(conversation_id),
  });
  const runtimeMode = runtimeConfig.mode;
  const runtimeThoughtLevel = runtimeConfig.thoughtLevel;
  const draftState = useMemo<DraftState>(() => {
    const input: DraftState = {
    content, files: collectChatFileRefs(uploadFile, atPath),
    sessions: selectedSessions.map(({ id }) => ({ id, name: sessionNames[id] ?? '' })), ...draftContext,
    };
    // 旧首条交接受理前保留原版本；自动补配置会使已保存的目标指针失效。
    if (sessionStorage.getItem(`aionrs_initial_message_${conversation_id}`)) return input;
    return captureOfficeDraftState(input, {
    workspace: conversationContext?.workspace, assistantId: conversationContext?.assistantId,
    model: current_model, permission: runtimeMode?.currentValue ?? currentMode,
    thoughtLevel: runtimeThoughtLevel?.currentValue,
    });
  }, [conversation_id, atPath, content, draftContext, selectedSessions, sessionNames, uploadFile,
    conversationContext?.workspace, conversationContext?.assistantId, current_model?.id, current_model?.use_model,
    runtimeMode?.currentValue, currentMode, runtimeThoughtLevel?.currentValue]);
  const persistentDraft = useConversationPersistentDraft(conversation_id, draftState, onRestoreDraft, !teamRuntime && !teamSendMessage && !teamPermission);
  const draftStateRef = useLatestRef(draftState);
  const sendingDraftRef = useRef(false);

  useEffect(() => {
    if (!runtimeMode?.currentValue) return;
    setCurrentMode(runtimeMode.currentValue);
  }, [runtimeMode?.currentValue]);

  useEffect(() => {
    if (!conversation_id) return;
    setAgentWarmed(false);
    void prepareRuntimeSync()
      .then(() => {
        setAgentWarmed(true);
      })
      .catch((error) => {
        Message.error(getConversationRuntimeWorkspaceErrorMessage(error, t));
      });
  }, [conversation_id, prepareRuntimeSync, t]);

  const slash_commands = useSlashCommands(conversation_id, {
    conversation_type: 'aionrs',
    agentStatus: agentWarmed ? 'active' : null,
    prepareRuntime: teamPermission ? prepareRuntimeSync : undefined,
  });

  const { setSendBoxHandler } = usePreviewContext();
  const commandQueueRuntimeGate = teamRuntime?.runtimeGate ?? {
    hydrated: runtimeView.hydrated,
    canSendMessage: runtimeView.canSendMessage,
    isProcessing: runtimeView.isProcessing,
  };
  const isCancelling = runtimeView.state === 'cancelling';
  const isBusy = isCancelling || commandQueueRuntimeGate.isProcessing || !commandQueueRuntimeGate.canSendMessage;

  const setContentRef = useLatestRef(setContent);
  const contentRef = useLatestRef(content);
  const atPathRef = useLatestRef(atPath);

  // Register handler for adding text from preview panel to sendbox
  useEffect(() => {
    const handler = (text: string) => {
      const new_content = content ? `${content}\n${text}` : text;
      setContentRef.current(new_content);
    };
    setSendBoxHandler(handler);
  }, [setSendBoxHandler, content]);

  // Listen for sendbox.fill event to append text to sendbox
  useAddEventListener(
    'sendbox.fill',
    (text: string) => {
      const prev = contentRef.current;
      setContentRef.current(prev ? `${prev}${text}` : text);
    },
    []
  );

  // Shared file handling logic
  const { handleFilesAdded, clearFiles } = useSendBoxFiles({
    atPath,
    uploadFile,
    setAtPath,
    setUploadFile,
  });

  const executeCommand = useCallback(
    async ({ input, files, sessions }: Pick<ConversationCommandQueueItem, 'input' | 'files' | 'sessions'>, submitted?: DraftDocument, expectedState?: DraftState) => {
      if (teamPermission) await teamPermission.warmupSession();
      if (!current_model?.use_model) {
        Message.warning(t('conversation.chat.noModelSelected'));
        throw new Error('No model selected');
      }

      // The message body is plain user text; the backend resolves each
      // ChatFileRef to an absolute path and injects the [[AION_FILES]] marker at
      // the send edge — the front-end no longer builds paths nor the marker.
      try {
        void checkAndUpdateTitle(conversation_id, input);
        if (teamSendMessage) {
          await teamSendMessage({ input, files });
          emitter.emit('chat.history.refresh');
          if (files.length > 0) {
            emitter.emit('aionrs.workspace.refresh');
          }
          return;
        }

        if (persistentDraft.enabled) {
          if (!submitted && await isOfficeConversation(conversation_id, conversationContext?.assistantId))
            throw new Error('办公任务的队列发送尚未接通；已保留队列项，请编辑取回后明确发送。');
          if (submitted) {
            const office = await sendOfficeDraft(persistentDraft, submitted, { expectedState: expectedState!, conversationId: conversation_id, assistantId: conversationContext?.assistantId, lang: i18n?.language, deliveryContent: input });
            if (office) {
              const runtime = officeTaskRuntime(office);
              if (runtime?.turn_id === office.turn_id) {
                markSendStarted(); setWaitingResponse(runtime.is_processing); setActiveMsgId(office.msg_id);
                markSendAccepted(office.turn_id, runtime, office.msg_id);
              } else hydrateOfficeTaskRuntime(conversation_id, office);
              emitter.emit('chat.history.refresh');
              if (files.length > 0) emitter.emit('aionrs.workspace.refresh');
              setOfficeRun(office); setTurnEnded(false);
              return office;
            }
          }
        }

        markSendStarted();
        setWaitingResponse(true);
        const res = await ipcBridge.conversation.sendMessage.invoke({
          input,
          conversation_id,
          files,
          // `@@` references. Omitting this makes the whole feature silently
          // no-op for this platform.
          sessions,
        });
        setActiveMsgId(res.msg_id);
        markSendAccepted(res.turn_id, res.runtime, res.msg_id);
        emitter.emit('chat.history.refresh');
        if (files.length > 0) {
          emitter.emit('aionrs.workspace.refresh');
        }
      } catch (error) {
        const errorMessage =
          getConversationRuntimeWorkspaceErrorMessage(error, t) ||
          (error instanceof Error ? error.message : String(error));
        const busyError = classifyConversationBusyError(error);
        if (busyError) {
          markSendFailed({
            kind: 'busy_conflict',
            reason: errorMessage,
            busyKind: busyError.kind,
            status: busyError.status,
            code: busyError.code,
          });
          throw error;
        }

        markSendFailed({ kind: 'ordinary', reason: errorMessage });
        if (persistentDraft.enabled) sendFailure.fail(errorMessage);
        Message.error(errorMessage);
        throw error;
      }
    },
    [
      checkAndUpdateTitle,
      conversation_id,
      current_model?.use_model,
      markSendAccepted,
      markSendFailed,
      markSendStarted,
      setActiveMsgId,
      setWaitingResponse,
      t,
      teamPermission,
      teamSendMessage,
      persistentDraft,
      conversationContext?.assistantId,
      i18n?.language,
    ]
  );

  const {
    items: queuedCommands,
    mode: queueMode,
    isInteractionLocked: isQueueInteractionLocked,
    enqueue,
    remove,
    prioritize,
    sendNow,
    clear,
    reorder,
    toggleMode,
    lockInteraction,
    unlockInteraction,
    resetActiveExecution,
  } = useConversationCommandQueue({
    conversation_id: conversation_id,
    enabled: true,
    isBusy,
    runtimeGate: commandQueueRuntimeGate,
    onExecute: (item) => executeCommand(item).then(() => {}),
  });

  // [mycowork] ADR-0025：目标草稿已持久化，受理前保留交接和源草稿；失败不自动重发。
  useEffect(() => {
    if (!persistentDraft.enabled || !current_model?.use_model || !persistentDraft.ready || isBusy || sendingDraftRef.current ||
      !sessionStorage.getItem(`aionrs_initial_message_${conversation_id}`) || sessionStorage.getItem(`aionrs_initial_processed_${conversation_id}`)) return;
    sendingDraftRef.current = true;
    void persistentDraft.initial((state, saved) => executeCommand({ input: state.content, files: state.files, sessions: state.sessions.map(({ id }) => ({ id })) }, saved, state))
      .catch((error: unknown) => { sendFailure.fail(error); Message.error(error instanceof Error ? error.message : '首条消息未确认受理，草稿已保留，请检查后重试。'); })
      .finally(() => { sendingDraftRef.current = false; });
  }, [conversation_id, current_model?.use_model, executeCommand, isBusy, persistentDraft]);

  const { enabled: crossSessionEnabled } = useCrossSessionMessageEnabled();

  // aionrs backends never support mid-turn delivery: while the agent is
  // replying, sending is hard-blocked with a toast instead of implicitly
  // enqueuing. The only way to queue a message while busy is the explicit
  // "add to queue" entry (handleAddToQueue below).
  const onSendHandler = async (message: string): Promise<void | false> => {
    if (isBusy) {
      Message.warning(
        t('conversation.commandQueue.midturnBlocked', {
          defaultValue:
            'This agent is still working, so the message can’t be sent directly. Save it to Draft box and send it later.',
        })
      );
      return false;
    }

    if (!persistentDraft.ready || (persistentDraft.enabled && sendingDraftRef.current)) {
      Message.warning('草稿尚未就绪或正在发送，请先处理草稿状态。');
      return false;
    }
    const sent = draftState;
    const filesToSend = collectChatFileRefs(uploadFile, atPath);
    const sessions = selectedSessions.length > 0 ? selectedSessions : undefined;
    if (!persistentDraft.enabled) {
      clearFiles(); setSelectedSessions([]); emitter.emit('aionrs.selected.file.clear');
      await executeCommand({ input: message, files: filesToSend, sessions });
      return;
    }
    sendingDraftRef.current = true;
    try {
      const submitted = await persistentDraft.flush();
      if (!persistentDraft.isCurrent()) return false;
      sendFailure.clear();
      const receipt = await executeCommand({ input: message, files: filesToSend, sessions }, submitted, sent);
      if (receipt) await persistentDraft.settleTaskSubmission(submitted, receipt.draft_revision, { ...sent, content: '', files: [], sessions: [] });
      else await persistentDraft.accept(sent, { ...sent, content: '', files: [], sessions: [] });
      await persistentDraft.finishInitial(sent, Boolean(receipt));
    } finally { sendingDraftRef.current = false; }
  };

  const [interrupting, setInterrupting] = useState(false);
  const handleInterruptSend = async () => {
    if (!teamRuntime?.onInterruptSend || !content.trim() || interrupting) return;
    const files = collectChatFileRefs(uploadFile, atPath);
    const input = content;
    setContent('');
    clearFiles();
    emitter.emit('aionrs.selected.file.clear');
    setInterrupting(true);
    try {
      await teamRuntime.onInterruptSend({ input, files });
    } finally {
      setInterrupting(false);
    }
  };

  // Explicit "add to queue" entry — visibility is keyed only to the user's
  // own input (non-empty draft), never to the agent's busy/replying state:
  // tying it to that racy, async signal made the entry appear/disappear
  // unpredictably. Clicking while idle is semantically fine — the queue's own
  // mode governs (auto drains immediately, manual holds). Clears the draft
  // the same way a send would.
  const canQueueCurrentDraft = content.trim().length > 0;
  const handleAddToQueue = useCallback(async () => {
    const captured = draftState;
    if (persistentDraft.enabled) {
      try {
        if (await isOfficeConversation(conversation_id, conversationContext?.assistantId)) {
          Message.warning('办公任务的队列发送尚未接通；输入已保留，请在空闲时明确发送。');
          return;
        }
      } catch { Message.warning('无法确认会话资料范围，输入已保留，请稍后重试。'); return; }
    }
    const filesToSend = collectChatFileRefs(uploadFile, atPath);
    // `@@` references must ride along, and must be released from the send box
    // the same way the draft text is — otherwise they leak into whatever the
    // user sends next.
    enqueue({
      input: content,
      files: filesToSend,
      sessions: selectedSessions.length > 0 ? selectedSessions : undefined,
    });
    if (draftStateRef.current === captured) {
      setContent(''); clearFiles(); setSelectedSessions([]); emitter.emit('aionrs.selected.file.clear');
    }
  }, [atPath, clearFiles, content, enqueue, selectedSessions, setContent, uploadFile, conversation_id, conversationContext?.assistantId, draftState, draftStateRef, persistentDraft.enabled]);

  const handleEditQueuedCommand = useCallback(
    (item: ConversationCommandQueueItem) => {
      remove(item.id);
      setContent(item.input);
      // Restore the two selection lanes: upload refs → uploadFile paths,
      // project refs → atPath items carrying their chatRef (so a re-send
      // collects the same project ref).
      const { uploadFiles, atPath: restoredAtPath } = splitChatFileRefs(item.files);
      setUploadFile(uploadFiles);
      setAtPath(restoredAtPath);
      emitter.emit('aionrs.selected.file.clear');
    },
    [remove, setAtPath, setContent, setUploadFile]
  );

  const appendSelectedFiles = useCallback(
    (files: string[]) => {
      // "Add files" picks a file from the backend machine's own filesystem
      // (native dialog / server-fs browse) — an absolute backend path. Send it
      // as a `local` ref (via the atPath lane, external-owned), NOT an `upload`
      // ref: the raw path is not under the managed upload dir and would be
      // rejected. Merge into this box's atPath only (no cross-column emit).
      const merged = mergeFileSelectionItems(atPathRef.current, localSelectionItems(files));
      if (merged !== atPathRef.current) setAtPath(merged as Array<string | FileOrFolderItem>);
    },
    [setAtPath]
  );
  const { openFileSelector, onSlashBuiltinCommand } = useOpenFileSelector({
    onFilesSelected: appendSelectedFiles,
  });

  const { entries: attachEntries, hiddenFileInput: attachHiddenInput } = useAttachEntry({
    openFileSelector,
    onLocalFilesAdded: handleFilesAdded,
    dividerBefore: true,
  });

  const handleSheetModeChange = useCallback(
    async (mode: string) => {
      if (!runtimeMode || mode === runtimeMode.currentValue) return;
      try {
        await runtimeConfig.setConfigOption(runtimeMode.id, mode);
        setCurrentMode(mode);
        propagateMode?.(mode);
        Message.success(t('agentMode.switchSuccess'));
      } catch (error) {
        console.error('[AionrsSendBox] Failed to switch mode via sheet:', error);
        Message.error(t(configErrorMessageKey(error)));
      }
    },
    [propagateMode, runtimeConfig, runtimeMode, t]
  );

  const handleSheetModelSelect = useCallback(
    (value: string) => {
      if (runtimeConfig.isConfigOptionBlocked?.('model')) return;
      // value format: `${providerId}::${modelName}`
      const [providerId, modelName] = value.split('::');
      const provider = modelSelection.providers.find((p) => p.id === providerId);
      if (!provider || !modelName) return;
      void modelSelection.handleSelectModel(provider, modelName);
    },
    [modelSelection, runtimeConfig]
  );

  const sheetEntries = useMemo<MobileActionSheetEntry[]>(() => {
    if (!isMobile) return [];

    // [mycowork] D115：窄屏权限菜单同样去掉 YOLO
    const availableModes: AgentModeOption[] = withoutYolo(
      conversationContext?.loadedMcpServers,
      runtimeMode?.options.map((item) => ({
        value: item.value,
        label: item.label,
        description: item.description ?? undefined,
      })) ??
        (dynamicModes.length > 0
          ? dynamicModes
          : [
              { value: 'default', label: 'Default' },
              { value: 'auto_edit', label: 'Auto-Accept Edits' },
              { value: 'yolo', label: 'YOLO' },
            ])
    );
    const modeOptions: MobileActionSheetOption[] = availableModes.map((mode) => ({
      key: mode.value,
      label: t(`agentMode.${mode.value}`, { defaultValue: mode.label }),
      description: mode.description,
      active: (runtimeMode?.currentValue ?? currentMode) === mode.value,
    }));

    const modelOptions: MobileActionSheetOption[] = modelSelection.providers.flatMap((provider) =>
      modelSelection.getAvailableModels(provider).map((modelName) => ({
        key: `${provider.id}::${modelName}`,
        label: modelName,
        description: provider.name,
        active:
          modelSelection.current_model?.id === provider.id && modelSelection.current_model?.use_model === modelName,
      }))
    );

    const currentModeLabel =
      modeOptions.find((opt) => opt.active)?.label ?? t('agentMode.default', { defaultValue: 'Default' });
    const currentModelLabel = modelSelection.current_model?.use_model || t('conversation.welcome.selectModel');

    const entries: MobileActionSheetEntry[] = [
      {
        key: 'model',
        icon: <Brain theme='outline' size='16' />,
        label: t('common.model', { defaultValue: 'Model' }),
        meta: currentModelLabel,
        submenu: {
          title: t('common.model', { defaultValue: 'Model' }),
          options: modelOptions,
          onSelect: handleSheetModelSelect,
          emptyText: t('conversation.welcome.selectModel'),
        },
      },
      {
        key: 'permission',
        icon: <Shield theme='outline' size='16' />,
        label: t('agentMode.permission', { defaultValue: 'Permission' }),
        meta: currentModeLabel,
        submenu: {
          title: t('agentMode.permission', { defaultValue: 'Permission' }),
          options: modeOptions,
          onSelect: (key) => void handleSheetModeChange(key),
        },
      },
      ...attachEntries,
    ];

    if (runtimeThoughtLevel) {
      entries.splice(1, 0, {
        key: 'thought-level',
        icon: <Brain theme='outline' size='16' />,
        label: t('agent.thoughtLevel.label'),
        meta:
          runtimeThoughtLevel.options.find((item) => item.value === runtimeThoughtLevel.currentValue)?.label ||
          runtimeThoughtLevel.currentValue ||
          '',
        submenu: {
          title: t('agent.thoughtLevel.label'),
          options: runtimeThoughtLevel.options.map((item) => ({
            key: item.value,
            label: item.label,
            description: item.description ?? undefined,
            active: runtimeThoughtLevel.currentValue === item.value,
          })),
          onSelect: (value) => {
            void runtimeConfig
              .setConfigOption(runtimeThoughtLevel.id, value)
              .then(() => Message.success(t('agent.thoughtLevel.switchSuccess')))
              .catch((error) => Message.error(t(configErrorMessageKey(error))));
          },
        },
      });
    }

    if (loadedSkills.length > 0) {
      const skillOptions: MobileActionSheetOption[] = loadedSkills.map((name) => ({
        key: name,
        label: `/${name}`,
      }));
      entries.push({
        key: 'skills',
        icon: <MagicHat theme='outline' size='16' />,
        label: t('common.selectedSkills', { defaultValue: 'Selected skills' }),
        variant: 'muted',
        submenu: {
          title: t('common.selectedSkills', { defaultValue: 'Selected skills' }),
          selectable: false,
          options: skillOptions,
          onSelect: (name) => {
            setContent(`/${name} `);
          },
        },
      });
    }

    if (loadedMcpStatuses.length > 0) {
      const mcpOptions: MobileActionSheetOption[] = loadedMcpStatuses.map((item) => ({
        key: item.id,
        label: item.name,
        description:
          item.status === 'loaded'
            ? undefined
            : item.reason
              ? `${t(`conversation.mcp.status.${item.status}` as const)} · ${item.reason}`
              : t(`conversation.mcp.status.${item.status}` as const),
      }));
      entries.push({
        key: 'mcp',
        icon: <Shield theme='outline' size='16' />,
        label: t('conversation.mcp.selected', { defaultValue: 'Selected MCP' }),
        variant: 'muted',
        submenu: {
          title: t('conversation.mcp.selected', { defaultValue: 'Selected MCP' }),
          selectable: false,
          options: mcpOptions,
          onSelect: () => undefined,
        },
      });
    }

    return entries;
  }, [
    attachEntries,
    conversationContext?.loadedMcpServers,
    currentMode,
    dynamicModes,
    handleSheetModeChange,
    handleSheetModelSelect,
    isMobile,
    loadedMcpStatuses,
    loadedSkills,
    modelSelection,
    runtimeConfig,
    runtimeMode,
    runtimeThoughtLevel,
    setContent,
    t,
  ]);

  // Accept file-selection events only when targeted at this conversation (or
  // untargeted); stops same-type peers on the team route from receiving each
  // other's selections. See emitter EventTypes comment.
  useAddEventListener(
    'aionrs.selected.file',
    (items: Array<string | FileOrFolderItem>, targetConversationId: string | undefined) => {
      if (targetConversationId === undefined || targetConversationId === conversation_id) setAtPath(items);
    },
    [conversation_id, setAtPath]
  );
  useAddEventListener(
    'aionrs.selected.file.append',
    (selectedItems: Array<string | FileOrFolderItem>, targetConversationId: string | undefined) => {
      if (targetConversationId !== undefined && targetConversationId !== conversation_id) return;
      const merged = mergeFileSelectionItems(atPathRef.current, selectedItems);
      if (merged !== atPathRef.current) {
        setAtPath(merged as Array<string | FileOrFolderItem>);
      }
    },
    [conversation_id, setAtPath]
  );

  // R068：本会话最近一次办公任务；本轮结束由页面看到的turn.completed转给Bridge，确认可选
  const [officeRun, setOfficeRun] = useState<TaskRun | null>(null);
  const [turnEnded, setTurnEnded] = useState(false);
  useEffect(() => {
    if (!officeRun || !persistentDraft.enabled || officeRun.status !== 'running' || officeRun.turn_end) return;
    try {
      return watchTurnEnd(officeTaskOwner(persistentDraft), officeRun, setOfficeRun);
    } catch {
      return undefined;
    }
  }, [officeRun?.run_id, officeRun?.turn_id, officeRun?.status, officeRun?.turn_end, persistentDraft.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!officeRun || !persistentDraft.enabled || officeRun.status !== 'running') return;
    try {
      return watchTurnEnded(officeTaskOwner(persistentDraft), officeRun, (latest) => { if (latest) setOfficeRun((prev) => (prev?.run_id === latest.run_id && prev.status !== 'running' ? prev : latest)); setTurnEnded(true); }); // a late re-read never downgrades a terminal run
    } catch {
      return undefined;
    }
  }, [officeRun?.run_id, officeRun?.turn_id, officeRun?.status, persistentDraft.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop conversation handler
  const handleStop = async (): Promise<void> => {
    // Best-effort cancel: swallow rejections so they don't bubble up as
    // unhandled rejections. UI state is still reset via finally.
    const turnId = runtimeView.activeTurnId;
    if (!turnId) {
      resetState();
      resetActiveExecution('stop');
      return;
    }
    runtimeView.markStopRequested(turnId);
    if (persistentDraft.enabled) {
      try {
        const stopped = await stopOfficeTurn(persistentDraft, conversation_id, turnId);
        if (stopped) {
          const runtime = officeTaskRuntime(stopped);
          if (runtime) runtimeView.markStopAcknowledged(turnId, runtime);
          if (stopped.saved_results?.length) Message.info({ content: <SavedResults run={stopped} lang={i18n?.language} />, duration: 0, closable: true }); // A513：已登记的结果（推定），无则不出；不自动消失，用户关
          if (!stopped.stop_confirmed) { Message.warning('此步骤未确认完成，请检查任务状态；不会停止后来的轮次。'); return; }
          resetState(); resetActiveExecution('stop'); return;
        }
      } catch { Message.warning('停止请求尚未确认，此步骤未确认完成，请检查任务状态。'); return; }
    }
    try {
      const result = await ipcBridge.conversation.stop.invoke({ conversation_id, turn_id: turnId });
      runtimeView.markStopAcknowledged(turnId, result.runtime);
    } catch (error) {
      console.warn('[AionrsSendBox] stop request failed', error);
      runtimeView.resetLocalGate('stop_failed');
    } finally {
      resetState();
      resetActiveExecution('stop');
    }
  };
  const effectiveHandleStop = teamRuntime?.onStop ?? handleStop;
  const handleSendNowQueued = useCallback(
    async (item: ConversationCommandQueueItem) => {
      // Stop the current reply (best-effort), then promote the chosen command
      // to the front of the queue in auto mode.  The drain effect will fire it
      // once the execution gate shows canExecute — avoiding the 409 race that
      // occurs when sendNow() calls onExecute() directly before the backend
      // has finished processing the stop.
      await effectiveHandleStop();
      prioritize(item.id);
    },
    [effectiveHandleStop, prioritize]
  );
  const sendBoxWidthClass = getChatSurfaceWidthClass();

  return (
    <div className={`${sendBoxWidthClass} flex flex-col mt-auto mb-16px`}>
      {persistentDraft.enabled && <DraftStatus draft={persistentDraft} lang={i18n?.language} />}
      {sendFailure.notice}
      {persistentDraft.enabled && officeRun && (
        <TaskCompletion
          key={officeRun.run_id}
          run={officeRun}
          turnEnded={turnEnded}
          lang={i18n?.language}
          onAccept={async (runId) => setOfficeRun(await acceptOfficeTask(officeTaskOwner(persistentDraft), runId))}
        />
      )}
      <div inert={persistentDraft.status === 'loading'}>
      <CommandQueuePanel
        items={queuedCommands}
        mode={queueMode}
        isMobile={isMobile}
        interactionLocked={isQueueInteractionLocked}
        onInteractionLock={lockInteraction}
        onInteractionUnlock={unlockInteraction}
        onEdit={handleEditQueuedCommand}
        onSendNow={handleSendNowQueued}
        onToggleMode={toggleMode}
        onReorder={reorder}
        onRemove={remove}
        onClear={clear}
      />
      <ThoughtDisplay
        thought={thought}
        running={teamRuntime?.loading ?? running}
        statusText={teamRuntime?.statusText}
        externalElapsedSource={Boolean(teamRuntime) || turnStartedAtMs != null}
        startedAtMs={teamRuntime ? (teamRuntime.startedAtMs ?? null) : turnStartedAtMs}
        onStop={effectiveHandleStop}
        onRetryStart={teamRuntime?.onRetryStart ? () => void teamRuntime.onRetryStart?.() : undefined}
      />
      <CrossSessionDisabledBanner />
      <SendBox
        data-testid='aionrs-sendbox'
        onMobilePlusClick={isMobile ? () => setIsMobileSheetOpen(true) : undefined}
        preserveInputOnSend={persistentDraft.enabled}
        value={content}
        onChange={handleContentChange}
        selectedWorkspaceItems={atPath}
        onSelectedWorkspaceItemsChange={(items) => {
          emitter.emit('aionrs.selected.file', items, conversation_id);
          setAtPath(items);
        }}
        selectedSessions={selectedSessions}
        sessionNames={persistentDraft.enabled ? sessionNames : undefined}
        onSessionNamesChange={persistentDraft.enabled ? setSessionNames : undefined}
        onSelectedSessionsChange={setSelectedSessions}
        crossSessionEnabled={crossSessionEnabled}
        isTeamConversation={Boolean(teamRuntime)}
        loading={teamRuntime?.loading ?? isBusy}
        active={teamRuntime?.isActive}
        onFocused={teamRuntime?.onFocus}
        disabled={!current_model?.use_model}
        sendDisabled={isBusy || !persistentDraft.ready}
        sendDisabledTooltip={
          isBusy
            ? t('conversation.commandQueue.midturnBlockedSendHint', {
                defaultValue:
                  'The current agent is still working and cannot receive another message yet. Add it to Draft box instead.',
              })
            : undefined
        }
        placeholder={
          current_model?.use_model
            ? t('acp.sendbox.placeholder', {
                backend: agent_name || 'AionCLI',
                defaultValue: `Send message to {{backend}}...`,
              })
            : t('conversation.chat.noModelSelected')
        }
        onStop={effectiveHandleStop}
        className='z-10'
        onFilesAdded={handleFilesAdded}
        hasPendingAttachments={uploadFile.length > 0 || atPath.length > 0}
        supportedExts={allSupportedExts}
        defaultMultiLine={!isMobile}
        lockMultiLine={!isMobile}
        tools={
          <FileAttachButton
            openFileSelector={openFileSelector}
            onLocalFilesAdded={handleFilesAdded}
            loadedMcpStatuses={loadedMcpStatuses}
          />
        }
        rightTools={
          <div className='flex items-center gap-8px min-w-0'>
            <AgentModeSelector
              backend='aionrs'
              conversation_id={conversation_id}
              compact
              initialMode={session_mode}
              dynamicModes={dynamicModes}
              compactLeadingIcon={<Shield theme='outline' size='14' fill={iconColors.secondary} />}
              modeLabelFormatter={(mode) => t(`agentMode.${mode.value}`, { defaultValue: mode.label })}
              compactLabelPrefix={t('agentMode.permission')}
              hideCompactLabelPrefixOnMobile
              onModeChanged={propagateMode}
              beforeRuntimeSync={prepareRuntimeConfig}
              beforeRuntimeSet={teamPermission?.warmupSession}
              configOptionsPort={teamPermission?.configOptionsPort}
            />
          </div>
        }
        prefix={
          <>
            {uploadFile.length > 0 && (
              <HorizontalFileList>
                {uploadFile.map((path) => (
                  <FilePreview
                    key={path}
                    data-testid={`aionrs-file-tag-${uploadFile.indexOf(path)}`}
                    path={path}
                    onRemove={() => setUploadFile(uploadFile.filter((v) => v !== path))}
                  />
                ))}
              </HorizontalFileList>
            )}
            {atPath.some((item) => (typeof item === 'string' ? false : !item.isFile)) && (
              <div className='flex flex-wrap items-center gap-8px mb-8px'>
                {atPath.map((item) => {
                  if (typeof item === 'string') return null;
                  if (!item.isFile) {
                    const folderIndex = atPath.filter((v) => typeof v !== 'string' && !v.isFile).indexOf(item);
                    return (
                      <Tag
                        key={item.path}
                        data-testid={`aionrs-folder-tag-${folderIndex}`}
                        color='blue'
                        closable
                        onClose={() => {
                          const newAtPath = atPath.filter((v) => (typeof v === 'string' ? true : v.path !== item.path));
                          emitter.emit('aionrs.selected.file', newAtPath, conversation_id);
                          setAtPath(newAtPath);
                        }}
                      >
                        {item.name}
                      </Tag>
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </>
        }
        onSend={onSendHandler}
        slash_commands={slash_commands}
        onSlashBuiltinCommand={onSlashBuiltinCommand}
        onAddToDraft={handleAddToQueue}
        addToDraftDisabled={!canQueueCurrentDraft || !persistentDraft.ready}
        addToDraftTooltip={
          isBusy
            ? t('conversation.commandQueue.addToQueueBusyHint', {
                defaultValue: 'Save to Draft box and send it later.',
              })
            : t('conversation.commandQueue.addToQueue', { defaultValue: 'Save to Draft box' })
        }
        allowSendWhileLoading
        sendButtonPrefix={
          teamRuntime?.onInterruptSend && content.trim() ? (
            <Button
              size='mini'
              type='secondary'
              icon={<Lightning />}
              loading={interrupting}
              onClick={() => void handleInterruptSend()}
            >
              {t('team.interruptAndSend')}
            </Button>
          ) : undefined
        }
      />
      </div>
      {isMobile && (
        <>
          <MobileActionSheet
            open={isMobileSheetOpen}
            onClose={() => setIsMobileSheetOpen(false)}
            title={t('common.more', { defaultValue: 'More' })}
            entries={sheetEntries}
          />
          {attachHiddenInput}
        </>
      )}
    </div>
  );
};

export default AionrsSendBox;
