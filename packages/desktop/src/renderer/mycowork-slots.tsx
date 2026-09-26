/**
 * [mycowork] ADR-0011: the single registration file for MyCowork mount points.
 * Each AionUi insertion point is a 1–2 line call into this file; components and Bridge calls
 * live in MyCowork packages/ui (resolved via the `@mycowork/ui` build alias). Ledger: MyCowork upstream/PATCHES.md.
 */
import React, { useEffect, useState } from 'react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Brain, FolderUpload, Tag } from '@icon-park/react';
import { Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import { ipcBridge } from '@/common';
import type { ISessionMcpServer, TChatConversation } from '@/common/config/storage';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import {
  askDropChoice,
  CompositionPage,
  ImportsPage,
  MemoryPage,
  ResourcesPage,
  VersionsPage,
  OfficeEditorPage,
  ProjectScopeEntry,
  ScopeChip,
  ScopeStrip,
  bindScopedConversation,
  importText,
  memoryText,
  resourceText,
  prepareScopedSession,
} from '@mycowork/ui';

/**
 * Mount point: the "sources" scope chip above the Guid (new task) input. When the Guid page was opened from a
 * project's "ask about this project" (router state `mycoworkProjectId`), the chip starts from that project's
 * default sources (MyCowork 01 §5); without it, behaviour is unchanged.
 */
export const GuidScopeSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const state = useLocation().state as { mycoworkProjectId?: unknown } | null;
  const projectId = typeof state?.mycoworkProjectId === 'string' ? state.mycoworkProjectId : undefined;
  return <ScopeChip lang={current.language} projectId={projectId} />;
};

/**
 * Mount point: the "scope this turn" strip above the conversation body (MyCowork 01 §6.4). Refetches the
 * conversation context whenever an assistant turn of this conversation finishes (the same `finish` frame the
 * chat hooks consume); keyed by conversation so a switch never shows the previous conversation's scope.
 * A strict narrowing of the scope (MyCowork D19) opens the Guid page, where the next send starts a new
 * conversation on the narrowed plan; this conversation stays readable.
 */
export const ConversationScopeSlot: React.FC<{ conversation_id: string }> = ({ conversation_id }) => {
  const { i18n: current } = useTranslation();
  const navigate = useNavigate();
  const [turns, setTurns] = useState(0);
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
      onStrictShrink={() => void navigate('/guid')}
    />
  );
};

/**
 * Mount point: sidebar "Projects" row action (MyCowork 02 P03 "ask about this project / link knowledge bases").
 * AionUi project ids are opaque and only reach the renderer on conversations (`project_id`), so the entry is
 * shown only when a conversation of this workspace group carries one. "Ask" opens the Guid page in the project's
 * workspace (as AionUi's own "+") plus `mycoworkProjectId`; saving the project default is a separate action.
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
};

/**
 * Mount point: before conversation.create, if a scope is selected for this turn, add the Bridge-issued
 * session MCP server (plan token) and workspace to `extra` (MyCowork ADR-0012).
 * No scope → `extra` unchanged. Bridge failure → throws, so the caller aborts instead of sending without scope.
 */
export const withGuidScope = async <T extends CreateExtra>(extra: T): Promise<T> => {
  const scoped = await prepareScopedSession(i18n.language);
  if (!scoped) return extra;
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
 * Mount point: route `/office/imports` (MyCowork P07 import queue). Router state `mycoworkProjectId` (from a project
 * entry) labels the batch with that project; the home page never guesses a project (MyCowork D23, R018).
 */
export const OfficeImportsSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const state = useLocation().state as { mycoworkProjectId?: unknown } | null;
  const projectId = typeof state?.mycoworkProjectId === 'string' ? state.mycoworkProjectId : undefined;
  return <ImportsPage lang={current.language} {...(projectId ? { projectId } : {})} />;
};

