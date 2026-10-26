/**
 * 文件：packages/desktop/src/renderer/mycowork-file-link.tsx
 * 职责：[mycowork] 消息里 deck 文件链接的宿主：已保存结果打开固定版本，其余文件沿 Explorer 载荷门预览。
 * 边界：只负责打开与传参；角色与模板入口由 @mycowork/ui 判定。从 mycowork-slots.tsx 拆出（单文件 ≤ 400 行）。
 */
import React, { useEffect, useRef } from 'react';
import { Button, Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import { useMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import { getCurrentProject, useCurrentProject } from '@/renderer/pages/conversation/explorer/currentProjectStore';
import {
  getCurrentConversation,
  useCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { classifyPreviewError, previewErrorToI18nKey } from '@/renderer/utils/previewError';
import { useOwnerKey } from '@/renderer/mycowork-resource-navigation';
import {
  ConversationFileLink,
  FillResultFile,
  savedResultFile,
  savedResultMessage,
  readSavedResultFile,
  type SavedResultFile,
  ResourceCitationLink,
  TemplateConfirmationAction,
} from '@mycowork/ui';

const renderFillFile = (file: SavedResultFile) => (
  <MyCoworkWorkspaceFileLinkSlot relativePath={file.relativePath} fixedResult={file}>
    {file.relativePath.split('/').pop()}
  </MyCoworkWorkspaceFileLinkSlot>
);

/** [mycowork] 持久工具消息只转交自有 UI；文件打开仍走原会话预览。 */
export const MyCoworkFillResultFileSlot: React.FC<{ message: ToolMessage }> = ({ message }) => {
  const conversationId = useCurrentConversation();
  const ownerKey = useOwnerKey();
  if (!conversationId || !ownerKey) return null;
  return (
    <FillResultFile
      key={`${ownerKey}:${conversationId}`}
      message={message}
      conversationId={conversationId}
      readMessage={ipcBridge.database.getConversationMessage.invoke}
      renderFile={renderFillFile}
    />
  );
};

/** [mycowork] Resource citations remain tied to the current authenticated conversation. */
export const MyCoworkResourceCitationSlot: React.FC<{ resourceId: string; children?: React.ReactNode }> = ({
  resourceId,
  children,
}) => {
  const conversationId = useCurrentConversation();
  const ownerKey = useOwnerKey();
  const { i18n } = useTranslation();
  if (!conversationId || !ownerKey) return <>{children}</>;
  return (
    <ResourceCitationLink
      key={`${ownerKey}:${conversationId}:${resourceId}`}
      conversationId={conversationId}
      resourceId={resourceId}
      lang={i18n.language}
    >
      {children}
    </ResourceCitationLink>
  );
};

/** [mycowork] 已保存回执优先打开固定版本；普通工作文件沿 Explorer 预览。 */
export const MyCoworkWorkspaceFileLinkSlot: React.FC<{
  relativePath: string;
  children?: React.ReactNode;
  fixedResult?: SavedResultFile;
  messageId?: string;
}> = ({ relativePath, children, fixedResult, messageId }) => {
  const projectId = useCurrentProject();
  const conversationId = useCurrentConversation();
  const preview = useOptionalPreviewContext();
  const ownerKey = useOwnerKey();
  const messages = useMessageList();
  const resultMessage = conversationId ? savedResultMessage(messages, conversationId, messageId, relativePath) : null;
  const resultKey = JSON.stringify([fixedResult, resultMessage]);
  const generation = useRef(0);
  useEffect(() => {
    return () => {
      generation.current += 1;
    };
  }, [projectId, conversationId, ownerKey, relativePath, resultKey]);
  const { t, i18n } = useTranslation();
  const open = async (): Promise<void> => {
    if (!projectId || !conversationId || !preview) return;
    const openedAt = generation.current;
    const current = () =>
      generation.current === openedAt &&
      getCurrentProject() === projectId &&
      getCurrentConversation() === conversationId;
    try {
      if (fixedResult || resultMessage) {
        const file =
          fixedResult ??
          (await readSavedResultFile(resultMessage!, conversationId, ipcBridge.database.getConversationMessage.invoke));
        if (!current()) return;
        if (!file || file.relativePath !== relativePath) throw new Error('Saved result is unavailable');
        preview.openPreview(`${file.resourceId}/${file.revisionId}`, 'mycowork-result', {
          title: relativePath.split('/').pop(),
          file_name: relativePath.split('/').pop(),
          editable: false,
        });
        return;
      }
      const detail = await ipcBridge.project.get.invoke({ project_id: projectId });
      if (!current() || detail.project_id !== projectId || !detail.explorer.workspace_pe_id) return;
      const { buildExplorerPreviewPayload } = await import('./pages/conversation/explorer/ExplorerContainer');
      if (!current()) return;
      const payload = await buildExplorerPreviewPayload(detail.explorer.workspace_pe_id, relativePath);
      if (current()) preview.openPreview(payload.content, payload.contentType, payload.metadata);
    } catch (error) {
      if (current()) Message.error(t(previewErrorToI18nKey(classifyPreviewError(error))));
    }
  };
  const disabled = !projectId || !conversationId || !preview || !ownerKey;
  if (!fixedResult && resultMessage && conversationId && savedResultFile(resultMessage, conversationId))
    return (
      <Button
        type='text'
        disabled={disabled}
        onClick={() => void open()}
        style={{
          border: 0,
          padding: 0,
          background: 'none',
          color: 'inherit',
          textDecoration: 'underline',
          font: 'inherit',
        }}
      >
        {children}
      </Button>
    );
  return (
    <>
      <ConversationFileLink
        disabled={disabled}
        onOpen={() => void open()}
        fileName={relativePath.split('/').pop()}
        lang={i18n.language}
        conversationId={conversationId}
        relativePath={relativePath}
      >
        {children}
      </ConversationFileLink>
      <TemplateConfirmationAction relativePath={relativePath} disabled={disabled} lang={i18n.language} />
    </>
  );
};
