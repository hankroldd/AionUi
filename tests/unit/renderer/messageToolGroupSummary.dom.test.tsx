import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ipcBridge } from '@/common';
import type {
  IMessageAsk,
  IMessagePermission,
  IMessageToolCall,
  IMessageToolGroup,
  TMessage,
} from '@/common/chat/chatLib';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { MessageListProvider, useUpdateMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import { removePermissionMessage } from '@/renderer/pages/conversation/Messages/usePendingConfirmationsRecovery';

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

const pendingTool: IMessageToolCall = {
  id: 'tool-pending',
  conversation_id: 'conv-1',
  type: 'tool_call',
  content: {
    call_id: 'aionrs-call-1',
    name: 'office_copy_to_workspace',
    status: 'running',
    args: { path: 'draft.pptx' },
  },
};
const pendingPermission: IMessagePermission = {
  id: 'permission-1',
  conversation_id: 'conv-1',
  type: 'permission',
  content: { id: 'call-1', call_id: 'call-1', description: 'Copy file', options: [] },
};

function renderPendingTools(messages: ToolMessage[], confirmations: TMessage[], type: 'aionrs' | 'acp' = 'aionrs') {
  let updateMessages: ReturnType<typeof useUpdateMessageList>;
  const CaptureUpdates: React.FC = () => {
    updateMessages = useUpdateMessageList();
    return null;
  };
  const view = render(
    <ConversationProvider value={{ conversation_id: 'conv-1', type }}>
      <MessageListProvider value={confirmations}>
        <CaptureUpdates />
        <MessageToolGroupSummary messages={messages} />
      </MessageListProvider>
    </ConversationProvider>
  );
  return {
    ...view,
    removeConfirmation: () => act(() => updateMessages((list) => removePermissionMessage(list, { id: 'call-1' }))),
  };
}

describe('pending confirmation activity', () => {
  it('stops the spinner for the matching permission and resumes when the card is removed', () => {
    const view = renderPendingTools([pendingTool], [pendingPermission]);
    expect(screen.getByText('messages.toolActivity.waitingForConfirmation')).toBeVisible();
    expect(view.container.querySelector('.arco-spin')).toBeNull();
    view.removeConfirmation();
    expect(screen.getByText('messages.toolActivity.running')).toBeVisible();
    expect(screen.queryByText('messages.toolActivity.waitingForConfirmation')).toBeNull();
  });

  it('keeps a concurrent executing tool visible while another tool awaits a choice', () => {
    const otherTool: IMessageToolCall = {
      ...pendingTool,
      id: 'tool-2',
      content: { ...pendingTool.content, call_id: 'call-2', name: 'search' },
    };
    const view = renderPendingTools([pendingTool, otherTool], [pendingPermission]);
    expect(screen.getByText('messages.toolActivity.waitingForConfirmation')).toBeVisible();
    expect(screen.getByText('messages.toolActivity.running')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /messages.toolActivity.label/ }));
    expect(view.container.querySelectorAll('.badge-breathing')).toHaveLength(1);
  });

  it('shows a confirming tool group as waiting using its original call id', () => {
    const view = renderPendingTools(
      [
        {
          id: 'group-1',
          conversation_id: 'conv-1',
          type: 'tool_group',
          content: [
            {
              call_id: 'call-1',
              name: 'copy',
              description: '',
              status: 'Confirming',
              render_output_as_markdown: false,
            },
          ],
        },
      ],
      [pendingPermission]
    );
    expect(screen.getByText('messages.toolActivity.waitingForConfirmation')).toBeVisible();
    expect(view.container.querySelector('.arco-spin')).toBeNull();
  });

  it('does not mistake another call or conversation for this tool permission', () => {
    renderPendingTools(
      [pendingTool],
      [
        { ...pendingPermission, conversation_id: 'conv-2' },
        { ...pendingPermission, id: 'permission-2', content: { ...pendingPermission.content, call_id: 'call-2' } },
      ]
    );
    expect(screen.queryByText('messages.toolActivity.waitingForConfirmation')).toBeNull();
    expect(screen.getByText('messages.toolActivity.running')).toBeVisible();
  });

  it('recognizes an unanswered ask by request id without changing terminal statuses', () => {
    const ask: IMessageAsk = {
      id: 'ask-1',
      conversation_id: 'conv-1',
      type: 'ask',
      content: { session_id: 'conv-1', request_id: 'call-1', questions: [] },
    };
    renderPendingTools(
      [
        pendingTool,
        ...(['Success', 'Error', 'Canceled'] as const).map<IMessageToolGroup>((status) => ({
          type: 'tool_group',
          conversation_id: 'conv-1',
          id: status,
          content: [{ call_id: 'call-1', name: 'copy', description: '', status, render_output_as_markdown: false }],
        })),
      ],
      [ask]
    );
    expect(screen.getByText('messages.toolActivity.waitingForConfirmation')).toBeVisible();
    expect(screen.getByText('messages.toolActivity.failed')).toBeVisible();
    expect(screen.getByText('messages.toolActivity.canceled')).toBeVisible();
  });

  it('does not apply the Aionrs id prefix to another platform', () => {
    renderPendingTools([pendingTool], [pendingPermission], 'acp');
    expect(screen.queryByText('messages.toolActivity.waitingForConfirmation')).toBeNull();
    expect(screen.getByText('messages.toolActivity.running')).toBeVisible();
  });
});
