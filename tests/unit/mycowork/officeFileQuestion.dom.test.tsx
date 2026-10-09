/**
 * 文件：officeFileQuestion.dom.test.tsx
 * 职责：真实资源页与全屏 Arco 预览的单文件问题、精确范围、资格拒绝与准备取消。
 * 边界：仅替换 Bridge HTTP 和 Host 导航回调，不替换预览、资源页或范围规则。
 */
import React from 'react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResourcesPage, type ScopeDraft } from '@mycowork/ui';

const fetchMock = vi.fn();
const ask = vi.fn<(draft: ScopeDraft, signal: AbortSignal, question?: string) => Promise<void>>();
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => structuredClone(body),
});
const file = (resource_id: string, file_name: string) => ({
  resource_id,
  file_name,
  source_id: 'src_fixture',
  origin: 'knowledge_base',
  state: 'ready',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  revision_count: 0,
  updated_at: '2026-10-04T00:00:00Z',
});
let files: ReturnType<typeof file>[];
let catalogStatus = 200;
let pendingCatalog: Promise<ReturnType<typeof reply>> | undefined;
const catalog = {
  sources: [
    {
      source_id: 'src_fixture',
      name: '虚构库',
      provider: 'weknora',
      counts: { total: 2, ready: 2, indexing: 0, failed: 0, unavailable: 0 },
    },
  ],
  projects: [],
};
function fixture() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/scopes')
      return (
        pendingCatalog ??
        reply(catalogStatus, catalogStatus === 200 ? catalog : { error: { code: 'UPSTREAM_UNAVAILABLE' } })
      );
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (url.startsWith('/bridge/v1/resources?'))
      return reply(200, { items: files, page: 1, page_size: 50, total: files.length });
    if (/\/resources\/res_[ab]\/office\/html$/.test(url))
      return { ...reply(200, null), text: async () => '<html><body>虚构正文</body></html>' };
    return reply(404, { error: { code: 'NOT_FOUND' } });
  });
}
async function open() {
  fireEvent.click(await screen.findByRole('button', { name: '虚构A.pptx' }));
  return screen.findByRole('dialog', { name: '当前内容预览' });
}
async function edit(dialog: HTMLElement, question = '  解释关键变化  ') {
  fireEvent.click(within(dialog).getByRole('button', { name: '询问此文件' }));
  const input = within(dialog).getByRole('textbox', { name: '询问此文件的问题' });
  fireEvent.change(input, { target: { value: question } });
  return input;
}
const submit = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: '进入对话草稿' });
beforeEach(() => {
  files = [file('res_a', '虚构A.pptx'), file('res_b', '虚构B.pptx')];
  catalogStatus = 200;
  pendingCatalog = undefined;
  fetchMock.mockReset();
  ask.mockReset();
  ask.mockResolvedValue();
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  fixture();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('requires expanding and explicitly confirming a nonempty question before handing exactly this file to Guid', async () => {
  render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
  const dialog = await open();
  expect(within(dialog).queryByRole('textbox')).toBeNull();
  const input = await edit(dialog, '  ');
  expect(submit(dialog)).toBeDisabled();
  expect(ask).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '  解释关键变化  ' } });
  fireEvent.click(submit(dialog));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  expect(ask.mock.calls[0][0]).toEqual({
    items: [{ source_id: 'src_fixture', name: '虚构库', resource_ids: ['res_a'] }],
    views: [],
    requiredResourceIds: ['res_a'],
  });
  expect(ask.mock.calls[0][2]).toBe('解释关键变化');
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(true);
});

it('does not hand off on Enter or during Chinese composition', async () => {
  render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
  const dialog = await open();
  const input = await edit(dialog);
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true });
  fireEvent.compositionEnd(input);
  expect(ask).not.toHaveBeenCalled();
  expect(input).toHaveValue('  解释关键变化  ');
});

it('IME Escape keeps the real Arco preview and the in-progress file question open', async () => {
  render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
  const dialog = await open();
  const input = await edit(dialog, '正在选择的中文问题');
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27, isComposing: true });
  expect(screen.getByRole('dialog', { name: '当前内容预览' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '询问此文件的问题' })).toHaveValue('正在选择的中文问题');
  expect(ask).not.toHaveBeenCalled();
});

it('ordinary Escape still closes the real Arco preview after question composition has ended', async () => {
  render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
  const dialog = await open();
  const input = await edit(dialog, '用户确认的中文问题');
  fireEvent.compositionStart(input);
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27, isComposing: false });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '当前内容预览' })).toBeNull());
  expect(ask).not.toHaveBeenCalled();
});

it('hides the unavailable question entry when Host did not provide a navigation callback', async () => {
  render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' />);
  const dialog = await open();
  expect(within(dialog).queryByRole('button', { name: '询问此文件' })).toBeNull();
  expect(within(dialog).queryByRole('textbox')).toBeNull();
});

