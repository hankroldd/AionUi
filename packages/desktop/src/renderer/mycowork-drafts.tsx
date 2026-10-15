/**
 * 文件：packages/desktop/src/renderer/mycowork-drafts.tsx
 * 职责：把原生输入和能力选择适配到Bridge持久草稿，首条消息交接只在受理后清源。
 * 边界：不新增发送API；只保存ID和输入意图，不保存provider对象、cookie或密钥（ADR-0025）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DraftChoices, DraftDocument, DraftState } from '@mycowork/contracts';
import {
  acceptStoredDraft,
  adoptStoredDraft,
  DraftStatus,
  readDraft,
  restoreScope,
  usePersistentDraft,
  useScope,
  writeDraft,
} from '@mycowork/ui';
import { useOwnerKey } from '@/renderer/mycowork-resource-navigation';
import type { GuidAssistantSelectionResult } from '@/renderer/pages/guid/hooks/useGuidAssistantSelection';
import type { GuidModelSelectionResult } from '@/renderer/pages/guid/hooks/useGuidModelSelection';
import type { GuidInputResult } from '@/renderer/pages/guid/hooks/useGuidInput';
import type { IMcpServer } from '@/common/config/storage';

export { DraftStatus };
export type PersistentDraft = ReturnType<typeof usePersistentDraft>;
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, sorted(item)])
        )
      : value;
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const storagePrefix = 'aionrs_initial_message_';
type DraftPointer = Pick<DraftDocument, 'input_location' | 'revision' | 'submission_id'>;
type InitialHandoff = { ownerKey: string; source: DraftPointer; target: DraftPointer };
const pointer = ({ input_location, revision, submission_id }: DraftDocument): DraftPointer => ({
  input_location,
  revision,
  submission_id,
});

function useCurrentOwner() {
  const ownerKey = useOwnerKey();
  const identity = useMemo(() => ({ ownerKey }), [ownerKey]);
  const current = useRef<typeof identity | undefined>(identity);
  current.current = identity;
  useLayoutEffect(() => {
    current.current = identity;
    return () => {
      current.current = undefined;
    };
  }, [identity]);
  useEffect(() => {
    for (const key of Object.keys(sessionStorage)) {
      if (!key.startsWith(storagePrefix)) continue;
      const stored = sessionStorage.getItem(key);
      if (ownerKey && stored) {
        try {
          if ((JSON.parse(stored) as Partial<InitialHandoff>).ownerKey === ownerKey) continue;
        } catch {
          /* 损坏的临时交接不参与发送；服务端草稿仍保留。 */
        }
      }
      sessionStorage.removeItem(key);
      sessionStorage.removeItem(key.replace(storagePrefix, 'aionrs_initial_processed_'));
    }
  }, [ownerKey]);
  return { ownerKey, isCurrent: () => Boolean(ownerKey && current.current === identity) };
}

type GuidOptions = {
  input: GuidInputResult;
  agent: GuidAssistantSelectionResult;
  model: GuidModelSelectionResult;
  skills: Array<{ name: string }>;
  servers: IMcpServer[];
  choices: DraftChoices;
  setSkills: (value: string[] | undefined) => void;
  setDisabledSkills: (value: string[] | undefined) => void;
  setMcp: (value: string[] | undefined) => void;
  navigation: Record<string, unknown> | null;
};

