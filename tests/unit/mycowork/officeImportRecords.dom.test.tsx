/**
 * [mycowork] PR04 导入记录（A305）：导入记录页（packages/ui/src/pages/imports/ImportsPage、RecordsList、BatchDetail、ItemActions）。
 * 职责：批次列表（时间 / 去向 / 项数 / 计数、筛选、空态、加载态、错误态带重试、有进行中时静默刷新并退避）；`?batch=` 的合法 / 非法 / 无权三种；
 *       每类条目的“回到文件”入口与失败后的下一步；Secret 项没有 AI 动作；批次详情里步骤“等待 / 处理中”的区分；受理后的“查看本次导入”。
 * 边界：真实 ImportsPage 与 Arco，只替换 fetch（虚构数据）；定时器只伪造 setTimeout / clearTimeout。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ImportsPage } from '@mycowork/ui';
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
      return reply(200, { sources: [{ source_id: 'src_q', name: '青禾库', provider: 'weknora', counts: { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 } }], projects: [] });
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

describe('导入记录列表', () => {
  it('列出本人批次：前几个文件名、项数、去向、进行中 / 失败 / 完成计数；页标题是“导入记录”，动作是“导入资料”', async () => {
    stub({
      list: () =>
        pageOf([
          summary({ counts: { active: 1, done: 0, failed: 1 }, item_count: 2 }),
          summary({ batch_id: 'imp_2', destination: { kind: 'knowledge_base', name: '青禾库' }, preview_names: ['合同.docx'], item_count: 4 }),
          summary({ batch_id: 'imp_3', destination: { kind: 'knowledge_base', name: null } }),
          summary({ batch_id: 'imp_4', secret: true }),
        ]),
    });
    open();
    expect(screen.getByRole('heading', { name: '导入记录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入资料' })).toBeInTheDocument();
    const rows = await screen.findAllByTestId('import-record');
    expect(rows).toHaveLength(4);
    expect(within(rows[0] as HTMLElement).getByText('进行中 1')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('失败 1')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('周报.md、预算.xlsx');
    expect(rows[0]).toHaveTextContent('2 个文件');
    expect(rows[0]).toHaveTextContent('仅存档');
    expect(rows[1]).toHaveTextContent('等 3 个文件');
    expect(rows[1]).toHaveTextContent('知识库：青禾库');
    expect(rows[2]).toHaveTextContent('知识库已不可用'); // 库已删 / 无权：如实说
    expect(rows[3]).toHaveTextContent('Secret（只存本机）');
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: '查看' })).toHaveAttribute('href', '#/office/imports?batch=imp_2');
  });

  it('空态有说明与下一步；筛选“进行中 / 有失败”带 status 请求，筛选后为空给另一句', async () => {
    stub({ list: (q) => (q.get('status') ? pageOf([]) : pageOf([])) });
    open();
    expect(await screen.findByText('还没有导入记录')).toBeInTheDocument();
    expect(screen.getByText(/点右上角“导入资料”/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('有失败'));
    expect(await screen.findByText('没有符合条件的导入')).toBeInTheDocument();
    expect(new URLSearchParams(String(listCalls().at(-1)?.[0]).split('?')[1]).get('status')).toBe('failed');
    fireEvent.click(screen.getByText('进行中'));
    await waitFor(() => expect(new URLSearchParams(String(listCalls().at(-1)?.[0]).split('?')[1]).get('status')).toBe('active'));
    fireEvent.click(screen.getByText('全部'));
    await waitFor(() => expect(new URLSearchParams(String(listCalls().at(-1)?.[0]).split('?')[1]).get('status')).toBeNull());
  });

  it('加载态是骨架；读失败先静默重试一次，仍失败才出错误态，点“重试”恢复', async () => {
    let down = true;
    stub({ list: () => (down ? new Error('x') : pageOf([summary()])) });
    open();
    expect(document.querySelector('.arco-skeleton')).not.toBeNull();
    expect(await screen.findByText('没能读取导入记录', {}, LONG)).toBeInTheDocument();
    expect(listCalls().length).toBeGreaterThanOrEqual(2); // 先静默重试过一次
    down = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByTestId('import-record')).toBeInTheDocument();
  });

  it('有进行中的批次：静默刷新，间隔 5 秒起退避，上一拍没返回不排下一拍；没有进行中就不刷', async () => {
    let n = 0;
    let release: ((v: unknown) => void) | undefined;
    stub({
      list: () => {
        n += 1;
        if (n === 3) return new Promise((r) => (release = r)); // 第三次读取挂起
        return pageOf([summary({ counts: { active: 1, done: 0, failed: 0 } })]);
      },
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    open();
    const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
    await tick(0);
    expect(screen.getByTestId('import-record')).toBeInTheDocument();
    await tick(4900);
    expect(n).toBe(1);
    await tick(200); // 5 秒
    expect(n).toBe(2);
    await tick(9800);
    expect(n).toBe(2);
    await tick(300); // 再 10 秒
    expect(n).toBe(3);
    await tick(120_000); // 第三次还没返回：不会排第四次
    expect(n).toBe(3);
    release?.(pageOf([summary({ counts: { active: 0, done: 1, failed: 0 } })]));
    await tick(0);
    expect(screen.queryByText(/进行中 \d/)).toBeNull();
    await tick(120_000); // 已无进行中：不再刷新
    expect(n).toBe(3);
  });

  it('后台刷新失败：保留已显示的列表，不换成错误态', async () => {
    let n = 0;
    stub({ list: () => (++n === 1 ? pageOf([summary({ counts: { active: 1, done: 1, failed: 0 } })]) : new Error('x')) });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    open();
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(screen.getByTestId('import-record')).toBeInTheDocument();
    await act(async () => void (await vi.advanceTimersByTimeAsync(5100)));
    expect(n).toBe(2);
    expect(screen.getByTestId('import-record')).toBeInTheDocument();
    expect(screen.queryByText('没能读取导入记录')).toBeNull();
  });

  it('页面不可见时不刷新，回到可见立即补读', async () => {
    let n = 0;
    stub({ list: () => (++n, pageOf([summary({ counts: { active: 1, done: 0, failed: 0 } })])) });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    open();
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
    expect(n).toBe(1);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => void (await vi.advanceTimersByTimeAsync(6000)));
    expect(n).toBe(1);
    vis.mockReturnValue('visible');
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    expect(n).toBe(2);
    vis.mockRestore();
  });
});

describe('?batch= 批次详情', () => {
  it('合法 id：显示该批每项进度；返回回到列表', async () => {
    stub({ batch: () => detail([row({ file_name: '周报.md', resource_id: 'res_1' })]) });
    open('#/office/imports?batch=imp_1');
    expect(await screen.findByText('周报.md')).toBeInTheDocument();
    expect(screen.getByLabelText('导入进度')).toBeInTheDocument();
    expect(String(fetchMock.mock.calls.find(([u]) => String(u).includes('/import-batches/'))?.[0])).toBe('/bridge/v1/import-batches/imp_1');
    fireEvent.click(screen.getByRole('button', { name: '回到导入记录' }));
    expect(window.location.hash).toBe('#/office/imports');
  });

  it('非法 id（含路径字符 / 重复参数）：不请求批次，留在列表并说明链接不对', async () => {
    stub();
    for (const hash of ['#/office/imports?batch=../x', '#/office/imports?batch=bat_1', '#/office/imports?batch=imp_1&batch=imp_2']) {
      const view = open(hash);
      expect(await screen.findByText('这个链接里的批次编号不正确')).toBeInTheDocument();
      expect(await screen.findByText('还没有导入记录')).toBeInTheDocument();
      view.unmount();
    }
    expect(fetchMock.mock.calls.some(([u]) => /\/import-batches\/[^?]/.test(String(u)))).toBe(false);
  });

  it('批次不存在或不是本人的（404）：人话说明与“回到导入记录”，不空白', async () => {
    stub({ batch: () => 404 });
    open('#/office/imports?batch=imp_other');
    expect(await screen.findByText('没有找到这批导入，或它不属于当前账号', {}, LONG)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回到导入记录' })).toBeInTheDocument();
  });

  it('其他读失败：带重试，不当作“不存在”', async () => {
    let down = true;
    stub({ batch: () => (down ? 503 : detail([row({ file_name: '好的.md' })])) });
    open('#/office/imports?batch=imp_1');
    expect(await screen.findByText('没能读取这批导入', {}, LONG)).toBeInTheDocument();
    expect(screen.queryByText('没有找到这批导入，或它不属于当前账号')).toBeNull();
    down = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('好的.md')).toBeInTheDocument();
  });
});

describe('每项回到文件的入口', () => {
  const itemsOf = (rows: object[]) => stub({ batch: () => detail(rows) });
  const within1 = (name: string) => within(screen.getAllByTestId('import-item').find((x) => x.textContent?.includes(name)) as HTMLElement);

  it('stored / 仅存档 / 已完成 / failed 但资源已登记：都有“在空间中查看”，点击去空间', async () => {
    itemsOf([
      row({ seq: 0, upload_id: 'u0', file_name: 'a-stored.md', status: 'stored', resource_id: 'res_a', steps: steps('pending') }),
      row({ seq: 1, upload_id: 'u1', file_name: 'b-archive.md', status: 'ready', resource_id: 'res_b' }),
      row({ seq: 2, upload_id: 'u2', file_name: 'c-failed.md', status: 'failed', resource_id: 'res_c', error: 'parse_failed', steps: steps('failed', 'pending') }),
    ]);
    open('#/office/imports?batch=imp_1');
    await screen.findByText('a-stored.md');
    for (const n of ['a-stored.md', 'b-archive.md', 'c-failed.md']) expect(within1(n).getByRole('button', { name: '在空间中查看' })).toBeInTheDocument();
    fireEvent.click(within1('b-archive.md').getByRole('button', { name: '在空间中查看' }));
    expect(window.location.hash).toBe('#/office/space');
  });

  it('失败项按原因给动作：回收站 / 编辑占用 / 原件缺失 / 其余重试', async () => {
    itemsOf([
      row({ seq: 0, upload_id: 'u0', file_name: 'trashed.md', status: 'failed', resource_id: 'res_t', error: 'resource_trashed', steps: steps('failed', 'pending') }),
      row({ seq: 1, upload_id: 'u1', file_name: 'locked.md', status: 'failed', resource_id: 'res_l', error: 'edit_lease_held', steps: { received: 'done', stored: 'failed', parse: 'skipped', index: 'skipped' } }),
      row({ seq: 2, upload_id: 'u2', file_name: 'gone.md', status: 'failed', resource_id: null, error: 'blob_missing', steps: { received: 'done', stored: 'failed', parse: 'skipped', index: 'skipped' } }),
      row({ seq: 3, upload_id: 'u3', file_name: 'plain.md', status: 'failed', resource_id: 'res_p', error: 'upstream_failed', steps: steps('failed', 'pending') }),
    ]);
    open('#/office/imports?batch=imp_1');
    await screen.findByText('trashed.md');
    const trashed = within1('trashed.md');
    expect(trashed.getByRole('link', { name: '去回收站' })).toHaveAttribute('href', '#/office/trash');
    expect(trashed.queryByRole('button', { name: '在空间中查看' })).toBeNull(); // 在回收站里，不指向空间
    expect(trashed.queryByRole('button', { name: '重试' })).toBeNull();
    const locked = within1('locked.md');
    expect(locked.getByRole('link', { name: '查看版本与变化' })).toHaveAttribute('href', '#/office/resources/res_l/versions');
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
    stub({ batch: () => detail([row({ file_name: 'plain.md', status: 'failed', error: 'upstream_failed', steps: steps('failed', 'pending') })], { revision: 3 }), retry: () => (calls += 1, detail([row({})], { revision: 4 })) });
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
          row({ seq: 0, upload_id: 'u0', file_name: 'run.md', status: 'stored', steps: { received: 'done', stored: 'pending', parse: 'pending', index: 'pending' } }),
          row({ seq: 1, upload_id: 'u1', file_name: 'bad.md', status: 'failed', error: 'blob_missing', steps: { received: 'done', stored: 'failed', parse: 'pending', index: 'pending' } }),
        ]),
    });
    open('#/office/imports?batch=imp_1');
    await screen.findByText('run.md');
    const states = (name: string) =>
      [...(screen.getAllByTestId('import-item').find((x) => x.textContent?.includes(name)) as HTMLElement).querySelectorAll('.arco-steps-item-description')].map((e) => e.textContent);
    expect(states('run.md')).toEqual(['完成', '处理中', '等待', '等待']);
    expect(states('bad.md')).toEqual(['完成', expect.stringContaining('原件已不在'), '等待', '等待']);
  });
});

describe('受理后回得去', () => {
  it('上传受理后给“查看本次导入”，链接指向该批次；关闭弹窗后在列表里仍找得到', async () => {
    bridge({ created: { ...batch([row({})]), batch_id: 'imp_new' } });
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    const list = vi.fn(() => pageOf([]));
    fetchMock.mockImplementation(async (u: string, i?: RequestInit) =>
      String(u).startsWith('/bridge/v1/import-batches?') ? reply(200, list()) : base(u, i),
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

describe('批次级重试隔离', () => {
  const failedRow = (over: object = {}) =>
    row({ file_name: 'plain.md', status: 'failed', error: 'upstream_failed', steps: steps('failed', 'pending'), ...over });
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
      failedRow({ seq: 1, upload_id: 'up_2', file_name: 'gone.md', error: 'blob_missing', resource_id: null, steps: { received: 'done', stored: 'failed', parse: 'skipped', index: 'skipped' } }),
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
