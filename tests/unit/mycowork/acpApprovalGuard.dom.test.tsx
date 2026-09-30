/**
 * [mycowork] D115：MyCowork 会话（挂了 Bridge MCP）里 Claude Code 等 ACP 批准卡（acp_permission）同样不给“始终允许”：
 * exec 类（kind execute、原生 Claude Code 的 Bash）与 mcp 类（title mcp__<服务>__<工具>）；写工具卡片无论会话都不给；
 * 其余卡片、非 MyCowork 会话不受影响。卡片形状取自 aioncore v0.2.2 session_agent.rs（原生 Claude Code：title = 工具名、无 kind、
 * 选项 allow / allow_always / reject）。只替身外部边界：aioncore（ipcBridge）。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { IMessageAcpPermission } from '@/common/chat/chatLib';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import MessageAcpPermission from '@/renderer/pages/conversation/Messages/acp/MessageAcpPermission';

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));

vi.mock('@/common/adapter/ipcBridge', () => ({ conversation: { confirmMessage: { invoke: confirmMock } } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));

const MYCOWORK = ['mycowork_bridge'];
const OTHER = ['github'];
const inSession = (mcpServers: string[] | undefined, node: React.ReactNode) => (
  <ConversationProvider value={{ conversation_id: 'conv-1', type: 'acp', loadedMcpServers: mcpServers }}>
    {node}
  </ConversationProvider>
);

const card = (title: string, kind?: string): IMessageAcpPermission => ({
  id: `m-${title}`,
  conversation_id: 'conv-1',
  type: 'acp_permission',
  position: 'left',
  content: {
    session_id: 'conv-1',
    tool_call: {
      tool_call_id: `req-${title}`,
      title,
      kind,
      raw_input: { command: 'curl http://127.0.0.1:25900/bridge/mcp' },
    },
    options: [
      { option_id: 'allow', name: 'Allow', kind: 'allow_once' },
      { option_id: 'allow_always', name: 'Always Allow', kind: 'allow_always' },
      { option_id: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  },
});
const optionValues = () =>
  Array.from(document.querySelectorAll('[data-testid^="message-acp-permission-option-"]')).map((el) =>
    el.getAttribute('data-testid')?.replace('message-acp-permission-option-', '')
  );

describe('[mycowork] D115 ACP 批准卡（Claude Code）', () => {
  beforeEach(() => confirmMock.mockReset().mockResolvedValue(undefined));

  it.each([
    ['Bash', undefined],
    ['Run curl', 'execute'],
    ['mcp__mycowork_bridge__search', undefined],
    ['mcp__github__create_issue', undefined],
  ])('MyCowork 会话里 %s（kind %s）只有“允许一次/拒绝”，允许一次照常确认', async (title, kind) => {
    render(inSession(MYCOWORK, <MessageAcpPermission message={card(title, kind)} />));
    expect(optionValues()).toEqual(['allow', 'reject']);
    fireEvent.click(screen.getByTestId('message-acp-permission-option-allow'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0]).toMatchObject({ confirm_key: 'allow', call_id: `req-${title}` });
  });

  it('写工具卡片在取不到会话信息时也不给 allow_always', () => {
    render(<MessageAcpPermission message={card('mcp__mycowork_bridge__office_edit')} />);
    expect(optionValues()).toEqual(['allow', 'reject']);
  });

  it('MyCowork 会话里其他工具（Write、Read）与非 MyCowork 会话的 Bash、MCP 照常给 allow_always', () => {
    const { unmount } = render(inSession(MYCOWORK, <MessageAcpPermission message={card('Write', 'edit')} />));
    expect(optionValues()).toEqual(['allow', 'allow_always', 'reject']);
    unmount();
    const other = render(inSession(OTHER, <MessageAcpPermission message={card('Bash')} />));
    expect(optionValues()).toEqual(['allow', 'allow_always', 'reject']);
    other.unmount();
    render(inSession([], <MessageAcpPermission message={card('mcp__github__create_issue')} />));
    expect(optionValues()).toEqual(['allow', 'allow_always', 'reject']);
  });

  it('[mycowork] A85：取不到会话信息时 Bash 与 MCP 卡片不给 allow_always（与 aionrs 卡片同一判定，宁可多藏）', () => {
    const { unmount } = render(<MessageAcpPermission message={card('Bash')} />);
    expect(optionValues()).toEqual(['allow', 'reject']);
    unmount();
    render(<MessageAcpPermission message={card('mcp__mycowork_bridge__memory_suggest')} />);
    expect(optionValues()).toEqual(['allow', 'reject']);
  });
});
