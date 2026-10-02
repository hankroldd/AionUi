import MyCoworkRail from '@/renderer/mycowork-rail';
import MyCoworkSecondaryHeader, { mycoworkSiderId } from '@/renderer/mycowork-secondary';
import classNames from 'classnames';
import React, { Suspense, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePreviewContext } from '@renderer/pages/conversation/Preview/context/PreviewContext';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { SiderToolbar, SiderAssistantEntry } from './SiderNav';
import TeamSiderSection from './TeamSiderSection';
import siderStyles from './Sider.module.css';

const WorkspaceGroupedHistory = React.lazy(() => import('@renderer/pages/conversation/GroupedHistory'));
const SettingsSider = React.lazy(() => import('@renderer/pages/settings/components/SettingsSider'));

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const location = useLocation();
  const { pathname } = location;

  const navigate = useNavigate();
  const { closePreview } = usePreviewContext();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const isSettings = pathname.startsWith('/settings');
  const isOffice = pathname.startsWith('/office/');
  const officeNavigationId = mycoworkSiderId(pathname);

  const handleNewChat = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/guid', { state: { resetAssistant: true } })).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleConversationSelect = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    // Do NOT call closePreview() here. conversation/index.tsx calls
    // closePreviewIfScopeChanged() once the conversation data loads, which
    // keeps the preview open when switching between conversations of the same
    // scope and closes it only when the scope (today = workspace) actually changes.
    setIsBatchMode(false);
  };

  const handleAssistantClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    Promise.resolve(navigate('/assistants')).catch((error) => {
      console.error('Navigation failed:', error);
    });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  const workspaceHistoryProps = {
    collapsed,
    tooltipEnabled,
    onSessionClick,
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
  };

  return (
    <div className='size-full flex flex-col mcw-secondary-content'>
      {isMobile && <MyCoworkRail mobile />}
      {!isSettings && !isOffice && <MyCoworkSecondaryHeader onConversationSelect={handleConversationSelect} />}
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-hidden'>
        {officeNavigationId ? (
          <div id={officeNavigationId} className='size-full' />
        ) : isOffice ? null : isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider collapsed={collapsed} tooltipEnabled={tooltipEnabled} />
          </Suspense>
        ) : (
          <div className='size-full flex flex-col gap-2px'>
            <SiderToolbar
              isMobile={isMobile}
              isBatchMode={isBatchMode}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onNewChat={handleNewChat}
              onToggleBatchMode={() => setIsBatchMode((prev) => !prev)}
            />
            {/* 原生助手与会话/项目行为保持不变 */}
            <SiderAssistantEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/assistants')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleAssistantClick}
            />
            {/* Divider between fixed top nav and scrollable content area */}
            <div
              className={classNames(
                'shrink-0 mt-6px mb-2px h-1px bg-[var(--color-border-2)]',
                collapsed ? 'mx-6px' : 'mx-10px'
              )}
            />
            {/* Scrollable content: pinned → team (slot) → projects → conversations */}
            <div className={classNames('flex-1 min-h-0 overflow-y-auto', siderStyles.scrollArea)}>
              <Suspense fallback={<div className='min-h-200px' />}>
                <WorkspaceGroupedHistory
                  {...workspaceHistoryProps}
                  afterPinnedContent={
                    <>
                      <TeamSiderSection
                        collapsed={collapsed}
                        pathname={pathname}
                        siderTooltipProps={siderTooltipProps}
                        onSessionClick={onSessionClick}
                      />
                    </>
                  }
                />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sider;