it.each(['secret', 'bridge-only', 'catalog-failed', 'source-revoked'])(
  'refuses %s with an explicit reason instead of borrowing publication target sources',
  async (reason) => {
    if (reason === 'secret') files[0].secret = true;
    if (reason === 'bridge-only')
      Object.assign(files[0], {
        source_id: null,
        origin: 'outputs',
        published_to: [
          { source_id: 'src_fixture', publication_id: 'pub_previous', status: 'published', has_published: true },
        ],
      });
    if (reason === 'catalog-failed') catalogStatus = 503;
    if (reason === 'source-revoked') files[0].source_id = 'src_revoked';
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
    const dialog = await open();
    expect(within(dialog).getByRole('button', { name: '询问此文件' })).toBeDisabled();
    expect(
      within(dialog).getByText(
        reason === 'secret'
          ? /Secret，无法提问/
          : reason === 'bridge-only'
            ? /不属于任何知识库/
            : reason === 'catalog-failed'
              ? /无法确认可选知识库/
              : /已不在当前授权范围/
      )
    ).toBeInTheDocument();
    expect(ask).not.toHaveBeenCalled();
  }
);

it('shows incomplete-read coverage without dropping this nonready file from the required scope', async () => {
  files[0].state = 'indexing';
  render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
  const dialog = await open();
  await edit(dialog);
  expect(within(dialog).getByText(/范围仍包含它们，回答会说明未覆盖情况/)).toBeInTheDocument();
  fireEvent.click(submit(dialog));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  expect(ask.mock.calls[0][0].requiredResourceIds).toEqual(['res_a']);
});

it('remains blocked while an unavailable catalog is being reloaded and enables only after its authorized source returns', async () => {
  catalogStatus = 503;
  render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
  const dialog = await open();
  let finish!: (value: ReturnType<typeof reply>) => void;
  pendingCatalog = new Promise((resolve) => {
    finish = resolve;
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '重试' }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/bridge/v1/scopes')).toHaveLength(2));
  expect(within(dialog).getByRole('button', { name: '询问此文件' })).toBeDisabled();
  expect(ask).not.toHaveBeenCalled();
  await act(async () => {
    finish(reply(200, catalog));
  });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: '询问此文件' })).toBeEnabled());
  await edit(dialog);
  fireEvent.click(submit(dialog));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
  expect(ask.mock.calls[0][0].requiredResourceIds).toEqual(['res_a']);
});

it('closing and reopening the same file clears its previous question without changing resource selection', async () => {
  render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
  await screen.findByRole('button', { name: '虚构A.pptx' });
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 虚构A.pptx' }));
  const first = await open();
  await edit(first);
  fireEvent.click(within(first).getByRole('button', { name: '关闭预览' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const second = await open();
  fireEvent.click(within(second).getByRole('button', { name: '询问此文件' }));
  expect(within(second).getByRole('textbox', { name: '询问此文件的问题' })).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: '选择 虚构A.pptx' })).toBeChecked();
  expect(ask).not.toHaveBeenCalled();
});

it('retains a failed question and retries the same trimmed text and exact file scope', async () => {
  ask.mockRejectedValueOnce(new Error('fixture navigation failure'));
  render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
  const dialog = await open();
  const input = await edit(dialog);
  fireEvent.click(submit(dialog));
  await within(dialog).findByText(/未能准备资料范围/);
  expect(input).toHaveValue('  解释关键变化  ');
  expect(submit(dialog)).toBeEnabled();
  fireEvent.click(submit(dialog));
  await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
  expect(ask.mock.calls[1][0]).toEqual(ask.mock.calls[0][0]);
  expect(ask.mock.calls[1][2]).toBe('解释关键变化');
});

it.each(['close', 'resource', 'owner', 'query', 'unmount'])(
  'cancels pending question preparation on %s and rejects a late failure without overwriting the new scene',
  async (change) => {
    let fail!: (error: Error) => void;
    ask.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      })
    );
    const view = render(<ResourcesPage lang='zh-CN' ownerKey='fixture-owner' onAskScope={ask} />);
    const dialog = await open();
    await edit(dialog);
    fireEvent.click(submit(dialog));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    const signal = ask.mock.calls[0][1];
    expect(submit(dialog)).toBeDisabled();
    fireEvent.click(submit(dialog));
    expect(ask).toHaveBeenCalledTimes(1);
    if (change === 'close') fireEvent.click(within(dialog).getByRole('button', { name: '关闭预览' }));
    if (change === 'resource') fireEvent.click(screen.getByRole('button', { name: '虚构B.pptx' }));
    if (change === 'owner') view.rerender(<ResourcesPage lang='zh-CN' ownerKey='next-owner' onAskScope={ask} />);
    if (change === 'query')
      fireEvent.change(screen.getByRole('textbox', { name: '搜索文件名或标签' }), { target: { value: 'B' } });
    if (change === 'unmount') view.unmount();
    await waitFor(() => expect(signal.aborted).toBe(true));
    await act(async () => {
      fail(new Error('旧问题迟到失败'));
    });
    expect(screen.queryByText(/未能准备资料范围/)).toBeNull();
    if (change === 'resource') expect(screen.queryByRole('textbox', { name: '询问此文件的问题' })).toBeNull();
  }
);
