/**
 * 文件：tests/unit/mycowork/fillResultCard.dom.test.tsx
 * 职责：持久填充结果在折叠工具摘要外显示原生文件卡，并沿原预览与待确认清单回看。
 * 边界：仅替换 HTTP、IPC 和预览承载；摘要、文件卡、登记解析与 Explorer 载荷门走真实实现。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolMessage } from '@/common/chat/normalizeToolCall';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import { MyCoworkWorkspaceFileLinkSlot } from '@/renderer/mycowork-file-link';
import {
  setCurrentProject,
  resetCurrentProjectForTest,
} from '@/renderer/pages/conversation/explorer/currentProjectStore';
import {
  setCurrentConversation,
  resetCurrentConversationForTest,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  getMessage: vi.fn(),
  project: vi.fn(),
  metadata: vi.fn(),
  readContent: vi.fn(),
  preview: vi.fn(),
  owner: { current: 'owner-a' as string | undefined },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: h.owner.current ? 'authenticated' : 'unauthenticated', user: { id: h.owner.current } }),
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => ({ openPreview: h.preview }),
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({ usePreviewContext: () => ({ openPreview: h.preview }) }));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));
vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getConversationMessage: { invoke: h.getMessage } },
    project: { get: { invoke: h.project } },
    fs: { getContentMetadata: { invoke: h.metadata }, readContent: { invoke: h.readContent } },
  },
}));

const path = 'deck/c1/青禾建设决策.pptx';
const name = '青禾建设决策.pptx';
const pending = [
  { field: 'items[2].step[3]', slide: 6, item: '2', category: 'missing', reason: '代价没有依据，已写待确认' },
];
const output = { output_id: 'out_result', resource_id: 'res_result', relative_path: path };
const message = (body: unknown = output, content: Record<string, unknown> = {}): ToolMessage =>
  ({
    id: 'fill-message',
    conversation_id: 'c1',
    type: 'tool_call',
    content: {
      call_id: 'fill-call',
      name: 'office_fill_template',
      status: 'completed',
      output: JSON.stringify(body),
      ...content,
    },
  }) as ToolMessage;
const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  resetCurrentProjectForTest();
  resetCurrentConversationForTest();
  setCurrentProject('p1');
  setCurrentConversation('c1');
  h.owner.current = 'owner-a';
  h.fetch.mockReset().mockResolvedValue(reply({ resource_id: 'res_result', pending_confirmations: pending }));
  h.getMessage.mockReset().mockResolvedValue(message());
  h.project.mockReset().mockResolvedValue({ project_id: 'p1', explorer: { workspace_pe_id: 'pe1' } });
  h.metadata.mockReset().mockResolvedValue({ name, type: 'file', size: 1024, lastModified: 1700000000000 });
  h.readContent.mockReset();
  h.preview.mockReset();
  vi.stubGlobal('fetch', h.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('持久填充结果的固定成品入口', () => {
  it('没有任何模型 Markdown，工具折叠时仍显示成品与原样清单，点击走原 Explorer 预览', async () => {
    render(
      <MessageToolGroupSummary
        messages={[message(output, { output: JSON.stringify(output) + '\n【人工修改提示】已保存新版本' })]}
      />
    );
    const card = await screen.findByRole('button', { name });
    expect(screen.getByRole('button', { name: /messages.toolActivity.label/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(await screen.findByText('交付文件')).toBeVisible();
    const pendingToggle = screen.getByRole('button', { name: /待你确认（1 条）/ });
    expect(pendingToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(pendingToggle);
    expect(screen.getByText('第 6 页 · 子项 2：代价没有依据，已写待确认')).toBeVisible();
    expect(String(h.fetch.mock.calls[0]?.[0])).toBe(
      `/bridge/v1/conversations/c1/output-resource?relative_path=${encodeURIComponent(path)}`
    );
    fireEvent.click(card);
    await waitFor(() =>
      expect(h.preview).toHaveBeenCalledWith(
        '',
        'ppt',
        expect.objectContaining({
          fileRef: { kind: 'project', pe_id: 'pe1', relative_path: path },
        })
      )
    );
    expect(h.project).toHaveBeenCalledWith({ project_id: 'p1' });
    expect(h.metadata).toHaveBeenCalledWith({ file: { kind: 'project', pe_id: 'pe1', relative_path: path } });
    expect(h.readContent).not.toHaveBeenCalled();
  });

  it('刷新重挂只从同一持久工具消息恢复，展开再折叠不重复挂卡', async () => {
    const saved = JSON.parse(JSON.stringify(message())) as ToolMessage;
    const first = render(<MessageToolGroupSummary messages={[saved]} />);
    expect(await screen.findByRole('button', { name })).toBeVisible();
    first.unmount();
    render(<MessageToolGroupSummary messages={[saved]} />);
    expect(await screen.findByRole('button', { name })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /messages.toolActivity.label/ }));
    fireEvent.click(screen.getByRole('button', { name: /messages.toolActivity.label/ }));
    expect(screen.getAllByRole('button', { name })).toHaveLength(1);
    expect(h.getMessage).not.toHaveBeenCalled();
  });

  it('原生 tool_call 历史截断时不猜预览字符串，折叠状态回读该条完整结果', async () => {
    let finish!: (value: ToolMessage) => void;
    h.getMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(
      <MessageToolGroupSummary
        messages={[message(output, { _compact: { truncated: true, original_size: 90000, preview_chars: 4096 } })]}
      />
    );
    await waitFor(() =>
      expect(h.getMessage).toHaveBeenCalledWith({ conversation_id: 'c1', message_id: 'fill-message' })
    );
    expect(screen.queryByRole('button', { name })).toBeNull();
    await act(async () => finish(message()));
    expect(await screen.findByRole('button', { name })).toBeVisible();
    expect(screen.getByRole('button', { name: /messages.toolActivity.label/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(h.getMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['业务错误也 completed', { error: { code: 'INVALID_ARGUMENT', message: '金额未知' } }, {}],
    ['失败', output, { status: 'error' }],
    ['取消', output, { status: 'canceled' }],
    ['缺成果标识', { resource_id: 'res_result', relative_path: path }, {}],
    ['非法资源标识', { ...output, resource_id: 'res_bad/path' }, {}],
    ['不同会话路径', { ...output, relative_path: 'deck/c2/青禾建设决策.pptx' }, {}],
    ['非填充工具', output, { name: 'read' }],
  ])('%s不显示成品卡或请求登记', async (_label, body, content) => {
    render(<MessageToolGroupSummary messages={[message(body, content)]} />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name })).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.getMessage).not.toHaveBeenCalled();
  });

  it('切会话后丢弃迟到的完整结果', async () => {
    let finish!: (value: ToolMessage) => void;
    h.getMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<MessageToolGroupSummary messages={[message(output, { _compact: { truncated: true } })]} />);
    await waitFor(() => expect(h.getMessage).toHaveBeenCalledTimes(1));
    act(() => setCurrentConversation('c2'));
    await act(async () => finish(message()));
    expect(screen.queryByRole('button', { name })).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('已有手写文件入口和 read 来源版本入口保持可用', async () => {
    const read = message(
      { kind: 'office', resource_id: 'res_source', revision_id: 'rev_source', root: { path: '/slide[2]' } },
      { name: 'read' }
    );
    render(
      <>
        <MyCoworkWorkspaceFileLinkSlot relativePath='deck/c1/旧文件.pptx'>旧文件.pptx</MyCoworkWorkspaceFileLinkSlot>
        <MessageToolGroupSummary messages={[read]} />
      </>
    );
    expect(screen.getByRole('button', { name: '旧文件.pptx' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /messages.toolActivity.label/ }));
    fireEvent.click(screen.getByRole('button', { name: /查看当时的版本/ }));
    expect(window.location.hash).toBe(
      '#/office/resources/res_source/versions?revision=rev_source&path=%2Fslide%5B2%5D'
    );
    expect(screen.queryByRole('button', { name })).toBeNull();
  });
});
