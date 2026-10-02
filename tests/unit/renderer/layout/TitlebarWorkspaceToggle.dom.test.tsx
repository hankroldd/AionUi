import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ desktop: true, mac: false }));
const sidebar = vi.hoisted(() => ({
  mobile: false,
  path: '/conversation/test',
  toggle: undefined as ((value: boolean) => void) | undefined,
  collapsed: true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: sidebar.path, search: '', hash: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { get: { invoke: vi.fn() } } },
}));
vi.mock('@/common/config/constants', () => ({ TEAM_MODE_ENABLED: false }));
vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({
  default: () => <span data-testid='conversation-search' />,
}));
vi.mock('@/renderer/components/layout/Titlebar/MobileConversationBrand', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/WindowControls', () => ({
  default: () => <div data-testid='window-controls' />,
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({
    isMobile: sidebar.mobile,
    siderCollapsed: sidebar.collapsed,
    setSiderCollapsed: sidebar.toggle,
  }),
}));
vi.mock('@/renderer/hooks/context/NavigationHistoryContext', () => ({
  useNavigationHistory: () => null,
}));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: vi.fn() }),
}));
vi.mock('@/renderer/services/feedback/resolveFeedbackModule', () => ({
  resolveFeedbackModule: () => 'conversation-session',
}));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => platform.desktop,
  isMacOS: () => platform.mac,
}));

import Titlebar from '@/renderer/components/layout/Titlebar';
import { WORKSPACE_STATE_EVENT } from '@/renderer/utils/workspace/workspaceEvents';

describe('Titlebar workspace toggle', () => {
  beforeEach(() => {
    sidebar.mobile = false;
    sidebar.path = '/conversation/test';
    sidebar.toggle = undefined;
    sidebar.collapsed = true;
    platform.desktop = true;
    platform.mac = false;
  });

  it('places the Windows workspace toggle directly after Bug Report', () => {
    render(<Titlebar workspaceAvailable />);

    const report = screen.getByRole('button', { name: 'conversation.welcome.quickActionFeedback' });
    const workspace = screen.getByRole('button', { name: 'common.expandMore' });

    expect(report.nextElementSibling).toBe(workspace);
    expect(workspace.nextElementSibling).toBe(screen.getByTestId('window-controls'));
  });

  it.each([
    { runtime: 'macOS desktop', desktop: true, mac: true },
    { runtime: 'WebUI', desktop: false, mac: false },
  ])('keeps the workspace toggle after Bug Report on $runtime', ({ desktop, mac }) => {
    platform.desktop = desktop;
    platform.mac = mac;
    render(<Titlebar workspaceAvailable />);

    const report = screen.getByRole('button', { name: 'conversation.welcome.quickActionFeedback' });
    const workspace = screen.getByRole('button', { name: 'common.expandMore' });

    expect(report.nextElementSibling).toBe(workspace);
    expect(screen.queryByTestId('window-controls')).not.toBeInTheDocument();
  });

  it('updates the workspace action when the panel becomes expanded', () => {
    render(<Titlebar workspaceAvailable />);

    act(() => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_STATE_EVENT, { detail: { collapsed: false } }));
    });

    expect(screen.getByRole('button', { name: 'common.collapse' })).toBeInTheDocument();
  });

  it('omits the workspace toggle when no workspace is available', () => {
    render(<Titlebar workspaceAvailable={false} />);

    expect(screen.queryByRole('button', { name: 'common.expandMore' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.collapse' })).not.toBeInTheDocument();
  });
  it('keeps the navigation drawer available on mobile settings pages', () => {
    sidebar.mobile = true;
    sidebar.path = '/settings/agent';
    sidebar.toggle = vi.fn();
    render(<Titlebar workspaceAvailable={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.expandMore' }));
    expect(sidebar.toggle).toHaveBeenCalledWith(false);
  });

  it.each([
    ['/guid', true, true],
    ['/conversation/test', false, false],
    ['/office/space', true, false],
    ['/office/trash', true, false],
    ['/office/memory', true, false],
    ['/scheduled', true, false],
    ['/scheduled/job-1', true, false],
    ['/settings/agent', true, false],
  ])('titlebar conversation search scope: %s collapsed=%s', (path, collapsed, visible) => {
    sidebar.path = path;
    sidebar.collapsed = collapsed;
    render(<Titlebar workspaceAvailable={false} />);
    expect(Boolean(screen.queryByTestId('conversation-search'))).toBe(visible);
  });

  it.each(['/office/space', '/office/trash', '/office/memory'])(
    'restores the %s sidebar on desktop without exposing conversation search',
    (path) => {
      sidebar.path = path;
      sidebar.collapsed = true;
      sidebar.toggle = vi.fn();
      render(<Titlebar workspaceAvailable={false} />);
      fireEvent.click(screen.getByRole('button', { name: 'common.expandMore' }));
      expect(sidebar.toggle).toHaveBeenCalledWith(false);
      expect(screen.queryByTestId('conversation-search')).toBeNull();
    }
  );
});
