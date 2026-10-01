/**
 * 文件：renderer/mycowork-rail.tsx
 * 职责：[mycowork] 图标栏与账户/更多菜单，适配已有路由、身份、反馈和主题。
 * 边界：不新增服务或主题状态；退出成功后才丢弃账户预览缓存。
 * 关联：ADR-0022；PR11 W4-1；退出条件：上游提供同等导航扩展点。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Message, Tooltip } from '@arco-design/web-react';
import { AllApplication, Brain, Home, More, Time, User } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { navigationText } from '@mycowork/ui';
import { DARK_THEME_ID, LIGHT_THEME_ID, SYSTEM_THEME_ID } from '@/common/theme/constants';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { useFeedback } from '@/renderer/hooks/context/FeedbackContext';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useThemeContext } from '@/renderer/hooks/context/ThemeContext';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { cleanupSiderTooltips } from '@/renderer/utils/ui/siderTooltip';
import { blurActiveElement } from '@/renderer/utils/ui/focus';

function handleMenuKeys(event: React.KeyboardEvent<HTMLDivElement>, close: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const target =
    event.key === 'ArrowDown'
      ? (index + 1) % buttons.length
      : event.key === 'ArrowUp'
        ? (index - 1 + buttons.length) % buttons.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : -1;
  if (target >= 0) {
    event.preventDefault();
    buttons[target]?.focus();
  }
}

type RailPopupProps = {
  label: string;
  icon: React.ReactNode;
  account?: boolean;
  active?: boolean;
  mobile: boolean;
  children: (close: () => void) => React.ReactNode;
};
function RailPopup(props: RailPopupProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (event?: React.KeyboardEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    setVisible(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => menu.current?.querySelector('button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [visible]);
  return (
    <Dropdown
      trigger='click'
      position={props.mobile ? 'bottom' : props.account ? 'tr' : 'br'}
      popupVisible={visible}
      onVisibleChange={setVisible}
      droplist={
        <div
          ref={menu}
          role='menu'
          aria-label={props.label}
          className='mcw-rail-menu'
          onKeyDown={(event) => handleMenuKeys(event, close)}
        >
          {props.children(close)}
        </div>
      }
    >
      <span className={`mcw-rail-control${props.account ? ' is-account' : ''}`}>
        <Tooltip
          disabled={visible || props.mobile}
          content={props.label}
          position={props.mobile ? 'bottom' : 'right'}
          className='mcw-rail-tooltip'
        >
          <Button
            type='text'
            ref={trigger}
            className={`mcw-rail-button${props.account ? ' mcw-rail-account' : ''}`}
            aria-label={props.label}
            aria-haspopup='menu'
            aria-expanded={visible}
            aria-current={props.active ? 'page' : undefined}
            onKeyDown={(event) => (visible && event.key === 'Escape' ? close(event) : undefined)}
          >
            {props.icon}
          </Button>
        </Tooltip>
      </span>
    </Dropdown>
  );
}

function ThemeItems(props: { lang: string; themeId: string | null; close: () => void; onTheme: (id: string) => void }) {
  const text = navigationText(props.lang);
  return (
    <div role='group' aria-label={text.theme}>
      {[
        [LIGHT_THEME_ID, text.light],
        [DARK_THEME_ID, text.dark],
        [SYSTEM_THEME_ID, text.system],
      ].map(([id, label]) => (
        <Button
          type='text'
          key={id}
          role='menuitemradio'
          aria-checked={props.themeId === id}
          onClick={() => {
            props.close();
            props.onTheme(id);
          }}
        >
          {label}
          <span aria-hidden='true'>{props.themeId === id ? '✓' : ''}</span>
        </Button>
      ))}
    </div>
  );
}

function AccountItems(props: {
  lang: string;
  username: string;
  themeId: string | null;
  showLogout: boolean;
  busy: boolean;
  close: () => void;
  onNavigate: (route: string) => void;
  onFeedback: () => void;
  onTheme: (id: string) => void;
  onLogout: () => void;
}): React.ReactElement {
  const text = navigationText(props.lang);
  return (
    <>
      <div className='mcw-rail-menu-label'>{props.username}</div>
      <Button
        type='text'
        role='menuitem'
        onClick={() => {
          props.close();
          props.onNavigate('/settings/agent');
        }}
      >
        {text.settings}
      </Button>
      <Button
        type='text'
        role='menuitem'
        onClick={() => {
          props.close();
          props.onFeedback();
        }}
      >
        {text.feedback}
      </Button>
      <div className='mcw-rail-menu-divider' role='separator' />
      <div className='mcw-rail-menu-label'>{text.theme}</div>
      <ThemeItems {...props} />
      {props.showLogout && (
        <>
          <div className='mcw-rail-menu-divider' role='separator' />
          <Button
            type='text'
            role='menuitem'
            disabled={props.busy}
            className='mcw-rail-danger'
            onClick={() => {
              props.close();
              props.onLogout();
            }}
          >
            {text.logout}
          </Button>
        </>
      )}
    </>
  );
}

function useRailActions(mobile: boolean, lang: string) {
  const text = navigationText(lang);
  const navigate = useNavigate();
  const { user, status, logout } = useAuth();
  const { activeId, selectTheme } = useThemeContext();
  const { openFeedback } = useFeedback();
  const layout = useLayoutContext();
  const { closePreview, clearPreviewForScope } = usePreviewContext();
  const [busy, setBusy] = useState(false);
  const showLogout = !window.electronAPI && status === 'authenticated';
  const handleLogout = useCallback(async () => {
    if (busy) return;
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setBusy(true);
    try {
      await logout();
      // PreviewProvider 跨登录仍挂载；只清磁盘会被存活的 tabs 状态重新写回。
      clearPreviewForScope();
      if (mobile) layout?.setSiderCollapsed(true);
    } catch {
      Message.error(text.logoutFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, logout, closePreview, clearPreviewForScope, layout, mobile, text.logoutFailed]);
  useEffect(() => {
    if (!showLogout) return;
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        void handleLogout();
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [showLogout, handleLogout]);
  const onNavigate = (route: string) => {
    cleanupSiderTooltips();
    blurActiveElement();
    if (!route.startsWith('/settings')) closePreview();
    void navigate(route);
    if (mobile) layout?.setSiderCollapsed(true);
  };
  return {
    lang,
    username: user?.username || text.local,
    themeId: activeId,
    showLogout,
    busy,
    onNavigate,
    onLogout: (): void => void handleLogout(),
    onFeedback: (): void => void openFeedback(),
    onTheme: (id: string): void => void selectTheme(id).catch(() => Message.error(text.themeFailed)),
  };
}

function MoreItems(props: { lang: string; close: () => void; onNavigate: (route: string) => void }) {
  const text = navigationText(props.lang);
  return (
    <>
      {[
        [text.knowledge, '/office/knowledge'],
        [text.imports, '/office/imports'],
      ].map(([label, route]) => (
        <Button
          type='text'
          key={route}
          role='menuitem'
          onClick={() => {
            props.close();
            props.onNavigate(route);
          }}
        >
          {label}
        </Button>
      ))}
    </>
  );
}

export default function MyCoworkRail({ mobile = false }: { mobile?: boolean }): React.ReactElement {
  const { i18n } = useTranslation();
  const text = navigationText(i18n.language);
  const actions = useRailActions(mobile, i18n.language);
  const { pathname } = useLocation();
  const space = pathname.startsWith('/office/space') || pathname.startsWith('/office/resources');
  const scheduled = pathname.startsWith('/scheduled');
  const memory = pathname.startsWith('/office/memory');
  const more = pathname.startsWith('/office/knowledge') || pathname.startsWith('/office/imports');
  const home = !space && !scheduled && !memory && !more && !pathname.startsWith('/settings');
  const entries = [
    { label: text.home, route: '/guid', active: home, Icon: Home },
    { label: text.space, route: '/office/space', active: space, Icon: AllApplication },
    { label: text.scheduled, route: '/scheduled', active: scheduled, Icon: Time },
    { label: text.memory, route: '/office/memory', active: memory, Icon: Brain },
  ];
  return (
    <nav aria-label={text.nav} className={`mcw-rail${mobile ? ' mcw-rail-mobile' : ''}`}>
      {entries.map(({ label, route, active, Icon }) => (
        <Tooltip
          key={route}
          disabled={mobile}
          content={label}
          position={mobile ? 'bottom' : 'right'}
          className='mcw-rail-tooltip'
        >
          <Button
            type='text'
            htmlType='button'
            className='mcw-rail-button'
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            onClick={() => actions.onNavigate(route)}
          >
            <Icon size={20} theme={active ? 'filled' : 'outline'} />
          </Button>
        </Tooltip>
      ))}
      <RailPopup label={text.more} icon={<More size={20} />} active={more} mobile={mobile}>
        {(close) => <MoreItems lang={i18n.language} close={close} onNavigate={actions.onNavigate} />}
      </RailPopup>
      <RailPopup label={text.account} icon={<User size={20} />} account mobile={mobile}>
        {(close) => <AccountItems {...actions} close={close} />}
      </RailPopup>
    </nav>
  );
}
