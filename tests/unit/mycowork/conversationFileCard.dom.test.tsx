/**
 * 文件：tests/unit/mycowork/conversationFileCard.dom.test.tsx
 * 职责：验证消息文件卡片：长文件名两行且后缀可辨、角色标签只来自可靠来源、键盘与 title 不回退。
 * 边界：只替换 HTTP 传输；卡片、角色判定与模板提供者走真实实现。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationFileLink, TemplateConfirmationProvider } from '@mycowork/ui';

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const LONG = '2026年第三季度华东区域销售复盘与下一阶段增长计划（含渠道与客户分层）最终定稿版.pptx';
const context = (relative_path: string) => ({
  plan_id: 'plan1',
  version: 1,
  template_preview: {
    decision_id: 'd1',
    decision_version: 1,
    theme: { asset_id: 'a1', version: 1, title: '商务蓝' },
    copy_id: 'cp1',
    relative_path,
  },
});
const card = (path: string, name: string, template?: string) => {
  const link = (
    <ConversationFileLink
      disabled={false}
      onOpen={() => {}}
      fileName={name}
      lang='zh-CN'
      conversationId='c1'
      relativePath={path}
    >
      {name}
    </ConversationFileLink>
  );
  return render(
    template ? (
      <TemplateConfirmationProvider
        ownerKey='o'
        projectId='p1'
        conversationId='c1'
        refreshKey={0}
        readContext={async () => context(template) as never}
        isCurrent={() => true}
      >
        {link}
      </TemplateConfirmationProvider>
    ) : (
      link
    )
  );
};

beforeEach(() => {
  h.fetch.mockReset().mockResolvedValue(reply(404, {}));
  vi.stubGlobal('fetch', h.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('文件卡片名称', () => {
  it('长中文文件名最多两行换行显示，卡片随容器伸缩，后缀留在可访问名称与 title 里', () => {
    const { container } = card(`deck/c1/${LONG}`, LONG);
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/width:\s*min\(100%,\s*420px\)/);
    expect(css).not.toContain('width: 280px');
    expect(css).toMatch(/\.mcw-conversation-file-name\s*{[^}]*-webkit-line-clamp:\s*2/);
    expect(css).toMatch(/\.mcw-conversation-file-name\s*{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/\.mcw-conversation-file-name\s*{[^}]*nowrap/);
    const button = screen.getByRole('button', { name: LONG });
    expect(button).toHaveAttribute('title', LONG);
    expect(button).toHaveTextContent('PPTX · 点击预览');
  });

  it('卡片可聚焦，回车触发打开', () => {
    const onOpen = vi.fn();
    render(
      <ConversationFileLink disabled={false} onOpen={onOpen} fileName='a.pptx' lang='zh-CN'>
        a.pptx
      </ConversationFileLink>
    );
    const button = screen.getByRole('button', { name: 'a.pptx' });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('文件角色标签', () => {
  it('登记输出（output-resource 命中）标“交付文件”，并按会话与相对路径查询', async () => {
    h.fetch.mockResolvedValue(reply(200, { resource_id: 'res_1' }));
    card('deck/c1/最终稿.pptx', '最终稿.pptx');
    expect(await screen.findByText('交付文件')).toBeVisible();
    expect(String(h.fetch.mock.calls[0]?.[0])).toBe(
      `/bridge/v1/conversations/c1/output-resource?relative_path=${encodeURIComponent('deck/c1/最终稿.pptx')}`
    );
    expect(screen.queryByText('模板样式')).toBeNull();
  });

  it('待确认模板路径标“模板样式”，即使它也已登记为输出也不改标交付文件', async () => {
    h.fetch.mockResolvedValue(reply(200, { resource_id: 'res_2' }));
    card('deck/c1/样例.pptx', '样例.pptx', 'deck/c1/样例.pptx');
    expect(await screen.findByText('模板样式')).toBeVisible();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('交付文件')).toBeNull();
  });

  it('没有可靠信息就不标：文件名叫“模板”“最终”也不猜', async () => {
    card('deck/c1/最终-模板.pptx', '最终-模板.pptx', 'deck/c1/别的.pptx');
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('交付文件')).toBeNull();
    expect(screen.queryByText('模板样式')).toBeNull();
  });

  it('查询失败按未知处理，不标也不报错', async () => {
    h.fetch.mockRejectedValue(new Error('offline'));
    card('deck/c1/x.pptx', 'x.pptx');
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    expect(screen.queryByText('交付文件')).toBeNull();
  });
});
