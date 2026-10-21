/**
 * 文件/职责：MyCowork 挂载点的唯一注册文件：上游各插入点只调用这里，组件与 Bridge 调用都在 @mycowork/ui。
 * [mycowork] ADR-0011: the single registration file for MyCowork mount points.
 * Each AionUi insertion point is a 1–2 line call into this file; components and Bridge calls
 * live in MyCowork packages/ui (resolved via the `@mycowork/ui` build alias). Ledger: MyCowork upstream/PATCHES.md.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Message } from '@arco-design/web-react';
import { getCurrentProject, useCurrentProject } from '@/renderer/pages/conversation/explorer/currentProjectStore';
import {
  getCurrentConversation,
  useCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { classifyPreviewError, previewErrorToI18nKey } from '@/renderer/utils/previewError';
import i18n from 'i18next';
import useSWR from 'swr';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookOpen } from '@icon-park/react';
import { ipcBridge } from '@/common';
import type { IMessageToolCall } from '@/common/chat/chatLib';
import { useGuidResourceSelection, useOwnerKey, useScopeChangeProposal } from '@/renderer/mycowork-resource-navigation';
import type { ISessionMcpServer, TChatConversation } from '@/common/config/storage';
import { useBranchAdapter } from '@/renderer/mycowork-branches';
import {
  askDropChoice,
  notifyCapabilityBlocked,
  ProjectScopeEntry,
  ScopeChip,
  ScopeStrip,
  bindScopedConversation,
  isSceneAssistant,
  prepareScopedSession,
  BranchMessageButton,
  fetchConversationContext,
  ConversationFileLink,
  useConversationWorkspace,
  TemplateConfirmationProvider,
  TemplateConfirmationAction,
  TemplateConfirmationDialog,
} from '@mycowork/ui';

/** PR10消息动作注册；普通聊天保留原按钮，办公状态未读到时不绕过分支登记。 */
export const MyCoworkMessageBranchSlot: React.FC<{
  conversationId?: string;
  messageId: string;
  isLastMessage: boolean;
  hasTurnAnchor: boolean;
  assistantId?: string;
  fallback: React.ReactNode;
}> = ({ conversationId, messageId, isLastMessage, hasTurnAnchor, assistantId, fallback }) => {
  const { i18n: current } = useTranslation();
  const ownerKey = useOwnerKey();
  const adapter = useBranchAdapter();
  const scene = isSceneAssistant(assistantId);
  const { data, error } = useSWR(
    ownerKey && conversationId && !scene ? ['mycowork-branch-context', ownerKey, conversationId] : null,
    ([, , id]) => fetchConversationContext(id)
  );
  if (!conversationId) return <>{fallback}</>;
  if (!scene && data === null) return <>{fallback}</>;
  if (!ownerKey || (!scene && (!data || error))) return null;
  return (
    <BranchMessageButton
      key={`${ownerKey}:${conversationId}:${messageId}`}
      lang={current.language}
      ownerKey={ownerKey}
      adapter={adapter}
      anchor={{
        conversation_id: conversationId,
        message_id: messageId,
        is_last_message: isLastMessage,
        has_turn_anchor: hasTurnAnchor,
      }}
    />
  );
};

/**
 * Mount point: the "sources" scope chip above the Guid (new task) input. When the Guid page was opened from a
 * project's "ask about this project" (router state `mycoworkProjectId`), the chip starts from that project's
 * default sources (MyCowork 01 §5); without it, behaviour is unchanged.
 */
export const GuidScopeSlot: React.FC<{ assistantId?: string | undefined }> = ({ assistantId }) => {
  const { i18n: current } = useTranslation();
  const ownerKey = useOwnerKey();
  const state = useLocation().state as { mycoworkProjectId?: unknown } | null;
  const projectId = typeof state?.mycoworkProjectId === 'string' ? state.mycoworkProjectId : undefined;
  // 从“空间”的“用这些资料提问”进来时，范围由路由意图一次性装入（navigation-intent.md）；账号不符 = 空必选集
  const { initialScope, scopeKey } = useGuidResourceSelection(ownerKey);
  return (
    <ScopeChip
      key={`${scopeKey}:${ownerKey ?? ''}`}
      lang={current.language}
      projectId={projectId}
      initialScope={initialScope}
      assistantId={assistantId}
    />
  );
};

