/**
 * 文件：renderer/mycowork-hidden-messages.ts
 * 职责：[mycowork] 判定哪些上游消息对办公用户没有意义、不该显示：上下文整理提示（Microcompact，D315）与推理（thinking）消息。
 *       消息流（MessageTips）与会话检索结果摘要共用同一判定，不各写一份。
 * 边界：纯函数，不读状态；只判定，不改消息内容。
 * 关联：PR11 A532（消息流）、A551（检索摘要）。退出条件：上游不再产出这类提示后删除。
 * 台账：MyCowork upstream/PATCHES.md。
 */

/** 上游英文上下文整理提示（含 token 数），不承担功能。 */
export const isMicrocompactText = (content: string): boolean => /^Microcompact:/i.test(content);

/** 检索结果项是否应隐藏：整理提示，或推理消息（英文原文）。 */
export const isHiddenSearchItem = (item: { message_type: string; preview_text: string }): boolean =>
  item.message_type === 'thinking' || isMicrocompactText(item.preview_text);
