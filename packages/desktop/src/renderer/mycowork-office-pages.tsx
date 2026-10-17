/**
 * [mycowork] 办公页路由挂载点（导入/空间/知识/能力/设置/计划/记忆），从 mycowork-slots.tsx 拆出（A506 行数上限）；
 * 外部一律经 mycowork-slots 再导出引用。
 */
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { ipcBridge } from '@/common';
import { getClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import { hasAvailableModels } from '@/renderer/pages/guid/utils/modelUtils';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { MYCOWORK_MEMORY_SIDER_ID, MYCOWORK_SPACE_SIDER_ID } from '@/renderer/mycowork-sider-ids';
import { useOwnerKey, useResourceQuestionNavigation } from '@/renderer/mycowork-resource-navigation';
import MarkdownView from '@/renderer/components/Markdown';
import {
  ImportsPage,
  KnowledgePage,
  CapabilitiesPage,
  capabilityReturnTarget,
  useCapabilityReturn,
  SetupPage,
  ConnectionsPage,
  connectionsEntryState,
  connectionsReturnTarget,
  useConnectionsReturn,
  SchedulesPage,
  MemoryPage,
  ResourcesPage,
} from '@mycowork/ui';

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

/** 页面仍持有数据，两个portal只共享原生容器与手机收起回调。 */
function useOfficeSidebar(id: string) {
  const layout = useLayoutContext();
  const [sidebar, setSidebar] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setSidebar(document.getElementById(id));
  }, [id]);
  return {
    navigationContainer: sidebar,
    ...(layout
      ? {
          onCollapse: () => layout.setSiderCollapsed(true),
          onSelect: () => layout.isMobile && layout.setSiderCollapsed(true),
        }
      : {}),
  };
}

/** 空间的数据仍由页面持有，portal 只把同一导航挂入原生二级栏。 */
export const OfficeResourcesSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const navigation = useOfficeSidebar(MYCOWORK_SPACE_SIDER_ID);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const trash = /^\/office\/trash\/?$/.test(pathname);
  const { user, status } = useAuth();
  const ownerKey = status === 'authenticated' ? (user?.id ?? 'local') : undefined;
  const onAskScope = useResourceQuestionNavigation(ownerKey);
  return (
    <ResourcesPage
      key={`${status}:${user?.id ?? ''}`}
      lang={current.language}
      {...navigation}
      trash={trash}
      onTrashChange={(next) => {
        if (next !== trash) void navigate(next ? '/office/trash' : '/office/space');
      }}
      ownerKey={ownerKey}
      resolveConversationName={resolveOutputConversationName}
      onAskScope={onAskScope}
      renderMarkdown={(content, overrides) => <MarkdownView components={overrides}>{content}</MarkdownView>}
    />
  );
};

/** 使用当前登录原生GET校验会话归属；不把Bridge登记ID当成权限，也不复用全局标题缓存。 */
async function resolveOutputConversationName(id: string): Promise<string | undefined> {
  if (!id || id === '.' || id === '..') return undefined;
  return (await getConversationOrNull(encodeURIComponent(id)))?.name.trim() || undefined;
}

/** [mycowork] ADR-0022：知识管理预留页，不连接任何管理 API。 */
export const OfficeKnowledgeSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  return <KnowledgePage lang={current.language} />;
};

/**
 * Mount point: route `/office/capabilities` (MyCowork P10 capability center: read-only status list + per-item re-check).
 * A validated return intent from a blocked task (router state, same account, whitelisted origin) adds "back to my task".
 */
export const OfficeCapabilitiesSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const navigate = useNavigate();
  const ownerKey = useOwnerKey();
  const intent = useCapabilityReturn(useLocation().state, ownerKey);
  const navigateToConnections = (capabilityId: string): void =>
    void navigate('/office/connections', { state: connectionsEntryState(ownerKey, capabilityId, intent) });
  const returnTo = intent && {
    capabilityId: intent.capabilityId,
    onReturn: () => {
      const target = capabilityReturnTarget(intent);
      void navigate(target.path, { state: target.state });
    },
  };
  return (
    <CapabilitiesPage lang={current.language} returnTo={returnTo ?? undefined} onConfigure={navigateToConnections} />
  );
};

/** Mount point: route `/office/setup` (MyCowork P00 first-run setup checklist, state derived from real capability checks). */
export const OfficeSetupSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  return <SetupPage lang={current.language} modelStatus={useSetupModelStatus()[0]} />;
};

/**
 * [mycowork] R001/D285：模型两步的状态只经宿主自己的接口读（provider 列表 + 工具设置里的图像模型），每次进页重读。
 * 对话模型 = 有启用的 provider 带 aionrs 可用模型（同对话页 getAvailableModels 口径）；读失败或返回非列表就不下结论。
 * 图像模型只在工具设置明确选了模型且开关打开时算已配置，读失败按“稍后再说”。
 */
function useSetupModelStatus(): [{ chat?: boolean; image?: boolean }, () => void] {
  const [status, setStatus] = useState<{ chat?: boolean; image?: boolean }>({});
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    ipcBridge.mode.listProviders.invoke().then(
      (list) =>
        live &&
        Array.isArray(list) &&
        setStatus((s) => ({ ...s, chat: list.some((p) => p.enabled !== false && hasAvailableModels(p)) })),
      () => {}
    );
    getClientBusinessSetting('tools.imageGenerationModel').then(
      (m) => live && setStatus((s) => ({ ...s, image: Boolean(m?.switch && m.id && m.use_model) })),
      () => {}
    );
    return () => {
      live = false;
    };
  }, [round]);
  return [status, (): void => setRound((n) => n + 1)];
}

/**
 * Mount point: route `/office/connections` (MyCowork P15 connections & data sources, slice A: status + test connection).
 * A validated return intent (router state, same account, whitelisted target) adds "back to capabilities / my task".
 */
export const OfficeConnectionsSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const navigate = useNavigate();
  const back = useConnectionsReturn(useLocation().state, useOwnerKey());
  const [modelStatus, reread] = useSetupModelStatus();
  const returnTo = back && {
    kind: back.kind,
    section: back.section,
    onReturn: () => {
      const target = connectionsReturnTarget(back);
      void navigate(target.path, target.state ? { state: target.state } : undefined);
    },
  };
  return (
    <ConnectionsPage
      lang={current.language}
      modelStatus={modelStatus}
      onRereadModel={reread}
      focus={back?.section}
      returnTo={returnTo ?? undefined}
    />
  );
};

/** Mount point: route `/office/schedules` (MyCowork P14 office schedules: list + turn off/on; separate from AionUi `/scheduled`). */
export const OfficeSchedulesSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  return <SchedulesPage lang={current.language} />;
};

/** Mount point: route `/office/memory` (MyCowork P11 memory: review, accept/reject/disable, pause precipitation). */
export const OfficeMemorySlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  const navigation = useOfficeSidebar(MYCOWORK_MEMORY_SIDER_ID);
  return <MemoryPage lang={current.language} {...navigation} />;
};