/**
 * Mount point: the "scope this turn" strip above the conversation body (MyCowork 01 §6.4). Refetches the
 * conversation context whenever an assistant turn of this conversation finishes (the same `finish` frame the
 * chat hooks consume); keyed by conversation so a switch never shows the previous conversation's scope.
 * A strict narrowing of the scope (MyCowork D19) opens the Guid page, where the next send starts a new
 * conversation on the narrowed plan; this conversation stays readable. A Bridge 503 while changing sources offers
 * "configure" with a validated return intent back to this conversation (MyCowork R036, D283).
 */
export const ConversationScopeSlot: React.FC<{ conversation_id: string }> = ({ conversation_id }) => {
  const { i18n: current } = useTranslation();
  const navigate = useNavigate();
  const ownerKey = useOwnerKey();
  const [turns, setTurns] = useState(0);
  const { proposed, handled } = useScopeChangeProposal(ownerKey, conversation_id);
  useEffect(
    () =>
      ipcBridge.conversation.responseStream.on((message) => {
        if (message.conversation_id === conversation_id && message.type === 'finish') setTurns((n) => n + 1);
      }),
    [conversation_id]
  );
  return (
    <ScopeStrip
      key={conversation_id}
      lang={current.language}
      conversationId={conversation_id}
      refreshKey={turns}
      proposed={proposed}
      onProposedHandled={handled}
      onStrictShrink={() => void navigate('/guid')}
      onBlocked={(error) =>
        notifyCapabilityBlocked(error, ownerKey, current.language, (path, state) => void navigate(path, { state }), {
          origin: 'conversation',
          conversationId: conversation_id,
        })
      }
    />
  );
};

/**
 * Mount point: sidebar "Projects" row action (MyCowork 02 P03 "ask about this project / link knowledge bases").
 * AionUi project ids are opaque and only reach the renderer on conversations (`project_id`), so the entry is
 * shown only when a conversation of this workspace group carries one. "Ask" opens the Guid page in the project's
 * workspace (as AionUi's own "+") plus `mycoworkProjectId`; "Import" opens /office/imports with the same id (R018);
 * saving the project default is a separate action.
 */
export const ProjectScopeSlot: React.FC<{
  group: { workspace: string; conversations: TChatConversation[] };
  isMobile: boolean;
}> = ({ group: { workspace, conversations }, isMobile }) => {
  const { i18n: current } = useTranslation();
  const navigate = useNavigate();
  const projectId = conversations.find((c) => c.project_id)?.project_id;
  if (!projectId) return null;
  return (
    <ProjectScopeEntry
      lang={current.language}
      projectId={projectId}
      onAsk={() => void navigate('/guid', { state: { workspace, mycoworkProjectId: projectId } })}
      onImport={() => void navigate('/office/imports', { state: { mycoworkProjectId: projectId } })}
      className={`flex-center cursor-pointer transition-colors text-t-secondary hover:text-t-primary size-20px rd-4px sider-action-btn ${isMobile ? 'flex' : 'hidden group-hover:flex'}`}
    >
      <BookOpen theme='outline' size='14' fill='currentColor' className='block leading-none' />
    </ProjectScopeEntry>
  );
};

type CreateExtra = {
  workspace?: string;
  custom_workspace?: boolean;
  selected_session_mcp_servers?: ISessionMcpServer[];
  default_files?: string[];
};

/**
 * Mount point: before conversation.create, if a scope is selected for this turn, add the Bridge-issued
 * session MCP server (plan token) and workspace to `extra` (MyCowork ADR-0012).
 * No scope → `extra` unchanged (scene assistants: an explicit empty plan, A197; pass the assistant id as 3rd argument). Bridge failure → throws, so the caller aborts instead of sending without scope.
 * [mycowork] D115：带范围的 Aion CLI 会话不以 YOLO 创建——aionrs 以 yolo 创建会把自动批准固定进会话配置，之后切回也不恢复；
 * 未指定时助手默认值可能是 yolo（固定值或“记住上次”），同样改成 default。调用方传入的 overrides 对象原地修改。
 */
