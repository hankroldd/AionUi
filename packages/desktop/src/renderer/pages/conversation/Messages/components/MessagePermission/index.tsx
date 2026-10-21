/**
 * 文件：Messages/components/MessagePermission/index.tsx
 * 职责：准确呈现当前调用的批准动作，沿用原批准守卫和回调。
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IMessagePermission, IMessageToolCall, TMessage } from '@/common/chat/chatLib';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { hidesAlwaysAllow } from '@/renderer/mycowork-approval-guard';
import { approvalSummary } from '@mycowork/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PermissionRequestPanel } from './PermissionRequestPanel';
import { toolDisplayNameKey } from '../toolDisplayName';
import { useMessageList } from '../../hooks';
import {
  classifyLegacyPermission,
  normalizePermissionOperationKind,
  type PermissionPanelOption,
} from './permissionOptions';

type MessagePermissionProps = {
  message: IMessagePermission;
};

const toolInput = (tool?: IMessageToolCall): Record<string, unknown> | undefined =>
  [tool?.content.input, tool?.content.args].find(
    (input) => input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length > 0
  );

const MessagePermission: React.FC<MessagePermissionProps> = React.memo(({ message }) => {
  const { t, i18n } = useTranslation();
  const content = message.content || ({} as IMessagePermission['content']);
  const { description, title, action, call_id, command_type } = content;
  const messages = useMessageList();
  const conversationContext = useConversationContextSafe();
  // [mycowork] AionCore v0.2.2 BackendOutputSink 给工具 ID 加 aionrs-；批准仍使用原 ID。
  const matchesTool = useCallback(
    (item?: TMessage | null): item is IMessageToolCall =>
      item?.type === 'tool_call' &&
      item.conversation_id === message.conversation_id &&
      Boolean(call_id) &&
      (item.content.call_id === call_id ||
        (conversationContext?.type === 'aionrs' && item.content.call_id === `aionrs-${call_id}`)),
    [call_id, conversationContext?.type, message.conversation_id]
  );
  const tool = messages.find(matchesTool);
  const input = toolInput(tool);
  const requestKey = `${message.conversation_id}:${message.id}:${call_id}`;
  const messageId = tool?.id || (conversationContext?.type === 'aionrs' && call_id ? `aionrs-${call_id}` : undefined);
  const [hydrated, setHydrated] = useState<{ requestKey: string; tool: IMessageToolCall } | null>(null);
  const fullTool = hydrated?.requestKey === requestKey ? hydrated.tool : undefined;

  useEffect(() => {
    if (input || !messageId || !call_id) return;
    let cancelled = false;
    void ipcBridge.database.getConversationMessage
      .invoke({ conversation_id: message.conversation_id, message_id: messageId })
      .then((candidate) => {
        if (!cancelled && candidate?.id === messageId && matchesTool(candidate) && toolInput(candidate)) {
          setHydrated({ requestKey, tool: candidate });
        }
      })
      .catch(() => {
        if (!cancelled) {
          console.warn('[MessagePermission] Failed to load tool input', {
            conversation_id: message.conversation_id,
            message_id: messageId,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [call_id, input, matchesTool, message.conversation_id, messageId, requestKey]);

  const displayInput = input ?? toolInput(fullTool);
  const detail = displayInput
    ? JSON.stringify(displayInput, null, 2)
    : t('messages.permissionInputUnavailable', {
        defaultValue: '完整工具参数不可用，请先查看操作说明；不确定时拒绝本次操作。',
      });
  const mcpServers = conversationContext?.loadedMcpServers;
  // [mycowork] D115：MyCowork 会话的 mcp 类与 exec 类卡片不给“始终允许”（aionrs 按类别记住，会连带放行 Bridge 写工具或免批准 shell）
  const options = (Array.isArray(content.options) ? content.options : []).filter(
    (option) => !hidesAlwaysAllow(mcpServers, command_type, action, String(option?.value))
  );
  const displayNameKey = toolDisplayNameKey(tool?.content.name ?? fullTool?.content.name ?? action);
  const displayTitle =
    (displayNameKey ? t(displayNameKey) : undefined) || title || description || t('messages.permissionRequest');
  // [mycowork] D302：Bridge 写工具把技术入参翻成“动作 · 对象 · 影响”；未知工具/入参不合法时沿用上游 description，“请求详情”仍是原 JSON
  const summary = approvalSummary(
    tool?.content.name ?? fullTool?.content.name ?? action,
    displayInput,
    i18n?.language?.startsWith('zh') ? 'zh' : 'en'
  );
  const shownDescription = summary ? [summary.action, summary.target, summary.impact].join(' · ') : description;

  const panelOptions = useMemo<PermissionPanelOption[]>(
    () =>
      options.map((option, index) => {
        const value = option ? String(option.value) : '';
        const fallbackId = `option_${index}`;
        const label = option?.label || `${t('messages.option')} ${index + 1}`;
        return {
          id: `${value || fallbackId}:${index}`,
          value,
          label: t(label, { ...option?.params, defaultValue: label }),
          intent: classifyLegacyPermission(value),
          testId: `message-permission-option-${value || fallbackId}`,
        };
      }),
    [options, t]
  );

  const handleConfirm = useCallback(
    async (selectedValue: string) => {
      await ipcBridge.conversation.confirmation.confirm.invoke({
        conversation_id: message.conversation_id,
        call_id,
        msg_id: message.msg_id || '',
        data: { value: selectedValue },
        always_allow: selectedValue === 'proceed_always',
      });
    },
    [call_id, message.conversation_id, message.msg_id]
  );

  return (
    <PermissionRequestPanel
      requestKey={`${message.id}:${call_id}`}
      testIdPrefix='message-permission'
      title={displayTitle}
      description={shownDescription && shownDescription !== displayTitle ? shownDescription : undefined}
      operationKind={normalizePermissionOperationKind(action)}
      detail={detail}
      detailLabelKey='messages.requestDetails'
      options={panelOptions}
      onConfirm={handleConfirm}
    />
  );
});

export { PermissionRequestPanel } from './PermissionRequestPanel';
export {
  classifyAcpPermission,
  classifyLegacyPermission,
  getPermissionOptionsIdentity,
  getSafePermissionOptionId,
  normalizePermissionOperationKind,
} from './permissionOptions';
export type { PermissionIntent, PermissionOperationKind, PermissionPanelOption } from './permissionOptions';
export default MessagePermission;
