/**
 * [mycowork] adapted：导入记录页（拆分b，原 officeImportRecords.dom.test.tsx，用例原样）。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ImportsPage } from '@mycowork/ui';
import { peekLocateIntent, clearLocateIntent } from '@mycowork/ui/pages/resources/locate-intent.ts';
import { batch, fetchMock, md, reply, row, steps, addFiles, confirmButton, bridge, posts } from './importFlowFixture';

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

describe('每项回到文件的入口', () => {
  const itemsOf = (rows: object[]) => stub({ batch: () => detail(rows) });
  const within1 = (name: string) =>
    within(screen.getAllByTestId('import-item').find((x) => x.textContent?.includes(name)) as HTMLElement);

  it('stored / 仅存档 / 已完成 / failed 但资源已登记：都有“在空间中查看”，点击去空间', async () => {
    itemsOf([
      row({
        seq: 0,
        upload_id: 'u0',
        file_name: 'a-stored.md',
        status: 'stored',
        resource_id: 'res_a',
        steps: steps('pending'),
      }),
      row({ seq: 1, upload_id: 'u1', file_name: 'b-archive.md', status: 'ready', resource_id: 'res_b' }),
      row({
        seq: 2,
        upload_id: 'u2',
        file_name: 'c-failed.md',
        status: 'failed',
        resource_id: 'res_c',
        error: 'parse_failed',
        steps: steps('failed', 'pending'),
      }),
    ]);
    open('#/office/imports?batch=imp_1');
    await screen.findByText('a-stored.md');
    for (const n of ['a-stored.md', 'b-archive.md', 'c-failed.md'])
      expect(within1(n).getByRole('button', { name: '在空间中查看' })).toBeInTheDocument();
    fireEvent.click(within1('b-archive.md').getByRole('button', { name: '在空间中查看' }));
    expect(window.location.hash).toBe('#/office/space');
    expect(peekLocateIntent()).toEqual({ resourceId: 'res_b', name: 'b-archive.md', place: 'imports' }); // 定位到“导入”入口
    clearLocateIntent();
  });

  it('失败项按原因给动作：回收站 / 编辑占用 / 原件缺失 / 其余重试', async () => {
    itemsOf([
      row({
        seq: 0,
        upload_id: 'u0',
        file_name: 'trashed.md',
        status: 'failed',
        resource_id: 'res_t',
        error: 'resource_trashed',
        steps: steps('failed', 'pending'),
      }),
      row({
        seq: 1,
        upload_id: 'u1',
        file_name: 'locked.md',
        status: 'failed',
        resource_id: null,
        error: 'edit_lease_held',
        steps: { received: 'done', stored: 'failed', parse: 'skipped', index: 'skipped' },
      }),
      row({
        seq: 2,
        upload_id: 'u2',
        file_name: 'gone.md',
        status: 'failed',
        resource_id: null,
        error: 'blob_missing',
        steps: { received: 'done', stored: 'failed', parse: 'skipped', index: 'skipped' },
      }),
      row({
        seq: 3,
        upload_id: 'u3',
        file_name: 'plain.md',
        status: 'failed',
        resource_id: 'res_p',
        error: 'upstream_failed',
        steps: steps('failed', 'pending'),
      }),
    ]);
    open('#/office/imports?batch=imp_1');
    await screen.findByText('trashed.md');
    const trashed = within1('trashed.md');
    expect(trashed.getByRole('link', { name: '去回收站' })).toHaveAttribute('href', '#/office/trash');
    expect(trashed.queryByRole('button', { name: '在空间中查看' })).toBeNull(); // 在回收站里，不指向空间
    expect(trashed.getByRole('button', { name: '重试' })).toBeInTheDocument(); // 从回收站恢复后回来能直接重试，不是死路
    const locked = within1('locked.md');
    expect(locked.queryByRole('link', { name: '查看版本与变化' })).toBeNull(); // Bridge 此时不给 resource_id，无处可跳
    expect(locked.getByRole('button', { name: '重试' })).toBeInTheDocument();
    const gone = within1('gone.md');
    expect(gone.getByRole('button', { name: '重新选择文件' })).toBeInTheDocument();
    expect(gone.queryByRole('button', { name: '重试' })).toBeNull();
    expect(gone.queryByRole('button', { name: '在空间中查看' })).toBeNull(); // 没有资源
    expect(within1('plain.md').getByRole('button', { name: '重试' })).toBeInTheDocument();
    fireEvent.click(gone.getByRole('button', { name: '重新选择文件' }));
    expect(await screen.findByTestId('mycowork-upload-flow')).toBeInTheDocument(); // 打开导入窗口
  });

  it('“重试”只重试失败项（带批次 revision），进行中禁用重复点击，之后重读批次', async () => {
    let calls = 0;
    stub({
      batch: () =>
        detail(
          [
            row({
              file_name: 'plain.md',
              status: 'failed',
              error: 'upstream_failed',
              steps: steps('failed', 'pending'),
            }),
          ],
          { revision: 3 }
        ),
      retry: () => ((calls += 1), detail([row({})], { revision: 4 })),
    });
    open('#/office/imports?batch=imp_1');
    await screen.findByText('plain.md');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(posts('/retry')).toHaveLength(1));
    expect(JSON.parse(String(posts('/retry')[0]?.[1]?.body))).toEqual({ expected_revision: 3 });
    expect(calls).toBe(1);
  });

  it('Secret 批次：写“Secret（只存本机）”，每项只有人工入口，没有询问 / 引用类动作', async () => {
    itemsOf([row({ file_name: '机密.md', resource_id: 'res_s' })]);
    stub({ batch: () => detail([row({ file_name: '机密.md', resource_id: 'res_s' })], { secret: true }) });
    open('#/office/imports?batch=imp_1');
    await screen.findByText('机密.md');
    const item = screen.getByTestId('import-item');
    expect(item).toHaveTextContent('Secret（只存本机）');
    expect(within(item).getByRole('button', { name: '在空间中查看' })).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: /询问|提问|引用|问问|Ask/ })).toBeNull();
    expect(within(item).queryByRole('link', { name: /询问|提问|引用|Ask/ })).toBeNull();
  });
});

describe('步骤“等待 / 处理中”', () => {
  it('只有第一个未完成的步骤是“处理中”，其后的 pending 是“等待”；失败后面的也是“等待”', async () => {
    stub({
      batch: () =>
        detail([
          row({
            seq: 0,
            upload_id: 'u0',
            file_name: 'run.md',
            status: 'stored',
            steps: { received: 'done', stored: 'pending', parse: 'pending', index: 'pending' },
          }),
          row({
            seq: 1,
            upload_id: 'u1',
            file_name: 'bad.md',
            status: 'failed',
            error: 'blob_missing',
            steps: { received: 'done', stored: 'failed', parse: 'pending', index: 'pending' },
          }),
        ]),
    });
    open('#/office/imports?batch=imp_1');
    await screen.findByText('run.md');
    const states = (name: string) =>
      [
        ...(
          screen.getAllByTestId('import-item').find((x) => x.textContent?.includes(name)) as HTMLElement
        ).querySelectorAll('.arco-steps-item-description'),
      ].map((e) => e.textContent);
    expect(states('run.md')).toEqual(['完成', '处理中', '等待', '等待']);
    expect(states('bad.md')).toEqual(['完成', expect.stringContaining('原件找不到了'), '等待', '等待']);
  });
});

describe('受理后回得去', () => {
  it('上传受理后给“查看本次导入”，链接指向该批次；关闭弹窗后在列表里仍找得到', async () => {
    bridge({ created: { ...batch([row({})]), batch_id: 'imp_new' } });
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    const list = vi.fn(() => pageOf([]));
    fetchMock.mockImplementation(async (u: string, i?: RequestInit) =>
      String(u).startsWith('/bridge/v1/import-batches?') ? reply(200, list()) : base(u, i)
    );
    render(<ImportsPage lang='zh-CN' />);
    fireEvent.click(screen.getByRole('button', { name: '导入资料' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('导入资料', { selector: '.arco-modal-title' })).toBeInTheDocument();
    expect(within(dialog).getByText(/选择文件后先上传暂存，确认后才登记为资料/)).toBeInTheDocument();
    await addFiles(dialog, md('周报.md'));
    await screen.findByText('已上传，待确认');
    fireEvent.click(confirmButton());
    const link = await screen.findByRole('link', { name: '查看本次导入' });
    expect(link).toHaveAttribute('href', '#/office/imports?batch=imp_new');
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2)); // 受理后列表重读
  });
});