/** Mount point: route `/office/resources` (MyCowork P05 resource center: tags, saved view tabs). */
export const OfficeResourcesSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  return <ResourcesPage lang={current.language} />;
};

/** Mount point: route `/office/memory` (MyCowork P11 memory: review, accept/reject/disable, pause precipitation). */
export const OfficeMemorySlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  return <MemoryPage lang={current.language} />;
};

/** Sidebar nav entry for a MyCowork page, styled like the Scheduled entry next to it. */
const OfficeNavEntry: React.FC<{
  path: string;
  label: string;
  icon: React.ReactElement;
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
}> = ({ path, label, icon, isMobile, collapsed, siderTooltipProps }) => {
  const navigate = useNavigate();
  const active = useLocation().pathname.startsWith(path);
  return (
    <Tooltip {...siderTooltipProps} content={label} position='right'>
      <div
        role='link'
        aria-label={label}
        className={classNames(
          'box-border h-34px w-full flex items-center gap-8px rd-8px cursor-pointer shrink-0 transition-colors text-t-primary',
          collapsed ? 'justify-center' : 'justify-start ps-10px pe-8px',
          isMobile && 'sider-action-btn-mobile',
          active ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
        )}
        onClick={() => void navigate(path)}
      >
        {icon}
        {!collapsed && <span className='collapsed-hidden text-14px font-[500] leading-24px'>{label}</span>}
      </div>
    </Tooltip>
  );
};

/** Mount point: sidebar nav entries to the MyCowork import queue, resource center and memory page. */
export const OfficeImportsSiderSlot: React.FC<{
  isMobile: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
}> = (props) => {
  const { i18n: current } = useTranslation();
  const size = props.collapsed ? '20' : '16';
  return (
    <>
      <OfficeNavEntry
        {...props}
        path='/office/imports'
        label={importText(current.language).title}
        icon={<FolderUpload theme='outline' size={size} fill='currentColor' className='block leading-none' />}
      />
      <OfficeNavEntry
        {...props}
        path='/office/resources'
        label={resourceText(current.language).title}
        icon={<Tag theme='outline' size={size} fill='currentColor' className='block leading-none' />}
      />
      <OfficeNavEntry
        {...props}
        path='/office/memory'
        label={memoryText(current.language).title}
        icon={<Brain theme='outline' size={size} fill='currentColor' className='block leading-none' />}
      />
    </>
  );
};

/**
 * Mount point: file drop into a chat/Guid input (useDragUpload). Asks "import as resources" (MyCowork P07 import
 * queue) or "attach to this turn" (AionUi's behaviour, also on cancel/close). Returns true when the drop was taken.
 */
export const mycoworkDropIntercept = (files: File[]): Promise<boolean> => askDropChoice(i18n.language, files);

/**
 * Mount point: route `/office/compositions/:decisionId` (MyCowork P09 page plan / template review, the `review_url`
 * returned by the runtime's `template_recommend`). A new choice creates a new decision version; the URL follows it.
 */
export const OfficeCompositionSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const navigate = useNavigate();
  const { decisionId = '' } = useParams();
  return (
    <CompositionPage
      lang={current.language}
      decisionId={decisionId}
      onVersion={(id) => void navigate(`/office/compositions/${encodeURIComponent(id)}`, { replace: true })}
    />
  );
};

/** Mount point: route `/office/resources/:resourceId/versions` (MyCowork P12 versions: timeline, compare, restore, publish). */
export const OfficeVersionsSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const { resourceId = '' } = useParams();
  return <VersionsPage lang={current.language} resourceId={resourceId} />;
};

/**
 * Mount point: route `/office/edit/:sessionId` (MyCowork P04 "preview → edit": the ONLYOFFICE editor for a Bridge edit
 * session; "finish" waits for the editing service to report the save instead of assuming it). Entry: the versions page.
 */
export const OfficeEditSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const { sessionId = '' } = useParams();
  return <OfficeEditorPage lang={current.language} sessionId={sessionId} />;
};
