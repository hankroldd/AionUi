/**
 * [mycowork] D302：批准卡把 Bridge 写工具翻成“动作 · 对象 · 影响”，“请求详情”仍是原 JSON，D115 不回退。
 * 只替身外部边界：aioncore（ipcBridge）。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { approvalSummary } from '@mycowork/ui';
import type { IMessagePermission, TMessage } from '@/common/chat/chatLib';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import MessagePermission from '@/renderer/pages/conversation/Messages/components/MessagePermission';
import { MessageListProvider } from '@/renderer/pages/conversation/Messages/hooks';

vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getConversationMessage: { invoke: vi.fn().mockResolvedValue(null) } },
    conversation: { confirmation: { confirm: { invoke: vi.fn() } } },
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));

const card = (tool: string): IMessagePermission => ({
  id: `m-${tool}`,
  msg_id: `db-${tool}`,
  conversation_id: 'conv-1',
  type: 'permission',
  position: 'left',
  content: {
    id: `c-${tool}`,
    title: `mcp wants to use: ${tool}`,
    description: `MCP mycowork_bridge/${tool}: {}`,
    action: tool,
    call_id: `call-${tool}`,
    command_type: 'mcp',
    options: [
      { label: 'Yes, allow once', value: 'proceed_once' },
      { label: 'Yes, allow always', value: 'proceed_always' },
      { label: 'No', value: 'cancel' },
    ],
  },
});
const toolMsg = (tool: string, input: unknown): TMessage =>
  ({
    id: `t-${tool}`,
    conversation_id: 'conv-1',
    type: 'tool_call',
    position: 'left',
    content: { call_id: `call-${tool}`, name: tool, status: 'pending', input },
  }) as unknown as TMessage;
const show = (tool: string, input?: unknown) =>
  render(
    <ConversationProvider value={{ conversation_id: 'conv-1', type: 'aionrs', loadedMcpServers: ['mycowork_bridge'] }}>
      <MessageListProvider value={input === undefined ? [] : [toolMsg(tool, input)]}>
        <MessagePermission message={card(tool)} />
      </MessageListProvider>
    </ConversationProvider>
  );

describe('D302 批准卡摘要', () => {
  it('office_edit 两处替换一处新增：描述含“共 3 处”与影响句', () => {
    show('mcp__mycowork_bridge_office_edit', {
      resource_id: 'r-1',
      base_content_sha256: 'a'.repeat(64),
      edits: [
        { path: '/body/p[1]', text: '甲' },
        { path: '/body/p[2]', text: '乙' },
        { path: '/body', text: '丙', insert: 'end' },
      ],
    });
    const text = (document.body.textContent ?? '').split('messages.requestDetails')[0]; // 摘要部分；其后是“请求详情”JSON
    expect(text).toContain('共 3 处');
    expect(text).toContain('替换 2 处');
    expect(text).toContain('新增段落 1 处');
    expect(text).toContain('旧版本保留可恢复；不会发布到知识库');
    expect(text).not.toContain('r-1');
  });

  it('office_register_output 带文件名', () => {
    show('office_register_output', { relative_path: '输出/周报.docx' });
    expect(document.body.textContent).toContain('周报.docx');
    expect(document.body.textContent).toContain('进入本次对话文件与版本记录');
  });

  it('未知工具保持上游 description；入参缺失或不合法不崩', () => {
    show('create_issue', { a: 1 });
    expect(document.body.textContent).toContain('MCP mycowork_bridge/create_issue: {}');
    document.body.replaceChildren();
    show('office_edit');
    expect(document.body.textContent).toContain('MCP mycowork_bridge/office_edit: {}');
    expect(approvalSummary('office_edit', { edits: [] }, 'zh')).toBeNull();
    expect(approvalSummary('office_edit', { edits: [{ text: 1 }] }, 'zh')).toBeNull();
    expect(approvalSummary('office_edit', null, 'zh')).toBeNull();
  });

  it('长文字只显示前 40 字加省略号', () => {
    const s = approvalSummary('memory_suggest', { kind: 'preference', text: '字'.repeat(500) }, 'zh');
    expect(s?.target).toBe(`「${'字'.repeat(40)}…」（本项目）`);
    expect(approvalSummary('office_edit', { edits: [{ text: '长'.repeat(9000) }] }, 'zh')?.target.length).toBeLessThan(
      90
    );
  });

  it('英文文案；其余三个工具各有摘要', () => {
    expect(approvalSummary('office_fetch_original', { resource_id: 'x' }, 'en')?.impact).toBe('Read-only');
    expect(approvalSummary('office_copy_to_workspace', { relative_path: 'a.docx' }, 'zh')?.impact).toBe(
      '只复制，原件不变'
    );
    expect(approvalSummary('memory_suggest', { kind: 'k', text: 't' }, 'zh')?.impact).toBe('需你接受才生效');
  });

  it('“请求详情”仍能展开看到原 JSON，且仍不给“始终允许”', () => {
    show('office_register_output', { relative_path: '输出/周报.docx' });
    const toggle = document.querySelector(
      '[data-testid="message-permission-detail-toggle"], summary, button[aria-expanded]'
    );
    if (toggle) fireEvent.click(toggle);
    expect(document.body.textContent).toContain('"relative_path": "输出/周报.docx"');
    expect(screen.queryByTestId('message-permission-option-proceed_always')).toBeNull();
  });
});
