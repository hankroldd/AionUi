/**
 * 文件：packages/desktop/src/renderer/mycowork-resource-navigation.tsx
 * [mycowork] 职责：资料提问只携带当前账号经核实的项目、工作目录与一次路由意图。
 * 边界：账号、路由或请求失效后不导航；原生提供同等接点后移除此适配。
 * 关联：MyCowork docs/contracts/navigation-intent.md；PR11 B2b。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import { BridgeError, fetchConversationContext, getScope, type ScopeDraft } from '@mycowork/ui';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { useLayoutContext, type GuidWorkContext } from '@/renderer/hooks/context/LayoutContext';

export type ResourceWorkOrigin = {
  ownerKey: string;
  projectId?: string;
  workspace?: string;
  originConversationId?: string;
};
type ResourceScopeIntent = { ownerKey: string; selection: ScopeDraft };
type ResourceNavigationState = {
  mycoworkResourceOrigin?: ResourceWorkOrigin;
  mycoworkScopeDraft?: ResourceScopeIntent;
  mycoworkProjectId?: string;
  workspace?: string;
};

/** Capture only the work context belonging to the currently mounted route and actor. */
export function spaceWorkOrigin(
  pathname: string,
  ownerKey: string | undefined,
  conversationId: string | undefined,
  work: GuidWorkContext | null | undefined
): ResourceWorkOrigin | undefined {
  if (!ownerKey) return undefined;
  if (conversationId) return { ownerKey, originConversationId: conversationId };
  if (pathname !== '/guid' || work?.ownerKey !== ownerKey) return { ownerKey };
  const { projectId } = getScope();
  return { ownerKey, ...(projectId ? { projectId } : {}), ...(work.workspace ? { workspace: work.workspace } : {}) };
}

/** Read the work origin at the rail click, rather than saving a last-used project. */
export function useSpaceNavigationState(ownerKey: string | undefined) {
  const location = useLocation();
  const conversationId = useMatch('/conversation/:id')?.params.id;
  const work = useLayoutContext()?.guidWork;
  return () => ({ mycoworkResourceOrigin: spaceWorkOrigin(location.pathname, ownerKey, conversationId, work) });
}

/** Keep the installed selection through its state-clearing replace, until a distinct navigation. */
export function useGuidResourceSelection(ownerKey: string | undefined) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as ResourceNavigationState | null;
  const [captured, setCaptured] = useState(state?.mycoworkScopeDraft);
  const [scopeKey, setScopeKey] = useState(location.key);
  const previousKey = useRef(location.key);
  const replacing = useRef(false);
  if (previousKey.current !== location.key) {
    previousKey.current = location.key;
    if (replacing.current && !state?.mycoworkScopeDraft) replacing.current = false;
    else if (captured || state?.mycoworkScopeDraft) {
      setCaptured(state?.mycoworkScopeDraft);
      setScopeKey(location.key);
    }
  }
  useEffect(() => {
    if (!state?.mycoworkScopeDraft) return;
    const { mycoworkScopeDraft: _scope, mycoworkProjectId: _project, workspace: _workspace, ...rest } = state;
    replacing.current = true;
    void navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: Object.keys(rest).length ? rest : null,
    });
  }, [location.hash, location.pathname, location.search, navigate, state]);
  const initialScope = useMemo(
    () =>
      captured
        ? captured.ownerKey === ownerKey && ownerKey
          ? captured.selection
          : { items: [], views: [], requiredResourceIds: [] }
        : undefined,
    [captured, ownerKey]
  );
  return { initialScope, scopeKey, ownsTransfer: !captured || captured.ownerKey === ownerKey };
}

/** Publish the live Guid workspace only for this mount; no workspace survives cleanup. */
export function useGuidWorkspace(ownerKey: string | undefined, workspace: string | undefined): void {
  const layout = useLayoutContext();
  useEffect(() => {
    if (!layout || !ownerKey) return;
    layout.setGuidWork({ ownerKey, workspace: workspace ?? '' });
    return () => layout.setGuidWork(null);
  }, [ownerKey, layout?.setGuidWork, workspace]);
}

async function verifiedWorkOrigin(origin: ResourceWorkOrigin | undefined) {
  if (!origin?.originConversationId) return { projectId: origin?.projectId, workspace: origin?.workspace };
  const id = origin.originConversationId;
  if (id === '.' || id === '..') throw new BridgeError('failed');
  try {
    const [conversation, context] = await Promise.all([
      getConversationOrNull(encodeURIComponent(id)),
      fetchConversationContext(id),
    ]);
    if (!conversation) throw new BridgeError('failed');
    return {
      projectId: context ? context.working_project_id : conversation.project_id,
      workspace: conversation.extra.workspace,
    };
  } catch {
    throw new BridgeError('failed');
  }
}

/** Verify conversation ownership and plan attribution before handing the scope to Guid. */
export function useResourceQuestionNavigation(ownerKey: string | undefined) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = useRef<{ key: string; ownerKey: string | undefined } | undefined>(undefined);
  current.current = { key: location.key, ownerKey };
  useEffect(
    () => () => {
      current.current = undefined;
    },
    []
  );
  return useCallback(
    async (draft: ScopeDraft, signal: AbortSignal): Promise<void> => {
      if (!ownerKey) throw new BridgeError('failed');
      const origin = (location.state as ResourceNavigationState | null)?.mycoworkResourceOrigin;
      if (origin && origin.ownerKey !== ownerKey) throw new BridgeError('failed');
      if (signal.aborted) return;
      const work = await verifiedWorkOrigin(origin);
      if (signal.aborted || current.current?.ownerKey !== ownerKey || current.current?.key !== location.key) return;
      const { projectId: _unverified, ...selection } = draft;
      await navigate('/guid', {
        state: {
          mycoworkScopeDraft: {
            ownerKey,
            selection: { ...selection, ...(work.projectId ? { projectId: work.projectId } : {}) },
          },
          ...(work.workspace ? { workspace: work.workspace } : {}),
        },
      });
    },
    [location.key, location.state, navigate, ownerKey]
  );
}
