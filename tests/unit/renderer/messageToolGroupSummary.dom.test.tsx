import React from 'react';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getConversationMessage: {
        invoke: vi.fn(),
      },
    },
  },
}));

describe('MessageToolGroupSummary', () => {
  it('loads full tool content when expanding a compact history item', async () => {
    const invoke = vi.mocked(ipcBridge.database.getConversationMessage.invoke);
    invoke.mockResolvedValue({
      id: 'message-1',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-1',
          status: 'completed',
          title: 'rg',
          kind: 'search',
          raw_input: { pattern: 'needle', path: '.' },
          content: [{ type: 'content', content: { type: 'text', text: 'full output' } }],
        },
      },
    } as unknown as TMessage);

    render(
      <MessageToolGroupSummary
        messages={[
          {
            id: 'message-1',
            conversation_id: 'conversation-1',
            type: 'acp_tool_call',
            content: {
              _compact: {
                truncated: true,
                original_size: 90000,
                preview_chars: 4096,
              },
              update: {
                session_update: 'tool_call',
                tool_call_id: 'tool-1',
                status: 'completed',
                title: 'rg',
                kind: 'search',
                raw_input: { pattern: 'needle', path: '.' },
                content: [{ type: 'content', content: { type: 'text', text: 'preview' } }],
              },
            },
          } as unknown as ToolMessage,
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /messages.toolActivity.label/ }));
    fireEvent.click(screen.getByText('rg'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith({
        conversation_id: 'conversation-1',
        message_id: 'message-1',
      });
    });
    expect(await screen.findByText('full output')).toBeInTheDocument();
  });
});

it('工具默认折叠，运行和错误可见，键盘可查看真实参数，后续运行不强制展开', async () => {
  const user = userEvent.setup();
  const message: ToolMessage = {
    id: 'tool-a',
    type: 'tool_call',
    conversation_id: 'conv-1',
    content: {
      call_id: 'call-a',
      name: 'office_copy_to_workspace',
      status: 'running',
      args: { target_relative_path: 'deck/a/模板.pptx' },
    },
  };
  const { rerender } = render(<MessageToolGroupSummary messages={[message]} />);
  expect(screen.getByText('messages.toolActivity.running')).toBeVisible();
  expect(screen.queryByText('messages.toolNames.office_copy_to_workspace')).not.toBeInTheDocument();
  await user.tab();
  expect(screen.getByRole('button', { expanded: false })).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.tab();
  expect(screen.getByRole('button', { name: /messages.toolNames.office_copy_to_workspace/ })).toHaveFocus();
  await user.keyboard(' ');
  expect(screen.getByText(/target_relative_path/)).toBeVisible();
  expect(screen.getByText(/deck\/a\/模板.pptx/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: /messages.toolActivity.label/ }));
  const failed: ToolMessage = { ...message, content: { ...message.content, status: 'error', output: 'write refused' } };
  rerender(<MessageToolGroupSummary messages={[failed]} />);
  expect(screen.getByText('messages.toolActivity.failed')).toBeVisible();
  expect(screen.queryByText(/target_relative_path/)).not.toBeInTheDocument();
  rerender(
    <MessageToolGroupSummary
      messages={[failed, { ...message, id: 'tool-b', content: { ...message.content, call_id: 'call-b' } }]}
    />
  );
  expect(screen.getByText('messages.toolActivity.running')).toBeVisible();
  expect(screen.getByRole('button', { name: /messages.toolActivity.label/ })).toHaveAttribute('aria-expanded', 'false');
});
