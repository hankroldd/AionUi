/**
 * [mycowork] adapted：导入记录页（拆分a，原 officeImportRecords.dom.test.tsx，用例原样）。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ImportsPage } from '@mycowork/ui';
import { batch, fetchMock, md, reply, row, bridge } from './importFlowFixture';

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

describe('导入记录列表', () => {
  it('列出本人批次：前几个文件名、项数、去向、进行中 / 失败 / 完成计数；页标题是“导入记录”，动作是“导入资料”', async () => {
    stub({
      list: () =>
        pageOf([
          summary({ counts: { active: 1, done: 0, failed: 1 }, item_count: 2 }),
          summary({
            batch_id: 'imp_2',
            destination: { kind: 'knowledge_base', name: '青禾库' },
            preview_names: ['合同.docx'],
            item_count: 4,
          }),
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
    expect(within(rows[1] as HTMLElement).getByRole('link', { name: '查看' })).toHaveAttribute(
      'href',
      '#/office/imports?batch=imp_2'
    );
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
    await waitFor(() =>
      expect(new URLSearchParams(String(listCalls().at(-1)?.[0]).split('?')[1]).get('status')).toBe('active')
    );
    fireEvent.click(screen.getByText('全部'));
    await waitFor(() =>
      expect(new URLSearchParams(String(listCalls().at(-1)?.[0]).split('?')[1]).get('status')).toBeNull()
    );
  });

  it('加载态是骨架；瞬时读失败由 bridge-client 重试，仍失败才出错误态，点“重试”恢复', async () => {
    let down = true;
    stub({ list: () => (down ? new Error('x') : pageOf([summary()])) });
    open();
    expect(document.querySelector('.arco-skeleton')).not.toBeNull();
    expect(await screen.findByText('没能读取导入记录', {}, LONG)).toBeInTheDocument();
    expect(listCalls()).toHaveLength(3); // 空体 503 属瞬时：bridge-client 一层重试（首发 + delays 两次）；页面层不再叠一层
    down = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByTestId('import-record')).toBeInTheDocument();
  });

  it('首次读到 404：直接出错误态，只发一次请求（读重试只在 bridge-client 一层）', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith('/bridge/v1/import-batches')
        ? reply(404, { error: { code: 'NOT_FOUND', message: 'x' } })
        : reply(200, { sources: [], projects: [], tags: [] })
    );
    vi.stubGlobal('fetch', fetchMock);
    open();
    expect(await screen.findByText('没能读取导入记录', {}, { timeout: 600 })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1000)); // 越过原先的 800ms 静默重试
    expect(listCalls()).toHaveLength(1);
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
    await tick(50_000); // 第三次还没返回（兜底超时 60 秒未到）：不会排第四次
    expect(n).toBe(3);
    await act(async () => release?.(pageOf([summary({ counts: { active: 0, done: 1, failed: 0 } })])));
    await tick(0);
    expect(screen.queryByText(/进行中 \d/)).toBeNull();
    await tick(120_000); // 已无进行中：不再刷新
    expect(n).toBe(3);
  });

  it('后台刷新失败：保留已显示的列表，不换成错误态', async () => {
    let n = 0;
    stub({
      list: () => (++n === 1 ? pageOf([summary({ counts: { active: 1, done: 1, failed: 0 } })]) : new Error('x')),
    });
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
    expect(String(fetchMock.mock.calls.find(([u]) => String(u).includes('/import-batches/'))?.[0])).toBe(
      '/bridge/v1/import-batches/imp_1'
    );
    fireEvent.click(screen.getByRole('button', { name: '回到导入记录' }));
    expect(window.location.hash).toBe('#/office/imports');
  });

  it('非法 id（含路径字符 / 重复参数）：不请求批次，留在列表并说明链接不对', async () => {
    stub();
    for (const hash of [
      '#/office/imports?batch=../x',
      '#/office/imports?batch=bat_1',
      '#/office/imports?batch=imp_1&batch=imp_2',
    ]) {
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
