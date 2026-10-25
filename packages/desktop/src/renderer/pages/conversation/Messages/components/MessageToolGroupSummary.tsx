/**
 * 文件：Messages/components/MessageToolGroupSummary.tsx
 * 职责：默认折叠工具详情，保留真实运行状态、参数与结果。
 */
import type { BadgeProps } from '@arco-design/web-react';
import { Badge, Button, Message, Spin, Tooltip } from '@arco-design/web-react';
import { IconDown, IconRight } from '@arco-design/web-react/icon';
import { Checklist, Download, Right } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { getAcpImageFileName } from '@/common/chat/acpToolCallOutput';
import type { NormalizedToolCall, NormalizedToolStatus, ToolMessage } from '@/common/chat/normalizeToolCall';
import { normalizeToolMessages } from '@/common/chat/normalizeToolCall';
import LocalImageView from '@/renderer/components/media/LocalImageView';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { downloadFileFromPath } from '@/renderer/utils/file/download';
import { MyCoworkCitedRevisionSlot } from '@/renderer/mycowork-cited-revision'; // [mycowork] R014
import { MyCoworkFillResultFileSlot } from '@/renderer/mycowork-file-link'; // [mycowork] R032
import { toolDisplayNameKey } from './toolDisplayName';
import { useMessageList } from '../hooks';
import './MessageToolGroupSummary.css';

const statusToBadge = (status: NormalizedToolStatus): BadgeProps['status'] => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    case 'running':
      return 'processing';
    case 'canceled':
      return 'default';
    case 'pending':
    default:
      return 'default';
  }
};

