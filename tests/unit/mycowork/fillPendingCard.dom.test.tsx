/**
 * 文件：tests/unit/mycowork/fillPendingCard.dom.test.tsx
 * 职责：验证 D322 成品文件卡片下方的“生成时待确认（N 条）”：数据来自 output-resource 带回的 pending_confirmations（一次填充工具结果原样），
 *       按类别分组、每条带页码与子项、可折叠、“复制清单”写入剪贴板；没有清单或不是交付文件时不出现。
 * 边界：只替换 HTTP 传输与剪贴板；卡片、角色判定与清单组件走真实实现。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationFileLink } from '@mycowork/ui';

const h = vi.hoisted(() => ({ fetch: vi.fn(), write: vi.fn() }));
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const PENDING = [
  { field: 'items[2].amount_must', item: '2', slide: 6, category: 'amount', reason: '旧稿未分档、只有总额 30 万元' },
  { field: 'items[3].lead', item: '3', slide: 7, category: 'missing', reason: '「导语」没有依据，已写“待确认”' },
  { field: 'items[1].title', item: '1', slide: 5, category: 'title', reason: '标题已截断：超过 32 字' },
  { field: '建议做金额', item: '2', slide: 6, category: 'confirm', reason: '旧稿只有必须项金额（虚构）' },
  { field: 'bad' }, // 形状不对的条目丢掉
];
const card = () =>
  render(
    <ConversationFileLink
      disabled={false}
      onOpen={() => {}}
      fileName='成品.pptx'
      lang='zh-CN'
      conversationId='c1'
      relativePath='deck/c1/成品.pptx'
    >
      成品.pptx
    </ConversationFileLink>
  );

beforeEach(() => {
  h.fetch.mockReset();
  h.write.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', h.fetch);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: h.write }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('成品卡片下方的待确认清单', () => {
  it('按类别分组、每条带页码与子项；可折叠；复制清单是同样内容的纯文本', async () => {
    h.fetch.mockResolvedValue(reply(200, { resource_id: 'res_1', pending_confirmations: PENDING }));
    card();
    const toggle = await screen.findByRole('button', { name: /生成时待确认（4 条）/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('后续修改不会自动更新此清单，请结合当前文件复核。')).toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['金额与分档', '缺内容的栏目', '标题', '需要你拍板']);
    expect(screen.getByText('第 6 页 · 子项 2：旧稿未分档、只有总额 30 万元')).toBeVisible();
    expect(screen.getByText('第 6 页 · 子项 2：建议做金额：旧稿只有必须项金额（虚构）')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: '复制清单' }));
    await waitFor(() => expect(h.write).toHaveBeenCalledTimes(1));
    const text = String(h.write.mock.calls[0]?.[0]);
    expect(text.split('\n')[0]).toBe('生成时待确认（4 条）');
    expect(text).toContain('后续修改不会自动更新此清单，请结合当前文件复核。');
    expect(text).toContain('【金额与分档】\n- 第 6 页 · 子项 2：旧稿未分档、只有总额 30 万元');
    expect(text).toContain('【标题】\n- 第 5 页 · 子项 1：标题已截断：超过 32 字');
    expect(await screen.findByRole('button', { name: '已复制' })).toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('后续修改不会自动更新此清单，请结合当前文件复核。')).toBeVisible();
  });

  it('交付文件没有清单（不是一次填充的成品）时不出现', async () => {
    h.fetch.mockResolvedValue(reply(200, { resource_id: 'res_2' }));
    card();
    expect(await screen.findByText('交付文件')).toBeVisible();
    expect(screen.queryByTestId('mycowork-fill-pending')).toBeNull();
  });

  it('不是登记产物（404）时不出现', async () => {
    h.fetch.mockResolvedValue(reply(404, {}));
    card();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('mycowork-fill-pending')).toBeNull();
  });
});
