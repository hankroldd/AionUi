/**
 * [mycowork] PR09: `/office/memory` 同状态超过一页（50 条）时的“加载更多”。
 * 只 mock Bridge 边界（fetch）。覆盖：总数 > 已显示条数时出现按钮并请求 page=2、追加而不是替换；到底后按钮消失；
 * 加载失败给提示、按钮仍在、再点可重试。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeMemorySlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: null, pathname: '/' }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const mem = (id: string) => ({
  memory_id: id,
  kind: 'preference',
  scope: { type: 'personal' },
  text: `条目 ${id}`,
  sources: { resource_ids: [] },
  status: 'candidate',
  revision: 1,
  exportable: false,
  created_at: 't',
  updated_at: 't',
});

/** 共 3 条，第 1 页 2 条、第 2 页 1 条；`failPage2` 次第 2 页请求先失败。 */
function bridge(failPage2 = 0) {
  let left = failPage2;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/bridge/v1/memory-items?')) {
      const page = Number(new URL(url, 'http://x').searchParams.get('page'));
      if (page === 2) {
        if (left-- > 0) return reply(500, { error: { code: 'INTERNAL', message: 'x' } });
        return reply(200, { items: [mem('c')], page: 2, page_size: 2, total: 3 });
      }
      return reply(200, { items: [mem('a'), mem('b')], page: 1, page_size: 2, total: 3 });
    }
    if (url === '/bridge/v1/memory-settings') return reply(200, { paused: false });
    return reply(404, {});
  });
}
const pages = () => fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('memory-items?'));

describe('OfficeMemorySlot paging', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the next page by appending, and the button goes away at the end', async () => {
    bridge();
    render(<OfficeMemorySlot />);
    await screen.findByText('条目 a');
    expect(screen.getByText(/共 3 条/)).toBeInTheDocument();
    expect(screen.queryByText('条目 c')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('条目 c')).toBeInTheDocument();
    expect(screen.getByText('条目 a')).toBeInTheDocument(); // 追加，不替换
    expect(pages().some((u) => u.includes('page=2') && u.includes('status=candidate'))).toBe(true);
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('a failed load explains itself, keeps the items and the button, and can be retried', async () => {
    bridge(1);
    render(<OfficeMemorySlot />);
    await screen.findByText('条目 a');
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('没有加载出更多条目，请重试')).toBeInTheDocument();
    expect(screen.getByText('条目 a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('条目 c')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull());
  });
});
