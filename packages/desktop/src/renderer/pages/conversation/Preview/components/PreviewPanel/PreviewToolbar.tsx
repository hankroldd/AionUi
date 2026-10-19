/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { shouldShowDownload } from './previewToolbarUtils';

/** 预览工具栏属性。 */
interface PreviewToolbarProps {
  content_type: string;
  isMarkdown: boolean;
  isHTML: boolean;
  viewMode: 'source' | 'preview';
  isSplitScreenEnabled: boolean;
  file_name?: string;
  showOpenInSystemButton: boolean;
  /** 无可渲染内容时隐藏内容操作，保留系统打开和下载两个文件出口。 */
  hasNoRenderableContent?: boolean;
  /** 与系统打开分开：后者也接受纯 fileRef，不能再代表文件已在磁盘上。 */
  hasFilePath: boolean;
  /** hidden 或未提供时不渲染刷新。 */
  refreshState?: string;
  refreshActionable?: boolean;
  onRefresh?: () => void;
  showSave?: boolean;
  saveActionable?: boolean;
  onSave?: () => void;
  onViewModeChange: (mode: 'source' | 'preview') => void;
  onSplitScreenToggle: () => void;
  onOpenInSystem: () => void;
  onDownload: () => void;
  onClose: () => void;
  inspectMode?: boolean;
  onInspectModeToggle?: () => void;
  leftExtra?: React.ReactNode;
  rightExtra?: React.ReactNode;
}

/**
 * 预览面板工具栏组件
 * Preview panel toolbar component
 *
 * 包含文件名、视图模式切换、下载按钮、关闭按钮等
 * Contains filename, view mode toggle, download button, close button, etc.
 */
