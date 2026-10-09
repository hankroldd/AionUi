/**
 * [mycowork] PR07 收尾修复。文件：tests/unit/mycowork/saveTrackerTeardown.ts
 * 职责：保存跟踪器相关用例共用的收尾：页面级跟踪器是模块级单例，Arco 的 Message / Notification 的退出动画还会让节点在 DOM 里多留几百毫秒，
 *       上一例的轮询与提示因此漏进下一例；`settleTracker` 停掉所有轮询、清提示，并等 DOM 里不再有提示节点。
 * 边界：只用真实的 setTimeout（用例里的假定时器只伪造 setInterval / Date）；不依赖任何产品内部状态之外的东西。
 */
import { Message, Notification } from '@arco-design/web-react';
import { resetSaveTracker } from '@mycowork/ui/pages/office-editor/save-tracker.tsx';

/** 等条件成立（真实时间轮询，最多约 1.5 秒）；返回最终是否成立。 */
export async function until(cond: () => boolean, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries && !cond(); i++) await new Promise((r) => setTimeout(r, 25));
  return cond();
}

export async function settleTracker(): Promise<void> {
  resetSaveTracker();
  Message.clear();
  Notification.clear();
  await until(() => !document.querySelector('.arco-message, .arco-notification'));
}
