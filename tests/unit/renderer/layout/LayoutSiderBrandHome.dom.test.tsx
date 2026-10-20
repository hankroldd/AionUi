/**
 * 文件：tests/unit/renderer/layout/LayoutSiderBrandHome.dom.test.tsx
 * 职责：验证侧栏原行为和项目预览的窄窗临时单区布局。
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { dispatchWorkspaceToggleEvent } from '@/renderer/utils/workspace/workspaceEvents';

// Mirror the project convention: t() echoes the key so labels/tooltips are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// react-router-dom: control location, capture navigate.
const navigate = vi.fn();
let currentPathname = '/guid';
const platformMocks = vi.hoisted(() => ({
  isElectronDesktopMock: vi.fn(() => false),
}));
const shortcutMocks = vi.hoisted(() => ({
  params: undefined as undefined | { toggleSider: () => void },
}));
const featureMocks = vi.hoisted(() => ({
  teamModeEnabled: false,
}));
const previewMocks = vi.hoisted(() => ({
  projectId: null as string | null,
  mainRowWidth: 1228,
  isOpen: false,
  isMaximized: false,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: currentPathname, search: '', hash: '' }),
  useNavigationType: () => 'POP',
  Outlet: () => <textarea aria-label='chat draft' defaultValue='draft' />,
}));

// Hidden devtools easter-egg target (icon) — assert it is independent of navigation.
const openDevTools = vi.fn(() => Promise.resolve());
vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      openDevTools: { invoke: () => openDevTools() },
      logStream: { on: () => () => {} },
    },
    task: { stopAll: { invoke: () => Promise.resolve({ success: false }) } },
  },
}));

// Trim Layout's collaborators to keep this a focused brand-behaviour test.
vi.mock('@/common/config/constants', () => ({
  get TEAM_MODE_ENABLED() {
    return featureMocks.teamModeEnabled;
  },
}));
vi.mock('@/renderer/components/layout/PwaPullToRefresh', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Titlebar', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/UpdateModal', () => ({ default: () => null }));
vi.mock('@renderer/hooks/system/useDeepLink', () => ({ useDeepLink: () => {} }));
vi.mock('@renderer/hooks/system/notification/useNotificationClick', () => ({ useNotificationClick: () => {} }));
vi.mock('@renderer/hooks/system/notification/useBrowserNotification', () => ({ useBrowserNotification: () => {} }));
vi.mock('@renderer/hooks/file/useDirectorySelection', () => ({
  useDirectorySelection: () => ({ contextHolder: null }),
}));
vi.mock('@renderer/utils/ui/siderTooltip', () => ({ cleanupSiderTooltips: () => {} }));
vi.mock('@renderer/hooks/ui/useConversationShortcuts', () => ({
  useConversationShortcuts: (params: { toggleSider: () => void }) => {
    shortcutMocks.params = params;
  },
}));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: platformMocks.isElectronDesktopMock }));
vi.mock('@renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({
    closePreview: () => {},
    isOpen: previewMocks.isOpen,
    isMaximized: previewMocks.isMaximized,
  }),
}));
vi.mock('@renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel', () => ({
  default: ({ hideMaximizeToggle = false }: { hideMaximizeToggle?: boolean }) => (
    <div data-testid='preview-probe' data-hide-maximize={hideMaximizeToggle}>
      <textarea aria-label='preview draft' defaultValue='preview body' />
    </div>
  ),
}));
vi.mock('@renderer/pages/conversation/explorer/currentProjectStore', () => ({
  useCurrentProject: () => previewMocks.projectId,
  setCurrentProject: () => {},
}));
vi.mock('@renderer/pages/conversation/hooks/useContainerWidth', () => ({
  useContainerWidth: () => ({ containerRef: { current: null }, containerWidth: previewMocks.mainRowWidth }),
}));
vi.mock('@renderer/components/layout/ProjectPanelHost', () => ({
  ProjectPanelHost: ({ collapsed }: { collapsed: boolean }) => (
    <div data-project-panel-host data-collapsed={collapsed} />
  ),
}));

vi.mock('@/renderer/mycowork-rail', () => ({ default: () => <nav data-testid='rail-mount' /> }));
import Layout from '@renderer/components/layout/Layout';

const renderLayout = () => render(<Layout sider={<div>sider</div>} />);

const BACK_KEY = 'common.backToPrevious';

describe('Layout sider brand Home button', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    navigate.mockClear();
    openDevTools.mockClear();
    platformMocks.isElectronDesktopMock.mockReturnValue(false);
    shortcutMocks.params = undefined;
    featureMocks.teamModeEnabled = false;
    sessionStorage.clear();
    localStorage.clear();
    currentPathname = '/guid';
    Object.assign(previewMocks, { projectId: null, mainRowWidth: 1228, isOpen: false, isMaximized: false });
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 1280 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to the recorded last non-settings path when clicked in a settings route', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/office/imports?batch=fictional');
    renderLayout();

    fireEvent.click(screen.getByLabelText(BACK_KEY));
    expect(navigate).toHaveBeenCalledWith('/office/imports?batch=fictional');
  });

  it('falls back to /guid in a settings route when no path is recorded', () => {
    currentPathname = '/settings/system';
    renderLayout();

    fireEvent.click(screen.getByLabelText(BACK_KEY));
    expect(navigate).toHaveBeenCalledWith('/guid');
  });

  it('falls back to /guid when the recorded path is itself a settings path', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/settings/system');
    renderLayout();

    fireEvent.click(screen.getByLabelText(BACK_KEY));
    expect(navigate).toHaveBeenCalledWith('/guid');
  });

  it('activates via keyboard (Enter and Space) in a settings route', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    renderLayout();

    const brand = screen.getByLabelText(BACK_KEY);
    fireEvent.keyDown(brand, { key: 'Enter' });
    fireEvent.keyDown(brand, { key: ' ' });
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/conversation/abc');
  });

  it('ignores non-activation keys in a settings route', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    renderLayout();

    const brand = screen.getByLabelText(BACK_KEY);
    fireEvent.keyDown(brand, { key: 'Tab' });
    fireEvent.keyDown(brand, { key: 'a' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves the native wordmark out of the new home secondary header', () => {
    currentPathname = '/guid';
    renderLayout();

    // No actionable role/label in chat routes.
    expect(screen.queryByLabelText(BACK_KEY)).toBeNull();
    expect(screen.queryByText('AionUi')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not expose the settings brand action on conversation routes', () => {
    currentPathname = '/conversation/xyz';
    renderLayout();

    expect(screen.queryByLabelText(BACK_KEY)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('provides common shortcuts with a functional sider toggle', () => {
    currentPathname = '/conversation/xyz';
    const { container } = renderLayout();
    const sider = container.querySelector('.layout-sider');

    expect(shortcutMocks.params?.toggleSider).toEqual(expect.any(Function));
    expect(sider).not.toHaveClass('collapsed');

    act(() => shortcutMocks.params?.toggleSider());
    expect(sider).toHaveClass('collapsed');

    act(() => shortcutMocks.params?.toggleSider());
    expect(sider).not.toHaveClass('collapsed');
  });

  it('keeps the common shortcut owner mounted on team routes', () => {
    currentPathname = '/team/team-1';
    featureMocks.teamModeEnabled = true;

    renderLayout();

    expect(shortcutMocks.params?.toggleSider).toEqual(expect.any(Function));
  });

  it('clicking the logo icon counts toward the devtools easter-egg and never navigates', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    const { container } = renderLayout();

    // The icon is the SVG-wrapping div (bg-black), separate from the wordmark.
    const icon = container.querySelector('.bg-black') as HTMLElement;
    expect(icon).toBeTruthy();
    for (let i = 0; i < 4; i++) fireEvent.click(icon);
    expect(openDevTools).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the update notification directly for tray update checks', () => {
    platformMocks.isElectronDesktopMock.mockReturnValue(true);
    const openListener = vi.fn();
    window.addEventListener('aionui-open-update-modal', openListener);

    try {
      renderLayout();

      window.dispatchEvent(new Event('tray:check-update'));

      expect(navigate).not.toHaveBeenCalled();
      expect(openListener).toHaveBeenCalledTimes(1);
      const event = openListener.mock.calls[0][0] as CustomEvent;
      expect(event.detail).toEqual({ source: 'tray' });
    } finally {
      window.removeEventListener('aionui-open-update-modal', openListener);
    }
  });

  it('768桌面窄主区临时单区，放宽和关闭后恢复聊天且不改宽度与折叠偏好', () => {
    currentPathname = '/conversation/preview';
    Object.assign(previewMocks, { projectId: 'project-1', mainRowWidth: 428, isOpen: true });
    window.innerWidth = 768;
    localStorage.setItem('chat-preview-width-px', '640');
    localStorage.setItem('project-panel-collapse:project-1', 'expanded');
    const { container, rerender } = renderLayout();
    const chat = screen.getByLabelText('chat draft');
    const draft = screen.getByLabelText('preview draft');
    const region = container.querySelector('[data-project-preview-region]')!;
    fireEvent.change(draft, { target: { value: 'unsaved preview' } });
    expect(chat).not.toBeVisible();
    expect(region).toHaveStyle({ flexGrow: 1, minWidth: 0 });
    expect(region.parentElement).toHaveClass('min-w-0');
    expect(region.querySelector('.cursor-col-resize')).toBeNull();
    expect(screen.getByTestId('preview-probe')).toHaveAttribute('data-hide-maximize', 'true');

    previewMocks.mainRowWidth = 1228;
    rerender(<Layout sider={<div>sider</div>} />);
    expect(chat).toBeVisible();
    expect(screen.getByLabelText('preview draft')).toBe(draft);
    expect(draft).toHaveValue('unsaved preview');
    expect(region).toHaveStyle({ width: '640px', minWidth: '340px' });
    expect(screen.getByTestId('preview-probe')).toHaveAttribute('data-hide-maximize', 'false');
    expect(localStorage.getItem('chat-preview-width-px')).toBe('640');
    expect(localStorage.getItem('project-panel-collapse:project-1')).toBe('expanded');
    previewMocks.isOpen = false;
    rerender(<Layout sider={<div>sider</div>} />);
    expect(chat).toBeVisible();
    expect(container.querySelector('[data-project-preview-region]')).toBeNull();
    expect(container.querySelector('[data-project-panel-host]')).toHaveAttribute('data-collapsed', 'false');
  });

  it('临时单区不覆盖用户的手动最大化，放宽后保留还原动作', () => {
    currentPathname = '/conversation/preview';
    Object.assign(previewMocks, { projectId: 'project-1', mainRowWidth: 428, isOpen: true, isMaximized: true });
    const { rerender } = renderLayout();
    expect(screen.getByTestId('preview-probe')).toHaveAttribute('data-hide-maximize', 'true');
    previewMocks.mainRowWidth = 1228;
    rerender(<Layout sider={<div>sider</div>} />);
    expect(screen.getByLabelText('chat draft')).not.toBeVisible();
    expect(screen.getByTestId('preview-probe')).toHaveAttribute('data-hide-maximize', 'false');
    expect(previewMocks.isMaximized).toBe(true);
  });

  it('主区宽度0尚未测量时不误判临时单区', () => {
    currentPathname = '/conversation/preview';
    Object.assign(previewMocks, { projectId: 'project-1', mainRowWidth: 0, isOpen: true });
    renderLayout();
    expect(screen.getByLabelText('chat draft')).toBeVisible();
    expect(screen.getByTestId('preview-probe')).toHaveAttribute('data-hide-maximize', 'false');
  });

  it('按扣除可见Explorer后的主区判定单区，手动收起后恢复并排', () => {
    currentPathname = '/conversation/preview';
    Object.assign(previewMocks, { projectId: 'project-1', mainRowWidth: 900, isOpen: true });
    renderLayout();
    expect(screen.getByLabelText('chat draft')).toBeVisible();
    act(() => dispatchWorkspaceToggleEvent());
    expect(screen.getByLabelText('chat draft')).not.toBeVisible();
    expect(screen.getByTestId('preview-probe')).toHaveAttribute('data-hide-maximize', 'true');
    act(() => dispatchWorkspaceToggleEvent());
    expect(screen.getByLabelText('chat draft')).toBeVisible();
    expect(screen.getByTestId('preview-probe')).toHaveAttribute('data-hide-maximize', 'false');
  });
});
