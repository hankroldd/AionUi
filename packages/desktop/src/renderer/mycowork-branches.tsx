/**
 * 文件：packages/desktop/src/renderer/mycowork-branches.tsx
 * 职责：把分支准备、新建空闲会话和导航适配到 AionUi 公开接口。
 * 边界：不 fork、不发送、不复制旧会话运行时或 MCP；每个异步边界复核登录身份。
 * 关联：PR10 C2/C3；ADR-0027；MyCowork packages/ui/src/branches/types.ts。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import i18n from 'i18next';
import type { BranchAdapter, BranchAnchor, PreparedBranch, ScopedSession } from '@mycowork/ui';
import { ipcBridge } from '@/common';
import type { IProvider, ISessionMcpServer, TProviderWithModel } from '@/common/config/storage';
import { isAionrsAssistant } from '@/common/types/agent/assistantTypes';
import { useOwnerKey } from '@/renderer/mycowork-resource-navigation';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { pickDefaultAssistantSelectionKey } from '@/renderer/pages/guid/hooks/useGuidAssistantSelection';
import { useGuidModelSelection } from '@/renderer/pages/guid/hooks/useGuidModelSelection';
import { resolveGuidAssistantDefaults } from '@/renderer/pages/guid/utils/assistantDefaults';
import { emitter } from '@/renderer/utils/emitter';

type CheckOwner = () => void;
type Skill = Awaited<ReturnType<typeof ipcBridge.fs.listAvailableSkills.invoke>>[number];
type Selection = {
  label: string;
  content: string;
  assistantId: string;
  model: TProviderWithModel;
  skillIds: string[];
  profileTokenSha256: string | null;
};

function fail(reason: string): never {
  throw new Error(i18n.t('conversation.createFailed'), { cause: new Error(reason) });
}

function safeModel(model: { id?: string; use_model?: string } | undefined): TProviderWithModel {
  if (!model?.id || !model.use_model) throw new Error(i18n.t('conversation.noModelConfigured'));
  return { id: model.id, use_model: model.use_model, platform: '', name: '', base_url: '', api_key: '' };
}

function apiId(id: string): string {
  if (!id || id === '.' || id === '..') fail('BRANCH_INVALID_ID');
  return encodeURIComponent(id);
}

async function owned<T>(pending: Promise<T>, check: CheckOwner): Promise<T> {
  try {
    return await pending;
  } finally {
    check();
  }
}

/** Keep the source token in this call only; the branch request receives its digest. */
async function profileTokenSha256(servers: ISessionMcpServer[] | undefined, check: CheckOwner): Promise<string | null> {
  if (servers === undefined) return null;
  if (!Array.isArray(servers)) fail('BRANCH_PROFILE_UNAVAILABLE');
  const matches = servers.filter((server) => server?.id === 'mycowork_bridge' || server?.name === 'mycowork_bridge');
  if (matches.length === 0) return null;
  const server = matches[0];
  if (
    matches.length !== 1 ||
    server.id !== 'mycowork_bridge' ||
    server.name !== 'mycowork_bridge' ||
    server.transport?.type !== 'streamable_http' ||
    typeof server.transport.url !== 'string' ||
    !server.transport.url
  )
    fail('BRANCH_PROFILE_UNAVAILABLE');
  const headers = Object.entries(server.transport.headers ?? {}).filter(
    ([key]) => key.toLowerCase() === 'authorization'
  );
  const token =
    headers.length === 1 && typeof headers[0][1] === 'string'
      ? /^Bearer ([A-Za-z0-9_-]+)$/i.exec(headers[0][1])?.[1]
      : undefined;
  if (!token) fail('BRANCH_PROFILE_UNAVAILABLE');
  try {
    const digest = await owned(crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)), check);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    check();
    fail('BRANCH_PROFILE_UNAVAILABLE');
  }
}

async function sourceSelection(anchor: BranchAnchor, check: CheckOwner): Promise<Selection> {
  const conversation = await owned(getConversationOrNull(apiId(anchor.conversation_id)), check);
  if (!conversation || conversation.type !== 'aionrs') fail('BRANCH_SOURCE_UNAVAILABLE');
  const message = await owned(
    ipcBridge.database.getConversationMessage.invoke({
      conversation_id: apiId(anchor.conversation_id),
      message_id: anchor.message_id,
    }),
    check
  );
  if (
    message.conversation_id !== anchor.conversation_id ||
    (message.id !== anchor.message_id && message.msg_id !== anchor.message_id) ||
    message.type !== 'text' ||
    typeof message.content.content !== 'string'
  )
    fail('BRANCH_MESSAGE_UNAVAILABLE');
  const assistantId = conversation.assistant?.id ?? conversation.extra.preset_assistant_id;
  if (!assistantId) fail('BRANCH_ASSISTANT_UNAVAILABLE');
  const detail = await owned(ipcBridge.assistants.get.invoke({ id: assistantId, locale: i18n.language }), check);
  if (!detail.state.enabled || !isAionrsAssistant(detail.engine)) fail('BRANCH_ASSISTANT_UNAVAILABLE');
  return {
    label: conversation.name,
    content: message.content.content,
    assistantId,
    model: safeModel(conversation.model),
    skillIds: [...new Set(conversation.extra.skills ?? [])],
    profileTokenSha256: await profileTokenSha256(conversation.extra.session_mcp_servers, check),
  };
}

