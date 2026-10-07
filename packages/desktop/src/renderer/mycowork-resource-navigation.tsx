/**
 * 文件：packages/desktop/src/renderer/mycowork-resource-navigation.tsx
 * [mycowork] 职责：资料提问只携带当前账号经核实的工作项目与一次路由意图，交给新建任务页草稿。
 * 边界：只用路由 state，不改上游发送链；账号、路由失效后不导航；原生提供同等接点后移除此适配。
 * 关联：MyCowork docs/contracts/navigation-intent.md；PR11 B2b。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { BridgeError, fetchConversationContext, getScope, type ScopeDraft } from '@mycowork/ui';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';

export type ResourceWorkOrigin = { ownerKey: string; projectId?: string; originConversationId?: string };
type ResourceScopeIntent = { ownerKey: string; selection: ScopeDraft };
type ResourceNavigationState = { mycoworkResourceOrigin?: ResourceWorkOrigin; mycoworkScopeDraft?: ResourceScopeIntent };

/** 在侧栏点击“空间”时读取来源工作上下文（对话页只记对话 id，新建任务页记当前项目），不保存“上次用过的项目”。 */
export function useSpaceNavigationState(ownerKey: string | undefined) {
  const { pathname } = useLocation();
  const conversationId = useMatch('/conversation/:id')?.params.id;
  return (): { mycoworkResourceOrigin?: ResourceWorkOrigin } => {
    if (!ownerKey) return {};
    if (conversationId) return { mycoworkResourceOrigin: { ownerKey, originConversationId: conversationId } };
    const { projectId } = getScope();
    return { mycoworkResourceOrigin: { ownerKey, ...(pathname === '/guid' && projectId ? { projectId } : {}) } };
  };
}

/** 新建任务页：把路由里的提问意图变成 ScopeChip 的初始范围；别的账号的意图一律变成空必选集（拒发，不退回整库）。意图随路由走，普通“新任务”导航即清空。 */
export function useGuidResourceSelection(ownerKey: string | undefined) {
  const intent = (useLocation().state as ResourceNavigationState | null)?.mycoworkScopeDraft;
  const initialScope = useMemo<ScopeDraft | undefined>(
    () =>
      !intent
        ? undefined
        : intent.ownerKey === ownerKey && ownerKey
          ? intent.selection
          : { items: [], views: [], requiredResourceIds: [] },
    [intent, ownerKey],
  );
  return { initialScope, scopeKey: intent ? JSON.stringify(intent) : '' };
}

async function verifiedProjectId(origin: ResourceWorkOrigin | undefined): Promise<string | undefined> {
  if (!origin?.originConversationId) return origin?.projectId;
  const id = origin.originConversationId;
  if (id === '.' || id === '..') throw new BridgeError('failed');
  try {
    const [conversation, context] = await Promise.all([
      getConversationOrNull(encodeURIComponent(id)),
      fetchConversationContext(id),
    ]);
    if (!conversation) throw new BridgeError('failed');
    return context ? context.working_project_id : conversation.project_id;
  } catch {
    throw new BridgeError('failed');
  }
}

/** 核实来源对话归属与计划所属项目后再进入草稿；信号已中止、账号或路由已变则不导航。 */
export function useResourceQuestionNavigation(ownerKey: string | undefined) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = useRef<{ key: string; ownerKey: string | undefined } | undefined>(undefined);
  current.current = { key: location.key, ownerKey };
  useEffect(
    () => () => {
      current.current = undefined;
    },
    [],
  );
  return useCallback(
    async (draft: ScopeDraft, signal: AbortSignal, question?: string): Promise<void> => {
      if (!ownerKey) throw new BridgeError('failed');
      const origin = (location.state as ResourceNavigationState | null)?.mycoworkResourceOrigin;
      if (origin && origin.ownerKey !== ownerKey) throw new BridgeError('failed');
      if (signal.aborted) return;
      const projectId = await verifiedProjectId(origin);
      if (signal.aborted || current.current?.ownerKey !== ownerKey || current.current?.key !== location.key) return;
      const { projectId: _unverified, ...selection } = draft;
      await navigate('/guid', {
        state: {
          mycoworkScopeDraft: { ownerKey, selection: { ...selection, ...(projectId ? { projectId } : {}) } },
          ...(question ? { prefillPrompt: question } : {}),
        },
      });
    },
    [location.key, location.state, navigate, ownerKey],
  );
}
