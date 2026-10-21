/**
 * 文件：renderer/mycowork-a11y.ts
 * 职责：[mycowork] 给上游组件补读屏名称：Arco 弹窗/抽屉的“Close”按钮写死英文、Switch（role=switch）没有名称。
 *       一处用 MutationObserver 补，覆盖全部页面，不逐个改上游组件。
 * 边界：只补缺失的 aria-label，不改已有非空名称、不改布局；取不到标签文字就留空，不编造；已处理的节点用 WeakSet 记住。
 * 关联：PR11 验收 中11/中12（A532）；退出条件：上游组件自带名称后删除。
 * 台账：MyCowork upstream/PATCHES.md。
 */
import i18n from 'i18next';

const SWITCH = 'button[role="switch"]';
const MAX_LABEL = 40;
const done = new WeakSet<Element>();

const firstText = (root: Element, skip: Element): string => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.trim();
    if (text && !skip.contains(n) && !n.parentElement?.closest('script,style')) return text;
  }
  return '';
};

/** 开关的标签：label[for]/外层 label 的文字，否则向上最多 4 层、取第一个非空文本节点（不克隆、不读 innerText）。 */
export function switchLabel(el: Element): string {
  const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  const wrapping = byFor ?? el.closest('label');
  const direct = wrapping ? firstText(wrapping, el) : '';
  if (direct) return direct.slice(0, MAX_LABEL);
  for (let node = el.parentElement, depth = 0; node && depth < 4; node = node.parentElement, depth++) {
    const text = firstText(node, el);
    if (text) return text.slice(0, MAX_LABEL);
  }
  return '';
}

/** 只补缺失的名称：已有非空 aria-label / aria-labelledby 一律不动。 */
export function labelUnnamed(root: ParentNode = document): void {
  root.querySelectorAll('[role="button"][aria-label="Close"]').forEach((el) => {
    const zh = i18n.t('common.close', { defaultValue: 'Close' });
    if (zh !== 'Close') el.setAttribute('aria-label', zh);
  });
  root.querySelectorAll(SWITCH).forEach((el) => {
    if (done.has(el) || el.getAttribute('aria-label')?.trim() || el.hasAttribute('aria-labelledby')) return;
    const label = switchLabel(el);
    if (!label) return;
    el.setAttribute('aria-label', label);
    done.add(el);
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
