/**
 * 文件：tests/unit/mycowork/officeRail.dom.test.tsx
 * 职责：验证原生导航适配、菜单键盘操作、三种主题委托与退出成功/失败边界。
 * 边界：身份/主题/预览 hook 为边界替身；真实 React Router、Arco 和图标栏参与渲染。
 * 关联：PR11 W4-1；ADR-0022；账户预览缓存不得跨登录泄露。
 */
import React from 'react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  lang: 'zh-CN',
  logout: vi.fn(),
  closePreview: vi.fn(),
  clearPreviewForScope: vi.fn(),
  selectTheme: vi.fn(),
  feedback: vi.fn(),
  collapse: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: state.lang } }) }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'fixture-account' }, status: 'authenticated', logout: state.logout }),
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ activeId: 'system', selectTheme: state.selectTheme }),
}));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({ useFeedback: () => ({ openFeedback: state.feedback }) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ setSiderCollapsed: state.collapse }),
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({ usePreviewContext: () => state }));
import MyCoworkRail from '@/renderer/mycowork-rail';

function RouteProbe() {
  return <output data-testid='route'>{useLocation().pathname}</output>;
}
function mount(route = '/guid', mobile = false) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <MyCoworkRail mobile={mobile} />
      <RouteProbe />
    </MemoryRouter>
  );
}
async function account() {
  fireEvent.click(screen.getByRole('button', { name: '账户菜单' }));
  await screen.findByRole('menu', { name: '账户菜单' });
}
describe('MyCowork icon rail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('electronAPI', undefined);
    state.lang = 'zh-CN';
    state.logout.mockResolvedValue(undefined);
    state.selectTheme.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.unstubAllGlobals();
  });
  it.each([
    ['空间', '/office/space'],
    ['定时任务', '/scheduled'],
    ['记忆', '/office/memory'],
    ['首页', '/guid'],
  ])('routes %s through the native router', (name, route) => {
    mount('/office/knowledge');
    fireEvent.click(screen.getByRole('button', { name }));
    expect(screen.getByTestId('route').textContent).toBe(route);
    expect(screen.getByRole('button', { name }).getAttribute('aria-current')).toBe('page');
  });
  it('recognizes old resource version links and nested scheduled routes', () => {
    const view = mount('/office/resources/r1/versions');
    expect(screen.getByRole('button', { name: '空间' }).getAttribute('aria-current')).toBe('page');
    view.unmount();
    mount('/scheduled/job1');
    expect(screen.getByRole('button', { name: '定时任务' }).getAttribute('aria-current')).toBe('page');
  });

  it('mobile rail keeps accessible labels and menus without hover tooltips covering the Space header', async () => {
    vi.useFakeTimers();
    mount('/office/space', true);
    const trigger = screen.getByRole('button', { name: '账户菜单' });
    fireEvent.mouseEnter(trigger);
    trigger.focus();
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.queryByRole('tooltip')).toBeNull();
    vi.useRealTimers();
    await account();
    expect(screen.getByRole('menu', { name: '账户菜单' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '空间' })).toHaveAttribute('aria-current', 'page');
  });
  it('More has only the two requested routes, with keyboard escape returning focus', async () => {
    mount();
    const trigger = screen.getByRole('button', { name: '更多' });
    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu', { name: '更多' });
    expect(screen.getAllByRole('menuitem').map((n) => n.textContent)).toEqual(['知识管理', '导入记录']);
    const first = screen.getByRole('menuitem', { name: '知识管理' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('导入记录');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
  });
  it.each([
    ['浅色', 'light'],
    ['深色', 'dark'],
    ['跟随系统', 'system'],
  ])('delegates %s to persisted native themes', async (label, id) => {
    mount();
    await account();
    fireEvent.click(screen.getByRole('menuitemradio', { name: label }));
    expect(state.selectTheme).toHaveBeenCalledWith(id);
  });
  it('opens native settings and feedback, displaying the existing account', async () => {
    mount();
    await account();
    expect(screen.getByText('fixture-account')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '设置' }));
    expect(screen.getByTestId('route').textContent).toBe('/settings/agent');
    await account();
    fireEvent.click(screen.getByRole('menuitem', { name: '帮助与反馈' }));
    expect(state.feedback).toHaveBeenCalledOnce();
  });
  it('discards account preview state only after native logout resolves', async () => {
    let finish!: () => void;
    state.logout.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    mount();
    await account();
    fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));
    expect(state.clearPreviewForScope).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(state.clearPreviewForScope).toHaveBeenCalledOnce());
  });
  it('does not discard previews when the logout hook rejects and keeps the shortcut', async () => {
    state.logout.mockRejectedValue(new Error('fixture failure'));
    mount();
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, shiftKey: true });
    await screen.findByText('退出失败，请重试。');
    expect(state.clearPreviewForScope).not.toHaveBeenCalled();
  });
  it('keeps navigation and account accessible in the mobile drawer', async () => {
    mount('/guid', true);
    fireEvent.click(screen.getByRole('button', { name: '记忆' }));
    expect(state.collapse).toHaveBeenCalledWith(true);
    await account();
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeTruthy();
  });
  it('uses English fallback labels', () => {
    state.lang = 'en';
    mount();
    expect(screen.getByRole('button', { name: 'Space' })).toBeTruthy();
  });
  it('closes from the trigger before popup focus moves', async () => {
    mount();
    const trigger = screen.getByRole('button', { name: '账户菜单' });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
  });
  it('leaves Escape available to native dialogs when the menu is closed', () => {
    mount();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    screen.getByRole('button', { name: '账户菜单' }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it('keeps desktop local accounts without a WebUI logout action', async () => {
    vi.stubGlobal('electronAPI', {});
    mount();
    await account();
    expect(screen.queryByRole('menuitem', { name: '退出登录' })).toBeNull();
  });
});
