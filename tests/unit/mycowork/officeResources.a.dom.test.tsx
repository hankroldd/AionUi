/**
 * [mycowork] adapted：办公资源页 OfficeResourcesSlot 回归（拆分a，原 officeResources.dom.test.tsx，用例原样）。
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpaceSnapshot } from '@mycowork/ui/pages/resources/space-snapshot.ts';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';
import { fetchMock, item, calls, bodyOf, bridge } from './officeResources.fixture';

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'fixture-account' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  useNavigationType: () => 'POP',
  useLocation: () => ({ state: null, pathname: '/', key: 'k' }),
  useNavigate: () => navigateMock,
}));

describe('OfficeResourcesSlot', () => {
  beforeEach(() => {
    resetSpaceSnapshot();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('adapted All uses a single origin=all response with type, origin, KB, time, tags and state', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    const rows = await screen.findAllByTestId('mycowork-resource-item');
    expect(rows.map((r) => within(r).getByRole('button', { name: /^(周报\.md|工作稿\.pptx)$/ }).textContent)).toEqual([
      '周报.md',
      '工作稿.pptx',
    ]);
    expect(calls('GET', 'origin=all&sort=updated&page=1')).toHaveLength(1);
    expect(calls('GET', 'source_id=src_q')).toHaveLength(0);
    const [weekly, draft] = rows as [HTMLElement, HTMLElement];
    expect(within(weekly).getByText('青禾库')).toBeInTheDocument();
    expect(within(weekly).getAllByText('今天 10:13').length).toBeGreaterThan(0);
    expect(within(weekly).getByText('AI 可引用')).toBeInTheDocument();
    expect(within(draft).getByText('我上传的')).toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: '工作稿.pptx' })).toHaveAttribute('type', 'button');
    expect(screen.queryByText(/个版本/)).toBeNull(); // 版本数在版本与变化页看（D146）
    expect(within(draft).getByText('仅存档')).toBeInTheDocument();
    expect(within(draft).getByText('风险')).toBeInTheDocument();
    expect(screen.queryByText(/T\d\d:\d\d/)).toBeNull(); // 不直出 ISO
  });

  it('the nav switches to one knowledge base or My imports', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_q'));
    await waitFor(() => expect(calls('GET', 'source_id=src_q&sort=updated&page=1')).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: '青禾库' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mycowork-nav-imports'));
    await waitFor(() => expect(calls('GET', 'origin=imports&sort=updated&page=1')).toHaveLength(1));
    expect(screen.getByTestId('mycowork-nav-imports')).toHaveAttribute('aria-current', 'page');
  });

  it('a failing source shows a local notice; results from the others stay', async () => {
    bridge({ sourceStatus: 500 });
    render(<OfficeResourcesSlot />);
    expect(await screen.findByText('工作稿.pptx')).toBeInTheDocument();
    expect(screen.getByText(/以下知识库暂时读不到：青禾库/)).toBeInTheDocument();
  });

  it('a knowledge base without access shows the no-permission state', async () => {
    bridge({ sourceStatus: 404 });
    render(<OfficeResourcesSlot />);
    await screen.findByText('工作稿.pptx');
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_q'));
    expect(await screen.findByText('没有这个来源的权限')).toBeInTheDocument();
  });

  it('search looks up names and tags across all sources and says content search is not available', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(screen.getByText(/不搜索文件正文/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索文件名或标签'), { target: { value: '周报' } });
    await waitFor(() => expect(calls('GET', `q=${encodeURIComponent('周报')}`)).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: '搜索“周报”' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索文件名或标签'), { target: { value: '不存在的词' } });
    expect(await screen.findByText('没有名称或标签匹配的资料')).toBeInTheDocument();
    // D146：名字匹配的标签列在结果上方（全路径），点一下进入该标签
    fireEvent.change(screen.getByLabelText('搜索文件名或标签'), { target: { value: '风险' } });
    const hits = await screen.findByTestId('mycowork-hit-tags');
    fireEvent.click(within(hits).getByText('项目 / 风险'));
    await waitFor(() => expect(calls('GET', 'tag_id=tag_c')).toHaveLength(1));
  });

  it('switches grid / list and remembers the choice locally', async () => {
    bridge();
    const { unmount, container } = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByLabelText('网格'));
    await waitFor(() => expect(container.querySelector('.mcw-rc-grid')).not.toBeNull());
    fireEvent.click(screen.getByLabelText('列表'));
    await waitFor(() => expect(container.querySelector('.mcw-rc-rows')).not.toBeNull());
    unmount();
    const again = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(again.container.querySelector('.mcw-rc-rows')).not.toBeNull();
  });

  it('a historical table preference is shown as a list without rewriting the preference or view', async () => {
    localStorage.setItem('mycowork.resources.layout', 'table');
    bridge({
      views: [
        {
          view_id: 'view_table',
          name: '旧表格',
          filter: { tag_ids: ['tag_c'] },
          layout: 'table',
          revision: 2,
          missing_tag_ids: [],
        },
      ],
    });
    const { container } = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(container.querySelector('.mcw-rc-rows [role="list"]')).not.toBeNull();
    expect(within(screen.getByLabelText('列表')).getByRole('radio')).toBeChecked();
    expect(screen.queryByLabelText('表格')).toBeNull();
    expect(localStorage.getItem('mycowork.resources.layout')).toBe('table');
    fireEvent.click(screen.getByTestId('mycowork-nav-view-view_table'));
    await waitFor(() => expect(calls('GET', 'view_id=view_table')).toHaveLength(1));
    expect(within(screen.getByLabelText('列表')).getByRole('radio')).toBeChecked();
    expect(calls('PATCH', '/bridge/v1/saved-views/view_table')).toHaveLength(0);
  });

  it('a Secret file with a ready index is excluded from AI in both layouts', async () => {
    bridge({ secretReady: true });
    const { container } = render(<OfficeResourcesSlot />);
    const row = (await screen.findAllByTestId('mycowork-resource-item')).find((r) =>
      within(r).queryByRole('button', { name: '周报.md' })
    )!;
    expect(within(row).getByText('AI 不引用')).toBeInTheDocument();
    expect(within(row).queryByText('AI 可引用')).toBeNull();
    expect(within(row).getByTestId('mycowork-secret-lock')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('网格'));
    await waitFor(() => expect(container.querySelector('.mcw-rc-grid')).not.toBeNull());
    const card = screen
      .getAllByTestId('mycowork-resource-item')
      .find((r) => within(r).queryByRole('button', { name: '周报.md' }))!;
    expect(within(card).getByText('AI 不引用')).toBeInTheDocument();
    expect(within(card).queryByText('AI 可引用')).toBeNull();
    expect(calls('PATCH', '/metadata')).toHaveLength(0);
  });

  it('a saved view remembers its own layout on the Bridge', async () => {
    bridge({
      views: [
        {
          view_id: 'view_1',
          name: '风险视图',
          filter: { tag_ids: ['tag_c'] },
          layout: 'card',
          revision: 5,
          missing_tag_ids: [],
        },
      ],
    });
    const { container } = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-view-view_1'));
    await waitFor(() => expect(calls('GET', 'view_id=view_1')).toHaveLength(1));
    await waitFor(() => expect(container.querySelector('.mcw-rc-grid')).not.toBeNull());
    fireEvent.click(screen.getByLabelText('列表'));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/saved-views/view_1')).toHaveLength(1));
    expect(bodyOf('PATCH', '/saved-views/view_1')).toEqual({ expected_revision: 5, layout: 'list' });
  });

  it('starring creates the starred collection first, then adds/removes with its revision; Starred lists it', async () => {
    bridge();
    const first = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '收藏 工作稿.pptx' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/collections')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/collections')).toEqual({
      name: '收藏',
      purpose: 'starred',
      resource_ids: ['res_1'],
    });
    first.unmount();
    fetchMock.mockReset();
    bridge({ starred: ['res_1'] });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(screen.getByRole('button', { name: '取消收藏 工作稿.pptx' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '收藏 周报.md' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/collections/col_s')).toHaveLength(1));
    expect(bodyOf('PATCH', '/collections/col_s')).toEqual({ expected_revision: 2, add: ['res_q'] });
    fireEvent.click(screen.getByTestId('mycowork-nav-starred'));
    await waitFor(() => expect(calls('GET', 'collection_id=col_s')).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByTestId('mycowork-resource-item')).toHaveLength(1));
  });

  it('a tag filters across sources and can be saved as a view with the current layout', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-tag-tag_c'));
    await waitFor(() => expect(calls('GET', 'tag_id=tag_c')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '存为智能分组' }));
    fireEvent.change(await screen.findByLabelText('分组名'), { target: { value: '我的风险' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/saved-views')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/saved-views')).toEqual({
      name: '我的风险',
      filter: { tag_ids: ['tag_c'] },
      layout: 'list',
    });
  });

  it('edits tags from "More" with the read metadata revision; a 409 reloads and says so', async () => {
    for (const patchStatus of [undefined, 409]) {
      fetchMock.mockReset();
      bridge({ patchStatus });
      const { unmount } = render(<OfficeResourcesSlot />);
      await screen.findByText('工作稿.pptx');
      fireEvent.click(screen.getByRole('button', { name: '更多操作 工作稿.pptx' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: '编辑标签' }));
      fireEvent.click(await screen.findByLabelText('编辑标签'));
      await screen.findByRole('option', { name: '项目' });
      fireEvent.click(screen.getByText('项目', { selector: 'li *' })); // 多选选项要点到选项里的文字（Arco 在内层元素上处理）
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(calls('PATCH', '/metadata')).toHaveLength(1));
      expect(bodyOf('PATCH', '/metadata')).toEqual({
        expected_metadata_revision: 4,
        tags: { add: ['tag_p'], remove: [] },
      });
      if (patchStatus) {
        expect(await screen.findByText('已被其他地方修改，已重新读取，请再操作一次')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: '“工作稿.pptx”的标签' })).toBeVisible();
      }
      unmount();
    }
  });

  it('moves a tag to the top level with its revision', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '标签“风险”的更多操作' }));
    await act(async () => fireEvent.click(await screen.findByRole('menuitem', { name: '（顶层）' })));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/tags/tag_c')).toHaveLength(1));
    expect(bodyOf('PATCH', '/bridge/v1/tags/tag_c')).toEqual({ expected_revision: 3, parent_id: null });
  });
});
