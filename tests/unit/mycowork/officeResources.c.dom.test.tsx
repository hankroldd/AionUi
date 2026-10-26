/**
 * [mycowork] adapted：办公资源页 OfficeResourcesSlot 回归（拆分c，原 officeResources.dom.test.tsx，用例原样）。
 */

import { act, fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpaceSnapshot } from '@mycowork/ui/pages/resources/space-snapshot.ts';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';
import { fetchMock, item, calls, bodyOf, bridge } from './officeResources.fixture';

// A518：整页渲染用例在并发负载下会超过默认 10 s，只对本文件放宽。
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 15_000 });

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

  it('a smart group keeps condition editing and uses management for two-step deletion (D143)', async () => {
    bridge({
      views: [
        {
          view_id: 'view_1',
          name: '风险视图',
          filter: { tag_ids: ['tag_c'], include_descendants: true, source_ids: ['src_q'] },
          layout: 'list',
          revision: 5,
          missing_tag_ids: [],
        },
      ],
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(screen.getByText('智能分组')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '管理智能分组' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '编辑分组' }));
    const name = await screen.findByLabelText('分组名');
    expect(name).toHaveValue('风险视图');
    fireEvent.change(name, { target: { value: '青禾风险' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/saved-views/view_1')).toHaveLength(1));
    expect(bodyOf('PATCH', '/saved-views/view_1')).toEqual({
      expected_revision: 5,
      name: '青禾风险',
      filter: { tag_ids: ['tag_c'], source_ids: ['src_q'], include_descendants: true },
    });
    // 选中一个智能分组时，标题区也有“编辑分组”（负责人第 1 条：找得到编辑入口）
    fireEvent.click(screen.getByTestId('mycowork-nav-view-view_1'));
    fireEvent.click(await screen.findByRole('button', { name: '编辑分组' }));
    expect(await screen.findByLabelText('分组名')).toHaveValue('青禾风险');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '管理智能分组' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除“青禾风险”' }));
    expect(await screen.findByText('只删除这个分组本身；里面的文件、标签与知识库都不受影响。')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1) as HTMLElement);
    await waitFor(() => expect(calls('DELETE', '/bridge/v1/saved-views/view_1')).toHaveLength(1));
  });

  it('management renames with the revision, refreshes the label and offers child creation with the chosen parent', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    const manager = await screen.findByRole('dialog');
    fireEvent.click(within(manager).getByRole('button', { name: '改名“风险”' }));
    fireEvent.change(within(manager).getByLabelText('改名“风险”'), { target: { value: '新风险' } });
    fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/tags/tag_c')).toHaveLength(1));
    expect(bodyOf('PATCH', '/tags/tag_c')).toEqual({ expected_revision: 3, name: '新风险' });
    await within(manager).findByRole('button', { name: '改名“新风险”' });
    expect(screen.getByTestId('mycowork-nav-tag-tag_c')).toHaveTextContent('新风险');
    fireEvent.click(within(manager).getByRole('button', { name: '为“项目”添加子标签' }));
    const child = await screen.findByLabelText('新标签名');
    fireEvent.change(child, { target: { value: '子类' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '新建' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1));
    expect(bodyOf('POST', '/tags')).toEqual({ name: '子类', parent_id: 'tag_p' });
  });

  it('management retains rename input and conflict notice after stale revision', async () => {
    bridge({ tagPatchStatus: 409 });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    const manager = await screen.findByRole('dialog');
    fireEvent.click(within(manager).getByRole('button', { name: '改名“风险”' }));
    const input = within(manager).getByLabelText('改名“风险”');
    fireEvent.change(input, { target: { value: '保留草稿' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(calls('PATCH', '/bridge/v1/tags/tag_c')).toHaveLength(0);
    fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
    expect(await within(manager).findByText('已被其他地方修改，已重新读取，请再操作一次')).toBeVisible();
    expect(input).toHaveValue('保留草稿');
  });

  it.each([404, 409])('tag deletion %s keeps the second confirmation and failure notice', async (status) => {
    bridge({ tagDeleteStatus: status });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除“风险”' }));
    expect(calls('DELETE', '/bridge/v1/tags/tag_c')).toHaveLength(0);
    const confirm = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(calls('DELETE', '/bridge/v1/tags/tag_c')).toHaveLength(1));
    await waitFor(() => expect(within(confirm).getByRole('alert')).toBeVisible());
    if (status === 409) expect(within(confirm).getByText('这个标签还有子标签，请先移动或删除子标签。')).toBeVisible();
    if (status === 404) expect(within(confirm).getByText('这项内容已不可用，请刷新页面后重试。')).toBeVisible();
    expect(confirm).toBeVisible();
    expect(screen.getAllByTestId('mycowork-resource-item')).toHaveLength(2);
  });

  it('pending deletion cannot close or submit again, and failure preserves its confirmation', async () => {
    let finish!: () => void;
    bridge({
      tagDeleteStatus: 409,
      tagDeleteWait: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除“风险”' }));
    const confirm = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    const remove = within(confirm).getByRole('button', { name: '删除' });
    fireEvent.click(remove);
    expect(within(confirm).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(within(confirm).getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.keyDown(confirm, { key: 'Escape', keyCode: 27 });
    const mask = confirm.closest('.arco-modal-wrapper') as HTMLElement;
    fireEvent.mouseDown(mask);
    fireEvent.click(mask);
    fireEvent.click(remove);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(confirm).toBeVisible();
    expect(calls('DELETE', '/bridge/v1/tags/tag_c')).toHaveLength(1);
    await act(async () => finish());
    expect(await within(confirm).findByText('这个标签还有子标签，请先移动或删除子标签。')).toBeVisible();
    expect(within(confirm).getByRole('button', { name: 'Close' })).toBeVisible();
    expect(calls('DELETE', '/bridge/v1/tags/tag_c')).toHaveLength(1);
  });

  it('cancelling child creation resets the parent when adding a top-level tag', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '为“项目”添加子标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(screen.getByTestId('mycowork-resource-nav')).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    fireEvent.change(await screen.findByLabelText('新标签名'), { target: { value: '顶层' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '新建' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1));
    expect(bodyOf('POST', '/tags')).toEqual({ name: '顶层' });
  });

  it('deleting the selected tag refreshes navigation and returns to Recent while resource rows stay', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-tag-tag_c'));
    fireEvent.click(screen.getByRole('button', { name: '管理标签' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '删除“风险”' }));
    fireEvent.click(within(screen.getAllByRole('dialog').at(-1) as HTMLElement).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByTestId('mycowork-nav-tag-tag_c')).toBeNull());
    expect(screen.getByTestId('mycowork-nav-recent')).toHaveAttribute('aria-current', 'page');
    // 回到“最近”会重读列表，行要等这次读取回来才出现
    await waitFor(() => expect(screen.getAllByTestId('mycowork-resource-item')).toHaveLength(2));
  });

  it('renames an invalid smart group without resending its filter or altering missing tags', async () => {
    const filter = { tag_ids: ['deleted_tag'], include_descendants: false, source_ids: ['src_q'] };
    bridge({
      views: [
        { view_id: 'view_bad', name: '旧分组', filter, layout: 'list', revision: 7, missing_tag_ids: ['deleted_tag'] },
      ],
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理智能分组' }));
    const manager = await screen.findByRole('dialog');
    fireEvent.click(within(manager).getByRole('button', { name: '改名“旧分组”' }));
    fireEvent.change(within(manager).getByLabelText('改名“旧分组”'), { target: { value: '新分组' } });
    fireEvent.click(within(manager).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/saved-views/view_bad')).toHaveLength(1));
    expect(bodyOf('PATCH', '/saved-views/view_bad')).toEqual({ expected_revision: 7, name: '新分组' });
    await within(manager).findByRole('button', { name: '改名“新分组”' });
    expect(within(manager).getByText(/分组引用的标签已删除/)).toBeVisible();
  });

  it('condition editing preserves exact tag matching instead of adding descendants implicitly', async () => {
    bridge({
      views: [
        {
          view_id: 'view_strict',
          name: '严格分组',
          filter: { tag_ids: ['tag_c'], include_descendants: false, source_ids: ['src_q'] },
          layout: 'list',
          revision: 8,
          missing_tag_ids: [],
        },
      ],
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByRole('button', { name: '管理智能分组' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '编辑分组' }));
    expect(await screen.findByLabelText('带这些标签的文件（任一，不含子标签）')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('分组名'), { target: { value: '改名仍严格' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('PATCH', '/bridge/v1/saved-views/view_strict')).toHaveLength(1));
    expect(bodyOf('PATCH', '/saved-views/view_strict')).toEqual({
      expected_revision: 8,
      name: '改名仍严格',
      filter: { tag_ids: ['tag_c'], source_ids: ['src_q'], include_descendants: false },
    });
  });

  it('shows at most two tags plus "+N"; an archive-only item offers "add to a knowledge base" (D145, D146)', async () => {
    bridge({ tags3: true });
    render(<OfficeResourcesSlot />);
    const draft = (await screen.findByText('工作稿.pptx')).closest(
      '[data-testid="mycowork-resource-item"]'
    ) as HTMLElement;
    const chips = within(draft).getByTestId('mycowork-item-tags');
    expect(within(chips).getAllByText(/^(项目|风险|第三个)$/)).toHaveLength(2);
    expect(within(chips).getByText('+1')).toBeInTheDocument();
    fireEvent.click(within(draft).getByRole('button', { name: '更多操作 工作稿.pptx' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '发布到知识库' }));
    expect(window.location.hash).not.toContain('/versions'); // 原地弹窗，不再跳版本页
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a knowledge base filtered by tags lists base ∩ tags, saves a smart group limited to it, and asks with it (D144)', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    fireEvent.click(screen.getByTestId('mycowork-nav-source-src_q'));
    await screen.findByRole('heading', { name: '青禾库' });
    fireEvent.click(document.querySelector('.mcw-rc-tagfilter') as HTMLElement);
    fireEvent.click(await screen.findByText('风险', { selector: '.arco-tree-select-popup *' }));
    await waitFor(() => expect(calls('GET', 'source_id=src_q&tag_id=tag_c&sort=updated&page=1')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '存为智能分组' }));
    fireEvent.change(await screen.findByLabelText('分组名'), { target: { value: '青禾里的风险' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/saved-views')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/saved-views')).toEqual({
      name: '青禾里的风险',
      filter: { tag_ids: ['tag_c'], source_ids: ['src_q'] },
      layout: 'list',
    });
    const ask = screen.getByRole('button', { name: /用这些资料提问/ });
    expect(ask).not.toHaveAttribute('href');
    fireEvent.click(ask);
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/guid', {
        state: {
          mycoworkScopeDraft: {
            ownerKey: 'u1',
            selection: { items: [{ source_id: 'src_q', name: '青禾库', tag_ids: ['tag_c'] }], views: [] },
          },
        },
      })
    );
  });

  it('no resources: the empty state and the Create menu both open the upload dialog (no page change)', async () => {
    bridge({ empty: true });
    render(<OfficeResourcesSlot />);
    expect(await screen.findByText('空间里还没有资料')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: /导入资料/ });
    expect(buttons).toHaveLength(1); // 空状态保留直接引导，页头统一用新建菜单
    fireEvent.click(buttons[0] as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByText('导入资料', { selector: '.arco-modal-title' })).toBeNull());
    const header = screen.getByTestId('mycowork-resources').querySelector('header') as HTMLElement;
    fireEvent.click(within(header).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '导入资料' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(window.location.hash).not.toBe('#/office/imports');
  });
});
