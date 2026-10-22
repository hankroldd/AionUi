/**
 * 文件：packages/desktop/src/renderer/components/workspace/ReviewSourceSelector.tsx
 * 职责：从本人会话中点选已受理的原始需求，交给固定版本审查作显式对照。
 * 边界：默认不选；只按用户操作分页，正文和来源身份均由 Bridge 冻结校验。
 * 关联：review-loop.md §7c，D329。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { ReviewSourceChoice } from '@mycowork/ui';
import type { IMessageText, TMessage } from '@/common/chat/chatLib';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { loadConversationMessagePage } from '@/renderer/utils/chat/messagePagination';

type Props = {
  ownerKey: string;
  disabled: boolean;
  value: ReviewSourceChoice[];
  onChange: (choices: ReviewSourceChoice[]) => void;
  onPendingChange: (pending: boolean) => void;
};
const MAX_CHOICES = 10; // D329：正文总长由服务器按冻结原文校验，不按消息摘要推算。
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messageId = (message: TMessage): string => message.msg_id ?? message.id;
const summary = (content: string): string => content.replace(/\s+/g, ' ').trim().slice(0, 160);

function candidate(message: TMessage, conversationId: string): message is IMessageText {
  return (
    message.conversation_id === conversationId &&
    message.type === 'text' &&
    message.position === 'right' &&
    message.hidden !== true &&
    (message.status === undefined || message.status === 'finish') &&
    typeof message.content?.content === 'string' &&
    Boolean(message.content.content.trim()) &&
    !message.content.cronMeta &&
    !message.content.teammateMessage &&
    typeof messageId(message) === 'string' &&
    Boolean(messageId(message))
  );
}

/** 只展示用户主动打开的会话页；任何消息均须精确查得本人已受理提交后才能选中。 */
export function ReviewSourceSelector({ ownerKey, disabled, value, onChange, onPendingChange }: Props) {
  const { t } = useTranslation();
  const { conversations } = useConversationHistoryContext();
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<IMessageText[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const lookup = useRef<{ controller: AbortController; notify: (pending: boolean) => void } | null>(null);
  const lifetime = useRef({ ownerKey, active: true });
  const current = useRef({ conversationId, disabled, value, onChange });
  current.current = { conversationId, disabled, value, onChange };
  if (lifetime.current.ownerKey !== ownerKey) {
    lifetime.current.active = false;
    lifetime.current = { ownerKey, active: true };
  }
  const blocked = disabled || !ownerKey;

  useEffect(() => {
    const instance = lifetime.current;
    instance.active = true;
    setConversationId('');
    setMessages([]);
    setResolved({});
    setBefore(null);
    setHasMore(false);
    setLoading(false);
    setLoadFailed(false);
    setPending(null);
    setError('');
    return () => {
      instance.active = false;
      generation.current += 1;
      releaseLookup();
    };
  }, [ownerKey]);
  useEffect(() => {
    if (!blocked) return;
    generation.current += 1;
    releaseLookup();
    setLoading(false);
    setPending(null);
  }, [blocked]);

  function releaseLookup(expected = lookup.current) {
    // 旧请求的 finally 不能清除切换会话后新请求的 pending。
    if (!expected || lookup.current !== expected) return;
    lookup.current = null;
    expected.controller.abort();
    expected.notify(false);
  }

  function requestScope(id: string) {
    const sequence = ++generation.current;
    const instance = lifetime.current;
    return () =>
      instance.active &&
      lifetime.current === instance &&
      generation.current === sequence &&
      current.current.conversationId === id &&
      !current.current.disabled;
  }

  async function load(id: string, cursor?: string) {
    const valid = requestScope(id);
    setLoading(true);
    setLoadFailed(false);
    setError('');
    try {
      const page = await loadConversationMessagePage(id, {
        limit: 50,
        ...(cursor ? { before: cursor } : {}),
        contentMode: 'compact',
      });
      if (!valid()) return;
      const items = page.items.filter((message) => candidate(message, id));
      setMessages((previous) => [
        ...new Map([...items, ...(cursor ? previous : [])].map((item) => [messageId(item), item])).values(),
      ]);
      setBefore(page.oldest_cursor);
      setHasMore(page.has_more_before && Boolean(page.oldest_cursor));
    } catch {
      if (valid()) {
        setLoadFailed(true);
        setError(t('common.reviewSources.loadError'));
      }
    } finally {
      if (valid()) setLoading(false);
    }
  }

  function chooseConversation(id: string) {
    releaseLookup();
    current.current.conversationId = id;
    setConversationId(id);
    setMessages([]);
    setBefore(null);
    setHasMore(false);
    setPending(null);
    void load(id);
  }

  async function chooseMessage(message: IMessageText) {
    const id = messageId(message);
    const known = resolved[`${conversationId}:${id}`];
    if (blocked || lookup.current) return;
    if (known && value.some((choice) => choice.submission_id === known)) {
      onChange(value.filter((choice) => choice.submission_id !== known));
      return;
    }
    if (value.length >= MAX_CHOICES) return;
    const valid = requestScope(conversationId);
    const operation = { controller: new AbortController(), notify: onPendingChange };
    lookup.current = operation;
    operation.notify(true);
    setPending(id);
    setError('');
    try {
      const query = new URLSearchParams({ conversation_id: conversationId, message_id: id });
      const response = await fetch(`/bridge/v1/tasks/lookup?${query}`, {
        credentials: 'same-origin',
        headers: { 'X-MyCowork-Draft-Owner': ownerKey },
        signal: operation.controller.signal,
      });
      if (!valid()) return;
      if (response.status === 404) {
        setError(t('common.reviewSources.unavailable'));
        return;
      }
      if (!response.ok) throw new Error('source_lookup_failed');
      const run: unknown = await response.json();
      if (!valid()) return;
      if (!accepted(run, conversationId, id)) {
        setError(t('common.reviewSources.unavailable'));
        return;
      }
      setResolved((previous) => ({ ...previous, [`${conversationId}:${id}`]: run.submission_id }));
      const latest = current.current;
      if (
        latest.value.length >= MAX_CHOICES ||
        latest.value.some((choice) => choice.submission_id === run.submission_id)
      )
        return;
      latest.onChange([...latest.value, { submission_id: run.submission_id, label: summary(message.content.content) }]);
    } catch {
      if (valid()) setError(t('common.reviewSources.lookupError'));
    } finally {
      if (valid()) setPending(null);
      releaseLookup(operation);
    }
  }

  return (
    <section className='flex flex-col gap-8px' aria-label={t('common.reviewSources.title')}>
      <div className='text-12px text-t-secondary'>{t('common.reviewSources.hint')}</div>
      <Select
        aria-label={t('common.reviewSources.conversation')}
        placeholder={t('common.reviewSources.conversation')}
        disabled={blocked}
        value={conversationId || undefined}
        showSearch
        filterOption={(input, option) =>
          (option.props as { title: string }).title.toLocaleLowerCase().includes(input.toLocaleLowerCase())
        }
        onChange={chooseConversation}
      >
        {conversations.map((conversation) => (
          <Select.Option key={conversation.id} value={conversation.id} title={conversation.name}>
            <div className='flex w-full min-w-0 items-center gap-8px'>
              <span className='min-w-0 flex-1 truncate' title={conversation.name}>
                {conversation.name}
              </span>
              <span className='w-180px shrink-0 whitespace-nowrap text-12px text-t-secondary'>
                {new Date(conversation.modified_at).toLocaleString()}
              </span>
            </div>
          </Select.Option>
        ))}
      </Select>
      {conversations.length === 0 && <div>{t('common.reviewSources.noConversations')}</div>}
      {(loading || Boolean(pending)) && <div role='status'>{t('common.loading')}</div>}
      {error && <div role='alert'>{error}</div>}
      {conversationId && !loading && messages.length === 0 && <div>{t('common.reviewSources.empty')}</div>}
      <div className='flex flex-col gap-8px max-h-240px overflow-y-auto'>
        {messages.map((message) => {
          const id = messageId(message);
          const known = resolved[`${conversationId}:${id}`];
          const checked = value.some((choice) => choice.submission_id === known);
          return (
            <Checkbox
              key={id}
              checked={checked}
              disabled={blocked || loading || Boolean(pending) || (!checked && value.length >= MAX_CHOICES)}
              onChange={() => void chooseMessage(message)}
            >
              <span className='whitespace-pre-wrap break-all'>{message.content.content}</span>
            </Checkbox>
          );
        })}
      </div>
      {(hasMore || loadFailed) && (
        <Button
          disabled={blocked || loading || Boolean(pending)}
          onClick={() => void load(conversationId, before ?? undefined)}
        >
          {loadFailed ? t('common.retry') : t('common.reviewSources.earlier')}
        </Button>
      )}
      {value.length > 0 && (
        <div className='flex flex-col gap-8px'>
          <div>{t('common.reviewSources.selected', { count: value.length })}</div>
          {value.map((choice) => (
            <div key={choice.submission_id} className='flex items-center gap-8px'>
              <span className='min-w-0 flex-1 break-all line-clamp-2' title={choice.label}>
                {choice.label}
              </span>
              <Button
                className='shrink-0'
                disabled={blocked || Boolean(pending)}
                onClick={() => onChange(value.filter((item) => item.submission_id !== choice.submission_id))}
                aria-label={t('common.reviewSources.remove', { label: choice.label })}
              >
                {t('common.delete')}
              </Button>
            </div>
          ))}
          <Button disabled={blocked || Boolean(pending)} onClick={() => onChange([])}>
            {t('common.reviewSources.clear')}
          </Button>
        </div>
      )}
    </section>
  );
}

function accepted(value: unknown, conversationId: string, id: string): value is { submission_id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.submission_id === 'string' &&
    UUID.test(run.submission_id) &&
    run.delivery_phase === 'accepted' &&
    run.conversation_id === conversationId &&
    run.msg_id === id
  );
}
