/**
 * 文件：renderer/mycowork-session.ts
 * 职责：[mycowork] 判断某会话是否 MyCowork 会话（挂了 Bridge MCP），供只对办公会话生效的显示过滤使用。
 * 边界：只读会话缓存（SWR 键 conversation/<id>，与既有读取共用）；读不到按“不是”处理，宁可少过滤。
 */
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import useSWR from 'swr';
import { isMycoworkSession } from '@/renderer/mycowork-approval-guard';

export function useIsMycoworkConversation(conversationId: string | null): boolean {
  const { data } = useSWR(conversationId ? `conversation/${conversationId}` : null, () =>
    getConversationOrNull(conversationId!)
  );
  return isMycoworkSession((data?.extra as { mcp_servers?: string[] } | undefined)?.mcp_servers);
}
