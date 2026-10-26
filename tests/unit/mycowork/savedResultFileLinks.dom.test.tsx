/**
 * 文件：tests/unit/mycowork/savedResultFileLinks.dom.test.tsx
 * 职责：正文文件链接只打开此前同路径的已保存版本，截断时只补读该条回执。
 * 边界：只替换 IPC、HTTP 和预览宿主；Markdown、消息定位与回执解析使用真实实现。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import MarkdownView from '@/renderer/components/Markdown';
import { MessageListProvider } from '@/renderer/pages/conversation/Messages/hooks';
import {
  resetCurrentProjectForTest,
  setCurrentProject,
} from '@/renderer/pages/conversation/explorer/currentProjectStore';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';

const h = vi.hoisted(() => ({ project: vi.fn(), metadata: vi.fn(), open: vi.fn(), getMessage: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getConversationMessage: { invoke: h.getMessage } },
    project: { get: { invoke: h.project } },
    fs: { getContentMetadata: { invoke: h.metadata } },
  },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'owner' } }),
}));
vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  default: ({ children }: { children: React.ReactNode }) => <code>{children}</code>,
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => ({ openPreview: h.open }),
}));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }));

const path = 'deck/c1/最终稿.pptx';
const answer = (id = 'answer') => ({
  id,
  conversation_id: 'c1',
  type: 'text' as const,
  content: { content: '已完成' },
});
const receipt = (id: string, revision: string, relativePath = path, tool = 'office_register_output') => ({
  id,
  conversation_id: 'c1',
  type: 'tool_call' as const,
  content: {
    call_id: id,
    name: tool,
    status: 'completed' as const,
    input: { relative_path: relativePath },
    output: JSON.stringify({
      output_id: `out_${id}`,
      resource_id: 'res_result',
      revision_id: revision,
      ...(tool === 'office_fill_template' ? { relative_path: relativePath } : {}),
    }),
  },
});
const compact = (id = 'compact', tool = 'office_register_output') => ({
  ...receipt(id, 'rev_new', path, tool),
  content: { ...receipt(id, 'rev_new', path, tool).content, output: '{"output_id":', _compact: { truncated: true } },
});
type List = React.ComponentProps<typeof MessageListProvider>['value'];
function links(messages: List, messageId = 'answer') {
  return (
    <MessageListProvider value={messages}>
      <MarkdownView messageId={messageId}>{`[最终稿](${path})`}</MarkdownView>
    </MessageListProvider>
  );
}
beforeEach(() => {
  resetCurrentProjectForTest();
  resetCurrentConversationForTest();
  setCurrentProject('p1');
  setCurrentConversation('c1');
  h.project.mockReset().mockResolvedValue({ project_id: 'p1', explorer: { workspace_pe_id: 'pe1' } });
  h.metadata.mockReset().mockResolvedValue({ size: 50, lastModified: 1 });
  h.open.mockReset();
  h.getMessage.mockReset();
  vi.spyOn(Message, 'error').mockReturnValue({} as never);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('同路径再次登记后，旧正文保留旧版，新正文采用此前最近新版', async () => {
  const messages = [receipt('old', 'rev_old'), answer(), receipt('new', 'rev_new'), answer('later')];
  const view = render(links(messages));
  fireEvent.click(screen.getByRole('button', { name: '最终稿' }));
  await waitFor(() =>
    expect(h.open).toHaveBeenLastCalledWith('res_result/rev_old', 'mycowork-result', expect.any(Object))
  );
  view.rerender(links(messages, 'later'));
  fireEvent.click(screen.getByRole('button', { name: '最终稿' }));
  await waitFor(() =>
    expect(h.open).toHaveBeenLastCalledWith('res_result/rev_new', 'mycowork-result', expect.any(Object))
  );
  expect(h.metadata).not.toHaveBeenCalled();
});

it.each(['其他路径', '其他会话', '隐藏', '失败', '业务错误', '缺版本', '非法版本'])(
  '%s回执不能覆盖此前合法版本',
  async (kind) => {
    let ignored = { ...receipt('ignored', 'rev_bad') };
    if (kind === '其他路径') ignored = receipt('ignored', 'rev_bad', 'deck/c1/sub/最终稿.pptx');
    if (kind === '其他会话') ignored.conversation_id = 'c2';
    if (kind === '隐藏') Object.assign(ignored, { hidden: true });
    if (kind === '失败') Object.assign(ignored.content, { status: 'error' });
    if (kind === '业务错误') ignored.content.output = '{"error":{"code":"FAILED"}}';
    if (kind === '缺版本') ignored.content.output = '{"output_id":"out_bad","resource_id":"res_result"}';
    if (kind === '非法版本')
      ignored.content.output = '{"output_id":"out_bad","resource_id":"res_result","revision_id":"rev_bad/path"}';
    render(links([receipt('old', 'rev_old'), ignored, answer()]));
    fireEvent.click(screen.getByRole('button', { name: '最终稿' }));
    await waitFor(() =>
      expect(h.open).toHaveBeenCalledWith('res_result/rev_old', 'mycowork-result', expect.any(Object))
    );
    expect(h.metadata).not.toHaveBeenCalled();
  }
);

it.each(['office_register_output', 'office_fill_template'])(
  '%s截断回执按输入路径补读单条，等值刷新不丢弃打开',
  async (tool) => {
    let finish!: (value: ReturnType<typeof receipt>) => void;
    h.getMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const messages = [receipt('old', 'rev_old'), compact('compact', tool), answer()];
    const view = render(links(messages));
    fireEvent.click(screen.getByRole('button', { name: '最终稿' }));
    await waitFor(() => expect(h.getMessage).toHaveBeenCalledWith({ conversation_id: 'c1', message_id: 'compact' }));
    view.rerender(links(JSON.parse(JSON.stringify(messages)) as List));
    await act(async () => finish(receipt('compact', 'rev_new', path, tool)));
    expect(h.open).toHaveBeenCalledWith('res_result/rev_new', 'mycowork-result', expect.any(Object));
    expect(h.getMessage).toHaveBeenCalledTimes(1);
    expect(h.metadata).not.toHaveBeenCalled();
  }
);

it('截断填充的短文件名按本会话目录定位单条回执，不退回同名旧版', async () => {
  const full = receipt('compact', 'rev_new', path, 'office_fill_template');
  full.content.input.relative_path = '最终稿.pptx';
  const shortened = compact('compact', 'office_fill_template');
  shortened.content.input.relative_path = '最终稿.pptx';
  h.getMessage.mockResolvedValue(full);
  render(links([receipt('old', 'rev_old'), shortened, answer()]));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '最终稿' })));
  expect(h.getMessage).toHaveBeenCalledExactlyOnceWith({ conversation_id: 'c1', message_id: 'compact' });
  expect(h.open).toHaveBeenCalledWith('res_result/rev_new', 'mycowork-result', expect.any(Object));
  expect(h.metadata).not.toHaveBeenCalled();
});

it.each([
  ['office_register_output', '最终稿.pptx'],
  ['office_fill_template', '../最终稿.pptx'],
  ['office_fill_template', 'sub/最终稿.pptx'],
  ['office_fill_template', 'deck/c2/最终稿.pptx'],
])('%s 输入 %s 不扩大为本会话的同名成品', async (tool, given) => {
  const unrelated = compact('compact', tool);
  unrelated.content.input.relative_path = given;
  render(links([receipt('old', 'rev_old'), unrelated, answer()]));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '最终稿' })));
  expect(h.getMessage).not.toHaveBeenCalled();
  expect(h.open).toHaveBeenCalledWith('res_result/rev_old', 'mycowork-result', expect.any(Object));
});

it.each(['读取失败', '不同路径'])('短文件名填充补读%s仍不退回同名旧版或工作文件', async (kind) => {
  const shortened = compact('compact', 'office_fill_template');
  shortened.content.input.relative_path = '最终稿.pptx';
  if (kind === '读取失败') h.getMessage.mockRejectedValue(new Error('unavailable'));
  else h.getMessage.mockResolvedValue(receipt('compact', 'rev_new', 'deck/c1/other.pptx', 'office_fill_template'));
  render(links([receipt('old', 'rev_old'), shortened, answer()]));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '最终稿' })));
  expect(h.getMessage).toHaveBeenCalledTimes(1);
  expect(Message.error).toHaveBeenCalled();
  expect(h.open).not.toHaveBeenCalled();
  expect(h.metadata).not.toHaveBeenCalled();
});

it.each(['读取失败', '仍截断', '不同消息', '隐藏消息', '不同路径'])(
  '最近同路径回执%s时不退回旧版本或工作副本',
  async (kind) => {
    let full: unknown = receipt('compact', 'rev_new');
    if (kind === '读取失败') h.getMessage.mockRejectedValue(new Error('unavailable'));
    else {
      if (kind === '仍截断') full = compact();
      if (kind === '不同消息') full = receipt('other', 'rev_new');
      if (kind === '隐藏消息') full = { ...receipt('compact', 'rev_new'), hidden: true };
      if (kind === '不同路径') full = receipt('compact', 'rev_new', 'deck/c1/other.pptx');
      h.getMessage.mockResolvedValue(full);
    }
    render(links([receipt('old', 'rev_old'), compact(), answer()]));
    fireEvent.click(screen.getByRole('button', { name: '最终稿' }));
    await waitFor(() => expect(Message.error).toHaveBeenCalled());
    expect(h.open).not.toHaveBeenCalled();
    expect(h.project).not.toHaveBeenCalled();
    expect(h.metadata).not.toHaveBeenCalled();
  }
);

it('切换会话后不打开迟到的完整回执', async () => {
  let finish!: (value: ReturnType<typeof receipt>) => void;
  h.getMessage.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(links([compact(), answer()]));
  fireEvent.click(screen.getByRole('button', { name: '最终稿' }));
  await waitFor(() => expect(h.getMessage).toHaveBeenCalledTimes(1));
  await act(async () => setCurrentConversation('c2'));
  await act(async () => finish(receipt('compact', 'rev_new')));
  expect(h.open).not.toHaveBeenCalled();
  expect(h.metadata).not.toHaveBeenCalled();
});

it.each(['正文在前', '没有正文身份', '截断无输入路径'])('%s时不猜已保存版本，普通工作文件仍可打开', async (kind) => {
  const unlocated = { ...compact(), content: { ...compact().content, input: {} } };
  const messages =
    kind === '正文在前'
      ? [answer(), receipt('future', 'rev_new')]
      : kind === '截断无输入路径'
        ? [unlocated, answer()]
        : [receipt('old', 'rev_old')];
  render(links(messages));
  fireEvent.click(screen.getByRole('button', { name: '最终稿' }));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith('', 'ppt', expect.any(Object)));
  expect(h.getMessage).not.toHaveBeenCalled();
  expect(h.metadata).toHaveBeenCalledTimes(1);
});
