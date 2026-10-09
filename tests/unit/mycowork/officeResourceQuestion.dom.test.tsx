/**
 * [mycowork] 文件：officeResourceQuestion.dom.test.tsx
 * 职责：真实资源页/Arco多选提问、明确ID、来源阻止与准备取消。
 * 边界：只替换Bridge HTTP和Host导航回调；不mock选择/hook，不创建模型会话。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { ResourceList } from '@mycowork/contracts';
import { ResourcesPage } from '@mycowork/ui';
import { BridgeError, type ScopeDraft } from '@mycowork/ui/scope-picker/index.ts';

type Item = ResourceList['items'][number];
const file = (id: string, source: string | null = 'src_a', state: Item['state'] = 'ready'): Item => ({
  resource_id: id,
  file_name: `${id.slice(4).toUpperCase()}.md`,
  source_id: source,
  state,
  origin: source ? 'knowledge_base' : 'imports',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-03T00:00:00Z',
  revision_count: 1,
});
const source = (id: string) => ({
  source_id: id,
  name: id === 'src_a' ? '甲库' : '乙库',
  provider: 'weknora',
  counts: { total: 2, ready: 2, indexing: 0, failed: 0, unavailable: 0 },
});
const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const fetchMock = vi.fn();
let pages: Item[][], sources: ReturnType<typeof source>[], catalogStatus: number, total: number, lang: string;
const host = () => vi.fn<(draft: ScopeDraft, signal: AbortSignal) => Promise<void>>(async () => {});
const mount = (onAskScope = host(), ownerKey = 'user-a') =>
  render(<ResourcesPage lang={lang} ownerKey={ownerKey} onAskScope={onAskScope} />);
const bar = () => screen.getByRole('region', { name: lang === 'en-US' ? 'Selected file actions' : '所选资料的操作' });
const pick = (name = 'A.md') =>
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: `${lang === 'en-US' ? 'Select' : '选择'} ${name}`,
      exact: true,
    })
  );
const ask = () =>
  within(bar()).getByRole('button', {
    name: lang === 'en-US' ? 'Ask with these files' : '用这些资料提问',
    exact: true,
  });
const readCalls = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).split('?')[0] === path).length;
async function ready(name = 'A.md') {
  await screen.findByRole('button', { name, exact: true });
}
function fixtures() {
  fetchMock.mockImplementation(async (url: string) => {
    const parsed = new URL(String(url), 'http://fixture.invalid');
    if (parsed.pathname === '/bridge/v1/scopes')
      return catalogStatus === 200
        ? response(200, { sources, projects: [{ project_id: 'must-not-guess', source_ids: ['src_b'] }] })
        : response(catalogStatus, { error: { code: 'UPSTREAM_UNAVAILABLE' } });
    if (parsed.pathname === '/bridge/v1/tags') return response(200, { tags: [] });
    if (parsed.pathname === '/bridge/v1/saved-views') return response(200, { views: [] });
    if (parsed.pathname === '/bridge/v1/collections') return response(200, { collections: [] });
    if (parsed.pathname === '/bridge/v1/resources') {
      const page = Number(parsed.searchParams.get('page') ?? 1);
      const items = (pages[page - 1] ?? []).filter(
        (r) =>
          (!parsed.searchParams.has('source_id') || r.source_id === parsed.searchParams.get('source_id')) &&
          (!parsed.searchParams.has('q') || r.file_name?.includes(parsed.searchParams.get('q')!))
      );
      return response(200, { items, page, page_size: 50, total, failed_source_ids: [] });
    }
    return response(404, { error: { code: 'NOT_FOUND' } });
  });
}
beforeEach(() => {
  lang = 'zh-CN';
  pages = [[file('res_a'), file('res_b'), file('res_c', 'src_b')]];
  sources = [source('src_a'), source('src_b')];
  catalogStatus = 200;
  total = 3;
  localStorage.clear();
  fetchMock.mockReset();
  fixtures();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 读请求的自动重试在用例里免等退避（产品默认 300/900 ms）
(globalThis as { __mcwReadRetryMs?: number[] }).__mcwReadRetryMs = [0, 0];

describe('selected resource questions', () => {
  it('all currently listed files stay explicit IDs, grouped once by source, with all required IDs and no guessed project', async () => {
    const onAskScope = host();
    mount(onAskScope);
    await ready();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择本页', exact: true }));
    expect(ask()).not.toHaveAttribute('href');
    fireEvent.click(ask());
    await waitFor(() => expect(onAskScope).toHaveBeenCalledTimes(1));
    expect(onAskScope.mock.calls[0][0]).toEqual({
      items: [
        { source_id: 'src_a', name: '甲库', resource_ids: ['res_a', 'res_b'] },
        { source_id: 'src_b', name: '乙库', resource_ids: ['res_c'] },
      ],
      views: [],
      requiredResourceIds: ['res_a', 'res_b', 'res_c'],
    });
    expect(onAskScope.mock.calls[0][1].aborted).toBe(false);
    expect(readCalls('/bridge/v1/context-plans')).toBe(0);
  });
  it('all 50 currently listed files keep a 50-ID whitelist instead of becoming a whole knowledge base', async () => {
    pages = [Array.from({ length: 50 }, (_, i) => file(`res_a${i}`))];
    total = 50;
    sources[0].counts.total = 50;
    sources[0].counts.ready = 50;
    const onAskScope = host();
    mount(onAskScope);
    await ready('A0.md');
    fireEvent.click(screen.getByRole('checkbox', { name: '选择本页', exact: true }));
    fireEvent.click(ask());
    await waitFor(() => expect(onAskScope).toHaveBeenCalledTimes(1));
    const draft = onAskScope.mock.calls[0][0];
    expect(draft.items[0].resource_ids).toEqual(pages[0].map((r) => r.resource_id));
    expect(draft.requiredResourceIds).toHaveLength(50);
    expect(draft.views).toEqual([]);
  });
  it('raw search hides the whole-source ask but explicit selected search results can ask without replacing the input', async () => {
    const onAskScope = host();
    mount(onAskScope);
    await ready();
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_a'));
    const input = screen.getByRole('textbox', { name: '搜索文件名或标签' });
    fireEvent.change(input, { target: { value: 'A' } });
    expect(screen.queryByRole('button', { name: '用这些资料提问' })).toBeNull();
    await ready();
    pick();
    fireEvent.click(ask());
    await waitFor(() => expect(onAskScope).toHaveBeenCalledTimes(1));
    expect(onAskScope.mock.calls[0][0].requiredResourceIds).toEqual(['res_a']);
    expect(input).toHaveValue('A');
  });
  it('Secret mixed with authorized files blocks the whole action, shows the reason, and keeps every checkbox', async () => {
    pages[0][1].secret = true;
    const onAskScope = host();
    mount(onAskScope);
    await ready();
    pick();
    pick('B.md');
    expect(ask()).toBeDisabled();
    expect(ask().getAttribute('title')).toContain('包含 Secret'); // 原因只挂在禁用的按钮上，页面顶部不出提示
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(ask());
    expect(onAskScope).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '选择 A.md', exact: true })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择 B.md', exact: true })).toBeChecked();
  });
  it('a published working draft without a source is blocked instead of borrowing its publication target', async () => {
    pages[0][1] = {
      ...file('res_b', null, 'stored'),
      origin: 'outputs',
      published_to: [{ publication_id: 'pub_fixture', source_id: 'src_a', status: 'published', has_published: true }],
    };
    const onAskScope = host();
    mount(onAskScope);
    await ready();
    pick();
    pick('B.md');
    expect(ask()).toBeDisabled();
    expect(ask().getAttribute('title')).toContain('没有普通知识库来源');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onAskScope).not.toHaveBeenCalled();
    expect(within(bar()).getByText('已选 2 项')).toBeVisible();
  });
  it('authorized indexing, failed and unavailable files remain selected, warn about coverage and all enter the draft', async () => {
    pages = [
      ['indexing', 'failed', 'unavailable'].map((state, i) =>
        file(`res_${String.fromCharCode(97 + i)}`, 'src_a', state as Item['state'])
      ),
    ];
    const onAskScope = host();
    mount(onAskScope);
    await ready();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择本页', exact: true }));
    expect(ask()).toBeEnabled();
    expect(within(bar()).getByRole('alert')).toHaveTextContent('范围仍包含它们');
    fireEvent.click(ask());
    await waitFor(() => expect(onAskScope).toHaveBeenCalledTimes(1));
    expect(onAskScope.mock.calls[0][0].requiredResourceIds).toEqual(['res_a', 'res_b', 'res_c']);
  });
  it('unavailable scope catalog can be retried: the catalog and list are re-read and the question works again', async () => {
    catalogStatus = 503;
    const onAskScope = host();
    mount(onAskScope);
    await ready();
    pick();
    expect(ask()).toBeDisabled();
    expect(ask().getAttribute('title')).toContain('无法确认可选知识库');
    expect(screen.getByRole('alert')).toHaveTextContent('资料服务暂不可用'); // 目录读取失败本身的提示，带重试
    const before = readCalls('/bridge/v1/resources');
    catalogStatus = 200;
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '重试' }));
    await waitFor(() => expect(readCalls('/bridge/v1/resources')).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    // 重读同一查询不再清空选择（列表内容没变）；目录读到后直接就能提问
    await waitFor(() => expect(ask()).toBeEnabled());
    fireEvent.click(ask());
    await waitFor(() => expect(onAskScope).toHaveBeenCalledTimes(1));
  });
  it('a missing source is an explicit authorization failure with no retry that could silently drop its file', async () => {
    sources = [source('src_a')];
    const onAskScope = host();
    mount(onAskScope);
    await ready();
    pick();
    pick('C.md');
    expect(ask()).toBeDisabled();
    expect(ask().getAttribute('title')).toContain('已不在当前授权范围');
    expect(screen.queryByRole('alert')).toBeNull(); // 没有会悄悄去掉这份文件的重试
    expect(ask()).toBeDisabled();
    expect(within(bar()).getByText('已选 2 项')).toBeVisible();
    expect(onAskScope).not.toHaveBeenCalled();
  });
  it('unknown Host failures show localized copy without private details and keep search and selection for retry', async () => {
    const onAskScope = host().mockRejectedValue(new Error('private_path_that_must_not_be_shown'));
    mount(onAskScope);
    await ready();
    pick();
    fireEvent.click(ask());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('未能准备资料范围'));
    expect(screen.queryByText(/private_path_that/)).toBeNull();
    expect(ask()).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: '选择 A.md', exact: true })).toBeChecked();
    onAskScope.mockResolvedValue(undefined);
    fireEvent.click(ask());
    await waitFor(() => expect(onAskScope).toHaveBeenCalledTimes(2));
  });
  it('whole-source ask uses the same Host callback without href or required-file marker', async () => {
    const onAskScope = host();
    mount(onAskScope);
    await ready();
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_a'));
    await ready();
    const button = screen.getByRole('button', { name: '用这些资料提问', exact: true });
    expect(button).not.toHaveAttribute('href');
    fireEvent.click(button);
    await waitFor(() => expect(onAskScope).toHaveBeenCalledTimes(1));
    expect(onAskScope.mock.calls[0][0]).toEqual({ items: [{ source_id: 'src_a', name: '甲库' }], views: [] });
  });
  it('one pending preparation prevents duplicate clicks, reports busy, and selection changes abort before late navigation', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const navigate = vi.fn();
    const onAskScope = host().mockImplementation(async (_draft, signal) => {
      await pending;
      if (!signal.aborted) navigate();
    });
    mount(onAskScope);
    await ready();
    pick();
    fireEvent.click(ask());
    fireEvent.click(ask());
    expect(onAskScope).toHaveBeenCalledTimes(1);
    expect(ask()).toBeDisabled();
    expect(bar()).toHaveAttribute('aria-busy', 'true');
    pick('B.md');
    expect(onAskScope.mock.calls[0][1].aborted).toBe(true);
    await act(async () => finish());
    expect(navigate).not.toHaveBeenCalled();
    expect(ask()).toBeEnabled();
  });
  it('a changed Host navigation context cancels its old preparation and allows a new attempt with the same selected files', async () => {
    let finish!: () => void;
    const onAskScope = host().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const view = mount(onAskScope);
    await ready();
    pick();
    fireEvent.click(ask());
    const next = host();
    view.rerender(<ResourcesPage lang={lang} ownerKey='user-a' onAskScope={next} />);
    expect(onAskScope.mock.calls[0][1].aborted).toBe(true);
    expect(ask()).toBeEnabled();
    await act(async () => finish());
    fireEvent.click(ask());
    await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(next.mock.calls[0][0].requiredResourceIds).toEqual(['res_a']);
  });
  it.each(['query', 'page', 'owner', 'unmount'] as const)(
    '%s changes cancel pending preparation without adopting its late error',
    async (change) => {
      let reject!: (error: Error) => void;
      const onAskScope = host().mockImplementation(
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          })
      );
      total = 51;
      pages.push([file('res_d')]);
      const view = mount(onAskScope);
      await ready();
      pick();
      fireEvent.click(ask());
      const signal = onAskScope.mock.calls[0][1];
      if (change === 'query')
        fireEvent.change(screen.getByRole('textbox', { name: '搜索文件名或标签' }), { target: { value: 'B' } });
      if (change === 'page') fireEvent.click(screen.getByText('2', { selector: '.arco-pagination-item' }));
      if (change === 'owner') view.rerender(<ResourcesPage lang={lang} ownerKey='user-b' onAskScope={onAskScope} />);
      if (change === 'unmount') view.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => reject(new BridgeError('failed')));
      expect(screen.queryByText(/未能准备资料范围/)).toBeNull();
      expect(screen.queryByRole('region', { name: '所选资料的操作' })).toBeNull();
    }
  );
  it('layout switches keep file IDs and English labels still name a keyboard reachable button', async () => {
    lang = 'en-US';
    const onAskScope = host();
    mount(onAskScope);
    await ready();
    pick();
    fireEvent.click(screen.getByLabelText('Grid'));
    expect(screen.getByRole('checkbox', { name: 'Select A.md', exact: true })).toBeChecked();
    ask().focus();
    expect(ask()).toHaveFocus();
    fireEvent.click(ask());
    await waitFor(() => expect(onAskScope).toHaveBeenCalledTimes(1));
    expect(onAskScope.mock.calls[0][0].requiredResourceIds).toEqual(['res_a']);
  });
});
