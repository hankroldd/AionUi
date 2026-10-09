/**
 * [mycowork] PR11 W4-10。文件：tests/unit/mycowork/spaceCardView.dom.test.tsx
 * 职责：空间网格（卡片）视图的结构：头部一行（小图标槽 + 单行文件名 + 悬停操作）、中部预览区（大图标）、底部恰两行；
 *       多选与否文件名节点不变；长文件名带 title；状态/来源文案仍来自枚举；点文件名仍打开预览。
 * 边界：jsdom 量不出像素，对齐靠结构与类名断言，真实像素对齐见 tests/e2e/P05-ui-polish/card-view.ts。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { fixture, item, list, OUTPUT, reset, SECRET } from './globalResourceFixture';

const LONG = '一个非常非常长的虚构文件名-preview-edit-final-version-2026-用来检查单行省略.pptx';
const cards = () => screen.getAllByTestId('mycowork-resource-item');

async function open() {
  fixture(() => list([item('res_long', LONG, { origin: 'imports' }), OUTPUT, SECRET], 3));
  render(<ResourcesPage lang='zh-CN' onAskScope={async () => undefined} />);
  await screen.findByRole('button', { name: LONG });
  fireEvent.click(screen.getByTestId('mycowork-layout-card'));
  await waitFor(() => expect(document.querySelector('.mcw-rc-grid')).not.toBeNull());
}

beforeEach(reset);
afterEach(() => vi.unstubAllGlobals());

it('每张卡片三段式：头部一行（小图标 + 单行文件名）、预览区（大图标）、页脚恰两行', async () => {
  await open();
  for (const card of cards()) {
    const [head, preview, foot] = Array.from(card.children);
    expect(head.className).toBe('mcw-rc-card-top');
    expect(head.querySelectorAll('.mcw-rc-name')).toHaveLength(1);
    expect(head.querySelectorAll('.mcw-rc-type.is-small')).toHaveLength(1);
    expect(head.querySelector('.mcw-rc-type.is-large')).toBeNull();
    expect(preview.className).toBe('mcw-rc-card-preview');
    expect(preview.querySelectorAll('.mcw-rc-type.is-large')).toHaveLength(1);
    expect(foot.className).toBe('mcw-rc-card-foot');
    expect(foot.querySelectorAll(':scope > .mcw-rc-card-line')).toHaveLength(2);
    expect(card.children).toHaveLength(3);
  }
});

it('长文件名带 title（全名）、单行省略；点文件名仍打开预览', async () => {
  await open();
  const name = screen.getByRole('button', { name: LONG });
  expect(name).toHaveAttribute('title', LONG);
  expect(name.className).toBe('mcw-rc-name');
  fireEvent.click(name);
  expect(await screen.findByRole('dialog')).toHaveClass('mcw-space-preview');
});

it('多选框不占文件名左边：有无多选时文件名节点的父节点与类名不变，选中后只在同一槽里换控件', async () => {
  await open();
  const card = cards()[0];
  const before = within(card).getByRole('button', { name: LONG });
  const slot = card.querySelector('.mcw-rc-card-top > .mcw-rc-pick');
  expect(slot).not.toBeNull();
  expect(before.previousElementSibling).toBe(slot);
  fireEvent.click(within(card).getByRole('checkbox', { name: `选择 ${LONG}` }));
  const after = within(cards()[0]).getByRole('button', { name: LONG });
  expect(after.className).toBe(before.className);
  expect(after.previousElementSibling?.className).toBe('mcw-rc-pick');
  expect(document.querySelector('.mcw-rc-grid')!.className).toContain('is-selecting');
  expect(card.querySelectorAll('.mcw-rc-pick')).toHaveLength(1);
});

it('页脚第 1 行：状态 + 来源（枚举文案）；第 2 行：库名 / 来自对话 + 时间；Secret 与状态不新增行', async () => {
  await open();
  const [imported, output, secret] = cards();
  const line = (card: HTMLElement, n: number) => card.querySelectorAll('.mcw-rc-card-line')[n] as HTMLElement;
  expect(line(imported, 0)).toHaveTextContent('AI 可引用');
  expect(line(imported, 0)).toHaveTextContent('我上传的');
  expect(line(imported, 1)).toHaveTextContent('虚构甲库');
  expect(line(imported, 1).querySelector('.mcw-rc-time')).not.toBeNull();
  expect(line(output, 0)).toHaveTextContent('仅存档');
  expect(line(output, 0)).toHaveTextContent('AI 生成的');
  expect(within(output).getByTestId('mycowork-output-source')).toBeInTheDocument();
  expect(line(secret, 0)).toHaveTextContent('AI 不引用');
  expect(within(secret).getByTestId('mycowork-secret-lock').closest('.mcw-rc-card-preview')).not.toBeNull();
  expect(secret.querySelectorAll('.mcw-rc-card-line')).toHaveLength(2);
});

it('悬停操作（收藏、更多）在头部里，可聚焦可点', async () => {
  await open();
  const head = cards()[0].querySelector('.mcw-rc-card-top')!;
  const star = within(head as HTMLElement).getByRole('button', { name: /收藏/ });
  star.focus();
  expect(document.activeElement).toBe(star);
  expect(head.querySelector('.mcw-rc-acts')).not.toBeNull();
  fireEvent.click(within(head as HTMLElement).getByRole('button', { name: `更多操作 ${LONG}` }));
  expect(await screen.findByRole('menu')).toBeInTheDocument();
});