const ToolItemDetail: React.FC<{ item: NormalizedToolCall; waitingForConfirmation?: boolean }> = ({
  item,
  waitingForConfirmation,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [fullItem, setFullItem] = useState<NormalizedToolCall | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const displayItem = fullItem ?? item;
  const displayNameKey = toolDisplayNameKey(displayItem.name);
  const hasDetail = displayItem.input || displayItem.output || item.truncated || item.imagePath;
  const [messageApi, messageContext] = Message.useMessage();
  const handleDownloadImage = useCallback(
    async (path: string) => {
      try {
        await downloadFileFromPath(path, getAcpImageFileName(path));
        messageApi.success(t('acp.image.download_success'));
      } catch (error) {
        console.error('[MessageToolGroupSummary] Failed to download image:', error);
        messageApi.error(t('acp.image.download_error'));
      }
    },
    [messageApi, t]
  );

  const loadFullItem = async () => {
    if (!item.truncated || fullItem || loadingFull || !item.conversationId || !item.messageId) return;
    setLoadingFull(true);
    setLoadError(false);
    try {
      const message = await ipcBridge.database.getConversationMessage.invoke({
        conversation_id: item.conversationId,
        message_id: item.messageId,
      });
      const next = normalizeToolMessages([message as ToolMessage]).find((candidate) => candidate.key === item.key);
      if (next) setFullItem(next);
    } catch {
      setLoadError(true);
    } finally {
      setLoadingFull(false);
    }
  };

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) void loadFullItem();
  };

  return (
    <div className='flex flex-col'>
      {messageContext}
      <div className='flex flex-row color-#86909C gap-12px items-center'>
        <Badge
          status={waitingForConfirmation ? 'default' : statusToBadge(item.status)}
          className={item.status === 'running' && !waitingForConfirmation ? 'badge-breathing' : ''}
        />
        <Button
          type='text'
          htmlType='button'
          className='!h-auto !p-0 !flex flex-1 min-w-0 !text-t-secondary'
          style={{ textAlign: 'start', background: 'transparent', justifyContent: 'space-between' }}
          aria-expanded={hasDetail ? expanded : undefined}
          disabled={!hasDetail}
          onClick={toggleExpanded}
        >
          <span className={'flex-1 min-w-0' + (expanded ? ' break-all' : ' truncate')}>
            <span className='font-medium text-13px'>{displayNameKey ? t(displayNameKey) : displayItem.name}</span>
            {displayItem.description && displayItem.description !== displayItem.name && (
              <span className='m-l-4px opacity-80 text-13px'>{displayItem.description}</span>
            )}
          </span>
          {hasDetail && (expanded ? <IconDown style={{ fontSize: 12 }} /> : <IconRight style={{ fontSize: 12 }} />)}
        </Button>
        {waitingForConfirmation && (
          <span className='text-12px text-t-secondary'>{t('messages.toolActivity.waitingForConfirmation')}</span>
        )}
        <MyCoworkCitedRevisionSlot name={displayItem.name} output={displayItem.output} />
      </div>
      {expanded && hasDetail && (
        <div className='tool-detail-panel m-l-20px m-t-4px'>
          <div className='tool-detail-label'>{displayItem.name}</div>
          {loadingFull && <div className='tool-detail-label'>{t('messages.toolDetail.loading')}</div>}
          {loadError && (
            <div role='alert' className='tool-detail-label'>
              {t('messages.toolDetail.loadFailed')}
            </div>
          )}
          {displayItem.input && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>{t('messages.toolDetail.input')}</div>
              <pre className='tool-detail-content'>{displayItem.input}</pre>
            </div>
          )}
          {displayItem.output && (
            <div className='tool-detail-section'>
              <div className='tool-detail-label'>{t('messages.toolDetail.output')}</div>
              <pre className='tool-detail-content'>{displayItem.output}</pre>
            </div>
          )}
        </div>
      )}
      {item.imagePath && (
        <div className='group relative m-l-20px m-t-8px overflow-hidden rounded border bg-1 p-2 max-w-280px'>
          <LocalImageView
            src={item.imagePath}
            alt={getAcpImageFileName(item.imagePath)}
            className='max-w-full max-h-320px object-contain rounded'
          />
          <Tooltip content={t('acp.image.download')}>
            <Button
              aria-label={t('acp.image.download_aria')}
              className='!absolute end-10px top-10px !h-28px !w-28px !p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-90 focus:opacity-100'
              type='secondary'
              size='mini'
              shape='circle'
              icon={<Download theme='outline' size='14' />}
              onClick={() => void handleDownloadImage(item.imagePath)}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
};

const MessageToolGroupSummary: React.FC<{ messages: ToolMessage[] }> = ({ messages }) => {
  const { t } = useTranslation();
  const list = useMessageList();
  const conversation = useConversationContextSafe();
  const [showMore, setShowMore] = useState(false);
  const confirmations = useMemo(
    () => list.filter((message) => message.type === 'permission' || message.type === 'ask'),
    [list]
  );
  const tools = useMemo(
    () =>
      messages.flatMap((message) =>
        normalizeToolMessages([message]).map((item) => ({
          ...item,
          waitingForConfirmation:
            (item.status === 'running' || item.status === 'pending') &&
            confirmations.some((confirmation) => {
              if (
                confirmation.conversation_id !== message.conversation_id ||
                message.conversation_id !== conversation?.conversation_id
              )
                return false;
              const callId =
                confirmation.type === 'permission' ? confirmation.content?.call_id : confirmation.content?.request_id;
              return (
                Boolean(callId) &&
                (item.key === callId || (conversation?.type === 'aionrs' && item.key === `aionrs-${callId}`))
              );
            }),
        }))
      ),
    [messages, confirmations, conversation?.conversation_id, conversation?.type]
  );
  const hasRunning = tools.some((item) => item.status === 'running' && !item.waitingForConfirmation);
  const hasConfirmation = tools.some((item) => item.waitingForConfirmation);
  const hasError = tools.some((item) => item.status === 'error');
  const hasCanceled = tools.some((item) => item.status === 'canceled');
  const hasPending = tools.some((item) => item.status === 'pending' && !item.waitingForConfirmation);

  return (
    <div className='tool-group-summary'>
      <Button
        type='text'
        htmlType='button'
        className='tool-group-summary__header'
        style={{ height: 'auto', padding: '4px 0', background: 'transparent' }}
        aria-expanded={showMore}
        onClick={() => setShowMore((previous) => !previous)}
      >
        <span className='tool-group-summary__icon'>
          {hasRunning ? <Spin size={12} /> : <Checklist theme='outline' size='14' />}
        </span>
        <span className='tool-group-summary__label'>
          {t('messages.toolActivity.label')} {tools.length > 0 ? `· ${tools.length}` : ''}
        </span>
        {hasRunning && <span>{t('messages.toolActivity.running')}</span>}
        {hasConfirmation && (
          <span title={t('messages.toolActivity.confirmationHint')}>
            {t('messages.toolActivity.waitingForConfirmation')}
          </span>
        )}
        {hasError && <span className='text-danger'>{t('messages.toolActivity.failed')}</span>}
        {hasCanceled && <span>{t('messages.toolActivity.canceled')}</span>}
        {!hasRunning && hasPending && <span>{t('messages.toolActivity.pending')}</span>}
        <span className={`tool-group-summary__arrow${showMore ? ' tool-group-summary__arrow--open' : ''}`}>
          <Right theme='outline' size='12' />
        </span>
      </Button>
      {messages.map((message) => (
        <MyCoworkFillResultFileSlot key={message.id} message={message} />
      ))}
      {showMore && (
        <div className='tool-group-summary__body'>
          {tools.map((item) => (
            <ToolItemDetail key={item.key} item={item} waitingForConfirmation={item.waitingForConfirmation} />
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageToolGroupSummary);
