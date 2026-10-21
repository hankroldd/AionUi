/**
 * 文件：renderer/mycowork-resend.ts
 * 职责：[mycowork] “重新发送”：事件名与“原消息文本”提取（两个入口共用同一来源）。
 * 边界：只传会话 ID 与原文；不编辑、不重新生成；发送走 SendBox.sendExact，不拼接输入框草稿。
 * 关联：PR11 验收 中9/中10（A534）。
 */
import { parseFileMarker } from '@/renderer/pages/conversation/Messages/components/fileMarker';
import {
  parseSessionMessageBlock,
  parseSessionsBlock,
} from '@/renderer/pages/conversation/Messages/components/sessionMarkers';

export const RESEND_EVENT = 'mycowork:resend-turn';
export type ResendDetail = { conversationId: string; text: string };

/** 用户消息原文：去掉文件/会话标记块后用户实际输入的文字（与消息气泡显示的文字一致）。 */
export const userMessageText = (content: string): string =>
  parseSessionMessageBlock(parseSessionsBlock(parseFileMarker(content, true).text).text).text;
