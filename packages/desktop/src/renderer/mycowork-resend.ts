/**
 * 文件：renderer/mycowork-resend.ts
 * 职责：[mycowork] “重新发送”事件名：用户消息悬停按钮发出，对话输入框接收后走现有发送链路再发一次。
 * 边界：只传会话 ID 与原文；不编辑、不重新生成。
 * 关联：PR11 验收 中9/中10（A532）。
 */
export const RESEND_EVENT = 'mycowork:resend-turn';
export type ResendDetail = { conversationId: string; text: string };
