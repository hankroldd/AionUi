/**
 * 文件：renderer/mycowork-secondary.tsx
 * 职责：原生二级栏头部与桌面收起偏好适配，复用会话搜索和既有抽屉。
 * 边界：手机开关不覆盖桌面偏好；空间/记忆内容在对应切片接入。
 * 关联：ADR-0022；PR11 W4-2。
 */
import { Button, Tooltip } from '@arco-design/web-react';
import { ExpandLeft, Search } from '@icon-park/react';
import { navigationText } from '@mycowork/ui';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import ConversationSearchPopover from '@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover';

const COLLAPSE_KEY = 'mycowork:sider-collapsed';

/** 桌面仅保存非敏感布尔偏好；浏览器拒绝存储时本轮仍可操作。 */
export function useMyCoworkSecondaryCollapse(isMobile: boolean) {
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [mobileCollapsed, setMobileCollapsed] = useState(true);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(desktopCollapsed));
    } catch {
      // 存储边界失败时仅保留本轮偏好，不能阻断导航。
    }
  }, [desktopCollapsed]);
  useEffect(() => {
    if (isMobile) setMobileCollapsed(true);
  }, [isMobile]);
  return {
    collapsed: isMobile ? mobileCollapsed : desktopCollapsed,
    setCollapsed: isMobile ? setMobileCollapsed : setDesktopCollapsed,
  };
}

const isScheduledRoute = (pathname: string) => pathname === '/scheduled' || pathname.startsWith('/scheduled/');

/** 首页系使用原生会话搜索；其他页不得显示会话搜索。 */
export const isMyCoworkHomeRoute = (pathname: string) =>
  !pathname.startsWith('/office/') && !pathname.startsWith('/settings') && !isScheduledRoute(pathname);

/** 原生二级栏头部；搜索结果选择沿用侧栏回调，收起由 Layout 统一控制。 */
export default function MyCoworkSecondaryHeader({ onConversationSelect }: { onConversationSelect: () => void }) {
  const layout = useLayoutContext();
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const text = navigationText(i18n.language);
  const searchLabel = t('conversation.historySearch.tooltip');
  return (
    <div className='mcw-secondary-header'>
      <h2>{isScheduledRoute(pathname) ? text.scheduled : text.home}</h2>
      {!layout?.siderCollapsed && isMyCoworkHomeRoute(pathname) && (
        <ConversationSearchPopover
          onConversationSelect={onConversationSelect}
          onSessionClick={() => layout?.isMobile && layout.setSiderCollapsed(true)}
          renderTrigger={({ onClick }) => (
            <Tooltip content={searchLabel}>
              <Button className='mcw-secondary-icon' aria-label={searchLabel} onClick={onClick}>
                <Search size={18} />
              </Button>
            </Tooltip>
          )}
        />
      )}
      <Tooltip content={text.collapseSidebar}>
        <Button
          className='mcw-secondary-icon'
          aria-label={text.collapseSidebar}
          onClick={() => layout?.setSiderCollapsed(true)}
        >
          <ExpandLeft size={18} />
        </Button>
      </Tooltip>
    </div>
  );
}
