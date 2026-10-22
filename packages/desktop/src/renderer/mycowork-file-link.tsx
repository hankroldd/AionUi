/**
 * 文件：packages/desktop/src/renderer/mycowork-file-link.tsx
 * 职责：[mycowork] 消息里 deck 相对路径文件链接的宿主：按与 Explorer 完全相同的载荷门打开预览，并带上会话归属给文件卡片标角色。
 * 边界：只负责打开与传参；角色与模板入口由 @mycowork/ui 判定。从 mycowork-slots.tsx 拆出（单文件 ≤ 400 行）。
 */
import React, { useEffect, useRef } from 'react';
import { Message } from '@arco-design/web-react';
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
  fillResultPath,
  ResourceCitationLink,
  TemplateConfirmationAction,
} from '@mycowork/ui';

const renderFillFile = (relativePath: string) => (
  <MyCoworkWorkspaceFileLinkSlot relativePath={relativePath} fixedResult>
    {relativePath.split('/').pop()}
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

/** Open an explicit workspace-relative link with the exact same payload gate as the Explorer. */
export const MyCoworkWorkspaceFileLinkSlot: React.FC<{
  relativePath: string;
  children?: React.ReactNode;
  fixedResult?: boolean;
}> = ({ relativePath, children, fixedResult }) => {
  const projectId = useCurrentProject();
  const conversationId = useCurrentConversation();
  const preview = useOptionalPreviewContext();
  const ownerKey = useOwnerKey();
  const messages = useMessageList();
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
  }, [projectId, conversationId, ownerKey]);
  const { t, i18n } = useTranslation();
  const open = async (): Promise<void> => {
    if (!projectId || !conversationId || !preview) return;
    const openedAt = generation.current;
    const current = () =>
      generation.current === openedAt &&
      getCurrentProject() === projectId &&
      getCurrentConversation() === conversationId;
    try {
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
  const disabled = !projectId || !conversationId || !preview;
  if (!fixedResult && conversationId && messages.some((item) => fillResultPath(item, conversationId) === relativePath))
    return (
      <button
        type='button'
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
      </button>
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
