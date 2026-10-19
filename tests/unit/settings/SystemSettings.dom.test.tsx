/**
 * 文件：tests/unit/settings/SystemSettings.dom.test.tsx
 * 职责：验证系统设置内容路由与侧栏键盘导航、折叠名称和导航失败回调。
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsSider from '@/renderer/pages/settings/components/SettingsSider';
import SystemSettings from '@/renderer/pages/settings/SystemSettings';

const mockUseLocation = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  useLocation: () => mockUseLocation(),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent', () => ({
  default: () => <div data-testid='system-modal-content'>SystemModalContent</div>,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/AboutModalContent', () => ({
  default: () => <div data-testid='about-modal-content'>AboutModalContent</div>,
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children, contentClassName }: { children: React.ReactNode; contentClassName?: string }) => (
    <div data-testid='settings-page-wrapper' {...(contentClassName ? { 'data-content-class': contentClassName } : {})}>
      {children}
    </div>
  ),
}));

describe('SystemSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders SystemModalContent when pathname is not /settings/about', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(screen.getByTestId('system-modal-content')).toBeInTheDocument();
    expect(screen.queryByTestId('about-modal-content')).not.toBeInTheDocument();
  });

  it('renders AboutModalContent when pathname is /settings/about', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/about' });
    render(<SystemSettings />);
    expect(screen.getByTestId('about-modal-content')).toBeInTheDocument();
    expect(screen.queryByTestId('system-modal-content')).not.toBeInTheDocument();
  });

  it('applies max-w-640px contentClassName for about page', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/about' });
    render(<SystemSettings />);
    const wrapper = screen.getByTestId('settings-page-wrapper');
    expect(wrapper).toHaveAttribute('data-content-class', 'max-w-640px');
  });

  it('does not apply contentClassName for system page', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    const wrapper = screen.getByTestId('settings-page-wrapper');
    expect(wrapper).not.toHaveAttribute('data-content-class');
  });

  it('wraps content in SettingsPageWrapper', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(screen.getByTestId('settings-page-wrapper')).toBeInTheDocument();
  });
});

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
  resolveExtensionAssetUrl: () => undefined,
}));
vi.mock('@/renderer/hooks/system/useExtensionSettingsTabs', () => ({ useExtensionSettingsTabs: () => [] }));
vi.mock('@/renderer/hooks/system/useExtI18n', () => ({ useExtI18n: () => ({ resolveExtTabName: () => '' }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsSider keyboard navigation', () => {
  const paths = ['agent', 'model', 'skills', 'tools', 'appearance', 'webui', 'system', 'archived', 'about'];

  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
  });

  it.each(['{Enter}', ' '])('Tab reaches all nine browser settings and %s navigates each once', async (key) => {
    const user = userEvent.setup();
    const { container } = render(<SettingsSider />);
    expect(screen.getAllByRole('button')).toHaveLength(paths.length);
    for (const path of paths) {
      // Tab order and activation are sequential browser actions.
      // eslint-disable-next-line no-await-in-loop
      await user.tab();
      expect(container.querySelector(`[data-settings-path="${path}"]`)).toHaveFocus();
      // eslint-disable-next-line no-await-in-loop
      await user.keyboard(key);
    }
    expect(mockNavigate.mock.calls).toEqual(paths.map((path) => [`/settings/${path}`, { replace: true }]));
  });

  it('keeps a name and current-page state when the text is collapsed', () => {
    render(<SettingsSider collapsed />);
    expect(screen.getByRole('button', { name: 'settings.system' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'settings.model' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the existing rejection report when navigation fails', async () => {
    const user = userEvent.setup();
    const error = new Error('fixture navigation rejected');
    mockNavigate.mockRejectedValueOnce(error);
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SettingsSider />);
    await user.click(screen.getByRole('button', { name: 'settings.model' }));
    await waitFor(() => expect(report).toHaveBeenCalledWith('Navigation failed:', error));
  });
});