function choiceBlocker(options: GuidOptions, restoredChoices: DraftChoices | undefined): string | undefined {
  const { agent, model } = options;
  let blockedReason: string | undefined;
  if (restoredChoices) {
    const c = restoredChoices;
    if (c.assistant_id === null) blockedReason = '草稿尚未选择助手，请明确选择助手后发送。';
    else if (c.model_id === null) blockedReason = '草稿尚未选择模型，请明确选择模型后发送。';
    else if (c.assistant_id && !agent.assistants.some((item) => item.id === c.assistant_id && item.enabled !== false))
      blockedReason = '草稿中的助手已不可用，请重新选择助手。';
    else if (c.backend && c.backend !== 'aionrs') blockedReason = '此草稿助手尚未接通持久恢复，请选择办公助手后发送。';
    else if (
      c.model_id &&
      !model.modelList.some((item) => item.id === c.model_provider_id && item.models.includes(c.model_id!))
    )
      blockedReason = '草稿中的模型已不可用，请重新选择模型后发送。';
    else if (
      c.permission &&
      agent.currentAgentModeOptions.length &&
      !agent.currentAgentModeOptions.some((item) => item.value === c.permission)
    )
      blockedReason = '草稿中的权限模式已不可用，请重新选择。';
    else if (
      c.thought_level &&
      !agent.currentThoughtLevelOption?.options.some((item) => item.value === c.thought_level)
    )
      blockedReason = '草稿中的思考级别已不可用，请重新选择。';
    else if (
      [...(c.skill_ids ?? []), ...(c.disabled_builtin_skill_ids ?? [])].some(
        (id) => !options.skills.some((item) => item.name === id)
      )
    )
      blockedReason = '草稿中的Skill已不可用，请重新选择。';
    else if (c.mcp_ids?.some((id) => !options.servers.some((item) => item.id === id && item.enabled !== false)))
      blockedReason = '草稿中的MCP已不可用，请重新选择。';
    else if (
      (c.assistant_id && c.assistant_id !== agent.selectedAssistantId) ||
      (c.model_id && c.model_id !== model.current_model?.use_model) ||
      (c.permission && c.permission !== agent.selectedMode)
    )
      blockedReason = '正在恢复草稿选择，请稍候。';
  }
  return blockedReason;
}