// eslint-disable-next-line max-len
const PreviewToolbar: React.FC<PreviewToolbarProps> = ({
  content_type,
  isMarkdown,
  isHTML,
  viewMode,
  isSplitScreenEnabled,
  showOpenInSystemButton,
  hasNoRenderableContent = false,
  hasFilePath,
  refreshState,
  refreshActionable = false,
  onRefresh,
  showSave = false,
  saveActionable = false,
  onSave,
  onViewModeChange,
  onSplitScreenToggle,
  onOpenInSystem,
  onDownload,
  inspectMode,
  onInspectModeToggle,
  leftExtra,
  rightExtra,
}) => {
  const { t } = useTranslation();
  const isDiff = content_type === 'diff';
  const preferActionButtonsInFront = Boolean(leftExtra);
  // 下载的隐藏规则看的是「文件是否在磁盘上」，用 hasFilePath 而不是
  // showOpenInSystemButton（后者已包含纯 fileRef 的情况）。
  // The download rule keys off "is the file on disk", so use hasFilePath rather
  // than showOpenInSystemButton (which now also covers bare-fileRef tabs).
  const showDownload = shouldShowDownload(content_type, hasFilePath);

  const toolbarBtn =
    'preview-toolbar-action !flex items-center gap-2px !h-auto !px-8px !py-3px !border-0 !rd-4px cursor-pointer transition-colors duration-150 !text-12px !font-medium';
  const toolbarBtnIdle = '!bg-transparent hover:!bg-bg-3';
  const toolbarBtnDefault = `${toolbarBtn} ${toolbarBtnIdle} !text-t-secondary hover:!text-t-primary`;
  const toolbarBtnActive = `${toolbarBtn} !text-white !bg-brand hover:!text-white hover:!bg-brand-hover`;
  const toolbarIconSize = 12;

  return (
    // [mycowork] `mycowork-preview-toolbar`: a CSS container; below ~560px the labelled buttons keep only their icon
    // (title stays as the tooltip) so a 1024-wide three-column layout does not push Download/Edit out of view
    // (MyCowork PR11 audit; rule in styles/arco-override.css).
    <div className='mycowork-preview-toolbar flex items-center justify-between h-32px px-10px bg-bg-2 flex-shrink-0 border-b border-border-1 overflow-x-auto'>
      <div className='flex items-center justify-between gap-8px w-full' style={{ minWidth: 'max-content' }}>
        {/* 左侧：Tabs（Markdown/HTML）+ 文件名 / Left: Tabs (Markdown/HTML) + Filename */}
        <div className='flex items-center h-full gap-8px'>
          {(isMarkdown || isHTML || isDiff) && !hasNoRenderableContent && (
            <>
              <div className='flex items-center h-full gap-0'>
                <Button
                  type='text'
                  htmlType='button'
                  aria-label={isHTML ? t('preview.code') : t('preview.source')}
                  aria-pressed={viewMode === 'source'}
                  style={{ height: '100%', padding: '0 10px', borderRadius: 0, borderWidth: 0 }}
                  className={`!flex items-center cursor-pointer transition-all duration-150 !text-12px !font-medium ${viewMode === 'source' ? '!text-brand !bg-aou-2 !border-b-4 !border-brand' : '!text-t-secondary !bg-transparent hover:!text-t-primary hover:!bg-bg-3'}`}
                  onClick={() => {
                    try {
                      onViewModeChange('source');
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {isHTML ? t('preview.code') : t('preview.source')}
                </Button>
                <Button
                  type='text'
                  htmlType='button'
                  aria-label={t('preview.preview')}
                  aria-pressed={viewMode === 'preview'}
                  style={{ height: '100%', padding: '0 10px', borderRadius: 0, borderWidth: 0 }}
                  className={`!flex items-center cursor-pointer transition-all duration-150 !text-12px !font-medium ${viewMode === 'preview' ? '!text-brand !bg-aou-2 !border-b-4 !border-brand' : '!text-t-secondary !bg-transparent hover:!text-t-primary hover:!bg-bg-3'}`}
                  onClick={() => {
                    try {
                      onViewModeChange('preview');
                    } catch {
                      /* ignore */
                    }
                  }}
                >
                  {t('preview.preview')}
                </Button>
              </div>
              {!isDiff && (
                <Button
                  type='text'
                  htmlType='button'
                  aria-label={isSplitScreenEnabled ? t('preview.closeSplitScreen') : t('preview.openSplitScreen')}
                  aria-pressed={isSplitScreenEnabled}
                  className={isSplitScreenEnabled ? toolbarBtnActive : toolbarBtnDefault}
                  onClick={() => {
                    try {
                      onSplitScreenToggle();
                    } catch {
                      /* ignore */
                    }
                  }}
                  title={isSplitScreenEnabled ? t('preview.closeSplitScreen') : t('preview.openSplitScreen')}
                >
                  <svg
                    width={toolbarIconSize}
                    height={toolbarIconSize}
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                  >
                    <rect x='3' y='3' width='18' height='18' rx='2' />
                    <line x1='12' y1='3' x2='12' y2='21' />
                  </svg>
                </Button>
              )}
            </>
          )}

          {preferActionButtonsInFront && showOpenInSystemButton && (
            <Button
              type='text'
              htmlType='button'
              aria-label={t('preview.openInSystemApp')}
              className={toolbarBtnDefault}
              onClick={onOpenInSystem}
              title={t('preview.openInSystemApp')}
            >
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='text-t-secondary'
              >
                <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                <polyline points='15 3 21 3 21 9' />
                <line x1='10' y1='14' x2='21' y2='3' />
              </svg>
              <span>{t('preview.openInSystemApp')}</span>
            </Button>
          )}
          {preferActionButtonsInFront && showDownload && (
            <Button
              type='text'
              htmlType='button'
              aria-label={t('preview.downloadFile')}
              className={toolbarBtnDefault}
              onClick={() => void onDownload()}
              title={t('preview.downloadFile')}
            >
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='text-t-secondary'
              >
                <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                <polyline points='7 10 12 15 17 10' />
                <line x1='12' y1='15' x2='12' y2='3' />
              </svg>
              <span>{t('common.download')}</span>
            </Button>
          )}
          {leftExtra}
        </div>

        <div className='flex items-center gap-4px flex-shrink-0'>
          {/* 刷新：放在这个稳定容器里，不进下面那两个「前置/后置」重复块 ——
              那两块由 preferActionButtonsInFront 二选一，只有 PDF 注入 leftExtra，
              所以按钮会随 tab 类型左右跳。
              Refresh lives in this stable container rather than in the duplicated
              front/back action blocks below: those two are selected by
              preferActionButtonsInFront, and only PDF injects leftExtra, so anything
              placed in them jumps sides when the tab type changes. */}
          {refreshState !== undefined && refreshState !== 'hidden' && (
            <Button
              type='text'
              htmlType='button'
              aria-label={t('preview.refresh.label')}
              disabled={!refreshActionable}
              data-testid='preview-refresh'
              data-refresh-state={refreshState}
              className={`${toolbarBtn} ${toolbarBtnIdle} ${refreshState === 'updated' ? '!text-warning-6' : '!text-t-secondary hover:!text-t-primary'} ${
                refreshActionable ? '' : '!cursor-not-allowed opacity-50'
              }`}
              onClick={refreshActionable ? onRefresh : undefined}
              title={
                refreshState === 'updated'
                  ? t('preview.refresh.hasUpdate')
                  : refreshState === 'idle-no-signal'
                    ? t('preview.refresh.noSignalSource')
                    : refreshState === 'disabled'
                      ? t('preview.refresh.unavailable')
                      : t('preview.refresh.tooltip')
              }
            >
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
              >
                <path d='M21 12a9 9 0 1 1-3-6.7' />
                <polyline points='21 3 21 9 15 9' />
              </svg>
              <span>{t('preview.refresh.label')}</span>
            </Button>
          )}

          {rightExtra}

          {!preferActionButtonsInFront && showOpenInSystemButton && (
            <Button
              type='text'
              htmlType='button'
              aria-label={t('preview.openInSystemApp')}
              className={toolbarBtnDefault}
              onClick={onOpenInSystem}
              title={t('preview.openInSystemApp')}
            >
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='text-t-secondary'
              >
                <path d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' />
                <polyline points='15 3 21 3 21 9' />
                <line x1='10' y1='14' x2='21' y2='3' />
              </svg>
              <span>{t('preview.openInSystemApp')}</span>
            </Button>
          )}

          {!preferActionButtonsInFront && showDownload && (
            <Button
              type='text'
              htmlType='button'
              aria-label={t('preview.downloadFile')}
              className={toolbarBtnDefault}
              onClick={() => void onDownload()}
              title={t('preview.downloadFile')}
            >
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                className='text-t-secondary'
              >
                <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                <polyline points='7 10 12 15 17 10' />
                <line x1='12' y1='15' x2='12' y2='3' />
              </svg>
              <span>{t('common.download')}</span>
            </Button>
          )}

          {isHTML && !hasNoRenderableContent && onInspectModeToggle && (
            <Button
              type='text'
              htmlType='button'
              aria-label={
                inspectMode ? t('preview.html.inspectElementDisable') : t('preview.html.inspectElementEnable')
              }
              aria-pressed={Boolean(inspectMode)}
              className={inspectMode ? toolbarBtnActive : toolbarBtnDefault}
              onClick={onInspectModeToggle}
              title={inspectMode ? t('preview.html.inspectElementDisable') : t('preview.html.inspectElementEnable')}
            >
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                className={inspectMode ? 'text-white' : 'text-t-secondary'}
              >
                <path d='M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z' />
                <path d='M13 13l6 6' />
              </svg>
              <span>{inspectMode ? t('preview.html.inspecting') : t('preview.html.inspectElement')}</span>
            </Button>
          )}

          {/* 保存：可编辑类型才出现，放在这一栏最后、最靠右；无未保存修改时置灰不可点。
              Save: appears only for editable types, placed last (rightmost) in this row;
              greyed out and non-clickable when there is nothing unsaved. */}
          {showSave && (
            <Button
              type='text'
              htmlType='button'
              aria-label={t('common.save')}
              disabled={!saveActionable}
              data-testid='preview-save'
              className={`${toolbarBtn} ${toolbarBtnIdle} ${saveActionable ? '!text-warning-6' : '!text-t-secondary !cursor-not-allowed opacity-50'}`}
              onClick={saveActionable ? onSave : undefined}
              title={saveActionable ? t('preview.save.tooltip') : t('preview.save.clean')}
            >
              <svg
                width={toolbarIconSize}
                height={toolbarIconSize}
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z' />
                <polyline points='17 21 17 13 7 13 7 21' />
                <polyline points='7 3 7 8 15 8' />
              </svg>
              <span>{t('common.save')}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviewToolbar;
