/**
 * [mycowork] PR11 W4-4o。文件：tests/unit/mycowork/globalResourcesQuery.dom.test.tsx
 * 职责：PR11 §3.2单次全集请求、准确分页、入口交集与集合条件重置的语义DOM测试。
 * 边界：真实ResourcesPage/Arco；Bridge响应为虚构边界替身，600后端真实性另由HTTP集成证明。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import {
  choose,
  fixture,
  input,
  lastQuery,
  nav,
  queries,
  reads,
  reset,
  selectFile,
  writes,
} from './globalResourceFixture';

beforeEach(() => {
  reset();
  fixture();
});
afterEach(() => vi.unstubAllGlobals());
const mount = async () => {
  render(<ResourcesPage lang='zh-CN' />);
  await screen.findByRole('link', { name: '第一页-1.md', exact: true });
};
it('初始全部一次origin=all查询，显示600与50条；第2/12页显示服务端页面且没有首50聚合', async () => {
  await mount();
  expect(reads()).toHaveLength(1);
  expect(Object.fromEntries(lastQuery())).toEqual({ origin: 'all', sort: 'updated', page: '1' });
  expect(screen.getByTestId('mycowork-nav-all')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('heading', { name: '全部', exact: true })).toBeInTheDocument();
  expect(screen.getByText('共 600 项')).toBeInTheDocument();
  expect(screen.getAllByTestId('mycowork-resource-item')).toHaveLength(50);
  selectFile('第一页-1.md');
  fireEvent.click(screen.getByText('2', { selector: '.arco-pagination-item' }));
  await screen.findByRole('link', { name: '第二页-51.md', exact: true });
  expect(lastQuery().get('page')).toBe('2');
  expect(screen.queryByRole('region', { name: '所选资料的操作' })).toBeNull();
  expect(screen.queryByRole('link', { name: '第一页-1.md', exact: true })).toBeNull();
  fireEvent.click(screen.getByText('12', { selector: '.arco-pagination-item' }));
  await screen.findByRole('link', { name: '尾页-600.md', exact: true });
  expect(lastQuery().get('page')).toBe('12');
  expect(reads()).toHaveLength(3);
});
it.each([
  ['状态', '入库失败', 'state', 'failed', '首页外失败-51.pdf'],
  ['类型', 'PDF', 'file_type', 'pdf', '首页外失败-51.pdf'],
  ['来源', '产物', 'origin_filter', 'outputs', '首页外产物-600.pdf'],
])('首页51之外匹配%s时查询后端、回1页并清selection', async (label, option, field, value, name) => {
  await mount();
  fireEvent.click(screen.getByText('2', { selector: '.arco-pagination-item' }));
  await screen.findByRole('link', { name: '第二页-51.md', exact: true });
  selectFile('第二页-51.md');
  await choose(label, option);
  await screen.findByRole('link', { name, exact: true });
  expect(lastQuery().get(field)).toBe(value);
  expect(lastQuery().get('page')).toBe('1');
  expect(screen.queryByRole('region', { name: '所选资料的操作' })).toBeNull();
  expect(screen.queryByRole('link', { name: '第一页-1.md', exact: true })).toBeNull();
  expect(screen.getByText(field === 'file_type' ? '共 2 项' : '共 1 项')).toBeInTheDocument();
});
it('All↔Recent重新查询并清条件/输入/页/选择；仅layout切换保留选择且不新增请求', async () => {
  await mount();
  selectFile('第一页-1.md');
  const before = reads().length;
  fireEvent.click(screen.getByLabelText('网格'));
  expect(screen.getByRole('checkbox', { name: '选择 第一页-1.md', exact: true })).toBeChecked();
  expect(reads()).toHaveLength(before);
  nav('recent');
  await waitFor(() => expect(reads()).toHaveLength(before + 1));
  await screen.findByRole('link', { name: '第一页-1.md', exact: true });
  expect(screen.getByRole('heading', { name: '最近', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '选择 第一页-1.md', exact: true })).not.toBeChecked();
  await choose('状态', '入库失败');
  await screen.findByRole('link', { name: '首页外失败-51.pdf', exact: true });
  fireEvent.change(input(), { target: { value: '待清输入' } });
  nav('all');
  await screen.findByRole('link', { name: '第一页-1.md', exact: true });
  expect(input()).toHaveValue('');
  expect(lastQuery().has('state')).toBe(false);
  expect(lastQuery().has('q')).toBe(false);
  expect(lastQuery().get('page')).toBe('1');
  expect(document.querySelector('.mcw-rc-grid')).not.toBeNull();
});
it.each([
  ['source-src_a', { source_id: 'src_a' }, '库内-匹配.md'],
  ['imports', { origin: 'imports' }, '导入-匹配.md'],
  ['tag-tag_case', { origin: 'all', tag_id: 'tag_case' }, '当前位置-匹配.md'],
  ['view-view_case', { origin: 'all', view_id: 'view_case' }, '当前位置-匹配.md'],
  ['starred', { origin: 'all', collection_id: 'col_case' }, '当前位置-匹配.md'],
])('%s下q和当前位置相交且只发单次查询', async (place, expected, name) => {
  await mount();
  nav(place);
  await waitFor(() => expect(reads()).toHaveLength(2));
  fireEvent.change(input(), { target: { value: '匹配' } });
  await screen.findByRole('link', { name, exact: true });
  expect(reads()).toHaveLength(3);
  for (const [field, value] of Object.entries(expected)) expect(lastQuery().get(field)).toBe(value);
  expect(lastQuery().get('q')).toBe('匹配');
  expect(lastQuery().get('page')).toBe('1');
  expect(screen.queryByRole('link', { name: '第一页-1.md', exact: true })).toBeNull();
});
it('全局名称排序重置页/选择并发送sort=name，支持多后缀而无客户端筛选', async () => {
  await mount();
  fireEvent.click(screen.getByText('2', { selector: '.arco-pagination-item' }));
  await screen.findByRole('link', { name: '第二页-51.md', exact: true });
  selectFile('第二页-51.md');
  await choose('排序', '按名称');
  await screen.findByRole('link', { name: '第一页-1.md', exact: true });
  expect(lastQuery().get('sort')).toBe('name');
  expect(lastQuery().get('page')).toBe('1');
  expect(screen.queryByRole('region', { name: '所选资料的操作' })).toBeNull();
  await choose('类型', 'PDF');
  await choose('类型', 'PPTX');
  await waitFor(() => expect(lastQuery().getAll('file_type')).toEqual(['pdf', 'pptx']));
  expect(lastQuery().get('sort')).toBe('name');
  expect(writes()).toHaveLength(0);
  expect(queries().some((q) => q.get('page') === '2')).toBe(true);
});