/** 首页恢复保持显式路由意图优先；恢复选择在用户改选前不被助手默认值替换。 */
export function useGuidPersistentDraft(options: GuidOptions) {
  const owner = useCurrentOwner();
  const scope = useScope();
  const latest = useRef(options);
  latest.current = options;
  // 原生助手选择会replace清空路由state；初次异步恢复仍须记住明确输入意图。
  const navigation = useRef(options.navigation);
  const consumedNavigation = useRef(false);
  if (options.navigation) navigation.current = options.navigation;
  useLayoutEffect(() => {
    consumedNavigation.current = false;
  }, [owner.ownerKey]);
  const [restoredChoices, setRestoredChoices] = useState<DraftChoices>();
  const onRestore = useCallback((state: DraftState) => {
    const { input } = latest.current;
    const nav = consumedNavigation.current ? null : navigation.current;
    consumedNavigation.current = true;
    const prompt = typeof nav?.prefillPrompt === 'string' ? nav.prefillPrompt : undefined;
    input.setInput(
      prompt
        ? nav?.preservePrefillDraft
          ? `${state.content}${state.content ? '\n' : ''}${prompt}`
          : prompt
        : state.content
    );
    input.setFiles(
      prompt && !nav?.preservePrefillDraft
        ? Array.isArray(nav?.prefillFiles)
          ? nav.prefillFiles.map((path) => ({ kind: 'upload' as const, path: String(path) }))
          : []
        : state.files
    );
    input.setDir(typeof nav?.workspace === 'string' ? nav.workspace : (state.workspace ?? ''));
    if (!nav?.mycoworkScopeDraft && !nav?.mycoworkProjectId && state.scope) restoreScope(state.scope);
    setRestoredChoices(nav?.selectedAssistantId || nav?.resetAssistant ? undefined : state.choices);
  }, []);
  const state = useMemo<DraftState>(
    () => ({
      content: options.input.input,
      files: options.input.files,
      sessions: [],
      workspace: options.input.dir,
      scope: { ...scope },
      choices: Object.fromEntries(
        Object.entries({ ...options.choices, ...restoredChoices }).filter(([, value]) => value !== '')
      ),
    }),
    [options.input.input, options.input.files, options.input.dir, options.choices, restoredChoices, scope]
  );
  const draft = usePersistentDraft({ ownerKey: owner.ownerKey, inputLocation: 'guid', state, onRestore });
  useEffect(() => {
    if (draft.ready && !draft.saved) consumedNavigation.current = true;
  }, [draft.ready, draft.saved]);
  const { agent, model } = options;
  useEffect(() => {
    const choices = restoredChoices;
    if (!choices) return;
    if (
      choices.assistant_id &&
      agent.assistants.some((item) => item.id === choices.assistant_id) &&
      agent.selectedAssistantId !== choices.assistant_id
    ) {
      agent.setSelectedAssistantId(choices.assistant_id);
      return;
    }
    if (choices.assistant_id && agent.selectedAssistantId !== choices.assistant_id) return;
    const provider = model.modelList.find(
      (item) => item.id === choices.model_provider_id && item.models.includes(choices.model_id ?? '')
    );
    if (provider && (model.current_model?.id !== provider.id || model.current_model.use_model !== choices.model_id)) {
      void model.setCurrentModel({ ...provider, use_model: choices.model_id! }, { persistPreference: false });
    }
    if (choices.permission !== undefined && agent.selectedMode !== choices.permission)
      agent.setSelectedMode(choices.permission, { persistPreference: false });
    if (choices.thought_level !== undefined && agent.selectedThoughtLevelValue !== choices.thought_level)
      agent.setSelectedThoughtLevelValue(choices.thought_level, { persistPreference: false });
    if (choices.acp_model !== undefined && agent.selectedAcpModel !== choices.acp_model)
      agent.setSelectedAcpModel(choices.acp_model, { persistPreference: false });
    if (!same(options.choices.skill_ids, choices.skill_ids)) options.setSkills(choices.skill_ids);
    if (!same(options.choices.disabled_builtin_skill_ids, choices.disabled_builtin_skill_ids))
      options.setDisabledSkills(choices.disabled_builtin_skill_ids);
    if (!same(options.choices.mcp_ids, choices.mcp_ids)) options.setMcp(choices.mcp_ids);
  }, [restoredChoices, agent, model, options]);
  const blockedReason = choiceBlocker(options, restoredChoices);
  const releaseChoices = (keys?: Array<keyof DraftChoices>) =>
    setRestoredChoices((previous) => {
      if (!previous || !keys) return undefined;
      const next = { ...previous };
      keys.forEach((key) => delete next[key]);
      return next;
    });
  return {
    ...draft,
    status: owner.ownerKey ? draft.status : ('loading' as const),
    ready:
      Boolean(owner.ownerKey) &&
      draft.ready &&
      !['loading', 'conflict', 'error'].includes(draft.status) &&
      !blockedReason,
    blockedReason,
    hasRestoredChoices: restoredChoices !== undefined,
    releaseChoices,
    ...owner,
  };
}

/** 首页创建会话后先CAS写入目标草稿；任何账号/页面切换都会停止后续导航接线。 */
export async function handoffGuidDraft(
  conversationId: string,
  source: DraftDocument,
  owner: { ownerKey?: string; isCurrent: () => boolean }
): Promise<void> {
  if (!owner.ownerKey || !owner.isCurrent()) throw new Error('登录状态已变化，请回到草稿重试。');
  const inputLocation = `conversation:${conversationId}`;
  const existing = await readDraft(inputLocation);
  if (!owner.isCurrent()) throw new Error('登录状态已变化，请回到草稿重试。');
  if (existing && !same(existing.state, source.state)) throw new Error('目标会话已有草稿，请先处理草稿冲突。');
  const target =
    existing ??
    (await writeDraft(inputLocation, {
      expected_revision: 0,
      submission_id: source.submission_id,
      state: source.state,
    }));
  if (!owner.isCurrent()) throw new Error('登录状态已变化，请回到草稿重试。');
  adoptStoredDraft(owner.ownerKey, target);
  sessionStorage.setItem(
    `${storagePrefix}${conversationId}`,
    JSON.stringify({
      ownerKey: owner.ownerKey,
      source: pointer(source),
      target: pointer(target),
    } satisfies InitialHandoff)
  );
}

