/**
 * [mycowork] adapted：导入记录页（拆分c，原 officeImportRecords.dom.test.tsx，用例原样）。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ImportsPage } from '@mycowork/ui';
import { batch, fetchMock, md, reply, row, steps, addFiles, confirmButton, bridge } from './importFlowFixture';

const summary = (over: object = {}) => ({
  batch_id: 'imp_1',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  item_count: 2,
  counts: { active: 0, done: 2, failed: 0 },
  destination: { kind: 'archive', name: null },
  secret: false,
  preview_names: ['周报.md', '预算.xlsx'],
  ...over,
});
const pageOf = (items: object[], total = items.length) => ({ items, page: 1, page_size: 20, total });
const detail = (items: object[], over: object = {}) => ({ ...batch(items), batch_id: 'imp_1', secret: false, ...over });
const listCalls = () =>
  fetchMock.mock.calls.filter(([u, i]) => String(u).startsWith('/bridge/v1/import-batches?') && !i?.method);

type Handlers = {
  list?: (q: URLSearchParams) => Promise<unknown> | unknown;
  batch?: (id: string) => Promise<unknown> | unknown;
  retry?: () => unknown;
};
function stub(h: Handlers = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://fixture.invalid');
    if (u.pathname === '/bridge/v1/scopes')
      return reply(200, {
        sources: [
          {
            source_id: 'src_q',
            name: '青禾库',
            provider: 'weknora',
            counts: { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 },
          },
        ],
        projects: [],
      });
    if (u.pathname === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (u.pathname === '/bridge/v1/import-batches' && !init?.method) {
      const r = await (h.list?.(u.searchParams) ?? pageOf([]));
      return r instanceof Error ? reply(503, {}) : reply(200, r);
    }
    const m = u.pathname.match(/^\/bridge\/v1\/import-batches\/([^/]+)(\/retry)?$/);
    if (m && m[2]) return reply(200, h.retry?.() ?? detail([row({})], { revision: 2 }));
    if (m) {
      const r = await (h.batch?.(m[1] as string) ?? detail([row({})]));
      if (r === 503) return reply(503, {});
      return r === 404 ? reply(404, { error: { code: 'NOT_FOUND', message: 'not found' } }) : reply(200, r);
    }
    throw new Error(`未定义的虚构HTTP请求 ${init?.method ?? 'GET'} ${u.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}
const open = (hash = '#/office/imports') => {
  window.location.hash = hash;
  return render(<ImportsPage lang='zh-CN' />);
};
const LONG = { timeout: 4000 };

beforeEach(() => {
  fetchMock.mockReset();
  window.location.hash = '';
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('批次级重试隔离', () => {
  const failedRow = (over: object = {}) =>
    row({
      file_name: 'plain.md',
      status: 'failed',
      error: 'upstream_failed',
      steps: steps('failed', 'pending'),
      ...over,
    });
  async function submitFailed(items: object[]) {
    bridge({ created: batch(items) });
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    const retry: { go: (r: unknown) => void; fail: boolean } = { go: () => undefined, fail: false };
    fetchMock.mockImplementation(async (u: string, i?: RequestInit) => {
      if (String(u).endsWith('/retry'))
        return retry.fail
          ? reply(409, { error: { code: 'REVISION_CONFLICT', message: 'x' } })
          : new Promise((res) => (retry.go = (r) => res(reply(200, r))));
      return base(u, i);
    });
    render(<ImportsPage lang='zh-CN' />);
    fireEvent.click(screen.getByRole('button', { name: '导入资料' }));
    const dialog = await screen.findByRole('dialog');
    await addFiles(dialog, md('plain.md'));
    await screen.findByText('已上传，待确认');
    fireEvent.click(confirmButton());
    await screen.findByLabelText('导入进度');
    return retry;
  }

  it('“只重试失败项”进行中不能“再导入一批”；成功后清掉之前的错误提示', async () => {
    const retry = await submitFailed([failedRow()]);
    retry.fail = true;
    fireEvent.click(screen.getByRole('button', { name: '只重试失败项' }));
    expect(await screen.findByText(/导入失败：/)).toBeInTheDocument(); // 第一次失败（版本冲突）
    retry.fail = false;
    fireEvent.click(screen.getByRole('button', { name: '只重试失败项' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '再导入一批' })).toBeDisabled());
    await act(async () => retry.go(batch([row({ file_name: 'plain.md' })], [], 3)));
    await waitFor(() => expect(screen.queryByText(/导入失败：/)).toBeNull()); // 旧错误清掉
    expect(screen.getByRole('button', { name: '再导入一批' })).toBeEnabled();
  });

  it('重试还在飞时换了新一批（重新选择文件）：旧重试回来不覆盖新草稿', async () => {
    const retry = await submitFailed([
      failedRow({ seq: 0, upload_id: 'up_1' }),
      failedRow({
        seq: 1,
        upload_id: 'up_2',
        file_name: 'gone.md',
        error: 'blob_missing',
        resource_id: null,
        steps: { received: 'done', stored: 'failed', parse: 'skipped', index: 'skipped' },
      }),
    ]);
    fireEvent.click(screen.getAllByRole('button', { name: '重试' })[0] as HTMLElement); // 批次级重试，飞行中
    fireEvent.click(await screen.findByRole('button', { name: '重新选择文件' })); // 开新一批
    expect(screen.queryByLabelText('导入进度')).toBeNull();
    expect(screen.getByRole('button', { name: '确认导入' })).toBeInTheDocument();
    await act(async () => retry.go(batch([row({ file_name: 'plain.md' })], [], 3)));
    expect(screen.queryByLabelText('导入进度')).toBeNull(); // 旧重试的结果没有把批次塞回来
    expect(screen.getByRole('button', { name: '确认导入' })).toBeInTheDocument();
  });
});

describe('路由与竞态', () => {
  it('react-router 的 navigate（pushState，不触发 hashchange）在批次详情与列表之间切换，页面跟着变', async () => {
    const { HashRouter, useNavigate, useLocation } = await import('react-router-dom');
    stub({
      list: () => pageOf([summary({ preview_names: ['列表里的.md'] })]),
      batch: () => detail([row({ file_name: '详情里的.md' })]),
    });
    let go: (to: string) => void = () => undefined;
    const Probe = () => ((go = useNavigate()), null);
    // 与 OfficeImportsSlot 一样订阅路由位置，router 导航会带着页面重渲染
    const Page = () => (useLocation(), (<ImportsPage lang='zh-CN' />));
    window.location.hash = '#/office/imports';
    render(
      <HashRouter>
        <Probe />
        <Page />
      </HashRouter>
    );
    expect(await screen.findByText(/列表里的.md/)).toBeInTheDocument();
    act(() => go('/office/imports?batch=imp_1'));
    expect(await screen.findByText('详情里的.md')).toBeInTheDocument();
    act(() => go('/office/imports'));
    expect(await screen.findByText(/列表里的.md/)).toBeInTheDocument(); // 列表真的渲染出来，不只是地址变了
    expect(screen.queryByText('详情里的.md')).toBeNull();
  });

  it('换筛选后，旧筛选的响应晚到不覆盖新列表', async () => {
    let releaseOld: ((v: unknown) => void) | undefined;
    stub({
      list: (q) =>
        q.get('status') === 'failed'
          ? pageOf([summary({ batch_id: 'imp_f', preview_names: ['新筛选.md'] })])
          : new Promise((r) => (releaseOld = r)),
    });
    open();
    await waitFor(() => expect(releaseOld).toBeDefined());
    fireEvent.click(screen.getByText('有失败'));
    expect(await screen.findByText(/新筛选.md/)).toBeInTheDocument();
    await act(async () => releaseOld?.(pageOf([summary({ batch_id: 'imp_old', preview_names: ['旧响应.md'] })])));
    expect(screen.queryByText(/旧响应.md/)).toBeNull();
    expect(screen.getByText(/新筛选.md/)).toBeInTheDocument();
  });

  it('/scopes 没读到时，详情里的知识库写通用的“知识库”，不写“已不可用”', async () => {
    stub({ batch: () => detail([row({ file_name: 'kb.md', source_id: 'src_q', status: 'ready' })]) });
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation(async (u: string, i?: RequestInit) =>
      String(u) === '/bridge/v1/scopes' ? reply(503, {}) : base(u, i)
    );
    open('#/office/imports?batch=imp_1');
    await screen.findByText('kb.md');
    expect(screen.getByTestId('import-item')).not.toHaveTextContent('已不可用');
    expect(screen.getByTestId('import-item')).toHaveTextContent('知识库');
  });
});
