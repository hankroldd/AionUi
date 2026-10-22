/**
 * [mycowork] PR10 E1：逐版本菜单绑定旧版审查，结果留在对应时间线条目。
 * 边界：只替换 HTTP / IPC；不接最新预览、不自动开启审查。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { VersionTimeline } from '@mycowork/ui/pages/versions/VersionTimeline.tsx';
import { versionsText } from '@mycowork/ui/pages/versions/index.ts';
import type { ReviewAdapter } from '@mycowork/ui';
import { getScope, setScopeSelection } from '@mycowork/ui';
import type { RevisionItem } from '@mycowork/contracts';
import { listReviews } from '@mycowork/ui/reviews/client.ts';

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([
  { total: 21, visiblePage: 1, pages: 2 },
  { total: 41, visiblePage: 2, pages: 3 },
])(
  'reads filtered review pages including empty pages until raw total $total is covered',
  async ({ total, visiblePage, pages }) => {
    const visible = {
      review_id: 'visible-review',
      status: 'completed',
      resource_id: 'resource-1',
      base_revision_id: 'old-version',
      input_revision_id: 'old-version',
      context_plan_id: 'plan',
      mode: 'review_only',
      max_rounds: 1,
      policy: { strict: true, web: 'off' },
      rounds: [],
      unresolved: [],
    };
    const readPages: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        const page = Number(new URL(path, 'http://fixture').searchParams.get('page'));
        readPages.push(page);
        return json({ items: page === visiblePage ? [visible] : [], page, total });
      })
    );
    expect(await listReviews('resource-1', 'old-version')).toEqual([visible]);
    expect(readPages).toEqual(Array.from({ length: pages }, (_, index) => index + 1));
  }
);
it.each(['menu', 'selected'])('opens saved results via the explicit %s action without preload', async (entry) => {
  const calls: string[] = [];
  setScopeSelection({ items: [{ source_id: 'old-account-source', name: '旧账号范围' }], views: [] });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      calls.push(path);
      if (path === '/bridge/v1/review-rules')
        return json({
          enabled_by_default: false,
          budget_tokens: { default: 100000, max: 500000 },
          rules: ['固定1轮规则（虚构）'],
        });
      return json({
        page: 1,
        total: 1,
        items: [
          {
            review_id: 'saved-review',
            status: 'completed',
            resource_id: 'resource-1',
            base_revision_id: 'old-version',
            input_revision_id: 'old-version',
            context_plan_id: 'saved-plan',
            mode: 'review_only',
            max_rounds: 1,
            policy: { strict: true, web: 'off' },
            unresolved: [],
            rounds: [
              {
                round: 1,
                input_revision_id: 'old-version',
                output_revision_id: null,
                tokens_used: 0,
                usage_observed: false,
                findings: [],
              },
            ],
          },
        ],
      });
    })
  );
  const adapter: ReviewAdapter = {
    create: vi.fn(),
    verify: vi.fn(),
    send: vi.fn(),
    observe: vi.fn(),
    cancel: vi.fn(),
  };
  const props = {
    items: [
      {
        revision_id: 'latest-version',
        parent_id: 'old-version',
        content_sha256: 'a'.repeat(64),
        size: 1,
        origin: 'edit',
        created_at: '2026-10-16T00:00:00Z',
        current: true,
      },
      {
        revision_id: 'old-version',
        parent_id: null,
        content_sha256: 'b'.repeat(64),
        size: 1,
        origin: 'original',
        created_at: '2026-10-15T00:00:00Z',
        current: false,
      },
    ] satisfies RevisionItem[],
    pubs: [],
    pubsStale: false,
    selected: entry === 'selected' ? 'old-version' : 'latest-version',
    lang: 'zh-CN',
    text: versionsText('zh-CN'),
    vOf: (id: string) => (id === 'old-version' ? 'v1' : 'v2'),
    kbName: () => undefined,
    canAct: true,
    more: { has: false, loading: false, onLoad: vi.fn() },
    onSelect: vi.fn(),
    onSideBySide: vi.fn(),
    onRestore: vi.fn(),
    resourceId: 'resource-1',
    headRevisionId: 'latest-version',
    ownerKey: 'owner-1',
    fileName: '虚构文件.docx',
    onAccept: vi.fn(),
    onRetry: vi.fn(),
    reviewAdapter: adapter,
  };
  const mounted = render(<VersionTimeline {...props} />);
  expect(calls).toHaveLength(0);
  expect(screen.queryByRole('dialog')).toBeNull();
  if (entry === 'selected') {
    fireEvent.click(within(screen.getAllByTestId('version-item')[1]!).getByRole('button', { name: 'AI 审查' }));
  } else {
    fireEvent.click(screen.getByRole('button', { name: '更多操作 v1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'AI 审查' }));
  }
  await screen.findByText('固定1轮规则（虚构）');
  expect(calls.find((p) => p.includes('/reviews?'))).toContain('revision_id=old-version');
  const rows = screen.getAllByTestId('version-item');
  await waitFor(() => expect(within(rows[1]!).getAllByTestId('version-review-results').length).toBeGreaterThan(0));
  expect(within(rows[0]!).queryByTestId('version-review-results')).toBeNull();
  expect(adapter.create).not.toHaveBeenCalled();
  expect(adapter.send).not.toHaveBeenCalled();
  mounted.rerender(<VersionTimeline {...props} ownerKey='owner-2' items={[]} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(getScope().items).toHaveLength(0);
});