/** 对话使用同一持久hook，内存草稿仍由原生hook维护；Team不启用。 */
export function useConversationPersistentDraft(
  conversationId: string,
  state: DraftState,
  onRestore: (state: DraftState) => void,
  enabled: boolean
) {
  const owner = useCurrentOwner();
  const draft = usePersistentDraft({
    ownerKey: enabled ? owner.ownerKey : undefined,
    inputLocation: `conversation:${conversationId}`,
    state,
    onRestore,
  });
  const attempt = useRef<string | undefined>(undefined);
  const clearSource = async (handoff: InitialHandoff) => {
    if (!owner.isCurrent()) return;
    const source = await readDraft(handoff.source.input_location);
    if (!owner.isCurrent() || !source || !same(pointer(source), handoff.source)) return;
    await acceptStoredDraft(owner.ownerKey!, source, {
      ...source.state,
      content: '',
      files: [],
      sessions: [],
      workspace: '',
      scope: { items: [], views: [], origin: 'turn' },
    });
  };
  const initial = async (send: (state: DraftState) => Promise<void>) => {
    if (!draft.ready || !enabled || !owner.isCurrent() || attempt.current === conversationId) return;
    const key = `${storagePrefix}${conversationId}`;
    const processed = `aionrs_initial_processed_${conversationId}`;
    const stored = sessionStorage.getItem(key);
    if (!stored || sessionStorage.getItem(processed)) return;
    let handoff: InitialHandoff;
    try {
      handoff = JSON.parse(stored) as InitialHandoff;
    } catch {
      throw new Error('首条消息交接无法读取，草稿已保留，请检查后发送。');
    }
    if (handoff.ownerKey !== owner.ownerKey || !draft.saved || !same(pointer(draft.saved), handoff.target)) return;
    const sent = draft.saved.state;
    if (!same(state, sent)) return;
    attempt.current = conversationId;
    await draft.flush();
    if (!owner.isCurrent()) return;
    sessionStorage.setItem(processed, 'pending');
    try {
      await send(sent);
    } catch {
      throw new Error('首条消息未确认受理，草稿已保留，请检查后重试。');
    }
    if (!owner.isCurrent()) return;
    sessionStorage.setItem(processed, 'accepted');
    try {
      await draft.accept(sent, { ...sent, content: '', files: [], sessions: [] });
      await clearSource(handoff);
    } catch {
      throw new Error('消息已受理，但草稿清理尚未保存；不会自动重复发送。');
    }
    if (!owner.isCurrent()) return;
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(processed);
  };
  const finishInitial = async (sent: DraftState) => {
    const key = `${storagePrefix}${conversationId}`;
    const stored = sessionStorage.getItem(key);
    if (!stored || !owner.isCurrent()) return;
    const handoff = JSON.parse(stored) as InitialHandoff;
    if (handoff.ownerKey !== owner.ownerKey) return;
    const source = await readDraft(handoff.source.input_location);
    if (!owner.isCurrent() || !source || !same(pointer(source), handoff.source) || !same(sent, source.state)) return;
    sessionStorage.setItem(`aionrs_initial_processed_${conversationId}`, 'accepted');
    await clearSource(handoff);
    if (!owner.isCurrent()) return;
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(`aionrs_initial_processed_${conversationId}`);
  };
  return {
    ...draft,
    status: owner.ownerKey ? draft.status : ('loading' as const),
    ready: Boolean(owner.ownerKey) && draft.ready && !['loading', 'conflict', 'error'].includes(draft.status),
    initial,
    finishInitial,
    ...owner,
  };
}
