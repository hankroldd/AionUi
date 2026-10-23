/**
 * 文件：tests/unit/mycowork/review-source-picker.dom.test.tsx
 * 职责：核查原话点选的精确身份、有界分页和迟到响应隔离。
 * 边界：只模拟公开消息与 Bridge HTTP；不调用模型、服务或真实资料。
 * 关联：review-loop.md §7c，D329。
 */
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { ReviewSourceChoice } from '@mycowork/ui';
import { ReviewSourceSelector } from '@/renderer/components/workspace/ReviewSourceSelector';
import zhCommon from '@/renderer/services/i18n/locales/zh-CN/common.json';

const api = vi.hoisted(() => ({
  page: vi.fn(),
  fetch: vi.fn(),
  changed: vi.fn(),
  pending: vi.fn(),
  conversations: [] as { id: string; name: string; modified_at: number }[],
}));
vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({ conversations: api.conversations }),
}));
vi.mock('@/renderer/utils/chat/messagePagination', () => ({ loadConversationMessagePage: api.page }));

const i18n = createInstance();
const submission = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const message = (id = 'message-a', conversationId = 'conversation-a', content = '虚构会议原始事实') => ({
  id: `row-${id}`,
  msg_id: id,
  conversation_id: conversationId,
  type: 'text',
  position: 'right',
  status: 'finish',
  content: { content },
});
const page = (items = [message()], more = false) => ({
  items,
  oldest_cursor: more ? 'opaque-before' : null,
  newest_cursor: 'opaque-after',
  has_more_before: more,
  has_more_after: false,
});
const accepted = (overrides = {}) => ({
  submission_id: submission(),
  delivery_phase: 'accepted',
  conversation_id: 'conversation-a',
  msg_id: 'message-a',
  ...overrides,
});
const response = (body: unknown = accepted(), status = 200) => new Response(JSON.stringify(body), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Screen({
  ownerKey = 'fixture-owner',
  disabled = false,
  initial = [],
}: {
  ownerKey?: string;
  disabled?: boolean;
  initial?: ReviewSourceChoice[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <I18nextProvider i18n={i18n}>
      <ReviewSourceSelector
        ownerKey={ownerKey}
        disabled={disabled}
        value={value}
        onPendingChange={api.pending}
        onChange={(choices) => {
          api.changed(choices);
          setValue(choices);
        }}
      />
    </I18nextProvider>
  );
}
async function chooseConversation(name = '虚构甲会话') {
  await act(async () => {
    fireEvent.click(screen.getByRole('combobox', { name: '选择会话' }));
  });
  const option = await screen.findByRole('option', { name: new RegExp(name) });
  await act(async () => {
    fireEvent.click(option);
  });
}
async function chooseMessage(content = '虚构会议原始事实') {
  const checkbox = await screen.findByRole('checkbox', { name: content });
  await act(async () => {
    fireEvent.click(checkbox);
  });
}
beforeAll(async () => {
  await i18n.init({
    lng: 'zh-CN',
    resources: { 'zh-CN': { translation: { common: zhCommon } } },
    interpolation: { escapeValue: false },
  });
});
beforeEach(() => {
  vi.clearAllMocks();
  api.conversations = [
    { id: 'conversation-a', name: '虚构甲会话', modified_at: 1 },
    { id: 'conversation-b', name: '虚构乙会话', modified_at: 2 },
  ];
  vi.stubGlobal('fetch', api.fetch);
  api.page.mockResolvedValue(page());
  api.fetch.mockResolvedValue(response());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('starts empty and reads nothing until the user chooses a conversation', () => {
  render(<Screen />);
  expect(api.page).not.toHaveBeenCalled();
  expect(api.fetch).not.toHaveBeenCalled();
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
});

it('keeps distinct dates beside identical long names and searches by the displayed name', async () => {
  const name = '虚构完整结构专利稿会话名称'.repeat(8);
  api.conversations = [
    { id: 'conversation-a', name, modified_at: Date.parse('2026-10-22T23:41:00+08:00') },
    { id: 'conversation-b', name, modified_at: Date.parse('2026-10-22T23:26:00+08:00') },
  ];
  render(<Screen />);
  const select = screen.getByRole('combobox', { name: '选择会话' });
  fireEvent.click(select);
  const options = await screen.findAllByRole('option');
  expect(options).toHaveLength(2);
  for (const [index, option] of options.entries()) {
    const title = within(option).getByText(name, { exact: true });
    expect(title).toHaveClass('truncate');
    expect(title).toHaveAttribute('title', name);
    const date = within(option).getByText(new Date(api.conversations[index]!.modified_at).toLocaleString());
    expect(date).toHaveClass('w-180px', 'shrink-0', 'whitespace-nowrap');
  }
  const input = select.querySelector('input');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { value: '完整结构专利稿' } });
  expect(await screen.findAllByRole('option')).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('option')[1]!);
  await waitFor(() => expect(api.page).toHaveBeenCalledWith('conversation-b', { limit: 50, contentMode: 'compact' }));
});

it('looks up the logical message identity with the owner header and a same-origin cookie before adding it', async () => {
  render(<Screen />);
  await chooseConversation();
  await chooseMessage();
  await waitFor(() =>
    expect(api.changed).toHaveBeenCalledWith([{ submission_id: submission(), label: '虚构会议原始事实' }])
  );
  expect(api.fetch).toHaveBeenCalledWith(
    '/bridge/v1/tasks/lookup?conversation_id=conversation-a&message_id=message-a',
    {
      credentials: 'same-origin',
      headers: { 'X-MyCowork-Draft-Owner': 'fixture-owner' },
      signal: expect.any(AbortSignal),
    }
  );
  expect(screen.getByRole('checkbox', { name: '虚构会议原始事实' })).toBeChecked();
  expect(screen.getByTitle('虚构会议原始事实')).toHaveClass('line-clamp-2');
});

it('only shows visible user text and loads one older cursor page after an explicit click', async () => {
  api.page
    .mockResolvedValueOnce(
      page(
        [
          message(),
          { ...message('assistant'), position: 'left' },
          { ...message('hidden'), hidden: true },
          message('other-conversation', 'conversation-b'),
          { ...message('scheduled'), content: { content: '定时输入', cronMeta: { source: 'cron' } } },
        ] as ReturnType<typeof message>[],
        true
      )
    )
    .mockResolvedValueOnce(page([message('old', 'conversation-a', '更早的虚构原话')]));
  render(<Screen />);
  await chooseConversation();
  expect(await screen.findAllByRole('checkbox')).toHaveLength(1);
  expect(api.page).toHaveBeenCalledExactlyOnceWith('conversation-a', { limit: 50, contentMode: 'compact' });
  fireEvent.click(screen.getByRole('button', { name: '加载更早消息' }));
  expect(await screen.findByRole('checkbox', { name: '更早的虚构原话' })).toBeVisible();
  expect(api.page).toHaveBeenLastCalledWith('conversation-a', {
    limit: 50,
    before: 'opaque-before',
    contentMode: 'compact',
  });
});

it.each([
  ['no unique match', () => response({}, 404)],
  ['not accepted', () => response(accepted({ delivery_phase: 'unknown' }))],
  ['wrong conversation', () => response(accepted({ conversation_id: 'conversation-b' }))],
  ['wrong message', () => response(accepted({ msg_id: 'other-message' }))],
  ['invalid submission identity', () => response(accepted({ submission_id: 'not-a-uuid' }))],
])('does not select a message with %s', async (_name, reply) => {
  api.fetch.mockResolvedValue(reply());
  render(<Screen />);
  await chooseConversation();
  await chooseMessage();
  expect(await screen.findByRole('alert')).toHaveTextContent('这条消息没有唯一的已受理办公提交');
  expect(api.changed).not.toHaveBeenCalled();
});

it('offers a human error when lookup fails without exposing server details', async () => {
  api.fetch.mockRejectedValue(new Error('fixture-private-details'));
  render(<Screen />);
  await chooseConversation();
  await chooseMessage();
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法确认这条需求');
  expect(screen.queryByText('fixture-private-details')).not.toBeInTheDocument();
});

it('can retry a failed message page without reading other conversations', async () => {
  api.page.mockRejectedValueOnce(new Error('fixture-private-details')).mockResolvedValueOnce(page());
  render(<Screen />);
  await chooseConversation();
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取消息');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('checkbox', { name: '虚构会议原始事实' })).toBeVisible();
  expect(api.page).toHaveBeenCalledTimes(2);
});

it('allows ten choices, disables an eleventh, and can remove or clear saved summaries', async () => {
  api.page.mockResolvedValue(page([message(), message('eleventh', 'conversation-a', '第十一条候选')]));
  const initial = Array.from({ length: 9 }, (_, i) => ({
    submission_id: submission(i + 2),
    label: `已选原话${i + 1}`,
  }));
  render(<Screen initial={initial} />);
  await chooseConversation();
  await chooseMessage();
  await waitFor(() => expect(screen.getByText('已选 10 / 10 条')).toBeVisible());
  expect(api.changed.mock.lastCall?.[0]).toHaveLength(10);
  expect(screen.getByRole('checkbox', { name: '第十一条候选' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '移除：已选原话1' }));
  expect(screen.getByText('已选 9 / 10 条')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '清空已选需求' }));
  expect(screen.queryByText(/已选 \d+ \/ 10 条/)).not.toBeInTheDocument();
});

