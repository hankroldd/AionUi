/**
 * [mycowork] R048 切片 A（D281，MyCowork navigation-intent §11）：同一文件从不同入口打开一致。
 * 只 mock Bridge 边界（fetch）与路由位置。覆盖：空间预览从两个入口打开同一资源只有一个视图、不重读、缩放不丢，
 * 换资源才换视图；版本页“并排查看”把历史版本加到当前版本右侧（各自标版本与时间、只读），同一版本再点不重复开，
 * 第三个关掉最早的，固定版本可关、关完回到当前版本。数据均为虚构。
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeVersionsSlot } from '@/renderer/mycowork-slots';
import { ResourcesPage } from '@mycowork/ui';

vi.mock('@/renderer/mycowork-branches', () => ({ useBranchAdapter: () => undefined }));
vi.mock('@/renderer/mycowork-reviews', () => ({ useReviewAdapter: () => undefined }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/office/resources/res_1/versions', search: '', state: null, key: 'k' }),
  useNavigate: () => vi.fn(),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const page = (body: string) => ({ ...reply(200, null), text: async () => body });
const calls = (re: RegExp) => fetchMock.mock.calls.filter(([url]) => re.test(String(url))).length;

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('space preview: same resource from two entries → one view', () => {
  const resources = ['虚构纪要.txt', '虚构备忘.txt'].map((file_name, i) => ({
    resource_id: `res_${i}`,
    file_name,
    source_id: null,
    origin: 'imports',
    state: 'stored',
    tag_ids: [],
    secret: false,
    can_mark_secret: true,
    revision_count: 1,
    updated_at: '2026-10-04T00:00:00Z',
  }));
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
      if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
      if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
      if (url.startsWith('/bridge/v1/resources?'))
        return reply(200, { items: resources, page: 1, page_size: 50, total: resources.length });
      if (/\/resources\/res_\d\/preview$/.test(url)) return page(`正文 ${url}`);
      return reply(404, { error: { code: 'NOT_FOUND', message: 'unexpected fixture read' } });
    });
  });

  it('keeps the open view (no reread, zoom kept) and only switches for another resource', async () => {
    localStorage.setItem('mycowork.resources.layout', 'list');
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    fireEvent.click(await screen.findByRole('button', { name: '虚构纪要.txt' }));
    const dialog = await screen.findByRole('dialog', { name: '当前内容预览' });
    await waitFor(() => expect(calls(/res_0\/preview$/)).toBe(1));
    fireEvent.click(within(dialog).getByRole('button', { name: '放大' }));
    // 第二个入口：换成卡片视图后从卡片上的文件名再打开同一资源
    fireEvent.click(screen.getByLabelText('网格'));
    const card = (await screen.findAllByTestId('mycowork-resource-item')).find(
      (el) => el.getAttribute('data-resource-id') === 'res_0'
    )!;
    fireEvent.click(within(card).getByRole('button', { name: '虚构纪要.txt' }));
    expect(screen.getAllByRole('dialog', { name: '当前内容预览' })).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: '重置缩放' })).toHaveTextContent('125%');
    expect(calls(/res_0\/preview$/)).toBe(1);
    const other = (await screen.findAllByTestId('mycowork-resource-item')).find(
      (el) => el.getAttribute('data-resource-id') === 'res_1'
    )!;
    fireEvent.click(within(other).getByRole('button', { name: '虚构备忘.txt' }));
    await waitFor(() => expect(calls(/res_1\/preview$/)).toBe(1));
    expect(screen.getAllByRole('dialog', { name: '当前内容预览' })).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: '重置缩放' })).toHaveTextContent('100%');
  });
});

describe('versions page: historical revisions side by side', () => {
  const rev = (id: string, parent: string | null, at: string) => ({
    revision_id: id,
    parent_id: parent,
    content_sha256: id,
    size: 1,
    created_at: at,
    origin: 'edit',
    current: id === 'rev_c',
  });
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/revisions'))
        return reply(200, {
          resource_id: 'res_1',
          current_revision_id: 'rev_c',
          file_name: '纪要（虚构）.txt',
          items: [
            rev('rev_c', 'rev_b', '2025-03-03T02:00:00.000Z'),
            rev('rev_b', 'rev_a', '2025-03-02T02:00:00.000Z'),
            rev('rev_a', null, '2025-03-01T02:00:00.000Z'),
          ],
          page: 1,
          page_size: 50,
          total: 3,
        });
      const content = /\/revisions\/(rev_[abc])\/content$/.exec(url);
      if (content) return page(`正文 ${content[1]}`);
      if (url.endsWith('/preview')) return page('正文 当前');
      if (url.includes('/changes?')) {
        const q = new URL(url, 'http://x').searchParams;
        return reply(200, {
          resource_id: 'res_1',
          from_revision_id: q.get('from'),
          to_revision_id: q.get('to'),
          format: 'docx',
          compared_root: '/',
          status: 'complete',
          coverage: { nodes_from: 1, nodes_to: 1, truncated: false, lists_truncated: false },
          changes: [],
          unknown_parts: [],
        });
      }
      if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
      if (url.endsWith('/metadata'))
        return reply(200, { resource_id: 'res_1', metadata_revision: 1, tag_ids: [], secret: false });
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url.startsWith('/bridge/v1/publications?'))
        return reply(200, { items: [], page: 1, page_size: 50, total: 0 });
      return reply(404, { code: 'NOT_FOUND' });
    });
  });
  const sideBySide = async (v: string) => {
    fireEvent.click(await screen.findByRole('button', { name: `更多操作 ${v}` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '并排查看' }));
  };
  const panes = () =>
    within(screen.getByTestId('versions-side-by-side'))
      .getAllByTestId('versions-preview')
      .map((el) => el.getAttribute('aria-label'));

  it('opens a labelled read-only pane beside the current one, reuses it, caps at two and closes back', async () => {
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('正文 当前')).toBeTruthy();
    expect(screen.queryByTestId('versions-side-by-side')).toBeNull();

    await sideBySide('v2');
    expect(await screen.findByText('正文 rev_b')).toBeTruthy();
    expect(panes()).toHaveLength(2);
    expect(panes()[0]).toMatch(/^当前内容预览/);
    expect(panes()[1]).toMatch(/^v2 · 2025年3月2日 \d\d:\d\d$/);
    const historical = screen.getAllByTestId('versions-preview')[1]!;
    expect(within(historical).getByText('只读')).toBeTruthy();
    expect(within(historical).getByTestId('versions-side-note').textContent).toBe('这是历史版本（不是最新版）');

    await sideBySide('v2'); // 同一版本再点：复用，不重复开、不重读
    expect(panes()).toHaveLength(2);
    expect(calls(/rev_b\/content$/)).toBe(1);

    await sideBySide('v1'); // 第三个：关掉最早打开的（当前版本）
    expect(await screen.findByText('正文 rev_a')).toBeTruthy();
    expect(panes()).toEqual([expect.stringMatching(/^v2 · /), expect.stringMatching(/^v1 · /)]);
    expect(screen.queryByText('正文 当前')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^关闭 v2 · / }));
    expect(screen.queryByTestId('versions-side-by-side')).toBeNull();
    expect(screen.getByTestId('versions-preview').getAttribute('aria-label')).toMatch(/^v1 · /);
    fireEvent.click(screen.getByRole('button', { name: /^关闭 v1 · / }));
    expect(await screen.findByText('正文 当前')).toBeTruthy();
    expect(screen.getByTestId('versions-preview').getAttribute('aria-label')).toBe('当前内容预览');
  });

  it('does not offer side-by-side on the current version row', async () => {
    render(<OfficeVersionsSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '更多操作 v3' }));
    await screen.findByRole('menuitem', { name: '接受并归档' });
    expect(screen.queryByRole('menuitem', { name: '并排查看' })).toBeNull();
  });
});
