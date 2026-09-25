/**
 * [mycowork] ADR-0011: `/office/resources/:resourceId/versions` (MyCowork P12 versions, PR08 slice 6).
 * Only the Bridge boundary is mocked (fetch). Covers: timeline with current/origin/restored-from and publication badges;
 * comparing two versions shows changes and the "partial" notice; restoring an old version sends the read current revision;
 * restoring while the file is edited online says so; accept-and-archive and publish-to-KB send the head revision.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeVersionsSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const rev = (id: string, over: object = {}) => ({
  revision_id: id,
  parent_id: null,
  content_sha256: 'x',
  size: 1,
  created_at: '2026-09-26T00:00:00.000Z',
  origin: 'original',
  current: false,
  ...over,
});
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));
const bodyOf = (method: string, part: string) => JSON.parse(String(calls(method, part)[0]?.[1]?.body));

function bridge(opts: { restoreStatus?: number } = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/revisions'))
      return reply(200, {
        resource_id: 'res_1',
        current_revision_id: 'rev_cccccccc',
        items: [
          rev('rev_cccccccc', { current: true, origin: 'restore', restored_from: 'rev_aaaaaaaa' }),
          rev('rev_bbbbbbbb', { origin: 'edit' }),
          rev('rev_aaaaaaaa'),
        ],
        page: 1,
        page_size: 50,
        total: 3,
      });
    if (url.startsWith('/bridge/v1/publications?'))
      return reply(200, {
        items: [
          {
            publication_id: 'pub_1',
            resource_id: 'res_1',
            revision_id: 'rev_bbbbbbbb',
            target: { kind: 'archive' },
            status: 'published',
            error: null,
            accepted_at: 't',
            published_at: 't',
            created_at: 't',
          },
        ],
        page: 1,
        page_size: 50,
        total: 1,
      });
    if (url === '/bridge/v1/scopes')
      return reply(200, {
        sources: [{ source_id: 'src_q', name: '青禾库', provider: 'weknora', counts }],
        projects: [],
      });
    if (url.includes('/changes?'))
      return reply(200, {
        status: 'partial',
        changes: [
          {
            kind: 'modified',
            to_path: '/slide[1]/shape[@id=1]',
            aspects: ['text'],
            text_before: '旧',
            text_after: '新',
          },
        ],
        unknown_parts: [{ reason: 'content_not_compared', to_path: '/slide[1]/chart[1]' }],
      });
    if (url.endsWith('/restore'))
      return opts.restoreStatus
        ? reply(opts.restoreStatus, { error: { code: 'EDIT_LEASE_HELD', message: 'x' } })
        : reply(201, {});
    if (url === '/bridge/v1/publications' && method === 'POST') return reply(201, {});
    return reply(404, {});
  });
}

describe('OfficeVersionsSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the timeline with current, origin, restored-from and publication badges', async () => {
    bridge();
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('cccccccc')).toBeInTheDocument();
    expect(screen.getByText('当前')).toBeInTheDocument();
    expect(screen.getByText('恢复自 aaaaaaaa')).toBeInTheDocument();
    expect(screen.getByText('AI 修改')).toBeInTheDocument();
    expect(screen.getByText('已归档 · 已完成')).toBeInTheDocument();
  });

  it('compares the default pair and shows changes plus the partial-coverage notice', async () => {
    bridge();
    render(<OfficeVersionsSlot />);
    await screen.findByText('cccccccc');
    fireEvent.click(screen.getByRole('button', { name: '对比这两个版本' }));
    expect(await screen.findByText('Diff 覆盖不足：部分对象无法比较')).toBeInTheDocument();
    expect(calls('GET', '/changes?')[0]?.[0]).toContain('from=rev_bbbbbbbb&to=rev_cccccccc');
    expect(screen.getByText('新')).toBeInTheDocument();
    expect(screen.getByText('看不见的部分')).toBeInTheDocument();
  });

  it('restores an old version with the read current revision; online editing is reported', async () => {
    bridge();
    const { unmount } = render(<OfficeVersionsSlot />);
    await screen.findByText('cccccccc');
    fireEvent.click(screen.getAllByRole('button', { name: '恢复为新版本' })[1] as HTMLElement);
    await waitFor(() => expect(calls('POST', '/revisions/rev_aaaaaaaa/restore')).toHaveLength(1));
    expect(bodyOf('POST', '/restore').expected_current_revision_id).toBe('rev_cccccccc');
    unmount();
    fetchMock.mockReset();
    bridge({ restoreStatus: 409 });
    render(<OfficeVersionsSlot />);
    await screen.findByText('cccccccc');
    fireEvent.click(screen.getAllByRole('button', { name: '恢复为新版本' })[0] as HTMLElement);
    expect(await screen.findByText('文件正在在线编辑，编辑中不能恢复覆盖。')).toBeInTheDocument();
  });

  it('accept-and-archive and publish-to-KB send the head revision', async () => {
    bridge();
    render(<OfficeVersionsSlot />);
    await screen.findByText('cccccccc');
    fireEvent.click(screen.getAllByRole('button', { name: '接受并归档' })[0] as HTMLElement);
    await waitFor(() => expect(calls('POST', '/bridge/v1/publications')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/publications')).toMatchObject({
      revision_id: 'rev_cccccccc',
      expected_head_revision_id: 'rev_cccccccc',
      target: { kind: 'archive' },
    });
    fireEvent.click(screen.getByLabelText('发布到知识库'));
    fireEvent.click(await screen.findByText('青禾库'));
    fireEvent.change(screen.getByLabelText('库里的文件名'), { target: { value: '汇报（虚构）.pptx' } });
    fireEvent.click(screen.getByRole('button', { name: '发布' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/publications')).toHaveLength(2));
    expect(JSON.parse(String(calls('POST', '/bridge/v1/publications')[1]?.[1]?.body)).target).toEqual({
      kind: 'knowledge_base',
      source_id: 'src_q',
      file_name: '汇报（虚构）.pptx',
    });
  });
});