it('keeps a late message page from the old conversation out of the new conversation', async () => {
  const late = deferred<ReturnType<typeof page>>();
  api.page
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(page([message('b', 'conversation-b', '乙会话原话')]));
  render(<Screen />);
  await chooseConversation();
  await chooseConversation('虚构乙会话');
  expect(await screen.findByRole('checkbox', { name: '乙会话原话' })).toBeVisible();
  await act(async () => {
    late.resolve(page());
  });
  expect(screen.queryByRole('checkbox', { name: '虚构会议原始事实' })).not.toBeInTheDocument();
});

it('reports lookup pending synchronously and releases completion or unmount without stale clears', async () => {
  const old = deferred<Response>();
  const next = deferred<Response>();
  const last = deferred<Response>();
  api.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise).mockReturnValueOnce(last.promise);
  api.page.mockImplementation((id: string) =>
    Promise.resolve(page([message(id === 'conversation-a' ? 'message-a' : 'message-b', id, id)]))
  );
  const view = render(<Screen />);
  await chooseConversation();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'conversation-a' }));
  expect(api.pending).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('status')).toBeVisible();
  await chooseConversation('虚构乙会话');
  expect(api.pending).toHaveBeenLastCalledWith(false);
  await chooseMessage('conversation-b');
  expect(api.pending).toHaveBeenLastCalledWith(true);
  const calls = api.pending.mock.calls.length;
  await act(async () => {
    old.resolve(response());
  });
  expect(api.pending).toHaveBeenCalledTimes(calls);
  await act(async () => {
    next.resolve(response(accepted({ conversation_id: 'conversation-b', msg_id: 'message-b' })));
  });
  expect(api.pending).toHaveBeenLastCalledWith(false);
  await chooseConversation();
  await chooseMessage('conversation-a');
  expect(api.pending).toHaveBeenLastCalledWith(true);
  view.unmount();
  expect(api.pending).toHaveBeenLastCalledWith(false);
  const finished = api.pending.mock.calls.length;
  await act(async () => {
    last.resolve(response());
  });
  expect(api.pending).toHaveBeenCalledTimes(finished);
});

it.each(['conversation', 'owner', 'disabled', 'unmount'])(
  'ignores a late accepted lookup after %s changes',
  async (change) => {
    const late = deferred<Response>();
    api.fetch.mockReturnValue(late.promise);
    const view = render(<Screen />);
    await chooseConversation();
    await chooseMessage();
    if (change === 'conversation') await chooseConversation('虚构乙会话');
    if (change === 'owner') view.rerender(<Screen ownerKey='other-owner' />);
    if (change === 'disabled') view.rerender(<Screen disabled />);
    if (change === 'unmount') view.unmount();
    await act(async () => {
      late.resolve(response());
    });
    expect(api.changed).not.toHaveBeenCalled();
  }
);
