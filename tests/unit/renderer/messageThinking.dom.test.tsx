/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageThinking } from '@/common/chat/chatLib';
import MessageThinking from '@/renderer/pages/conversation/Messages/components/MessageThinking';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

function createThinkingMessage(createdAt: number): IMessageThinking {
  return {
    id: 'thinking-1',
    type: 'thinking',
    msg_id: 'msg-1',
    conversation_id: 'conversation-1',
    position: 'left',
    created_at: createdAt,
    content: {
      content: 'analyzing',
      status: 'thinking',
    },
  };
}

describe('MessageThinking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves elapsed time when the component remounts for an active thinking message', () => {
    vi.setSystemTime(new Date('2026-05-26T09:00:10.000Z'));
    const createdAt = Date.now() - 5_000;

    const { unmount } = render(<MessageThinking message={createThinkingMessage(createdAt)} />);

    expect(screen.getByText('Thinking... · 5s')).toBeInTheDocument();

    unmount();

    vi.setSystemTime(new Date('2026-05-26T09:00:12.000Z'));
    render(<MessageThinking message={createThinkingMessage(createdAt)} />);

    expect(screen.getByText('Thinking... · 7s')).toBeInTheDocument();
  });
});

it('思考默认折叠，键盘可打开完整正文，流式更新和完成不改用户选择', async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  const message = createThinkingMessage(Date.now());
  const { rerender } = render(<MessageThinking message={message} />);
  expect(screen.getByText('analyzing')).not.toBeVisible();
  await user.tab();
  const toggle = screen.getByRole('button', { expanded: false });
  expect(toggle).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByText('analyzing')).toBeVisible();
  rerender(<MessageThinking message={{ ...message, content: { content: '完整思考正文', status: 'thinking' } }} />);
  expect(screen.getByText('完整思考正文')).toBeVisible();
  await user.keyboard(' ');
  rerender(<MessageThinking message={{ ...message, content: { content: '下一段思考正文', status: 'thinking' } }} />);
  expect(screen.getByText('下一段思考正文')).not.toBeVisible();
  await user.keyboard('{Enter}');
  rerender(
    <MessageThinking message={{ ...message, content: { content: '下一段思考正文', status: 'done', duration: 2000 } }} />
  );
  expect(screen.getByText('下一段思考正文')).toBeVisible();
  expect(screen.getByText('Thought complete · 2s')).toBeVisible();
});