export const withGuidScope = async <T extends CreateExtra>(
  extra: T,
  overrides?: { permission?: string },
  assistantId?: string
): Promise<T> => {
  // [mycowork] A197: the scene assistant ("Report / PPT") also gets the Bridge tools with an explicit EMPTY scope plan when
  // nothing is selected; any other assistant (or an unknown one) keeps the plain no-scope behaviour above.
  const scoped = await prepareScopedSession(
    i18n.language,
    (extra.default_files?.length ?? 0) > 0,
    isSceneAssistant(assistantId),
    true,
    assistantId // [mycowork] D263: Bridge maps a scene assistant to its allowed skills (skill_read); other ids grant nothing
  );
  if (!scoped) return extra;
  if (overrides && (!overrides.permission || overrides.permission === 'yolo')) overrides.permission = 'default';
  return {
    ...extra,
    selected_session_mcp_servers: [...(extra.selected_session_mcp_servers ?? []), scoped.session_mcp_server],
    // A user-picked workspace wins (then the Bridge read-only tool allowlist does not apply; open decision);
    // otherwise use the per-token session directory prepared by the Bridge (MyCowork D22).
    ...(extra.custom_workspace ? {} : { workspace: scoped.workspace, custom_workspace: true }),
  };
};

/**
 * Mount point: right after conversation.create succeeds, bind the new conversation to the plan frozen by
 * withGuidScope (PUT /bridge/v1/conversations/{id}/plan). Never throws: a failed bind only warns, the chat goes on.
 */
export const bindGuidScope = (conversationId: string): Promise<void> =>
  bindScopedConversation(conversationId, i18n.language);

/**
 * Mount point: file drop into a chat/Guid input (useDragUpload). Asks "import as resources" (MyCowork P07 import
 * queue) or "attach to this turn" (AionUi's behaviour, also on cancel/close). Returns true when the drop was taken.
 */
export const mycoworkDropIntercept = (files: File[]): Promise<boolean> => askDropChoice(i18n.language, files);

// [mycowork] A506：办公页挂载点拆在独立文件，这里是唯一对外出口（Router 与测试 mock 都认这个模块）。
export {
  OfficeImportsSlot,
  OfficeResourcesSlot,
  OfficeKnowledgeSlot,
  OfficeCapabilitiesSlot,
  OfficeSetupSlot,
  OfficeConnectionsSlot,
  OfficeMaintenanceSlot,
  OfficeSchedulesSlot,
  OfficeResearchSlot,
  OfficeMemorySlot,
} from './mycowork-office-pages';
export {
  OfficeCompositionSlot,
  OfficeVersionsSlot,
  OfficeEditSlot,
  OfficeTextEditSlot,
  PreviewEditSlot,
} from './mycowork-office-edit-slots';

// [mycowork] ADR-0025：原生文件只引用注册出口，持久化适配不散入平台组件。
export {
  DraftStatus,
  handoffGuidDraft,
  useGuidPersistentDraft,
  useConversationPersistentDraft,
} from './mycowork-drafts';
export type { PersistentDraft } from './mycowork-drafts';
export { notifyCapabilityBlocked } from '@mycowork/ui';
export {
  captureOfficeDraftState,
  hydrateOfficeTaskRuntime,
  isOfficeConversation,
  officeTaskRuntime,
  sendOfficeDraft,
  stopOfficeTurn,
  officeTaskOwner,
  watchTurnEnd,
  watchTurnEnded,
} from './mycowork-task-send';
export { useOfficeTaskRecovery } from './mycowork-task-recovery';

// [mycowork] Business labels/path recognition stay in the owned UI package.
export { ConversationFilesToggle, ConversationFilesEmpty, conversationFilePath } from '@mycowork/ui';

/** Display-only scope; successful workspace tools refresh the existing Explorer without waiting for turn end. */
export function useMyCoworkConversationFiles(
  projectId: string,
  conversationId: string | null,
  onFilesWritten?: () => void
) {
  const ownerKey = useOwnerKey();
  const [turns, setTurns] = useState(0);
  useEffect(() => {
    if (!ownerKey || !conversationId) return;
    return ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== conversationId) return;
      if (message.type === 'finish') setTurns((n) => n + 1);
      if (message.type !== 'tool_call') return;
      const tool = message.data as IMessageToolCall['content'];
      if (
        tool?.status === 'completed' &&
        ['office_copy_to_workspace', 'office_fetch_original', 'office_register_output', 'office_edit'].includes(
          tool.name
        )
      ) {
        onFilesWritten?.();
      }
    });
  }, [ownerKey, conversationId, onFilesWritten]);
  return useConversationWorkspace(ownerKey, projectId, conversationId, turns);
}

