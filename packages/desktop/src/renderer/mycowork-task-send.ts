/**
 * 文件：packages/desktop/src/renderer/mycowork-task-send.ts
 * 职责：将任务受理与确切轮次停止适配到现有原生发送和运行信号。
 * 边界：不发第二条消息，不自建聊天状态或后台观察器；账号来自持久草稿的Auth挂载。
 * 关联：ADR-0025第二片；PR03 plan §10 B。
 */
import type { DraftDocument, DraftState, TaskRun } from '@mycowork/contracts';
import {
  fetchConversationContext,
  draftStateEquals,
  acceptStoredDraft,
  readDraft,
  settleTaskSubmission,
  isSceneAssistant,
  lookupOfficeTask,
  officeTaskAccepted,
  officeTaskFailureText,
  readOfficeTask,
  stopOfficeTask,
  submitOfficeTask,
  type AcceptedOfficeTask,
  type OfficeTaskOwner,
} from '@mycowork/ui';
import type { TConversationRuntimeSummary } from '@/common/config/storage';
import { hydrateSucceeded } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import type { PersistentDraft } from './mycowork-drafts';

type CapturedDraft = PersistentDraft & { ownerKey?: string; isCurrent: () => boolean };

/** 记录当前可见配置；未就绪的字段保留原意图，技能/MCP不从显示名称猜成ID。 */
export function captureOfficeDraftState(
  state: DraftState,
  visible: {
    workspace?: string;
    assistantId?: string;
    model?: { id?: string; use_model?: string };
    permission?: string | null;
    thoughtLevel?: string | null;
  }
): DraftState {
  return {
    ...state,
    ...(visible.workspace !== undefined ? { workspace: visible.workspace } : {}),
    choices: {
      ...state.choices,
      backend: 'aionrs',
      ...(visible.assistantId !== undefined ? { assistant_id: visible.assistantId } : {}),
      ...(visible.model?.id && visible.model.use_model
        ? { model_provider_id: visible.model.id, model_id: visible.model.use_model }
        : {}),
      ...(visible.permission ? { permission: visible.permission } : {}),
      ...(visible.thoughtLevel ? { thought_level: visible.thoughtLevel } : {}),
    },
  };
}

/** 原生草稿已经捕获Auth身份；缺失身份不以local或当前Cookie补成另一账号。 */
export function officeTaskOwner(draft: CapturedDraft): OfficeTaskOwner {
  if (!draft.ownerKey || !draft.isCurrent()) throw new Error('登录状态已变化，输入已保留，请重新登录后检查任务。');
  return { ownerKey: draft.ownerKey, isCurrent: draft.isCurrent };
}

/** 现会话的计划为准；只有404表示无计划，场景助手即使显式空范围也属于办公。 */
export async function isOfficeConversation(conversationId: string, assistantId?: string): Promise<boolean> {
  if (isSceneAssistant(assistantId)) return true;
  return (await fetchConversationContext(conversationId)) !== null;
}

/** 仅将公开runtime的完整基本形状传给原生gate，不把任务status伪装成runtime。 */
export function officeTaskRuntime(run: TaskRun): TConversationRuntimeSummary | null {
  const r = run.runtime;
  if (
    !r ||
    !['idle', 'starting', 'running', 'cancelling', 'restarting', 'waiting_confirmation'].includes(String(r.state)) ||
    typeof r.can_send_message !== 'boolean' ||
    typeof r.has_task !== 'boolean' ||
    typeof r.is_processing !== 'boolean' ||
    typeof r.pending_confirmations !== 'number' ||
    (r.turn_id !== null && typeof r.turn_id !== 'string')
  )
    return null;
  return r as TConversationRuntimeSummary;
}

/** 首页/后续统一任务用例；普通无范围返回null，拒绝或未知受理均保留输入并明确报错。 */
export async function sendOfficeDraft(
  draft: CapturedDraft,
  saved: DraftDocument,
  options: {
    expectedState: DraftState;
    conversationId?: string;
    assistantId?: string;
    lang?: string;
    deliveryContent?: string;
  }
): Promise<AcceptedOfficeTask | null> {
  const owner = officeTaskOwner(draft);
  if (!draftStateEquals(saved.state, options.expectedState))
    throw new Error('输入或附件已变化，内容已保留，请确认后再次发送。');
  const result = await submitOfficeTask({ ...owner, draft: saved, ...options });
  if (!result) return null;
  if (!officeTaskAccepted(result.run)) {
    const why = officeTaskFailureText(result.run, 'zh-CN') ?? ''; // R068：按失败分型给原因，没有就不编造
    if (result.run.status === 'failed' && result.run.delivery_phase === 'rejected') {
      await draft.accept(saved.state, saved.state);
      throw new Error(`任务尚未受理：投递已明确拒绝，输入已保留；请检查后再次点击发送。${why}`);
    }
    const unknown = result.run.delivery_phase === 'unknown' || result.run.status === 'recovery_required';
    throw new Error(
      (unknown
        ? '此提交的受理结果尚未确认，输入已保留；不会自动重复发送。'
        : '任务尚未受理，输入已保留，请检查任务状态。') + why
    );
  }
  let accepted = result.run;
  if (options.conversationId && !officeTaskRuntime(accepted)) {
    const current = await readOfficeTask(owner, accepted.run_id);
    if (!officeTaskAccepted(current)) throw new Error('任务当前状态尚未确认，输入已保留。');
    accepted = current;
  }
  return accepted;
}

/** 重放的旧轮次仅用真实runtime校准已有gate，不把后来轮次绑定到旧run。 */
export function hydrateOfficeTaskRuntime(conversationId: string, run: TaskRun): void {
  const runtime = officeTaskRuntime(run);
  if (runtime) hydrateSucceeded(conversationId, runtime);
}

/** 刷新后按当前活动轮次找本人run；查找失败不退回另一条停止路径。 */
export async function stopOfficeTurn(
  draft: CapturedDraft,
  conversationId: string,
  turnId: string
): Promise<TaskRun | null> {
  const owner = officeTaskOwner(draft);
  const task = await lookupOfficeTask(owner, { conversationId, turnId });
  return task ? stopOfficeTask(owner, task.run_id) : null;
}

/** 旧首条交接的源稿按原指针结算；任务受理时续写保留并换新UUID。 */
export async function settleInitialSource(
  owner: OfficeTaskOwner,
  pointer: Pick<DraftDocument, 'input_location' | 'revision' | 'submission_id'>,
  taskAccepted: boolean
): Promise<void> {
  if (!owner.isCurrent()) return;
  const source = await readDraft(pointer.input_location, owner.ownerKey);
  if (
    !owner.isCurrent() ||
    !source ||
    source.input_location !== pointer.input_location ||
    source.submission_id !== pointer.submission_id
  )
    return;
  const cleared: DraftState = {
    ...source.state,
    content: '',
    files: [],
    sessions: [],
    workspace: '',
    scope: { items: [], views: [], origin: 'turn' },
  };
  if (taskAccepted) await settleTaskSubmission(owner.ownerKey, source, pointer.revision, cleared);
  else if (source.revision === pointer.revision) await acceptStoredDraft(owner.ownerKey, source, cleared);
}
