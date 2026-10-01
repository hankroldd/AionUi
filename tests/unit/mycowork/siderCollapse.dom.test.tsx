/**
 * 文件：tests/unit/mycowork/siderCollapse.dom.test.tsx
 * 职责：二级栏实际宽度/收起持久化、图标栏挂载与原生 fallback 页脚隔离回归。
 * 边界：Layout 中的 rail 使用挂载替身；账户菜单真实行为在 officeRail 与浏览器证据验证。
 * 关联：PR11 W4-1/W4-2；ADR-0022。
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';

const shortcut = vi.hoisted(() => ({ toggleSider: undefined as undefined | (() => void), pathname: '/guid' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: shortcut.pathname, search: '', hash: '' }),
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

vi.mock('@/renderer/mycowork-rail', () => ({ default: () => <nav data-testid='rail-mount' /> }));
import Layout from '@renderer/components/layout/Layout';
import SiderFooter from '@renderer/components/layout/Sider/SiderFooter';
import { getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

const SiderStub: React.FC = () => null;
const tooltip = { disabled: true } as const;

describe('[mycowork] sidebar collapse', () => {
  beforeEach(() => {
    localStorage.clear();
    shortcut.pathname = '/guid';
    vi.stubGlobal('PointerEvent', MouseEvent);
  });
  beforeAll(() => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as never;
  });

  it('collapsed secondary sider uses zero width and remains hidden from keyboard navigation', () => {
    const { container } = render(<Layout sider={<SiderStub />} />);
    act(() => shortcut.toggleSider?.());
    const sider = container.querySelector('.layout-sider') as HTMLElement;
    expect(sider.className).toContain('collapsed');
    expect(sider.style.width).toBe('0px');
    expect(sider.style.visibility).toBe('hidden');
  });

  it('starts with 288px and ignores widths below the new minimum', () => {
    localStorage.setItem('sider-width-px', '220');
    const { container } = render(<Layout sider={<SiderStub />} />);
    expect((container.querySelector('.layout-sider') as HTMLElement).style.width).toBe('288px');
  });

  it.each([
    [237, '0px'],
    [238, '238px'],
    [239, '239px'],
    [800, '468px'],
  ])('real Layout drag to %s observes the sidebar bounds (%s)', (target, expected) => {
    const { container } = render(<Layout sider={<SiderStub />} />);
    const handle = container.querySelector('.layout-sider .cursor-col-resize') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 288, button: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: target });
    expect((container.querySelector('.layout-sider') as HTMLElement).style.width).toBe(expected);
    expect(localStorage.getItem('mycowork:sider-collapsed')).toBe(String(target < 238));
  });

  it('refresh preserves collapse and expansion restores the last legal width', () => {
    localStorage.setItem('sider-width-px', '350');
    const first = render(<Layout sider={<SiderStub />} />);
    act(() => shortcut.toggleSider?.());
    first.unmount();
    const { container } = render(<Layout sider={<SiderStub />} />);
    const sider = container.querySelector('.layout-sider') as HTMLElement;
    expect(sider.style.width).toBe('0px');
    act(() => shortcut.toggleSider?.());
    expect(sider.style.width).toBe('350px');
  });

  it('Office routes hide the unrelated native conversation sidebar', () => {
    shortcut.pathname = '/office/space';
    const { container } = render(<Layout sider={<SiderStub />} />);
    const sider = container.querySelector('.layout-sider') as HTMLElement;
    expect(sider.style.width).toBe('0px');
    expect(sider.style.visibility).toBe('hidden');
    expect(localStorage.getItem('mycowork:sider-collapsed')).toBe('false');
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

  it('keeps the new primary rail mounted after the secondary sider collapses', () => {
    render(<Layout sider={<SiderStub />} />);
    act(() => shortcut.toggleSider?.());
    expect(screen.getByTestId('rail-mount')).toBeTruthy();
  });

  it('sidebar shortcut follows the current viewport without changing the desktop preference', () => {
    const width = window.innerWidth;
    const { container } = render(<Layout sider={<SiderStub />} />);
    try {
      act(() => {
        window.innerWidth = 390;
        fireEvent.resize(window);
      });
      act(() => shortcut.toggleSider?.());
      const sider = container.querySelector('.layout-sider') as HTMLElement;
      expect(sider.style.width).not.toBe('0px');
      expect(localStorage.getItem('mycowork:sider-collapsed')).toBe('false');
      act(() => {
        window.innerWidth = width;
        fireEvent.resize(window);
      });
      expect(sider.style.width).toBe('288px');
    } finally {
      window.innerWidth = width;
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

  it.each([false, true])('native fallback footer retains its isolated theme control (collapsed=%s)', (collapsed) => {
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
