/**
 * [mycowork] ADR-0011: every `/office/*` page uses the MyCowork page skeleton (MyCowork .claude/rules/ui.md "页面骨架",
 * aligned with AionUi's Scheduled/Assistants pages): the root fills the layout content (flex 1, min-height 0, overflow hidden);
 * the body below the header is the page's own scroll container (flex 1, min-height 0, overflow-y auto), so long content scrolls
 * instead of being cut off; content is centred with a 1024px max width. The versions page timeline scrolls on its own.
 * jsdom has no layout, so this checks the styles that make scrolling possible and that long content sits inside the scroller;
 * the real-browser scroll check is in MyCowork verification/PR11/*-ui-redesign.
 * Only the Bridge boundary is mocked (fetch).
 */

import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import {
  OfficeCompositionSlot,
  OfficeEditSlot,
  OfficeImportsSlot,
  OfficeMemorySlot,
  OfficeResourcesSlot,
  OfficeVersionsSlot,
} from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1', sessionId: 'eds_1', decisionId: 'tdec_1' }),
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => vi.fn(),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const N = 60;
const resource = (i: number) => ({
  resource_id: `res_${i}`,
  file_name: `长列表资料${i}.pptx`,
  source_id: null,
  state: 'stored',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-09-27T02:13:22.409Z',
  revision_count: 1,
});
const revision = (i: number) => ({
  revision_id: `rev_${String(i).padStart(8, '0')}`,
  parent_id: null,
  content_sha256: 'x',
  size: 1,
  created_at: new Date(2026, 8, 27, 10, i % 60).toISOString(),
  origin: 'edit',
  current: i === 0,
});

function bridge() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (url.startsWith('/bridge/v1/resources?'))
      return reply(200, { page: 1, page_size: 50, total: N, items: Array.from({ length: 50 }, (_, i) => resource(i)) });
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (url.endsWith('/revisions'))
      return reply(200, {
        resource_id: 'res_1',
        current_revision_id: revision(0).revision_id,
        items: Array.from({ length: 40 }, (_, i) => revision(i)),
        page: 1,
        page_size: 50,
        total: 40,
      });
    if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [], page: 1, page_size: 50, total: 0 });
    return reply(503, {});
  });
}

/** Root fills the content area; the body is the page's own vertical scroller with a centred 1024px column. */
function expectSkeleton(testId: string): HTMLElement {
  const root = screen.getByTestId(testId);
  expect(root.style.flex).toBe('1 1 0%');
  expect(root.style.minHeight).toBe('0px');
  expect(root.style.overflow).toBe('hidden');
  const scroller = within(root).getByTestId('mycowork-page-scroll');
  expect(scroller.style.overflowY).toBe('auto');
  expect(scroller.style.flex).toBe('1 1 0%');
  expect(scroller.style.minHeight).toBe('0px');
  const column = scroller.firstElementChild as HTMLElement;
  expect(column.style.maxWidth).toBe('1024px');
  expect(column.style.margin).toBe('0px auto');
  return scroller;
}

describe('office page skeleton', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    bridge();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resources: a long list sits inside the page scroller', async () => {
    render(<OfficeResourcesSlot />);
    const scroller = expectSkeleton('mycowork-resources');
    expect(await within(scroller).findByText('长列表资料49.pptx')).toBeInTheDocument();
  });

  it('versions: the page scrolls and the timeline scrolls on its own, holding all versions', async () => {
    render(<OfficeVersionsSlot />);
    const scroller = expectSkeleton('mycowork-versions');
    const timeline = within(scroller).getByTestId('mycowork-versions-timeline');
    expect(timeline.style.overflowY).toBe('auto');
    expect(await within(timeline).findByText('v40')).toBeInTheDocument();
    expect(within(timeline).getByText('v1')).toBeInTheDocument();
  });

  it('imports, memory, page plan and the non-editing editor page use the same skeleton', async () => {
    for (const [Slot, id] of [
      [OfficeImportsSlot, 'mycowork-imports'],
      [OfficeMemorySlot, 'mycowork-memory'],
      [OfficeCompositionSlot, 'mycowork-composition'],
      [OfficeEditSlot, 'mycowork-office-editor'],
    ] as const) {
      const { unmount } = render(<Slot />);
      expectSkeleton(id);
      unmount();
    }
  });
});
