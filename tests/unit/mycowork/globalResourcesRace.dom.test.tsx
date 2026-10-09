/**
 * [mycowork] PR11 W4-4o。文件：tests/unit/mycowork/globalResourcesRace.dom.test.tsx
 * 职责：PR11 §3.2真实React请求迟到、即时输入隐去旧集合与四态/局部失败的语义测试。
 * 边界：只延迟或失败Bridge HTTP，不mock查询hook，不冒称真实WeKnora或浏览器L3。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import {
  choose,
  deferred,
  fixture,
  FIRST,
  input,
  item,
  lastQuery,
  list,
  nav,
  reads,
  reply,
  reset,
  type Reply,
} from './globalResourceFixture';

beforeEach(reset);
afterEach(() => vi.unstubAllGlobals());
it('初始all请求迟到不能覆盖后来source；旧error也不能盖住后来的成功', async () => {
  const old = deferred<Reply>();
  fixture((q) => (q.has('source_id') ? list([item('res_new', '新源资料.md')], 1) : old.promise));
  render(<ResourcesPage lang='zh-CN' />);
  await screen.findByTestId('mycowork-nav-source-src_a');
  expect(document.querySelector('.arco-skeleton')).not.toBeNull();
  nav('source-src_a');
  await screen.findByRole('button', { name: '新源资料.md' });
  await act(async () => {
    old.resolve(reply(503, { error: { code: 'PROVIDER_UNAVAILABLE', message: 'fictional' } }));
  });
  expect(screen.getByRole('button', { name: '新源资料.md' })).toBeInTheDocument();
  expect(screen.queryByText('资源列表没有读到')).toBeNull();
  expect(screen.getByText('共 1 项')).toBeInTheDocument();
});
it('旧state请求晚到不能覆盖新的type筛选', async () => {
  const old = deferred<Reply>();
  fixture((q) =>
    q.has('file_type')
      ? list([item('res_new', '新PDF.pdf')], 1)
      : q.has('status_group')
        ? old.promise
        : list(FIRST.slice(0, 2), 2)
  );
  render(<ResourcesPage lang='zh-CN' />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  await choose('状态', '不可用');
  await waitFor(() => expect(lastQuery().get('status_group')).toBe('unavailable'));
  await choose('类型', 'PDF');
  await screen.findByRole('button', { name: '新PDF.pdf' });
  await act(async () => {
    old.resolve(list([item('res_old', '旧状态迟到.md')], 1));
  });
  expect(screen.getByRole('button', { name: '新PDF.pdf' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '旧状态迟到.md' })).toBeNull();
});
it('旧q成功晚到不能覆盖更新的q、总数与当前位置', async () => {
  const old = deferred<Reply>();
  fixture((q) =>
    q.get('q') === '旧查询'
      ? old.promise
      : q.has('q')
        ? list([item('res_new', '新查询结果.md')], 1)
        : list(FIRST.slice(0, 2), 2)
  );
  render(<ResourcesPage lang='zh-CN' />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  nav('source-src_a');
  await screen.findByRole('heading', { name: '虚构甲库', exact: true });
  fireEvent.change(input(), { target: { value: '旧查询' } });
  await waitFor(() => expect(lastQuery().get('q')).toBe('旧查询'));
  fireEvent.change(input(), { target: { value: '新查询' } });
  await screen.findByRole('button', { name: '新查询结果.md' });
  await act(async () => {
    old.resolve(list([item('res_old', '旧查询迟到.md')], 98));
  });
  expect(screen.getByRole('button', { name: '新查询结果.md' })).toBeInTheDocument();
  expect(screen.getByText('共 1 项')).toBeInTheDocument();
  expect(screen.queryByText('共 98 项')).toBeNull();
  expect(screen.queryByRole('button', { name: '旧查询迟到.md' })).toBeNull();
  expect(screen.getByTestId('mycowork-nav-source-src_a')).toHaveAttribute('aria-current', 'page');
});
it('旧place成功晚到不能覆盖新imports集合', async () => {
  const old = deferred<Reply>();
  fixture((q) =>
    q.get('source_id') === 'src_a'
      ? old.promise
      : q.get('origin') === 'imports'
        ? list([item('res_import', '新导入集合.md', { origin: 'imports', source_id: null })], 1)
        : list(FIRST.slice(0, 2), 2)
  );
  render(<ResourcesPage lang='zh-CN' />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  nav('source-src_a');
  await waitFor(() => expect(lastQuery().get('source_id')).toBe('src_a'));
  nav('imports');
  await screen.findByRole('button', { name: '新导入集合.md' });
  await act(async () => {
    old.resolve(list([item('res_old', '旧库迟到.md')], 300));
  });
  expect(screen.getByRole('button', { name: '新导入集合.md' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '旧库迟到.md' })).toBeNull();
  expect(screen.getByText('共 1 项')).toBeInTheDocument();
  expect(screen.getByTestId('mycowork-nav-imports')).toHaveAttribute('aria-current', 'page');
});
it('input变化当帧隐藏旧列表，300ms窗口内旧filter响应不能显示；新q胜出', async () => {
  const old = deferred<Reply>();
  fixture((q) =>
    q.has('q')
      ? list([item('res_new', '新q匹配.md')], 1)
      : q.has('status_group')
        ? old.promise
        : list(FIRST.slice(0, 2), 2)
  );
  render(<ResourcesPage lang='zh-CN' />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  await choose('状态', '不可用');
  fireEvent.change(input(), { target: { value: '新查询' } });
  expect(screen.queryByTestId('mycowork-resource-item')).toBeNull();
  const before = reads().length;
  await act(async () => {
    old.resolve(list([item('res_old', '旧filter迟到.md')], 1));
  });
  expect(reads()).toHaveLength(before);
  expect(screen.queryByRole('button', { name: '旧filter迟到.md' })).toBeNull();
  await screen.findByRole('button', { name: '新q匹配.md' });
  expect(lastQuery().get('q')).toBe('新查询');
});
it('partial显示准确成功候选total与失败库人名，重试单查询；空、错误、加载均可识别', async () => {
  const loading = deferred<Reply>();
  let mode = 'partial';
  fixture(() =>
    mode === 'partial'
      ? list([item('res_ok', '仍可管理.md')], 137, 1, { failed_source_ids: ['src_b'] })
      : mode === 'empty'
        ? list([], 0)
        : mode === 'error'
          ? reply(503, { error: { code: 'PROVIDER_UNAVAILABLE', message: 'fictional' } })
          : loading.promise
  );
  render(<ResourcesPage lang='zh-CN' />);
  await screen.findByRole('button', { name: '仍可管理.md' });
  expect(screen.getByText('共 137 项')).toBeInTheDocument();
  const partial = screen
    .getByText('以下知识库暂时读不到：虚构乙库。结果不完整，当前显示已成功读取的资料。')
    .closest('.arco-alert') as HTMLElement;
  expect(partial).toBeInTheDocument();
  expect(screen.queryByText(/src_b/)).toBeNull();
  mode = 'empty';
  fireEvent.click(within(partial).getByRole('button', { name: '重试' }));
  await screen.findByText('空间里还没有资料');
  expect(screen.getByText('共 0 项')).toBeInTheDocument();
  mode = 'error';
  nav('recent');
  await screen.findByText('资源列表没有读到');
  expect(screen.queryByText('共 0 项')).toBeNull();
  expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
  mode = 'loading';
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(document.querySelector('.arco-skeleton')).not.toBeNull());
  expect(screen.queryByTestId('mycowork-resource-item')).toBeNull();
  await act(async () => {
    loading.resolve(list([item('res_back', '恢复后的资料.md')], 1));
  });
  await screen.findByRole('button', { name: '恢复后的资料.md' });
  expect(reads()).toHaveLength(6); // 4 次查询 + 503 那次的 2 次自动重试
});
