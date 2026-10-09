/**
 * [mycowork] PR11 W4-9 ②：同名文件“作为新版本导入”的界面选项（packages/ui/src/pages/imports，R020）。
 * 职责：待导入文件与本人已有资源同名但内容不同时给三选一（作为新版本 / 另存为独立资料（默认）/ 取消这一项）；选新版本请求带
 *       target_resource_id 且不带 duplicate_action；结果写“已成为 X 的第 N 版”；同内容、ZIP、Secret、查询失败、非精确同名都不出这个选项。
 * 边界：真实 ImportsPage、UploadFlow 与 Arco，只替换 fetch（importFlowFixture）；同名候选来自 GET /resources?origin=imports&q=<名>。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { addFiles, batch, bodyOf, bridge, confirmButton, fetchMock, md, posts, renderImports, reply, row, zip, type Opts } from './importFlowFixture';

const inFlow = () => screen.getByTestId('mycowork-upload-flow');
const res = (id: string, name: string, over: object = {}) => ({
  resource_id: id,
  file_name: name,
  secret: false,
  source_id: null,
  updated_at: '2026-10-01T02:00:00Z',
  ...over,
});
const found = (...items: object[]): Opts['resources'] => () => ({ page: 1, page_size: 50, total: items.length, items });
const lookups = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/bridge/v1/resources?')).map(([url]) => new URLSearchParams(String(url).split('?')[1]));
async function add(file: File = md('周报.md')) {
  renderImports('zh-CN');
  await addFiles(inFlow(), file);
  await screen.findByText('已上传，待确认');
}
const choice = (label: string | RegExp) => within(within(inFlow()).getByRole('radiogroup')).getByText(label);

beforeEach(() => {
  fetchMock.mockReset();
  window.location.hash = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('作为新版本导入', () => {
  it('有本人同名资源：出三选一，默认“另存为独立资料”，请求不带 target_resource_id', async () => {
    bridge({ resources: found(res('res_old', '周报.md')) });
    await add();
    expect(screen.getByText(/你已有同名资料“周报.md”，内容不同/)).toBeInTheDocument();
    const group = within(inFlow()).getByRole('radiogroup');
    expect(within(group).getAllByRole('radio').map((r) => r.parentElement?.textContent)).toEqual([
      '作为“周报.md”的新版本',
      '另存为独立资料',
      '取消这一项',
    ]);
    expect(within(group).getByRole('radio', { name: '另存为独立资料' })).toBeChecked();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts('/import-batches')).toHaveLength(1));
    expect(bodyOf().items[0]).toEqual({ upload_id: 'up_1', purpose: 'working', duplicate_action: 'register_separately' });
  });

  it('查询用现有列表接口：origin=imports、q=文件名、按最近变化排序', async () => {
    bridge({ resources: found(res('res_old', '周报.md')) });
    await add();
    const q = lookups()[0];
    expect(q?.get('origin')).toBe('imports');
    expect(q?.get('q')).toBe('周报.md');
    expect(q?.get('sort')).toBe('updated');
  });

  it('选“作为新版本”：请求项带 target_resource_id、不带 duplicate_action；结果写“已成为 X 的第 N 版”', async () => {
    bridge({
      resources: found(res('res_old', '周报.md')),
      created: batch([row({ upload_id: 'up_1', resource_id: 'res_old', status: 'ready' })]),
      revisionTotal: 3,
    });
    await add();
    fireEvent.click(choice(/作为“周报.md”的新版本/));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts('/import-batches')).toHaveLength(1));
    expect(bodyOf().items[0]).toEqual({ upload_id: 'up_1', purpose: 'working', target_resource_id: 'res_old' });
    expect(await screen.findByText('已成为“周报.md”的第 3 版')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/bridge/v1/resources/res_old/revisions')).toBe(true);
    // 成为新版本的项：除了“在空间中查看”，还给“查看版本与变化”（跳该资源的版本页）
    expect(screen.getByRole('link', { name: '查看版本与变化' })).toHaveAttribute('href', '#/office/resources/res_old/versions');
    expect(screen.getByRole('button', { name: '在空间中查看' })).toBeInTheDocument();
  });

  it('选“另存为独立资料”后结果里不出现“已成为”', async () => {
    bridge({ resources: found(res('res_old', '周报.md')), created: batch([row({ resource_id: 'res_new' })]) });
    await add();
    fireEvent.click(choice('另存为独立资料'));
    fireEvent.click(confirmButton());
    expect(await screen.findByTestId('import-item')).toBeInTheDocument();
    expect(screen.queryByTestId('import-version')).toBeNull();
  });

  it('“取消这一项”：移除该文件，没有可导入的文件时不能确认', async () => {
    bridge({ resources: found(res('res_old', '周报.md')) });
    await add();
    fireEvent.click(choice('取消这一项'));
    await waitFor(() => expect(screen.queryByTestId('import-draft')).toBeNull());
    expect(confirmButton()).toBeDisabled();
    expect(posts('/import-batches')).toHaveLength(0);
  });

  it('版本数读不到时只写“已成为 X 的新版本”', async () => {
    bridge({ resources: found(res('res_old', '周报.md')), created: batch([row({ resource_id: 'res_old' })]) });
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation(async (u: string, i?: RequestInit) =>
      u.endsWith('/revisions') ? reply(503, {}) : base(u, i),
    );
    await add();
    fireEvent.click(choice(/新版本/));
    fireEvent.click(confirmButton());
    expect(await screen.findByText('已成为“周报.md”的新版本')).toBeInTheDocument();
  });

  it('只是名称包含（不是精确同名）或候选是 Secret：不出选项', async () => {
    bridge({ resources: found(res('res_a', '周报.md.bak'), res('res_b', '周报.md', { secret: true })) });
    await add();
    expect(within(inFlow()).queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText(/你已有同名资料/)).toBeNull();
  });

  it('同内容（hash 相同）仍是“引用已有 / 另登记”二选一，不查同名也不出新版本', async () => {
    bridge({ upload: () => ({ duplicate_of: ['res_old'] }), resources: found(res('res_old', '周报.md')) });
    await add();
    expect(screen.getByText('引用已有资源')).toBeInTheDocument();
    expect(screen.queryByText(/新版本/)).toBeNull();
    expect(lookups()).toHaveLength(0);
  });

  it('ZIP 不查同名、不出新版本选项', async () => {
    bridge({ resources: found(res('res_old', '资料包.zip')) });
    await add(zip('资料包.zip'));
    expect(within(inFlow()).queryByRole('radiogroup')).toBeNull();
    expect(lookups()).toHaveLength(0);
  });

  it('勾 Secret：选项隐藏，请求不带 target_resource_id（Bridge 会 400）', async () => {
    bridge({ resources: found(res('res_old', '周报.md')) });
    await add();
    fireEvent.click(choice(/新版本/));
    fireEvent.click(screen.getByRole('checkbox', { name: /设为 Secret/ }));
    expect(within(inFlow()).queryByRole('radiogroup')).toBeNull();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts('/import-batches')).toHaveLength(1));
    expect(bodyOf().items[0]).toEqual({ upload_id: 'up_1', purpose: 'working', duplicate_action: 'register_separately' });
    expect(bodyOf().secret).toBe(true);
  });

  it('同名查询失败：单独提示“没能查到是否已有同名资料”并可重试，不当作没有；仍可导入', async () => {
    bridge({ resources: found(res('res_old', '周报.md')) });
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    let down = true;
    fetchMock.mockImplementation(async (u: string, i?: RequestInit) =>
      u.startsWith('/bridge/v1/resources?') && down ? reply(503, {}) : base(u, i),
    );
    await add();
    expect(within(inFlow()).queryByRole('radiogroup')).toBeNull();
    expect(screen.getByTestId('import-lookup-failed')).toHaveTextContent('没能查到是否已有同名资料');
    expect(confirmButton()).toBeEnabled();
    down = false;
    fireEvent.click(within(screen.getByTestId('import-lookup-failed')).getByRole('button', { name: '重试' }));
    expect(await screen.findByText(/你已有同名资料“周报.md”/)).toBeInTheDocument();
    expect(screen.queryByTestId('import-lookup-failed')).toBeNull();
  });

  it('多份精确同名：全部列出（各带库名 / 更新时间），默认仍是另存为独立资料，由用户选其中一份', async () => {
    bridge({
      resources: found(
        res('res_new', '周报.md', { updated_at: '2026-10-03T02:00:00Z' }),
        res('res_older', '周报.md', { updated_at: '2026-10-01T02:00:00Z' }),
      ),
    });
    await add();
    expect(screen.getByText(/你已有 2 份同名资料“周报.md”/)).toBeInTheDocument();
    const group = within(inFlow()).getByRole('radiogroup');
    expect(within(group).getAllByRole('radio')).toHaveLength(4); // 两份候选 + 另存为 + 取消
    expect(within(group).getByRole('radio', { name: '另存为独立资料' })).toBeChecked();
    expect(within(group).getAllByText(/最近更新于 .*，仅存档/)).toHaveLength(2);
    fireEvent.click(within(group).getAllByText(/作为“周报.md”的新版本/)[1] as HTMLElement); // 第二份：较早的
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts('/import-batches')).toHaveLength(1));
    expect(bodyOf().items[0].target_resource_id).toBe('res_older');
  });

  it('多份同名时不改选，请求仍是另存为独立资料（不替用户选目标）', async () => {
    bridge({ resources: found(res('res_new', '周报.md'), res('res_older', '周报.md')) });
    await add();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts('/import-batches')).toHaveLength(1));
    expect(bodyOf().items[0]).toEqual({ upload_id: 'up_1', purpose: 'working', duplicate_action: 'register_separately' });
  });

  it('不是本人的资料（can_mark_secret 为 false）不作为新版本的候选', async () => {
    bridge({ resources: found(res('res_other', '周报.md', { can_mark_secret: false })) });
    await add();
    expect(within(inFlow()).queryByRole('radiogroup')).toBeNull();
  });

  it('第 2 页没查成但第 1 页已有候选：提示“可能没列全”并可重试', async () => {
    const filler = Array.from({ length: 49 }, (_, n) => res(`res_f${n}`, `周报.md.副本${n}`));
    let page2Down = true;
    bridge({
      resources: (q) =>
        q.get('page') === '2'
          ? ((page2Down ? undefined : { page: 2, page_size: 50, total: 51, items: [res('res_p2', '周报.md', { updated_at: '2026-09-01T00:00:00Z' })] }) as object)
          : { page: 1, page_size: 50, total: 51, items: [...filler, res('res_p1', '周报.md')] },
    });
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation(async (u: string, i?: RequestInit) =>
      page2Down && String(u).startsWith('/bridge/v1/resources?') && new URLSearchParams(String(u).split('?')[1]).get('page') === '2'
        ? reply(503, {})
        : base(u, i),
    );
    await add();
    expect(await screen.findByTestId('import-lookup-partial')).toHaveTextContent('可能没列全');
    expect(within(inFlow()).getByRole('radiogroup')).toBeInTheDocument();
    page2Down = false;
    fireEvent.click(within(screen.getByTestId('import-lookup-partial')).getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByTestId('import-lookup-partial')).toBeNull());
    expect(screen.getByText(/你已有 2 份同名资料/)).toBeInTheDocument();
  });

  it('英文界面', async () => {
    bridge({ resources: found(res('res_old', 'r.md')), created: batch([row({ resource_id: 'res_old' })]), revisionTotal: 2 });
    renderImports('en');
    await addFiles(inFlow(), md('r.md'));
    await screen.findByText('Uploaded, awaiting confirmation');
    expect(screen.getByText(/You already have a resource named “r.md” with different content/)).toBeInTheDocument();
    fireEvent.click(within(within(inFlow()).getByRole('radiogroup')).getByText('As a new version of “r.md”'));
    fireEvent.click(confirmButton('en'));
    expect(await screen.findByText('Became version 2 of “r.md”')).toBeInTheDocument();
  });

  it('后端拒绝新版本项（目标已删 / 无权，404）：提示改选独立资料；改选后结果不写“已成为”', async () => {
    bridge({ resources: found(res('res_old', '周报.md')), created: batch([row({ resource_id: 'res_old' })]) });
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
    let first = true;
    fetchMock.mockImplementation(async (u: string, i?: RequestInit) => {
      if (u === '/bridge/v1/import-batches' && i?.method === 'POST' && first) {
        first = false;
        return reply(404, { error: { code: 'NOT_FOUND', message: 'x' } });
      }
      return base(u, i);
    });
    await add();
    fireEvent.click(choice(/新版本/));
    fireEvent.click(confirmButton());
    expect(await screen.findByText('要更新的同名资料已不在或无权更新，请改选“另存为独立资料”')).toBeInTheDocument();
    expect(screen.queryByText(/请重试/)).toBeNull();
    fireEvent.click(choice('另存为独立资料'));
    fireEvent.click(confirmButton());
    expect(await screen.findByTestId('import-item')).toBeInTheDocument();
    expect(screen.queryByTestId('import-version')).toBeNull();
    expect(bodyOf(1).items[0]).toEqual({ upload_id: 'up_1', purpose: 'working', duplicate_action: 'register_separately' });
  });

  it('新版本项原件没保存成功，或后端落到的不是目标资源：不写“已成为”', async () => {
    const failedStep = { received: 'done', stored: 'failed', parse: 'skipped', index: 'skipped' };
    bridge({
      resources: found(res('res_old', '周报.md')),
      created: batch([row({ resource_id: 'res_old', status: 'failed', steps: failedStep, error: 'blob_missing' })]),
    });
    await add();
    fireEvent.click(choice(/新版本/));
    fireEvent.click(confirmButton());
    expect(await screen.findByTestId('import-item')).toBeInTheDocument();
    expect(screen.queryByTestId('import-version')).toBeNull();
  });

  it('后端落到别的资源：不写“已成为”', async () => {
    bridge({ resources: found(res('res_old', '周报.md')), created: batch([row({ resource_id: 'res_other' })]) });
    await add();
    fireEvent.click(choice(/新版本/));
    fireEvent.click(confirmButton());
    expect(await screen.findByTestId('import-item')).toBeInTheDocument();
    expect(screen.queryByTestId('import-version')).toBeNull();
  });

  it('选项旁写明最近更新时间与所在库 / 仅存档，多份同名时看得出是哪一份', async () => {
    bridge({ resources: found(res('res_old', '周报.md')) });
    await add();
    expect(screen.getByText(/最近更新于 .*，仅存档/)).toBeInTheDocument();
  });

  it('同名候选在第 2 页才出现也找得到', async () => {
    const filler = Array.from({ length: 50 }, (_, n) => res(`res_f${n}`, `周报.md.副本${n}`));
    bridge({
      resources: (q) =>
        q.get('page') === '2'
          ? { page: 2, page_size: 50, total: 51, items: [res('res_p2', '周报.md')] }
          : { page: 1, page_size: 50, total: 51, items: filler },
    });
    await add();
    expect(within(inFlow()).getByRole('radiogroup')).toBeInTheDocument();
    expect(lookups().map((q) => q.get('page'))).toEqual(['1', '2']);
  });
});
