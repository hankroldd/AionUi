/**
 * [mycowork] D116: `/office/resources` Secret lock and mark/unmark (MyCowork P05 resource center, PR04 T05h).
 * Only the Bridge boundary is mocked (fetch). Covers: a Secret item shows a lock tag to everyone who can see it; only
 * the owner (can_mark_secret) gets the mark/unmark action (in the item's "More" menu); the action asks for confirmation explaining the consequence,
 * the conversation scope banner says how many Secret items the plan left out (no names);
 * cancel writes nothing, confirm patches metadata with the read revision; a 403 says only the owner can change it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage, ScopeStrip } from '@mycowork/ui';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const item = (over: object) => ({
  resource_id: 'res_1',
  file_name: '工作稿.pptx',
  source_id: null,
  origin: 'imports', // adapted：ResourceList的新来源字段；Secret合同断言保持原样。
  purpose: 'working',
  state: 'stored',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-09-27T02:13:22.409Z',
  revision_count: 1,
  ...over,
});
const ITEMS = [
  item({}),
  item({ resource_id: 'res_s', file_name: '机密方案.docx', secret: true }),
  item({ resource_id: 'res_o', file_name: '别人的.pptx', secret: true, can_mark_secret: false }),
];
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));

function bridge(patchStatus = 200) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (url.startsWith('/bridge/v1/resources?'))
      return reply(200, { page: 1, page_size: 50, total: ITEMS.length, items: ITEMS });
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (url.endsWith('/metadata') && method === 'GET')
      return reply(200, {
        resource_id: 'x',
        metadata_revision: 7,
        current_revision_id: null,
        tag_ids: [],
        secret: false,
      });
    if (url.endsWith('/metadata') && method === 'PATCH')
      return patchStatus === 200 ? reply(200, {}) : reply(patchStatus, { error: { code: 'FORBIDDEN', message: 'x' } });
    return reply(404, {});
  });
}

/** Opens an item's "More" menu and returns the menu item texts (then closes it with Escape). */
async function menuOf(name: string): Promise<string[]> {
  fireEvent.click(screen.getByRole('button', { name: `更多操作 ${name}` }));
  const menu = await screen.findByRole('menu');
  const texts = [...menu.querySelectorAll('[role=menuitem]')].map((m) => m.textContent ?? '');
  fireEvent.click(screen.getByRole('button', { name: `更多操作 ${name}` }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return texts;
}
async function pick(name: string, action: string) {
  fireEvent.click(screen.getByRole('button', { name: `更多操作 ${name}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}

describe('ResourcesPage Secret (D116)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows a lock on Secret items to everyone; only the owner gets the action', async () => {
    bridge();
    render(<ResourcesPage lang='zh-CN' />);
    await screen.findByText('工作稿.pptx');
    expect(screen.getAllByTestId('mycowork-secret-lock')).toHaveLength(2);
    expect(await menuOf('工作稿.pptx')).toContain('标为 Secret');
    expect(await menuOf('机密方案.docx')).toContain('取消 Secret');
    const theirs = await menuOf('别人的.pptx'); // 别人的只看得到锁
    expect(theirs.some((t) => /Secret/.test(t))).toBe(false);
  });

  it('marking asks first: cancel writes nothing; confirm patches secret=true with the read revision', async () => {
    bridge();
    render(<ResourcesPage lang='zh-CN' />);
    await screen.findByText('工作稿.pptx');
    await pick('工作稿.pptx', '标为 Secret');
    expect(await screen.findByText('把“工作稿.pptx”标为 Secret？')).toBeInTheDocument();
    expect(screen.getByText(/不会进入任何 AI 上下文/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByText('把“工作稿.pptx”标为 Secret？')).not.toBeInTheDocument());
    expect(calls('PATCH', '/metadata')).toHaveLength(0);
    await pick('工作稿.pptx', '标为 Secret');
    fireEvent.click(await screen.findByRole('button', { name: '确定' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/resources/res_1/metadata')).toHaveLength(1));
    expect(JSON.parse(String(calls('PATCH', '/metadata')[0]?.[1]?.body))).toEqual({
      expected_metadata_revision: 7,
      secret: true,
    });
  });

  it('unmarking patches secret=false; a 403 says only the owner can change it', async () => {
    bridge(403);
    render(<ResourcesPage lang='zh-CN' />);
    await screen.findByText('机密方案.docx');
    await pick('机密方案.docx', '取消 Secret');
    expect(await screen.findByText('取消“机密方案.docx”的 Secret 标记？')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '确定' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/resources/res_s/metadata')).toHaveLength(1));
    expect(JSON.parse(String(calls('PATCH', '/metadata')[0]?.[1]?.body))).toEqual({
      expected_metadata_revision: 7,
      secret: false,
    });
    expect(await screen.findByText('只有资源本人可以标记或取消 Secret')).toBeInTheDocument();
  });

  it('English labels', async () => {
    bridge();
    render(<ResourcesPage lang='en-US' />);
    await screen.findByText('工作稿.pptx');
    fireEvent.click(screen.getByRole('button', { name: 'More actions 工作稿.pptx' }));
    expect(await screen.findByRole('menuitem', { name: 'Mark as Secret' })).toBeInTheDocument();
  });
});

describe('ScopeStrip Secret count (D116)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says how many Secret items the frozen plan left out, without names', async () => {
    const counts = { total: 2, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
    const brief = (n?: number) => ({
      groups: [{ source_id: 'src_q', source_name: '青禾库', mode: 'subset', counts }],
      excluded: 0,
      unauthorized: 0,
      refs: {},
      policy: { strict: false, web: 'off' },
      ...(n === undefined ? {} : { secret_excluded: n }),
    });
    for (const [n, expected] of [
      [1, true],
      [undefined, false],
    ] as const) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () =>
        reply(200, {
          plan_id: 'plan_1',
          version: 1,
          status: 'OK',
          brief: brief(n),
          used: [],
          withheld: 0,
          superseded: false,
        })
      );
      const { unmount } = render(<ScopeStrip conversationId='c1' lang='zh-CN' />);
      await screen.findByText(/青禾库/);
      expect(screen.queryByText(/已排除 Secret 1 项/) !== null).toBe(expected);
      unmount();
    }
  });

  it('says how many template samples the frozen plan left out (A170)', async () => {
    const counts = { total: 2, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
    for (const [n, expected] of [
      [2, true],
      [undefined, false],
    ] as const) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () =>
        reply(200, {
          plan_id: 'plan_1',
          version: 1,
          status: 'OK',
          brief: {
            groups: [{ source_id: 'src_q', source_name: '青禾库', mode: 'subset', counts }],
            excluded: 0,
            unauthorized: 0,
            refs: {},
            policy: { strict: false, web: 'off' },
            ...(n === undefined ? {} : { template_excluded: n }),
          },
          used: [],
          withheld: 0,
          superseded: false,
        })
      );
      const { unmount } = render(<ScopeStrip conversationId='c1' lang='zh-CN' />);
      await screen.findByText(/青禾库/);
      expect(screen.queryByText(/已排除 2 份模板样例/) !== null).toBe(expected);
      unmount();
    }
  });
});
