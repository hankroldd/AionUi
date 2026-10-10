/**
 * [mycowork] PR03 R013：分页篮子保持跨页ID，取消/空集不扩大范围，Secret与上限不绕过。
 * 只替换同源HTTP边界；真实ScopeChip、Modal、Checkbox与预览读取。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ScopeChip, getScope, setScopeSelection } from '@mycowork/ui';

const request = vi.fn();
const name = (id: number) => `虚构资料${id}.md`;
const row = (id: number) => ({
  resource_id: `res_${id}`,
  file_name: name(id),
  state: 'ready',
  origin: 'kb_native',
  tag_ids: [],
  updated_at: '2026-10-10T00:00:00Z',
  secret: id === 2,
});
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let total = 550;
let failSearch = false;
let resolveLate: ((r: Response) => void) | undefined;
let pending = false;
let pendingSignal: AbortSignal | undefined;
async function browse() {
  fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
  const source = await screen.findByRole('checkbox', { name: /青禾库/ });
  if (!(source as HTMLInputElement).checked) fireEvent.click(source);
  fireEvent.click(screen.getByRole('button', { name: '浏览全部 青禾库' }));
  return screen.findByRole('dialog', { name: '浏览 青禾库' });
}
const confirm = async (dialog: HTMLElement) => {
  fireEvent.click(within(dialog).getByRole('button', { name: '使用已选文件' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '浏览 青禾库' })).not.toBeInTheDocument());
};
const apply = () => fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));

describe('resource basket across pages', () => {
  beforeEach(() => {
    total = 550;
    failSearch = false;
    resolveLate = undefined;
    pending = false;
    pendingSignal = undefined;
    setScopeSelection([]);
    request.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/bridge/v1/scopes')
        return reply({
          projects: [],
          sources: [
            {
              source_id: 'kb_a',
              name: '青禾库',
              counts: { total: 550, ready: 550, indexing: 0, failed: 0, unavailable: 0 },
            },
          ],
        });
      if (url === '/bridge/v1/tags') return reply({ tags: [] });
      if (url === '/bridge/v1/saved-views') return reply({ views: [] });
      if (url.includes('/preview'))
        return new Response('仅供查看的虚构正文', { headers: { 'content-type': 'text/plain' } });
      if (url.startsWith('/bridge/v1/resources?')) {
        const q = new URL(url, 'http://localhost').searchParams;
        if (q.get('q') === '等待' && pending) {
          pendingSignal = init?.signal as AbortSignal;
          return new Promise(() => {});
        }
        if (q.get('q') === '慢')
          return new Promise<Response>((resolve) => {
            resolveLate = resolve;
          });
        if (q.get('q') === '失败' && failSearch)
          return reply({ error: { code: 'FORBIDDEN', message: 'fixture' } }, 403);
        const page = Number(q.get('page') ?? 1);
        const items =
          q.get('q') === '额外'
            ? [row(501)]
            : q.get('q') === '风险'
              ? [row(3)]
              : q.get('q') === '失败'
                ? [row(4)]
                : Array.from({ length: 50 }, (_, i) => row((page - 1) * 50 + i));
        return reply({ items, total: q.get('q') ? 1 : total, page, page_size: 50 });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps off-page and hidden IDs; preview returns to the same query and confirmation is not application', async () => {
    render(<ScopeChip lang='zh-CN' />);
    const dialog = await browse();
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: name(1) }));
    fireEvent.click(dialog.querySelector('.arco-pagination-item-next')!);
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: name(51) }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: '搜索此知识库的文件' }), {
      target: { value: '风险' },
    });
    await within(dialog).findByRole('checkbox', { name: name(3) });
    fireEvent.click(within(dialog).getByRole('button', { name: '选择本页' }));
    const trigger = within(dialog).getByRole('button', { name: `预览 ${name(3)}` });
    fireEvent.click(trigger);
    await screen.findByText('仅供查看的虚构正文');
    fireEvent.click(screen.getByRole('button', { name: '返回选择' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(within(dialog).getByRole('textbox', { name: '搜索此知识库的文件' })).toHaveValue('风险');
    await confirm(dialog);
    expect(getScope().items).toEqual([]);
    apply();
    await waitFor(() => expect(getScope().items[0]?.resource_ids).toEqual(['res_1', 'res_51', 'res_3']));
  });

  it('keeps a newly listed ID after confirmation despite an older complete legacy snapshot', async () => {
    let reads = 0;
    const serve = request.getMockImplementation()!;
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/bridge/v1/resources?')) {
        const items = ++reads === 1 ? [row(1)] : [row(1), row(3)];
        return reply({ items, total: items.length, page: 1, page_size: 50 });
      }
      return serve(url, init);
    });
    setScopeSelection([{ source_id: 'kb_a', name: '青禾库', resource_ids: ['res_1'] }]);
    render(<ScopeChip lang='zh-CN' />);
    fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
    await screen.findByRole('checkbox', { name: name(1), exact: true });
    fireEvent.click(screen.getByRole('button', { name: '浏览全部 青禾库' }));
    const dialog = await screen.findByRole('dialog', { name: '浏览 青禾库' });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: name(3), exact: true }));
    expect(within(dialog).getByText('已选择 2 份')).toBeInTheDocument();
    await confirm(dialog);
    apply();
    await waitFor(() => expect(getScope().items[0]?.resource_ids).toEqual(['res_1', 'res_3']));
  });

  it('narrows on a new tag result and ignores the previous tag response arriving late', async () => {
    let finishOld: ((value: Response) => void) | undefined;
    const serve = request.getMockImplementation()!;
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/bridge/v1/tags')
        return reply({
          tags: [
            { tag_id: 'tag_old', name: '旧标签（虚构）', parent_id: null },
            { tag_id: 'tag_new', name: '新标签（虚构）', parent_id: null },
          ],
        });
      if (url.startsWith('/bridge/v1/resources?')) {
        if (new URL(url, 'http://localhost').searchParams.getAll('tag_id').includes('tag_new'))
          return reply({ items: [row(3)], total: 1, page: 1, page_size: 50 });
        return new Promise<Response>((resolve) => {
          finishOld = resolve;
        });
      }
      return serve(url, init);
    });
    setScopeSelection([{ source_id: 'kb_a', name: '青禾库', tag_ids: ['tag_old'], resource_ids: ['res_1', 'res_3'] }]);
    render(<ScopeChip lang='zh-CN' />);
    fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
    const tags = await screen.findByLabelText('只要带这些标签的（可选）');
    await waitFor(() => expect(finishOld).toBeTypeOf('function'));
    fireEvent.click(tags);
    fireEvent.click(await screen.findByText('新标签（虚构）'));
    await screen.findByRole('checkbox', { name: name(3), exact: true });
    await act(async () => finishOld!(reply({ items: [row(1)], total: 1, page: 1, page_size: 50 })));
    apply();
    await waitFor(() => expect(getScope().items[0]?.resource_ids).toEqual(['res_3']));
    expect(getScope().items[0]?.tag_ids).toContain('tag_new');
  });

  it('cancelling returns focus and leaves the original explicit selection intact', async () => {
    setScopeSelection([{ source_id: 'kb_a', name: '青禾库', resource_ids: ['res_4'] }]);
    render(<ScopeChip lang='zh-CN' />);
    const dialog = await browse();
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: name(1) }));
    fireEvent.click(within(dialog).getByRole('button', { name: '返回范围' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '浏览全部 青禾库' })));
    apply();
    await waitFor(() => expect(getScope().items[0]?.resource_ids).toEqual(['res_4']));
  });

  it('explicitly confirming an empty basket removes that source instead of widening it', async () => {
    setScopeSelection([{ source_id: 'kb_a', name: '青禾库', resource_ids: ['res_4'] }]);
    render(<ScopeChip lang='zh-CN' />);
    const dialog = await browse();
    await within(dialog).findByRole('checkbox', { name: name(4) });
    fireEvent.click(within(dialog).getByRole('button', { name: '清空已选' }));
    await confirm(dialog);
    apply();
    await waitFor(() => expect(getScope().items).toEqual([]));
  });

  it('does not allow new Secret selection or include Secret in page selection', async () => {
    render(<ScopeChip lang='zh-CN' />);
    const dialog = await browse();
    expect(await within(dialog).findByRole('checkbox', { name: name(2) })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '选择本页' }));
    await confirm(dialog);
    apply();
    await waitFor(() => expect(getScope().items[0]?.resource_ids).toHaveLength(49));
    expect(getScope().items[0]?.resource_ids).not.toContain('res_2');
  });

  it('caps additions at 500 while allowing an existing selected item to be removed', async () => {
    setScopeSelection([
      { source_id: 'kb_a', name: '青禾库', resource_ids: Array.from({ length: 500 }, (_, i) => `res_${i}`) },
    ]);
    render(<ScopeChip lang='zh-CN' />);
    const dialog = await browse();
    const selected = await within(dialog).findByRole('checkbox', { name: name(1) });
    expect(selected).not.toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: '搜索此知识库的文件' }), {
      target: { value: '额外' },
    });
    expect(await within(dialog).findByRole('checkbox', { name: name(501) })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: '搜索此知识库的文件' }), { target: { value: '' } });
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: name(1) }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: '搜索此知识库的文件' }), {
      target: { value: '额外' },
    });
    const extra = await within(dialog).findByRole('checkbox', { name: name(501) });
    expect(extra).not.toBeDisabled();
    fireEvent.click(extra);
    await confirm(dialog);
    apply();
    await waitFor(() => expect(getScope().items[0]?.resource_ids).toHaveLength(500));
    expect(getScope().items[0]?.resource_ids).toContain('res_501');
  });

  it('aborts a pending search when the task page unmounts', async () => {
    pending = true;
    const page = render(<ScopeChip lang='zh-CN' />);
    const dialog = await browse();
    await within(dialog).findByRole('checkbox', { name: name(1) });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '搜索此知识库的文件' }), {
      target: { value: '等待' },
    });
    await waitFor(() => expect(pendingSignal).toBeDefined());
    page.unmount();
    expect(pendingSignal!.aborted).toBe(true);
  });
  it('legacy picker also blocks new Secret entries and excludes them from select all', async () => {
    total = 50;
    render(<ScopeChip lang='zh-CN' />);
    fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /青禾库/ }));
    fireEvent.click(screen.getByRole('button', { name: '挑选文件', exact: true }));
    const secret = await screen.findByRole('checkbox', { name: name(2), exact: true });
    expect(secret).toBeDisabled();
    expect(secret).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '全选', exact: true }));
    apply();
    await waitFor(() => expect(getScope().items[0]?.resource_ids).toHaveLength(49));
    expect(getScope().items[0]?.resource_ids).not.toContain('res_2');
  });

  it('ignores a late search and preserves the basket through an HTTP failure and retry', async () => {
    render(<ScopeChip lang='zh-CN' />);
    const dialog = await browse();
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: name(1) }));
    const input = within(dialog).getByRole('textbox', { name: '搜索此知识库的文件' });
    fireEvent.change(input, { target: { value: '慢' } });
    await waitFor(() => expect(resolveLate).toBeDefined());
    fireEvent.change(input, { target: { value: '风险' } });
    await within(dialog).findByRole('checkbox', { name: name(3) });
    await act(async () => {
      resolveLate!(reply({ items: [row(8)], total: 1, page: 1, page_size: 50 }));
    });
    expect(within(dialog).getByRole('checkbox', { name: name(3) })).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox', { name: name(8) })).toBeNull();
    failSearch = true;
    fireEvent.change(input, { target: { value: '失败' } });
    await within(dialog).findByText(/FORBIDDEN/);
    expect(within(dialog).getByText('已选择 1 份')).toBeInTheDocument();
    failSearch = false;
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }));
    await within(dialog).findByRole('checkbox', { name: name(4) });
    await confirm(dialog);
    apply();
    await waitFor(() => expect(getScope().items[0]?.resource_ids).toEqual(['res_1']));
  });
});
