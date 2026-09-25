/**
 * [mycowork] ADR-0011: the single registration file for MyCowork mount points.
 * Each AionUi insertion point is a 1–2 line call into this file; components and Bridge calls
 * live in MyCowork packages/ui (resolved via the `@mycowork/ui` build alias). Ledger: MyCowork upstream/PATCHES.md.
 */
import React, { useEffect, useState } from 'react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { ipcBridge } from '@/common';
import type { ISessionMcpServer } from '@/common/config/storage';
import { ScopeChip, ScopeStrip, bindScopedConversation, prepareScopedSession } from '@mycowork/ui';

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
 */
export const ConversationScopeSlot: React.FC<{ conversation_id: string }> = ({ conversation_id }) => {
  const { i18n: current } = useTranslation();
  const [turns, setTurns] = useState(0);
  useEffect(
    () =>
      ipcBridge.conversation.responseStream.on((message) => {
        if (message.conversation_id === conversation_id && message.type === 'finish') setTurns((n) => n + 1);
      }),
    [conversation_id]
  );
  return (
    <ScopeStrip key={conversation_id} lang={current.language} conversationId={conversation_id} refreshKey={turns} />
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
