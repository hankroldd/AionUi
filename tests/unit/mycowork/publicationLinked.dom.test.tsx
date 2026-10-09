/**
 * [mycowork] PR08 A391。文件：tests/unit/mycowork/publicationLinked.dom.test.tsx
 * 职责：发布到知识库时库里已有内容相同的条目（linked_existing）的界面：本会话发起的发布完成提示写“「库名」里已有内容相同的《X》，这次没有另存一份；
 *       AI 引用的是库里那一份。”（读不到名字时不写名字；版本页与空间页两条对账路径都测）、版本页时间线上那条发布记录带简短版本、空间行的发布标记带“库里已有同内容文件”；
 *       没有 linked_existing 时都不出现；中英两套。
 * 边界：只用真实 React/Arco 组件，只替换 Bridge HTTP；字段形状与 bridge.v1.openapi.yaml 的 Publication / published_to 一致。
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import { resetAccountScopedState } from '@mycowork/ui';
import { watchPublication } from '@mycowork/ui/pages/versions/index.ts';
import { OfficeResourcesSlot, OfficeVersionsSlot } from '@/renderer/mycowork-slots';
import { settleTracker } from './saveTrackerTeardown';

const ui = vi.hoisted(() => ({ lang: 'zh-CN' }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'fixture-account' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: ui.lang } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => vi.fn(),
}));
readRetry.delays = [0, 0];

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => {
  const res = { status, ok: status < 300, json: async () => body, clone: () => res };
  return res;
};
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const rev = (id: string, over: object = {}) => ({
  revision_id: id, parent_id: null, content_sha256: 'x', size: 1, created_at: '2026-10-08T01:00:00.000Z', origin: 'edit', current: false, ...over,
});
const pub = (over: object = {}) => ({
  publication_id: 'p1', resource_id: 'res_1', revision_id: 'rev_bbbbbbbb',
  target: { kind: 'knowledge_base', source_id: 'src_q', file_name: '我的稿.md' },
  status: 'published', error: null, published_resource_id: 'res_kb', accepted_at: 't', published_at: 't', created_at: 't', ...over,
});
function bridge(o: { pubs?: object[]; list?: object[] } = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/revisions'))
      return reply(200, {
        resource_id: 'res_1', current_revision_id: 'rev_bbbbbbbb', file_name: '我的稿.md',
        items: [rev('rev_bbbbbbbb', { current: true }), rev('rev_aaaaaaaa', { origin: 'original' })],
        page: 1, page_size: 50, total: 2,
      });
    if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: o.pubs ?? [], page: 1, page_size: 50, total: 1 });
    if (url === '/bridge/v1/scopes')
      return reply(200, { sources: [{ source_id: 'src_q', name: '青禾库', provider: 'weknora', counts }], projects: [] });
    if (url.endsWith('/metadata')) return reply(200, { secret: false });
    if (url.includes('/changes?'))
      return reply(200, {
        resource_id: 'res_1', from_revision_id: 'rev_aaaaaaaa', to_revision_id: 'rev_bbbbbbbb', format: 'md', compared_root: '/', status: 'complete',
        coverage: { nodes_from: 1, nodes_to: 1, truncated: false, lists_truncated: false }, changes: [], unknown_parts: [],
      });
    if (url.endsWith('/office/html')) return { ...reply(200, null), text: async () => '<html><head></head><body></body></html>' };
    if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (url.startsWith('/bridge/v1/resources?')) {
      const items = o.list ?? [];
      return reply(200, { page: 1, page_size: 50, total: items.length, items });
    }
    return reply(404, {});
  });
}
const output = (linked: boolean) => ({
  resource_id: 'res_o', file_name: '产物.md', source_id: null, origin: 'outputs', purpose: 'working', state: 'stored',
  tag_ids: [], secret: false, can_mark_secret: true, updated_at: '2026-10-08T01:00:00.000Z', revision_count: 1,
  published_to: [
    { publication_id: 'p1', source_id: 'src_q', status: 'published', has_published: true, linked_existing: linked, ...(linked ? { published_file_name: '库里的旧名.md' } : {}) },
  ],
});

describe('A391 发布关联到库里已有同内容条目', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    ui.lang = 'zh-CN';
  });
  afterEach(async () => {
    cleanup();
    resetAccountScopedState();
    Message.clear();
    vi.unstubAllGlobals();
    await settleTracker();
  });

  it('完成提示写出库里已有的那份名字，没有另存一份；时间线上带简短版本', async () => {
    bridge({ pubs: [pub({ linked_existing: true, published_file_name: '库里的旧名.md' })] });
    watchPublication('p1', { kb: '青禾库', lang: 'zh-CN' });
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('「青禾库」里已有内容相同的《库里的旧名.md》，这次没有另存一份；AI 引用的是库里那一份。')).toBeInTheDocument();
    expect(screen.queryByText('已发布到「青禾库」，AI 现在可以引用它')).toBeNull();
    expect((await screen.findByTestId('version-publication-linked')).textContent).toBe('库里已有内容相同的《库里的旧名.md》，没有另存一份');
  });

  it('读不到那份的名字（null）时不写名字', async () => {
    bridge({ pubs: [pub({ linked_existing: true, published_file_name: null })] });
    watchPublication('p1', { kb: '青禾库', lang: 'zh-CN' });
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('「青禾库」里已有内容相同的文件，这次没有另存一份；AI 引用的是库里那一份。')).toBeInTheDocument();
    expect((await screen.findByTestId('version-publication-linked')).textContent).toBe('库里已有内容相同的文件，没有另存一份');
  });

  it('没有 linked_existing 时仍是原来的完成提示，也没有关联提示', async () => {
    bridge({ pubs: [pub({ linked_existing: false })] });
    watchPublication('p1', { kb: '青禾库', lang: 'zh-CN' });
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('已发布到「青禾库」，AI 现在可以引用它')).toBeInTheDocument();
    expect(screen.queryByTestId('version-publication-linked')).toBeNull();
    expect(screen.queryByTestId('publication-linked-existing')).toBeNull();
  });

  it('英文', async () => {
    ui.lang = 'en';
    bridge({ pubs: [pub({ linked_existing: true, published_file_name: 'old-name.md' })] });
    watchPublication('p1', { kb: 'Library', lang: 'en' });
    render(<OfficeVersionsSlot />);
    expect(
      await screen.findByText('"Library" already has identical content, "old-name.md"; no second copy was saved. AI cites the one in the library.'),
    ).toBeInTheDocument();
    expect((await screen.findByTestId('version-publication-linked')).textContent).toBe(
      'The library already has identical content, "old-name.md"; no second copy saved',
    );
  });

  it('从空间页发起的发布：完成提示（空间列表对账）同样带库里那份的名字', async () => {
    bridge({ list: [output(true)] });
    watchPublication('p1', { kb: '青禾库', lang: 'zh-CN' });
    render(<OfficeResourcesSlot />);
    expect(
      await screen.findByText('「青禾库」里已有内容相同的《库里的旧名.md》，这次没有另存一份；AI 引用的是库里那一份。'),
    ).toBeInTheDocument();
  });

  it('时间线上关联时的链接名是“查看库里那一份”', async () => {
    bridge({ pubs: [pub({ linked_existing: true, published_file_name: '库里的旧名.md' })] });
    render(<OfficeVersionsSlot />);
    expect(await screen.findByRole('link', { name: '查看库里那一份' })).toBeInTheDocument();
  });

  it('空间行：published_to 带 linked_existing 时标“库里已有同内容文件”，没带不标', async () => {
    bridge({ list: [output(true)] });
    render(<OfficeResourcesSlot />);
    expect((await screen.findByTestId('mycowork-publication-linked')).textContent).toBe('库里已有同内容文件');
    cleanup();
    bridge({ list: [output(false)] });
    render(<OfficeResourcesSlot />);
    await screen.findByText('产物.md');
    expect(screen.queryByTestId('mycowork-publication-linked')).toBeNull();
  });
});
