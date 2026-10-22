/**
 * 文件：tests/unit/mycowork/resourceCitation.dom.test.tsx
 * 职责：真实 Markdown 来源链接经会话核验打开原文，危险地址与迟到响应不能打开。
 * 边界：只替换 HTTP、身份和 Shadow DOM 容器；Markdown、挂载、预览和会话状态均走真实实现。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import MarkdownView from '@/renderer/components/Markdown';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';

vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  default: ({ children }: { children: React.ReactNode }) => <code>{children}</code>,
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'owner' } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }));

const request = vi.fn();
const FILE = '虚构周报.txt';
const BODY = '本周完成照明验收，灯具 36 套。';
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
  text: async () => String(body),
});
const context = {
  plan_id: 'plan_a',
  version: 1,
  status: 'OK',
  superseded: false,
  brief: { groups: [], policy: { strict: true, web: 'off' }, refs: {}, excluded: 0, unauthorized: 0 },
  used: [{ resource_id: 'res_a', source_id: 'src_a', file_name: FILE, reads: 1, last_read_at: '2026-10-22T00:00:00Z' }],
  withheld: 0,
};

beforeEach(() => {
  resetCurrentConversationForTest();
  setCurrentConversation('c1');
  request.mockReset().mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/conversations/c1/context') return reply(200, context);
    if (url === '/bridge/v1/resources/res_a/preview') return reply(200, BODY);
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', request);
});
afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});

describe('正文知识来源', () => {
  it('真实 Markdown 引用点击后就地预览原文，关闭回到引用按钮', async () => {
    render(<MarkdownView>{`[${FILE}](resource:res_a)`}</MarkdownView>);
    const trigger = screen.getByRole('button', { name: FILE });
    fireEvent.click(trigger);
    expect(await screen.findByText(BODY)).toBeVisible();
    expect(screen.getByText('这里展示当前原件，不代表 AI 当时读取的历史版本。')).toBeVisible();
    expect(request).toHaveBeenCalledWith('/bridge/v1/conversations/c1/context', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
    await waitFor(() => expect(screen.queryByText(BODY)).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('已撤权或未用过的资源不请求原件，并给出可见说明', async () => {
    request.mockResolvedValue(reply(200, { ...context, used: [] }));
    render(<MarkdownView>{`[${FILE}](resource:res_a)`}</MarkdownView>);
    fireEvent.click(screen.getByRole('button', { name: FILE }));
    expect(await screen.findByText('这份来源当前不可用，或不在本对话的已用资料中。')).toBeVisible();
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('切换会话后的迟到核验不能打开旧来源', async () => {
    let complete!: (value: ReturnType<typeof reply>) => void;
    request.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    render(<MarkdownView>{`[${FILE}](resource:res_a)`}</MarkdownView>);
    fireEvent.click(screen.getByRole('button', { name: FILE }));
    act(() => setCurrentConversation('c2'));
    await act(async () => complete(reply(200, context)));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('会话核验失败说明原因，不继续请求原件', async () => {
    request.mockResolvedValue(reply(403, { error: { code: 'FORBIDDEN' } }));
    render(<MarkdownView>{`[${FILE}](resource:res_a)`}</MarkdownView>);
    fireEvent.click(screen.getByRole('button', { name: FILE }));
    expect(await screen.findByText('你没有权限做这个操作。')).toBeVisible();
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'resource://res_a',
    'resource:res_a/../x',
    'resource:res_a?url=https://example.test',
    `resource:res_${'x'.repeat(65)}`,
  ])('不会给非法地址建立资源入口：%s', (href) => {
    render(<MarkdownView>{`[无效来源](${href})`}</MarkdownView>);
    expect(screen.queryByRole('button', { name: '无效来源' })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
