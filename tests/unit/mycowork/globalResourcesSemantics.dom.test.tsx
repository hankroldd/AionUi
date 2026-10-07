/**
 * [mycowork] PR11 W4-4o。文件：tests/unit/mycowork/globalResourcesSemantics.dom.test.tsx
 * 职责：PR11 §3.2来源/知识库分列、Secret人工可见与真实Arco键盘筛选的语义DOM测试。
 * 边界：只替换Bridge HTTP；未交付动作不得以可点击占位出现，不验证真实设备或AI数据链。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import {
  fetchMock,
  FIRST,
  fixture,
  input,
  lastQuery,
  list,
  nav,
  OUTPUT,
  reads,
  reply,
  reset,
  SECRET,
  selectFile,
  writes,
} from './globalResourceFixture';

beforeEach(reset);
afterEach(() => vi.unstubAllGlobals());
it('来源按origin，KB按source_id各自显示；产物原稿显示“已生成”而不是存档文案，Secret人工可见但标AI不引用', async () => {
  const publishedOutput = { ...OUTPUT, source_id: 'src_a', file_name: '已入库产物.pdf', state: 'ready' };
  fixture(() => list([publishedOutput, OUTPUT, SECRET], 3));
  render(<ResourcesPage lang='zh-CN' onAskScope={async () => undefined} />);
  const published = (await screen.findByRole('button', { name: '已入库产物.pdf' })).closest(
    '[data-testid="mycowork-resource-item"]'
  ) as HTMLElement;
  expect(published.querySelector('.mcw-rc-source')).toHaveTextContent('产物');
  expect(published.querySelector('.mcw-rc-knowledge-base')).toHaveTextContent('虚构甲库');
  const output = screen
    .getByRole('button', { name: '首页外产物-600.pdf' })
    .closest('[data-testid="mycowork-resource-item"]') as HTMLElement;
  expect(output.querySelector('.mcw-rc-source')).toHaveTextContent('产物');
  expect(output.querySelector('.mcw-rc-knowledge-base')).toHaveTextContent('—');
  // ADR-0022 决策 7：产物原稿（state=stored）只显示“已生成 / 已发布”胶囊，不套用“存档（AI 不引用）”
  expect(within(output).getByText('已生成')).toBeInTheDocument();
  expect(within(output).queryByText(/存档|AI 不引用/)).toBeNull();
  expect(within(published).getByText('AI 可引用')).toBeInTheDocument();
  const secret = screen
    .getByRole('button', { name: '虚构密件.md' })
    .closest('[data-testid="mycowork-resource-item"]') as HTMLElement;
  expect(within(secret).getByText('AI 不引用')).toBeInTheDocument();
  expect(within(secret).getByTestId('mycowork-secret-lock')).toHaveTextContent('Secret');
  expect(within(secret).getByRole('checkbox', { name: '选择 虚构密件.md' })).toBeEnabled();
  fireEvent.click(screen.getByLabelText('网格'));
  const cards = screen.getAllByTestId('mycowork-resource-item');
  expect(within(cards[0]).getByTestId('mycowork-output-source')).toBeInTheDocument(); // 产物卡片的来源行 = 来源对话 · 时间
  expect(within(cards[0]).getByText('虚构甲库')).toBeInTheDocument();
  expect(within(cards[1]).getByText('已生成')).toBeInTheDocument();
  expect(within(cards[1]).queryByText(/存档|AI 不引用/)).toBeNull();
  expect(within(cards[1]).queryByText('虚构甲库')).toBeNull();
  expect(within(cards[2]).getByText('AI 不引用')).toBeInTheDocument();
  expect(reads()).toHaveLength(1);
});
it('产物“更多”有发布到知识库；解析不到来源对话就不给入口；Secret仍可查看原件且不出现发布或加入知识库', async () => {
  fixture(() => list([OUTPUT, SECRET], 2));
  render(<ResourcesPage lang='zh-CN' onAskScope={async () => undefined} />);
  await screen.findByRole('button', { name: '首页外产物-600.pdf' });
  fireEvent.click(screen.getByRole('button', { name: '更多操作 首页外产物-600.pdf' }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: '版本与变化' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: '发布到知识库' })).toBeInTheDocument();
  expect(within(menu).queryByText(/打开来源对话|加入知识库/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更多操作 虚构密件.md' }));
  const menus = await screen.findAllByRole('menu');
  const secretMenu = menus.at(-1)!;
  const preview = within(secretMenu).getByRole('link', { name: '查看原件' });
  expect(preview).toHaveAttribute('href', '/bridge/v1/resources/res_secret/preview');
  expect(within(secretMenu).queryByText(/加入知识库|发布到知识库/)).toBeNull();
  expect(writes()).toHaveLength(0);
});
it.each([
  ['来源', 'origin_filter', 'imports'],
  ['类型', 'file_type', 'csv'],
  ['状态', 'state', 'ready'],
  ['排序', 'sort', 'name'],
])('键盘Enter打开与选定%s，Escape关闭菜单', async (label, field, value) => {
  fixture(() => list(FIRST.slice(0, 2), 2));
  render(<ResourcesPage lang='zh-CN' onAskScope={async () => undefined} />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  const combo = screen.getByRole('combobox', { name: label });
  const target = label === '类型' ? within(combo).getByRole('textbox') : combo;
  target.focus();
  fireEvent.keyDown(target, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
  await screen.findByRole('listbox');
  if (label === '排序') fireEvent.keyDown(target, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 });
  fireEvent.keyDown(target, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
  await waitFor(() => expect(lastQuery().get(field)).toBe(value));
  fireEvent.keyDown(target, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 });
  expect(writes()).toHaveLength(0);
});
it('Tab可达搜索后续动作，原生按钮Enter切导航、Space切checkbox选择', async () => {
  fixture(() => list(FIRST.slice(0, 2), 2));
  render(<ResourcesPage lang='zh-CN' onAskScope={async () => undefined} />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  const user = userEvent.setup();
  input().focus();
  expect(input()).toHaveFocus();
  await user.tab();
  expect(screen.getAllByRole('button', { name: '新建', exact: true })[0]).toHaveFocus();
  const recent = screen.getByTestId('mycowork-nav-recent');
  recent.focus();
  await user.keyboard('{Enter}');
  await screen.findByRole('heading', { name: '最近', exact: true });
  expect(recent).toHaveAttribute('aria-current', 'page');
  await screen.findByRole('checkbox', { name: '选择 第一页-1.md', exact: true });
  const checkbox = screen.getByRole('checkbox', { name: '选择 第一页-1.md', exact: true });
  checkbox.focus();
  await user.keyboard(' ');
  expect(checkbox).toBeChecked();
  expect(screen.getByRole('region', { name: '所选资料的操作' })).toBeInTheDocument();
});
it('输入当帧清selection，清除全部条件保留source且恢复整库动作，既有ID不复活', async () => {
  fixture(() => list(FIRST.slice(0, 2), 2));
  render(<ResourcesPage lang='zh-CN' onAskScope={async () => undefined} />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  nav('source-src_a');
  await screen.findByRole('button', { name: '用这些资料提问' });
  selectFile('第一页-1.md');
  fireEvent.change(input(), { target: { value: '输入清选' } });
  expect(screen.queryByRole('region', { name: '所选资料的操作' })).toBeNull();
  expect(screen.queryByRole('button', { name: '用这些资料提问' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除条件' }));
  await screen.findByRole('button', { name: '用这些资料提问' });
  expect(input()).toHaveValue('');
  expect(lastQuery().get('source_id')).toBe('src_a');
  expect(screen.getByRole('checkbox', { name: '选择 第一页-1.md', exact: true })).not.toBeChecked();
  expect(writes()).toHaveLength(0);
});
it('知识库目录首次读取失败：页面仍列出本人资料，点“重试”后重读目录，知识库导航出现', async () => {
  fixture(() => list(FIRST.slice(0, 2), 2));
  const serve = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
  let scopes = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/bridge/v1/scopes' && scopes++ === 0
      ? reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } })
      : serve(url, init)
  );
  render(<ResourcesPage lang='zh-CN' />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  expect(screen.queryByTestId('mycowork-nav-source-src_a')).toBeNull();
  const notice = (await screen.findAllByRole('alert')).find((alert) =>
    within(alert).queryByRole('button', { name: '重试' })
  );
  expect(notice).toBeDefined();
  fireEvent.click(within(notice as HTMLElement).getByRole('button', { name: '重试' }));
  expect(await screen.findByTestId('mycowork-nav-source-src_a')).toHaveTextContent('虚构甲库');
  expect(scopes).toBe(2);
});
