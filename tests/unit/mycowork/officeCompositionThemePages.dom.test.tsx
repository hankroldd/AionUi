/**
 * 文件/职责：测试 P09“采用本主题整套页型（N 页）”（MyCowork PR05 D322）：决策详情带 theme_pages 且页数对得上时出现，
 * 按 theme_pages 顺序逐页提交（已是该页型的跳过）、全部成功回到对话；某页失败即停、说明第几页、不回到对话；页数或某页内容关系对不上不出现。
 * [mycowork] ADR-0011. Only the Bridge boundary is mocked (fetch), reusing the stateful fake Bridge of templateBrowseFixture.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeCompositionSlot } from '@/renderer/mycowork-slots';
import { fetchMock, reply, serve, type Server } from './templateBrowseFixture';

const navigate = vi.hoisted(() => vi.fn());
const back = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => navigate,
  useParams: () => ({ decisionId: 'dec_1' }),
}));

/** 'p2:summary' 给出与计划不同的内容关系；缺省与夹具计划相同（parallel）。 */
const tp = (spec: string) => {
  const [id = spec, relation = 'parallel'] = spec.split(':');
  return { asset_id: id, title: `页型 ${id}`, structure: id, relation, fields: [] };
};
/** Bridge GET adds theme_pages; choices returns only the persisted decision. */
function serveWithThemePages(s: Server, ids: string[]) {
  const posts = serve(s);
  const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<ReturnType<typeof reply>>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const r = await base(url, init);
    if (!/template-decisions\//.test(url) || r.status >= 300) return r;
    return reply(r.status, {
      ...((await r.json()) as object),
      theme: { asset_id: 'theme.dept-decision', version: 1, title: '部门主题' },
      ...(init?.method === 'POST' ? {} : { theme_pages: ids.map(tp) }),
    });
  });
  return posts;
}

describe('P09 adopt the theme page set (D322)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    navigate.mockReset();
    back.mockReset();
    window.history.pushState({}, '', '#/office/compositions/dec_1'); // 有历史：“回到对话”走 history.back()
    vi.spyOn(window.history, 'back').mockImplementation(back);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('selects every page in theme_pages order, skipping pages already on that pattern, then returns to chat', async () => {
    const posts = serveWithThemePages(
      {
        pages: [
          { no: 1, cands: ['a1'] },
          { no: 2, cands: ['b1'], picked: 'p2' },
          { no: 3, cands: ['c1'] },
        ],
      },
      ['p1', 'p2', 'p3']
    );
    render(<OfficeCompositionSlot />);
    const adopt = await screen.findByRole('button', { name: '采用本主题整套页型（3 页）' });
    expect(adopt.className).toMatch(/arco-btn-primary/);
    expect(screen.getByRole('button', { name: '全部采用首选' }).className).not.toMatch(/arco-btn-primary/);
    fireEvent.click(adopt);
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(posts.map((p) => [p.id, p.body.page_no, p.body.asset_id])).toEqual([
      ['dec_1', 1, 'p1'],
      ['dec_2', 3, 'p3'],
    ]);
  });

  it('stops at the failing page with its number and stays on the review page', async () => {
    const posts = serveWithThemePages(
      {
        pages: [
          { no: 1, cands: ['a1'] },
          { no: 2, cands: ['b1'] },
          { no: 3, cands: ['c1'] },
        ],
        failChoiceAt: { pageNo: 2 },
      },
      ['p1', 'p2', 'p3']
    );
    render(<OfficeCompositionSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '采用本主题整套页型（3 页）' }));
    expect(await screen.findByText(/已采用 1 页.*第 2 页没成功/)).toBeInTheDocument();
    expect(posts.map((p) => p.body.page_no)).toEqual([1, 2]);
    expect(back).not.toHaveBeenCalled();
  });

  it('keeps the full theme action after a manual page choice with GET-only metadata', async () => {
    const posts = serveWithThemePages(
      {
        pages: [
          { no: 1, cands: ['p1'] },
          { no: 2, cands: ['p2'] },
          { no: 3, cands: ['p3'] },
        ],
      },
      ['p1', 'p2', 'p3']
    );
    render(<OfficeCompositionSlot />);
    await screen.findByRole('button', { name: '采用本主题整套页型（3 页）' });
    fireEvent.click(screen.getAllByRole('button', { name: '选这个结构' })[0] as HTMLElement);
    await screen.findByRole('button', { name: '已选中' });
    fireEvent.click(await screen.findByRole('button', { name: '采用本主题整套页型（3 页）' }));
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(posts.map((p) => [p.id, p.body.page_no, p.body.asset_id])).toEqual([
      ['dec_1', 1, 'p1'],
      ['dec_2', 2, 'p2'],
      ['dec_3', 3, 'p3'],
    ]);
    expect(
      fetchMock.mock.calls.filter(([url, init]) => /template-decisions\//.test(url) && init?.method !== 'POST')
    ).toHaveLength(1);
  });

  it('is not offered when the page plan and theme_pages differ in length', async () => {
    serveWithThemePages(
      {
        pages: [
          { no: 1, cands: ['a1'] },
          { no: 2, cands: ['b1'] },
        ],
      },
      ['p1', 'p2', 'p3']
    );
    render(<OfficeCompositionSlot />);
    expect(await screen.findByRole('button', { name: '全部采用首选' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /采用本主题整套页型/ })).toBeNull();
  });

  it('is not offered when a theme page does not match the planned relation of its page', async () => {
    serveWithThemePages(
      {
        pages: [
          { no: 1, cands: ['a1'] },
          { no: 2, cands: ['b1'] },
          { no: 3, cands: ['c1'] },
        ],
      },
      ['p1', 'p2:summary', 'p3']
    );
    render(<OfficeCompositionSlot />);
    expect(await screen.findByRole('button', { name: '全部采用首选' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /采用本主题整套页型/ })).toBeNull();
  });
});
