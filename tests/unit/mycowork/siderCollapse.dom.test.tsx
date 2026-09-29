/**
 * [mycowork] Sidebar collapse / theme toggle / MyCowork entries (MyCowork PR11, owner report 2026-09-29).
 * Covers: the collapsed desktop sider keeps a 64px icon rail (AionUi v1.x behaviour) instead of 0; the MyCowork nav
 * entries use the same markup as AionUi's Scheduled entry in both states (collapsed = centred icon only, expanded =
 * icon in the same 22px box, so icons line up); hovering a collapsed item shows its name; the theme toggle is in the
 * footer outside Settings and when collapsed without truncating Settings / Log out; mobile still collapses to 0.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Tooltip } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';

const shortcut = vi.hoisted(() => ({ toggleSider: undefined as undefined | (() => void) }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/guid', search: '', hash: '' }),
  useNavigationType: () => 'POP',
  useMatch: () => null,
  useParams: () => ({}),
  Outlet: () => null,
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    application: { openDevTools: { invoke: vi.fn() }, logStream: { on: () => () => {} } },
    task: { stopAll: { invoke: () => Promise.resolve({ success: false }) } },
  },
}));
vi.mock('@/common/config/constants', () => ({ TEAM_MODE_ENABLED: false }));
vi.mock('@/renderer/components/layout/PwaPullToRefresh', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Titlebar', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/UpdateModal', () => ({ default: () => null }));
vi.mock('@renderer/hooks/system/useDeepLink', () => ({ useDeepLink: () => {} }));
vi.mock('@renderer/hooks/system/notification/useNotificationClick', () => ({ useNotificationClick: () => {} }));
vi.mock('@renderer/hooks/system/notification/useBrowserNotification', () => ({ useBrowserNotification: () => {} }));
vi.mock('@renderer/hooks/file/useDirectorySelection', () => ({
  useDirectorySelection: () => ({ contextHolder: null }),
}));
vi.mock('@renderer/hooks/ui/useConversationShortcuts', () => ({
  useConversationShortcuts: (p: { toggleSider: () => void }) => {
    shortcut.toggleSider = p.toggleSider;
  },
}));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: () => false }));
vi.mock('@renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: () => {} }),
}));

import Layout from '@renderer/components/layout/Layout';
import SiderFooter from '@renderer/components/layout/Sider/SiderFooter';
import { SiderScheduledEntry } from '@renderer/components/layout/Sider/SiderNav';
import { OfficeImportsSiderSlot } from '@/renderer/mycowork-slots';
import { getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

const SiderStub: React.FC = () => null;
const tooltip = { disabled: true } as const;
const sortedClasses = (el: Element | null | undefined) => [...(el?.classList ?? [])].toSorted();

describe('[mycowork] sidebar collapse', () => {
  beforeAll(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as never;
  });

  it('collapsed desktop sider keeps a 64px icon rail', () => {
    const { container } = render(<Layout sider={<SiderStub />} />);
    act(() => shortcut.toggleSider?.());
    const sider = container.querySelector('.layout-sider') as HTMLElement;
    expect(sider.className).toContain('collapsed');
    expect(sider.style.width).toBe('64px');
  });

  it('mobile sider still collapses to 0 (overlay)', () => {
    const width = window.innerWidth;
    window.innerWidth = 390;
    try {
      const { container } = render(<Layout sider={<SiderStub />} />);
      const sider = container.querySelector('.layout-sider') as HTMLElement;
      expect(sider.className).toContain('collapsed');
      expect(sider.style.width).toBe('0px');
    } finally {
      window.innerWidth = width;
    }
  });

  it.each([false, true])('MyCowork entries use the native entry markup (collapsed=%s)', (collapsed) => {
    const native = render(
      <SiderScheduledEntry
        isMobile={false}
        isActive={false}
        collapsed={collapsed}
        siderTooltipProps={tooltip}
        onClick={() => {}}
      />
    ).container;
    const ours = render(
      <OfficeImportsSiderSlot isMobile={false} collapsed={collapsed} siderTooltipProps={tooltip} />
    ).container;
    const nativeIcon = native.querySelector('svg');
    const rows = ours.querySelectorAll('[role="link"]');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const icon = row.querySelector('svg');
      expect(sortedClasses(row)).toEqual(sortedClasses(native.firstElementChild));
      // icon-park wraps the svg in span.i-icon; the box around that wrapper must be the native one
      expect(sortedClasses(icon?.closest('.i-icon')?.parentElement)).toEqual(
        sortedClasses(nativeIcon?.closest('.i-icon')?.parentElement)
      );
      expect(icon?.getAttribute('width')).toBe(nativeIcon?.getAttribute('width'));
      expect(row.textContent).toBe(collapsed ? '' : row.getAttribute('aria-label'));
    }
  });

  it('hovering an item of the collapsed rail shows its name', async () => {
    render(
      <div className='layout-sider'>
        <Tooltip {...getSiderTooltipProps(true)} content='资源中心' position='right'>
          <div data-testid='row' />
        </Tooltip>
      </div>
    );
    fireEvent.mouseEnter(screen.getByTestId('row'));
    await waitFor(() => expect(screen.getByText('资源中心')).toBeTruthy());
    // not clamped inside the 64px rail (it would cover the icon)
    expect(screen.getByText('资源中心').closest('.layout-sider')).toBeNull();
  });

  it.each([false, true])('theme toggle is in the footer outside Settings (collapsed=%s)', (collapsed) => {
    const { getByTestId } = render(
      <SiderFooter
        isMobile={false}
        isSettings={false}
        collapsed={collapsed}
        theme='light'
        siderTooltipProps={tooltip}
        onSettingsClick={() => {}}
        onThemeToggle={() => {}}
      />
    );
    expect(getByTestId('theme-toggle').getAttribute('aria-label')).toBe('settings.darkMode');
  });

  it('expanded footer: Settings and Log out keep their width, the theme toggle sits at the end', () => {
    const { getByText, getByTestId } = render(
      <SiderFooter
        isMobile
        isSettings={false}
        theme='light'
        siderTooltipProps={tooltip}
        onSettingsClick={() => {}}
        onThemeToggle={() => {}}
        showLogout
        onLogoutClick={() => {}}
      />
    );
    // jsdom has no layout: with the toggle added, flex-1 on both items made them share (and truncate) the rest of the
    // row — "退出…" at 1440 and "退…" at 390 in a real browser. The pixel check is in the PR11 sidebar-fix probe.json.
    for (const label of ['common.settings', 'settings.googleLogout']) {
      expect(getByText(label).parentElement?.classList.contains('flex-1')).toBe(false);
    }
    // box-border keeps it 40px when the mobile class adds 10px side padding (else 60px and the labels truncate at 390)
    expect([...getByTestId('theme-toggle').classList]).toEqual(
      expect.arrayContaining(['ms-auto', 'box-border', 'w-40px'])
    );
  });
});