/** Open an explicit workspace-relative link with the exact same payload gate as the Explorer. */
export const MyCoworkWorkspaceFileLinkSlot: React.FC<{ relativePath: string; children?: React.ReactNode }> = ({
  relativePath,
  children,
}) => {
  const projectId = useCurrentProject();
  const conversationId = useCurrentConversation();
  const preview = useOptionalPreviewContext();
  const ownerKey = useOwnerKey();
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [projectId, conversationId, ownerKey]);
  const { t, i18n } = useTranslation();
  const open = async (): Promise<void> => {
    if (!projectId || !conversationId || !preview) return;
    const openedAt = generation.current;
    const current = () =>
      generation.current === openedAt &&
      getCurrentProject() === projectId &&
      getCurrentConversation() === conversationId;
    try {
      const detail = await ipcBridge.project.get.invoke({ project_id: projectId });
      if (!current() || detail.project_id !== projectId || !detail.explorer.workspace_pe_id) return;
      const { buildExplorerPreviewPayload } = await import('./pages/conversation/explorer/ExplorerContainer');
      if (!current()) return;
      const payload = await buildExplorerPreviewPayload(detail.explorer.workspace_pe_id, relativePath);
      if (current()) preview.openPreview(payload.content, payload.contentType, payload.metadata);
    } catch (error) {
      if (current()) Message.error(t(previewErrorToI18nKey(classifyPreviewError(error))));
    }
  };
  return (
    <>
      <ConversationFileLink
        disabled={!projectId || !conversationId || !preview}
        onOpen={() => void open()}
        fileName={relativePath.split('/').pop()}
        lang={i18n.language}
      >
        {children}
      </ConversationFileLink>
      <TemplateConfirmationAction
        relativePath={relativePath}
        disabled={!projectId || !conversationId || !preview}
        lang={i18n.language}
      />
    </>
  );
};

/** ADR-0031：会话内共用一次模板读取，成功模板工具及结束事件刷新，不轮询。 */
export const MyCoworkTemplateConfirmationProvider: React.FC<{
  conversationId: string;
  enabled: boolean;
  children: React.ReactNode;
}> = ({ conversationId, enabled, children }) => {
  const ownerKey = useOwnerKey();
  const projectId = useCurrentProject();
  const activeConversationId = useCurrentConversation();
  const [refreshKey, setRefreshKey] = useState(0);
  const active = enabled && !!ownerKey && !!projectId && activeConversationId === conversationId;
  useEffect(() => {
    if (!active) return;
    return ipcBridge.conversation.responseStream.on((message) => {
      if (message.conversation_id !== conversationId) return;
      if (message.type === 'finish') {
        setRefreshKey((n) => n + 1);
        return;
      }
      if (message.type !== 'tool_call') return;
      const tool = message.data as IMessageToolCall['content'];
      if (
        tool?.status === 'completed' &&
        ['template_recommend', 'template_select', 'office_copy_to_workspace'].includes(tool.name)
      )
        setRefreshKey((n) => n + 1);
    });
  }, [active, conversationId, ownerKey, projectId]);
  return (
    <TemplateConfirmationProvider
      ownerKey={active ? ownerKey : undefined}
      projectId={projectId ?? ''}
      conversationId={conversationId}
      refreshKey={refreshKey}
      readContext={fetchConversationContext}
      isCurrent={() => active && getCurrentConversation() === conversationId && getCurrentProject() === projectId}
    >
      {children}
    </TemplateConfirmationProvider>
  );
};

/** ADR-0031：只把原草稿与原 SendBox 的提交入口交给自有弹窗。 */
export const MyCoworkTemplateConfirmationDialog: React.FC<
  Omit<React.ComponentProps<typeof TemplateConfirmationDialog>, 'lang'>
> = (props) => {
  const { i18n: current } = useTranslation();
  return <TemplateConfirmationDialog {...props} lang={current.language} />;
};
