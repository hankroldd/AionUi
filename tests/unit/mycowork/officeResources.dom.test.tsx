/**
 * [mycowork] ADR-0011: `/office/resources` (MyCowork P05 resource center, PR04 slice d/f).
 * Only the Bridge boundary is mocked (fetch). Covers: "my imports" list with states and tags, switching to a granted
 * source; clicking a tag filters, the filter can be saved as a view tab and the tab filters by view; editing a
 * resource's tags patches metadata with the read revision (409 → reload + notice); moving a tag to the top level.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: null, pathname: '/' }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const TAGS = [
  { tag_id: 'tag_p', name: '项目', parent_id: null, namespace: 'platform', aliases: [], revision: 1, updated_at: 't' },
  {
    tag_id: 'tag_c',
    name: '风险',
    parent_id: 'tag_p',
    namespace: 'platform',
    aliases: [],
    revision: 3,
    updated_at: 't',
  },
];
const item = (over: object) => ({
  resource_id: 'res_1',
  file_name: '工作稿.pptx',
  source_id: null,
  purpose: 'working',
  state: 'stored',
  tag_ids: [],
  ...over,
});
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));

function bridge(opts: { patchStatus?: number } = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/bridge/v1/scopes')
      return reply(200, {
        sources: [{ source_id: 'src_q', name: '青禾库', provider: 'weknora', counts }],
        projects: [],
      });
    if (url.startsWith('/bridge/v1/resources?')) {
      const items = url.includes('source_id=src_q')
        ? [item({ resource_id: 'res_q', file_name: '周报.md', source_id: 'src_q', state: 'ready', purpose: undefined })]
        : [item({ tag_ids: ['tag_c'] })];
      return reply(200, { page: 1, page_size: 50, total: items.length, items });
    }
    if (url === '/bridge/v1/tags' && method === 'GET') return reply(200, { tags: TAGS });
    if (url === '/bridge/v1/saved-views' && method === 'GET')
      return reply(200, { views: [{ view_id: 'view_1', name: '风险视图', filter: { tag_ids: ['tag_c'] } }] });
    if (url.endsWith('/metadata') && method === 'GET')
      return reply(200, {
        resource_id: 'res_1',
        metadata_revision: 4,
        current_revision_id: 'rev_1',
        tag_ids: ['tag_c'],
      });
    if (url.endsWith('/metadata') && method === 'PATCH')
      return opts.patchStatus
        ? reply(opts.patchStatus, { error: { code: 'REVISION_CONFLICT', message: 'x' } })
        : reply(200, {});
    return reply(method === 'GET' ? 404 : 201, {});
  });
}

describe('OfficeResourcesSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists my imports with state and tags, and switches to a granted source', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    expect(await screen.findByText('工作稿.pptx')).toBeInTheDocument();
    expect(screen.getByText('只存原件')).toBeInTheDocument();
    expect(calls('GET', '/bridge/v1/resources?origin=imports')).toHaveLength(1);
    fireEvent.click(screen.getAllByText('我的导入')[0] as HTMLElement);
    fireEvent.click(await screen.findByText('青禾库'));
    expect(await screen.findByText('周报.md')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看原件' })).toHaveAttribute(
      'href',
      '/bridge/v1/resources/res_q/preview'
    );
  });

  it('filters by a tag, saves the filter as a view tab, and filters by the view', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('工作稿.pptx');
    fireEvent.click(screen.getByText('项目 / 风险'));
    await waitFor(() => expect(calls('GET', 'tag_id=tag_c')).toHaveLength(1));
    fireEvent.change(screen.getByPlaceholderText('视图名'), { target: { value: '我的风险' } });
    fireEvent.click(screen.getByRole('button', { name: '把当前标签筛选存为视图 Tab' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/saved-views')).toHaveLength(1));
    expect(JSON.parse(String(calls('POST', '/bridge/v1/saved-views')[0]?.[1]?.body))).toEqual({
      name: '我的风险',
      filter: { tag_ids: ['tag_c'] },
    });
    fireEvent.click(screen.getByRole('tab', { name: '风险视图' }));
    await waitFor(() => expect(calls('GET', 'view_id=view_1')).toHaveLength(1));
  });

  it('edits resource tags with the read metadata revision; a 409 reloads and says so', async () => {
    bridge();
    const { unmount } = render(<OfficeResourcesSlot />);
    await screen.findByText('工作稿.pptx');
    fireEvent.click(screen.getByLabelText('工作稿.pptx 标签'));
    await screen.findByRole('option', { name: '项目' });
    fireEvent.click(screen.getByText('项目', { selector: 'li *' })); // 多选选项要点到选项里的文字（Arco 在内层元素上处理）
    await waitFor(() => expect(calls('PATCH', '/metadata')).toHaveLength(1));
    expect(JSON.parse(String(calls('PATCH', '/metadata')[0]?.[1]?.body))).toEqual({
      expected_metadata_revision: 4,
      tags: { add: ['tag_p'], remove: [] },
    });
    unmount();
    fetchMock.mockReset();
    bridge({ patchStatus: 409 });
    render(<OfficeResourcesSlot />);
    await screen.findByText('工作稿.pptx');
    fireEvent.click(screen.getByLabelText('工作稿.pptx 标签'));
    await screen.findByRole('option', { name: '项目' });
    fireEvent.click(screen.getByText('项目', { selector: 'li *' })); // 多选选项要点到选项里的文字（Arco 在内层元素上处理）
    expect(await screen.findByText('已被其他地方修改，已重新读取，请再操作一次')).toBeInTheDocument();
  });

  it('moves a tag to the top level with its revision', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('工作稿.pptx');
    fireEvent.click(screen.getByLabelText('移到 风险'));
    await act(async () => fireEvent.click(await screen.findByRole('option', { name: '（顶层）' })));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/tags/tag_c')).toHaveLength(1));
    expect(JSON.parse(String(calls('PATCH', '/bridge/v1/tags/tag_c')[0]?.[1]?.body))).toEqual({
      expected_revision: 3,
      parent_id: null,
    });
  });
});
