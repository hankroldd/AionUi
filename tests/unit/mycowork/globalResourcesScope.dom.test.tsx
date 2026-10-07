/**
 * [mycowork] PR11 W4-4o。文件：tests/unit/mycowork/globalResourcesScope.dom.test.tsx
 * 职责：PR11 §3.2筛选无法表达为Scope/SavedView时即时撤掉整库动作，验证300ms旧q窗口与恢复。
 * 边界：真实页面、Scope与Arco，只用虚构Bridge边界；不把UI门禁当成后端AI排除集成。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { choose, fixture, input, lastQuery, list, nav, reads, reset, writes, FIRST } from './globalResourceFixture';

const askScope = vi.fn(async () => undefined);
beforeEach(() => {
  askScope.mockClear();
  reset();
  fixture(() => list(FIRST.slice(0, 2), 2));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const noScopeActions = () => {
  expect(screen.queryByRole('button', { name: '用这些资料提问' })).toBeNull();
  expect(screen.queryByRole('button', { name: '存为智能分组' })).toBeNull();
};
async function sourceAndTags() {
  render(<ResourcesPage lang='zh-CN' onAskScope={askScope} />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  nav('source-src_a');
  await screen.findByRole('button', { name: '用这些资料提问' });
  fireEvent.click(screen.getByLabelText('按标签筛选'));
  fireEvent.click(await screen.findByText('风险', { selector: '.arco-tree-select-popup *' }));
  await waitFor(() => expect(lastQuery().get('tag_id')).toBe('tag_case'));
  expect(screen.getByRole('button', { name: '存为智能分组' })).toBeInTheDocument();
}
it('输入当帧及299ms内隐藏ask/save、不发查询；旧q清空前仍隐藏，300ms后恢复精确源+标签', async () => {
  await sourceAndTags();
  const before = reads().length;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fireEvent.change(input(), { target: { value: '匹配' } });
  noScopeActions();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(299);
  });
  expect(reads()).toHaveLength(before);
  noScopeActions();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(reads()).toHaveLength(before + 1);
  expect(lastQuery().get('q')).toBe('匹配');
  noScopeActions();
  fireEvent.change(input(), { target: { value: '' } });
  noScopeActions();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(299);
  });
  expect(reads()).toHaveLength(before + 1);
  noScopeActions();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(reads()).toHaveLength(before + 2);
  expect(lastQuery().has('q')).toBe(false);
  expect(lastQuery().get('source_id')).toBe('src_a');
  expect(lastQuery().get('tag_id')).toBe('tag_case');
  expect(screen.getByRole('button', { name: '用这些资料提问' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '存为智能分组' })).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});
it.each([
  ['类型', 'PDF', 'file_type', 'pdf'],
  ['状态', '入库失败', 'state', 'failed'],
  ['来源', '产物', 'origin_filter', 'outputs'],
])('%s条件即时撤掉整库ask/save，清除条件恢复且保留当前源，不写不等价的分组', async (label, option, field, value) => {
  await sourceAndTags();
  await choose(label, option);
  noScopeActions();
  await waitFor(() => expect(lastQuery().get(field)).toBe(value));
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '清除条件' }));
  await screen.findByRole('button', { name: '用这些资料提问' });
  expect(lastQuery().get('source_id')).toBe('src_a');
  expect(lastQuery().has(field)).toBe(false);
  expect(lastQuery().has('tag_id')).toBe(false);
  expect(screen.queryByRole('button', { name: '存为智能分组' })).toBeNull();
  expect(writes()).toHaveLength(0);
});
it('排序仍完整表达源+标签；ask沿用真实Scope并且save只写源/标签不写排序和分页', async () => {
  await sourceAndTags();
  await choose('排序', '按名称');
  await waitFor(() => expect(lastQuery().get('sort')).toBe('name'));
  expect(screen.getByRole('button', { name: '用这些资料提问' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '存为智能分组' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '用这些资料提问' }));
  await waitFor(() => expect(askScope).toHaveBeenCalledTimes(1));
  expect(askScope.mock.calls[0]?.[0]).toEqual({
    items: [{ source_id: 'src_a', name: '虚构甲库', tag_ids: ['tag_case'] }],
    views: [],
  });
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '存为智能分组' }));
  fireEvent.change(await screen.findByLabelText('分组名'), { target: { value: '虚构精确分组' } });
  fireEvent.click(screen.getByRole('button', { name: '保存', exact: true }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(JSON.parse(String(writes()[0][1].body))).toEqual({
    name: '虚构精确分组',
    filter: { tag_ids: ['tag_case'], source_ids: ['src_a'] },
    layout: 'list',
  });
});
