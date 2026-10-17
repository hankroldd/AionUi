/**
 * [mycowork] adapted：办公资源页 OfficeResourcesSlot 回归（拆分b，原 officeResources.dom.test.tsx，用例原样）。
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';
import { LayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { fetchMock, item, calls, bodyOf, bridge } from './officeResources.fixture';

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'fixture-account' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/', key: 'k' }),
  useNavigate: () => navigateMock,
}));

describe('OfficeResourcesSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('nav groups stay collapsed; old internal width is ignored because the native sidebar owns resizing', async () => {
    bridge();
    const first = render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const tagsHeader = () =>
      screen.getByText('标签', { selector: '.arco-collapse-item-header *' }).closest('.arco-collapse-item-header');
    fireEvent.click(tagsHeader() as HTMLElement);
    await waitFor(() =>
      expect(JSON.parse(String(localStorage.getItem('mycowork.resources.nav'))).open).not.toContain('tags')
    );
    expect(screen.queryByRole('separator')).toBeNull();
    localStorage.setItem('mycowork.resources.nav', JSON.stringify({ width: 200, open: ['sources', 'views'] }));
    first.unmount();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    expect(screen.queryByRole('separator')).toBeNull();
    expect(tagsHeader()).toHaveAttribute('aria-expanded', 'false');
  });

  it('portal navigation shares the main query and closes only the mobile drawer after choosing results', async () => {
    bridge();
    const collapse = vi.fn();
    const { container } = render(
      <LayoutContext.Provider value={{ isMobile: true, siderCollapsed: false, setSiderCollapsed: collapse }}>
        <aside id='mycowork-space-sider' />
        <div onClick={() => collapse(true)}>
          <OfficeResourcesSlot />
        </div>
      </LayoutContext.Provider>
    );
    await screen.findByText('周报.md');
    const host = container.querySelector('#mycowork-space-sider') as HTMLElement;
    expect(within(host).getByTestId('mycowork-resource-nav')).toBeInTheDocument();
    expect(within(screen.getByTestId('mycowork-resources')).queryByTestId('mycowork-resource-nav')).toBeNull();
    fireEvent.click(within(host).getByText('知识库', { selector: '.arco-collapse-item-header *' }));
    expect(collapse).not.toHaveBeenCalled();
    fireEvent.click(within(host).getByText('知识库', { selector: '.arco-collapse-item-header *' }));
    fireEvent.click(within(host).getByRole('button', { name: '搜索空间' }));
    expect(collapse).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('搜索文件名或标签'), { target: { value: '周报' } });
    fireEvent.keyDown(within(dialog).getByLabelText('搜索文件名或标签'), { key: 'Enter', isComposing: true });
    expect(collapse).not.toHaveBeenCalled();
    await waitFor(() => expect(calls('GET', `q=${encodeURIComponent('周报')}`)).toHaveLength(1));
    expect(within(screen.getByTestId('mycowork-resources')).getByLabelText('搜索文件名或标签')).toHaveValue('周报');
    fireEvent.click(within(dialog).getByRole('button', { name: '查看结果' }));
    expect(collapse).toHaveBeenCalledWith(true);
    fireEvent.click(within(host).getByTestId('mycowork-nav-imports'));
    await waitFor(() => expect(calls('GET', 'origin=imports&sort=updated&page=1')).toHaveLength(1));
    expect(within(screen.getByTestId('mycowork-resources')).getByLabelText('搜索文件名或标签')).toHaveValue('');
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
    expect(within(host).getByRole('button', { name: '回收站' })).toBeInTheDocument();
  });

  it('the new menu opens existing tag creation; a conflict keeps the dialog and draft', async () => {
    bridge({ createTagStatus: 409 });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const nav = screen.getByTestId('mycowork-resource-nav');
    fireEvent.click(within(nav).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('新标签名'), { target: { value: '重复标签' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/tags')).toEqual({ name: '重复标签' });
    expect(within(dialog).getByLabelText('新标签名')).toHaveValue('重复标签');
    expect(await within(dialog).findByText('已有同名标签，请换个名字')).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('the header and sidebar share one tag dialog; composing Enter does not create a tag', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const header = screen.getByTestId('mycowork-resources').querySelector('header') as HTMLElement;
    expect(within(header).getByRole('heading', { name: '全部' })).toBeInTheDocument();
    fireEvent.click(within(header).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText('新标签名');
    fireEvent.change(name, { target: { value: '页头标签' } });
    fireEvent.keyDown(name, { key: 'Enter', isComposing: true });
    expect(calls('POST', '/bridge/v1/tags')).toHaveLength(0);
    fireEvent.keyDown(name, { key: 'Enter', isComposing: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1);
    expect(bodyOf('POST', '/tags')).toEqual({ name: '页头标签' });
    fireEvent.click(within(screen.getByTestId('mycowork-resource-nav')).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByLabelText('新标签名')).toHaveValue('');
  });

  it('tag creation waits for its response without closing, editing or submitting twice', async () => {
    let finish!: () => void;
    bridge({
      createTagStatus: 409,
      createTagWait: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    });
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const header = screen.getByTestId('mycowork-resources').querySelector('header') as HTMLElement;
    fireEvent.click(within(header).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText('新标签名');
    fireEvent.change(name, { target: { value: '保留创建草稿' } });
    const create = within(dialog).getByRole('button', { name: '新建' });
    fireEvent.click(create);
    expect(name).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(create);
    expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1);
    await act(async () => finish());
    expect(await within(dialog).findByText('已有同名标签，请换个名字')).toBeVisible();
    expect(name).toHaveValue('保留创建草稿');
    expect(name).toBeEnabled();
  });

  it('tag creation from the mobile portal keeps navigation open while using the dialog', async () => {
    bridge();
    const collapse = vi.fn();
    const { container } = render(
      <LayoutContext.Provider value={{ isMobile: true, siderCollapsed: false, setSiderCollapsed: collapse }}>
        <aside id='mycowork-space-sider' />
        <div onClick={() => collapse(true)}>
          <OfficeResourcesSlot />
        </div>
      </LayoutContext.Provider>
    );
    await screen.findByText('周报.md');
    const host = container.querySelector('#mycowork-space-sider') as HTMLElement;
    fireEvent.click(within(host).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建标签' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('新标签名'));
    fireEvent.change(within(dialog).getByLabelText('新标签名'), { target: { value: '手机创建' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '新建' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/tags')).toHaveLength(1));
    expect(collapse).not.toHaveBeenCalled();
  });

  it('header search keeps an IME-cancelling Escape and clears an ordinary Escape', async () => {
    bridge();
    render(<OfficeResourcesSlot />);
    await screen.findByText('周报.md');
    const header = screen.getByTestId('mycowork-resources').querySelector('header') as HTMLElement;
    const input = within(header).getByLabelText('搜索文件名或标签');
    fireEvent.change(input, { target: { value: '组合输入' } });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(input).toHaveValue('组合输入');
    fireEvent.keyDown(input, { key: 'Escape', isComposing: false });
    expect(input).toHaveValue('');
  });
});