async function defaultSelection(modelList: IProvider[], catalog: Skill[], check: CheckOwner): Promise<Selection> {
  const assistants = await owned(ipcBridge.assistants.list.invoke(), check);
  const assistantId = pickDefaultAssistantSelectionKey(assistants.filter(isAionrsAssistant));
  if (!assistantId) fail('BRANCH_ASSISTANT_UNAVAILABLE');
  const detail = await owned(ipcBridge.assistants.get.invoke({ id: assistantId, locale: i18n.language }), check);
  if (!detail.state.enabled || !isAionrsAssistant(detail.engine)) fail('BRANCH_ASSISTANT_UNAVAILABLE');
  const defaults = resolveGuidAssistantDefaults(detail);
  const provider = defaults.modelId ? modelList.find((item) => item.models.includes(defaults.modelId!)) : modelList[0];
  const model = safeModel(provider && { id: provider.id, use_model: defaults.modelId ?? provider.models[0] });
  const automatic = catalog
    .filter((skill) => skill.source === 'builtin' && skill.is_auto_inject)
    .map((skill) => skill.name)
    .filter((id) => !defaults.disabledBuiltinSkillIds.includes(id));
  return {
    label: detail.profile.name,
    content: i18n.language.startsWith('zh')
      ? '基于本分支工作目录中的所选文件版本继续处理。本会话不继承原会话的资料范围；不要自动执行。'
      : "Continue from the selected file version in this branch's working directory. This conversation does not inherit the original conversation's source scope. Do not execute automatically.",
    assistantId,
    model,
    skillIds: [...new Set([...defaults.skillIds, ...automatic])],
    profileTokenSha256: null,
  };
}

async function readSkills(ids: string[], catalog: Skill[], check: CheckOwner): Promise<PreparedBranch['skills']> {
  return Promise.all(
    ids.map(async (skill_id) => {
      const matches = catalog.filter((skill) => skill.name === skill_id);
      let content: string | undefined;
      if (matches.length === 1) {
        try {
          content = await owned(
            ipcBridge.fs.readSkillFile.invoke({
              skill_location: matches[0]!.location,
              relative_path: 'SKILL.md',
            }),
            check
          );
        } catch {
          check(); // 读取失败可只记名称；身份变化不能作为读取失败降级。
        }
      }
      return { skill_id, ...(content !== undefined ? { content } : {}) };
    })
  );
}

async function createConversation(
  id: string,
  session: ScopedSession,
  selection: Selection,
  catalog: Skill[],
  check: CheckOwner
): Promise<string> {
  check();
  const excluded = catalog.filter((skill) => skill.source === 'builtin' && !selection.skillIds.includes(skill.name));
  const created = await owned(
    ipcBridge.conversation.create.invoke({
      id,
      name: selection.label,
      model: selection.model,
      assistant: {
        id: selection.assistantId,
        locale: i18n.language,
        conversation_overrides: {
          model: selection.model.use_model,
          permission: 'default',
          skill_ids: selection.skillIds,
          disabled_builtin_skill_ids: excluded.map((skill) => skill.name),
          mcp_ids: [],
        },
      },
      extra: {
        ...(session.system_prompt !== undefined ? { system_prompt: session.system_prompt } : {}),
        workspace: session.workspace,
        custom_workspace: true,
        selected_mcp_server_ids: [],
        selected_session_mcp_servers: [session.session_mcp_server],
        preset_enabled_skills: selection.skillIds,
        exclude_auto_inject_skills: excluded.map((skill) => skill.name),
      },
    }),
    check
  );
  if (!created || typeof created.id !== 'string' || !created.id.trim()) fail('BRANCH_CREATE_ACK_INVALID');
  return created.id;
}

/** 只准备所选消息或版本的新会话；登录变化或公开接口失败时拒绝后续副作用。 */
export function useBranchAdapter(): BranchAdapter {
  const ownerKey = useOwnerKey();
  const navigate = useNavigate();
  const { modelList } = useGuidModelSelection('aionrs');
  const owner = useRef({ ownerKey });
  if (owner.current.ownerKey !== ownerKey) owner.current = { ownerKey };
  useEffect(() => {
    if (owner.current.ownerKey !== ownerKey) owner.current = { ownerKey };
    return () => {
      owner.current = { ownerKey: undefined };
    };
  }, [ownerKey]);
  return useMemo<BranchAdapter>(() => {
    const capture = (): CheckOwner => {
      const captured = owner.current;
      const check = () => {
        if (!captured.ownerKey || captured.ownerKey !== ownerKey || owner.current !== captured)
          fail('BRANCH_IDENTITY_CHANGED');
      };
      check();
      return check;
    };
    return {
      async prepare(anchor) {
        const check = capture();
        const catalog = await owned(ipcBridge.fs.listAvailableSkills.invoke(), check);
        const selection = anchor
          ? await sourceSelection(anchor, check)
          : await defaultSelection(modelList, catalog, check);
        check();
        const skills = await readSkills(selection.skillIds, catalog, check);
        check();
        return {
          label: selection.label,
          content: selection.content,
          skills,
          profileTokenSha256: selection.profileTokenSha256,
          createConversation: (id, session) => createConversation(id, session, selection, catalog, check),
        };
      },
      async readWorkspace(conversationId, skillIds) {
        const check = capture();
        const conversation = await owned(getConversationOrNull(apiId(conversationId)), check);
        if (!conversation) return null;
        if (
          conversation.type !== 'aionrs' ||
          !conversation.extra.workspace ||
          JSON.stringify((conversation.extra.skills ?? []).toSorted()) !== JSON.stringify(skillIds.toSorted())
        )
          fail('BRANCH_WORKSPACE_SKILLS_MISMATCH');
        return conversation.extra.workspace;
      },
      openConversation(conversationId) {
        capture()();
        emitter.emit('chat.history.refresh');
        void navigate(`/conversation/${apiId(conversationId)}`);
      },
    };
  }, [modelList, navigate, ownerKey]);
}
