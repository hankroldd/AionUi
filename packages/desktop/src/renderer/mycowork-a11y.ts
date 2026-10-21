/**
 * 文件：renderer/mycowork-a11y.ts
 * 职责：[mycowork] 给上游组件补读屏名称：Arco 弹窗/抽屉的“Close”按钮写死英文、Switch（role=switch）没有名称。
 *       一处用 MutationObserver 补，覆盖全部页面，不逐个改上游组件。
 * 边界：只补缺失的 aria-label，不改已有名称、不改布局；取不到标签文字就留空，不编造。
 * 关联：PR11 验收 中11/中12（A532）；退出条件：上游组件自带名称后删除。
 * 台账：MyCowork upstream/PATCHES.md。
 */
import i18n from 'i18next';

const SWITCH = 'button[role="switch"]:not([aria-label]):not([aria-labelledby])';
const MAX_LABEL = 40;

/** 开关旁的标签：从开关向上找第一个“除开关外还有文字”的祖先，取其中第一段文字（不超过 40 字）。 */
export function switchLabel(el: Element): string {
  for (let node = el.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('button[role="switch"],script,style').forEach((n) => n.remove());
    const text = (clone.innerText ?? clone.textContent ?? '')
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean);
    if (text) return text.slice(0, MAX_LABEL);
  }
  return '';
}

export function labelUnnamed(root: ParentNode = document): void {
  root.querySelectorAll('[role="button"][aria-label="Close"]').forEach((el) => {
    const zh = i18n.t('common.close', { defaultValue: 'Close' });
    if (zh !== 'Close') el.setAttribute('aria-label', zh);
  });
  root.querySelectorAll(SWITCH).forEach((el) => {
    const label = switchLabel(el);
    if (label) el.setAttribute('aria-label', label);
  });
}

let started = false;
export function startMycoworkA11y(): void {
  if (started || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  started = true;
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      labelUnnamed();
    });
  }).observe(document.body, { childList: true, subtree: true });
}
