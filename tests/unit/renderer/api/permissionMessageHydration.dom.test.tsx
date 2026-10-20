/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessagePermission, IMessageToolCall, TMessage } from '@/common/chat/chatLib';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { MessageListProvider } from '@/renderer/pages/conversation/Messages/hooks';
import MessagePermission from '@/renderer/pages/conversation/Messages/components/MessagePermission';

const { getMessage, confirm } = vi.hoisted(() => ({
  getMessage: vi.fn<() => Promise<TMessage>>(),
  confirm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getConversationMessage: { invoke: getMessage } },
    conversation: { confirmation: { confirm: { invoke: confirm } } },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const permission = (conversationId = 'conversation-1', callId = 'call-1'): IMessagePermission => ({
  id: `permission-${conversationId}-${callId}`,
  conversation_id: conversationId,
  type: 'permission',
  content: {
    id: callId,
    call_id: callId,
    action: 'office_register_output',
    command_type: 'mcp',
    description: 'Execute: truncated description is not tool input',
    options: [
      { label: 'Allow once', value: 'proceed_once' },
      { label: 'Cancel', value: 'cancel' },
    ],
  },
});

const tool = (message = permission()): IMessageToolCall => ({
  id: `aionrs-${message.content.call_id}`,
  conversation_id: message.conversation_id,
  type: 'tool_call',
  content: {
    call_id: `aionrs-${message.content.call_id}`,
    name: 'office_register_output',
    args: { relative_path: 'deck/fictional.pptx', title: 'Fictional invitation', purpose: 'working' },
  },
});

const Card = ({ message, tools = [] }: { message: IMessagePermission; tools?: TMessage[] }) => (
  <ConversationProvider value={{ conversation_id: message.conversation_id, type: 'aionrs' }}>
    <MessageListProvider value={tools}>
      <MessagePermission message={message} />
    </MessageListProvider>
  </ConversationProvider>
);

const deferredMessage = () => {
  let resolve!: (message: TMessage) => void;
  const promise = new Promise<TMessage>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  getMessage.mockReset().mockImplementation(() => new Promise(() => {}));
  confirm.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe('permission full message hydration', () => {
  it('automatically loads persisted input when the tool row is missing from the stream', async () => {
    const pending = deferredMessage();
    getMessage.mockReturnValueOnce(pending.promise);
    render(<Card message={permission()} />);
    expect(getMessage).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      message_id: 'aionrs-call-1',
    });

    await act(async () => pending.resolve(tool()));
    expect(screen.getByText(/deck\/fictional.pptx/)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('loads full input when the current tool row only contains metadata', async () => {
    const full = tool();
    full.content.input = full.content.args;
    full.content.args = {};
    getMessage.mockResolvedValueOnce(full);
    render(<Card message={permission()} tools={[{ ...tool(), content: { ...tool().content, args: {} } }]} />);

    expect(await screen.findByText(/deck\/fictional.pptx/)).toBeInTheDocument();
    expect(getMessage).toHaveBeenCalledWith({ conversation_id: 'conversation-1', message_id: 'aionrs-call-1' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('uses complete existing arguments without fetching, even when input is an empty object', () => {
    const full = tool();
    full.content.input = {};
    render(<Card message={permission()} tools={[full]} />);

    expect(screen.getByText(/deck\/fictional.pptx/)).toBeInTheDocument();
    expect(getMessage).not.toHaveBeenCalled();
  });

  it.each(['conversation', 'type', 'call', 'message id'] as const)(
    'rejects a persisted response with the wrong %s',
    async (mismatch) => {
      let candidate: TMessage = tool();
      if (mismatch === 'conversation') candidate.conversation_id = 'another-conversation';
      if (mismatch === 'type') candidate = { ...candidate, type: 'text', content: { content: 'Unrelated text' } };
      if (mismatch === 'call' && candidate.type === 'tool_call') candidate.content.call_id = 'aionrs-another-call';
      if (mismatch === 'message id') candidate.id = 'another-message';
      getMessage.mockResolvedValueOnce(candidate);
      render(<Card message={permission()} />);
      await act(async () => {});

      expect(screen.getByText(/完整工具参数不可用/)).toBeInTheDocument();
      expect(screen.queryByText(/deck\/fictional.pptx|Unrelated text/)).toBeNull();
      expect(confirm).not.toHaveBeenCalled();
    }
  );

  it.each(['conversation', 'call'] as const)('ignores a late result after the %s changes', async (changed) => {
    const first = deferredMessage();
    const second = deferredMessage();
    getMessage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldPermission = permission();
    const nextPermission =
      changed === 'conversation' ? permission('conversation-2') : permission('conversation-1', 'call-2');
    const oldTool = tool(oldPermission);
    oldTool.content.args = { command: 'OLD parameters' };
    const nextTool = tool(nextPermission);
    nextTool.content.args = { command: 'NEW parameters' };
    const { rerender } = render(<Card message={oldPermission} />);
    rerender(<Card message={nextPermission} />);

    await act(async () => first.resolve(oldTool));
    expect(screen.queryByText(/OLD parameters/)).toBeNull();
    expect(screen.getByText(/完整工具参数不可用/)).toBeInTheDocument();
    await act(async () => second.resolve(nextTool));
    expect(screen.getByText(/NEW parameters/)).toBeInTheDocument();
  });

  it('hides already hydrated input immediately when a new permission card replaces the old one', async () => {
    const first = deferredMessage();
    const second = deferredMessage();
    getMessage.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const message = permission();
    const { rerender } = render(<Card message={message} />);
    await act(async () => first.resolve(tool()));
    expect(screen.getByText(/deck\/fictional.pptx/)).toBeInTheDocument();

    rerender(<Card message={{ ...message, id: 'new-permission-card' }} />);
    expect(screen.queryByText(/deck\/fictional.pptx/)).toBeNull();
    expect(screen.getByText(/完整工具参数不可用/)).toBeInTheDocument();
  });

  it('keeps the unavailable detail on read failure and logs no command or response body', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getMessage.mockRejectedValueOnce(new Error('Private response body'));
    render(<Card message={permission()} />);
    await act(async () => {});

    expect(screen.getByText(/完整工具参数不可用/)).toBeInTheDocument();
    expect(warning).toHaveBeenCalledWith('[MessagePermission] Failed to load tool input', {
      conversation_id: 'conversation-1',
      message_id: 'aionrs-call-1',
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(['proceed_once', 'cancel'])('preserves the %s approval payload after hydration', async (value) => {
    getMessage.mockResolvedValueOnce(tool());
    const message = permission();
    message.msg_id = 'turn-message';
    render(<Card message={message} />);
    await screen.findByText(/deck\/fictional.pptx/);
    fireEvent.click(screen.getByTestId(`message-permission-option-${value}`));

    expect(confirm).toHaveBeenCalledWith({
      conversation_id: message.conversation_id,
      call_id: message.content.call_id,
      msg_id: 'turn-message',
      data: { value },
      always_allow: false,
    });
    expect(await screen.findByTestId('message-permission-status')).toBeInTheDocument();
  });
});
