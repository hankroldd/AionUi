/**
 * 文件：renderer/mycowork-office-agents.ts
 * 职责：[mycowork] A567（D325）：首页助手列表只给办公引擎（Aion CLI）助手与本部署放开登录态的编程 agent；首页默认助手固定为办公场景助手，
 *       选过别的助手不被记成默认。
 * 边界：纯函数；放开清单在界面构建时由 MYCOWORK_SANDBOX_AGENTS 注入（与 aioncore 隔离包装同一变量、同一白名单 codex、claude，D148、D260），
 *       未注入（测试栈、单元测试、未知构建）= 不放开任何编程 agent。只管界面能不能选，登录态隔离仍归 aioncore-sandboxed.sh。
 * 退出条件：上游能按部署隐藏 agent，或 aioncore 对隔离内不可用的 agent 报 offline 后删除本文件与调用点（台账：MyCowork upstream/PATCHES.md）。
 */
import { assistantRuntimeKey, isAionrsAssistant, type Assistant } from '@/common/types/agent/assistantTypes';
import { isSceneAssistant } from '@mycowork/ui';

declare const __MYCOWORK_RELEASED_AGENTS__: string | undefined;

/** 首页兜底的办公助手（scripts/aionui-scene-seed.ts 登记的「汇报 / PPT」）。 */
export const DEFAULT_OFFICE_ASSISTANT_ID = 'mycowork-scene-ppt';

/** 每次调用时读（测试可 stubGlobal）：逗号分隔的 runtime 键，与 assistantRuntimeKey 同口径（claude、codex）。 */
const releasedAgents = (): Set<string> =>
  new Set(
    (typeof __MYCOWORK_RELEASED_AGENTS__ === 'string' ? __MYCOWORK_RELEASED_AGENTS__ : '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
  );

/** 首页可选：Aion CLI 助手（含场景助手），或 runtime 在本部署放开清单里的编程 agent。 */
export const officeOfferedAssistants = (assistants: Assistant[]): Assistant[] => {
  const released = releasedAgents();
  return assistants.filter((assistant) => isAionrsAssistant(assistant) || released.has(assistantRuntimeKey(assistant)));
};

/** 只有办公场景助手会被记成首页默认（误选 Claude Code 等不改变下次默认）。 */
export const persistsAsGuidDefault = (assistantId: string): boolean => isSceneAssistant(assistantId);

/** 记住的场景助手不可用时，回落到「汇报 / PPT」（已启用才算）。 */
export const officeFallbackAssistantId = (assistants: Assistant[]): string | undefined =>
  assistants.find((assistant) => assistant.id === DEFAULT_OFFICE_ASSISTANT_ID && assistant.enabled !== false)?.id;
