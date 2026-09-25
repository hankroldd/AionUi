/**
 * [mycowork] ADR-0011: the single registration file for MyCowork mount points.
 * Each AionUi insertion point is a 1–2 line call into this file; components and Bridge calls
 * live in MyCowork packages/ui (resolved via the `@mycowork/ui` build alias). Ledger: MyCowork upstream/PATCHES.md.
 */
import React from 'react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ISessionMcpServer } from '@/common/config/storage';
import { ScopeChip, bindScopedConversation, prepareScopedSession } from '@mycowork/ui';

/** Mount point: the "sources" scope chip above the Guid (new task) input. */
export const GuidScopeSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  return <ScopeChip lang={current.language} />;
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
