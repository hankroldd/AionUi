/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { chatFileRefKey, type ChatFileRef } from '@/common/types/chatFile';
import { getBaseUrl, isBackendHttpError } from '@/common/adapter/httpBridge';
import WebviewHost from '@/renderer/components/media/WebviewHost';
import { openExternalUrl } from '@/renderer/utils/platform';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Button, Spin } from '@arco-design/web-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerTabReloader } from '../../context/tabReloaderRegistry';
// [mycowork] B4/A528: liveness probe, disconnect/missing copy and reading-position helpers (MyCowork packages/ui)
import {
  frameScrollY,
  isWatchAlive,
  previewWatchText,
  restoreFrameScroll,
  watchGone,
  watchLostError,
} from '@mycowork/ui';

const WATCH_PROBE_MS = 15_000; // 两次连续失败才判断开，总延迟仍 ≤ 30 秒
// [mycowork] 后端按文件复用进程；跨卸载等待旧清理，避免迟到 stop 关掉新查看器复用的进程。
let pendingWatchCleanup = Promise.resolve();

type DocType = 'ppt' | 'word' | 'excel';
type OfficeWatchErrorCode =
  | 'OFFICECLI_NOT_FOUND'
  | 'OFFICECLI_INSTALL_FAILED'
  | 'OFFICECLI_PORT_TIMEOUT'
  | 'OFFICECLI_START_FAILED'
  | 'PATH_OUTSIDE_SANDBOX';

const BRIDGE = {
  ppt: ipcBridge.pptPreview,
  word: ipcBridge.wordPreview,
  excel: ipcBridge.excelPreview,
} as const;

// Web-server proxy base paths (Electron uses the direct localhost URL instead)
const PROXY_PATH: Record<DocType, string> = {
  ppt: '/api/ppt-proxy',
  word: '/api/office-watch-proxy',
  excel: '/api/office-watch-proxy',
};

const IFRAME_TITLE: Record<DocType, string> = {
  ppt: 'PPT Preview',
  word: 'Word Preview',
  excel: 'Excel Preview',
};

const I18N_KEYS = {
  ppt: {
    loading: 'preview.ppt.loading',
    installing: 'preview.ppt.installing',
    startFailed: 'preview.ppt.startFailed',
    installHint: 'preview.ppt.installHint',
  },
  word: {
    loading: 'preview.word.watch.loading',
    installing: 'preview.word.watch.installing',
    startFailed: 'preview.word.watch.startFailed',
    installHint: 'preview.word.watch.installHint',
  },
  excel: {
    loading: 'preview.excel.watch.loading',
    installing: 'preview.excel.watch.installing',
    startFailed: 'preview.excel.watch.startFailed',
    installHint: 'preview.excel.watch.installHint',
  },
} as const;

const OFFICE_ERROR_I18N_KEYS: Record<OfficeWatchErrorCode, string> = {
  OFFICECLI_NOT_FOUND: 'preview.office.errors.officecliNotFound',
  OFFICECLI_INSTALL_FAILED: 'preview.office.errors.installFailed',
  OFFICECLI_PORT_TIMEOUT: 'preview.office.errors.portTimeout',
  OFFICECLI_START_FAILED: 'preview.office.errors.startFailed',
  PATH_OUTSIDE_SANDBOX: 'preview.office.errors.outsideSandbox',
};

export const OFFICECLI_INSTALL_URL = 'https://github.com/iOfficeAI/OfficeCLI/releases';

interface OfficeWatchViewerProps {
  docType: DocType;
  // [mycowork] S10: lets the panel's refresh reach this viewer (see the reloader effect).
  tabId?: string;
  // Preferred identity: the backend resolves pe→path and keys the watch by it, so
  // start/stop match even when the tab has no device path (explorer office files).
  fileRef?: ChatFileRef;
  file_path?: string;
  content?: string;
  workspace?: string;
}

interface OfficeWatchErrorState {
  code?: OfficeWatchErrorCode;
  message: string;
  // [mycowork] the watch process is gone (its /events stream no longer answers): offer "reopen", no install hint
  gone?: boolean;
  missing?: boolean; // [mycowork] A528：文件不在或无权查看，重开无意义，不给按钮
}

// [mycowork] A528：后端对不存在/无权查看的文件回 404/403，其余失败不能断定文件状态。断开后只读查一次元数据，
// 区分“预览服务停了、文件还在”与“文件不在”；查不出返回 undefined，不猜。
const isMissingFileError = (err: unknown) => isBackendHttpError(err) && (err.status === 404 || err.status === 403);
async function fileStillThere(fileRef?: ChatFileRef, file_path?: string, workspace?: string) {
  try {
    if (fileRef) await ipcBridge.fs.getContentMetadata.invoke({ file: fileRef });
    else await ipcBridge.fs.getFileMetadata.invoke({ path: file_path ?? '', workspace });
    return true;
  } catch (err) {
    return isMissingFileError(err) ? false : undefined;
  }
}

export function resolveOfficeWatchUrl(url: string, docType: DocType): string {
  const proxyMatch = url.match(/^\/api\/(?:office-watch-proxy|ppt-proxy)\/(\d+)(\/.*)?$/);
  if (proxyMatch && isElectronDesktop()) {
    const [, port, suffix] = proxyMatch;
    return `http://127.0.0.1:${port}${suffix || '/'}`;
  }

  if (url.startsWith('/')) {
    if (!isElectronDesktop()) {
      const proxyPortMatch = url.match(/^\/api\/(?:office-watch-proxy|ppt-proxy)\/(\d+)(\/.*)?$/);
      if (proxyPortMatch) {
        const [, port, suffix] = proxyPortMatch;
        // The backend registers /{port} and /{port}/{*path} only; a bare
        // trailing slash matches neither route and 404s (#3212), so emit a
        // suffix only when it carries a real sub-path.
        const subPath = suffix && suffix !== '/' ? suffix : '';
        return `${PROXY_PATH[docType]}/${port}${subPath}`;
      }
    }
    return `${getBaseUrl()}${url}`;
  }

  if (!isElectronDesktop()) {
    const parsed = new URL(url);
    return `${PROXY_PATH[docType]}/${parsed.port}`;
  }

  return url;
}

function normalizeOfficeWatchErrorCode(error?: string | null): OfficeWatchErrorCode | undefined {
  switch (error) {
    case 'OFFICECLI_NOT_FOUND':
    case 'OFFICECLI_INSTALL_FAILED':
    case 'OFFICECLI_PORT_TIMEOUT':
    case 'OFFICECLI_START_FAILED':
    case 'PATH_OUTSIDE_SANDBOX':
      return error;
    default:
      return undefined;
  }
}

// officecli runs next to the backend, so on web deployments it must be
// installed on the server — same command the backend's auto-installer uses.
export const OFFICECLI_SERVER_INSTALL_COMMAND = 'curl -fsSL https://d.officecli.ai/install.sh | bash';

export function resolveOfficeErrorActions(
  code: OfficeWatchErrorCode | undefined,
  isElectron: boolean
): { showServerInstallGuide: boolean; showInstallLink: boolean; showRetry: boolean } {
  const officecliMissing = code === 'OFFICECLI_NOT_FOUND' || code === 'OFFICECLI_INSTALL_FAILED';
  return {
    // A desktop install link would point web users at the wrong machine —
    // give them the server-side command instead.
    showServerInstallGuide: !isElectron && officecliMissing,
    showInstallLink: isElectron && code === 'OFFICECLI_NOT_FOUND',
    showRetry: officecliMissing || code === 'OFFICECLI_PORT_TIMEOUT',
  };
}

/**
 * Shared Office watch viewer.
 *
 * Launches an `officecli watch` child process via IPC, waits for the local
 * HTTP server to be ready, then renders it in a webview (Electron) or iframe
 * (web server mode). Cleans up the process on unmount.
 *
 * Used by PptViewer, OfficeDocViewer, and ExcelViewer — each passes its
 * docType to select the correct IPC bridge, proxy path, and i18n keys.
 */
const OfficeWatchViewer: React.FC<OfficeWatchViewerProps> = ({ docType, tabId, fileRef, file_path, workspace }) => {
  const { t, i18n } = useTranslation();
  const keys = I18N_KEYS[docType];

  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'starting' | 'installing'>('starting');
  const [error, setError] = useState<OfficeWatchErrorState | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // [mycowork] A528：断开时记下的阅读位置，重开同一文件加载后恢复；换文件即作废。
  const frameRef = useRef<HTMLIFrameElement>(null);
  const resumeScrollY = useRef<number | null>(null);
  const fileKey = fileRef ? chatFileRefKey(fileRef) : file_path;
  useEffect(() => {
    resumeScrollY.current = null;
  }, [docType, fileKey]);
  // [mycowork] 顶部刷新与断开重开共用下方生命周期，等待旧进程停完再读文件，不额外发一次 stop。
  useEffect(() => {
    if (!tabId) return;
    return registerTabReloader(tabId, () => setRetryKey((value) => value + 1));
  }, [tabId, docType]);

  useEffect(() => {
    const bridge = BRIDGE[docType];

    // A ChatFileRef alone is enough (explorer office tabs have no device path).
    if (!fileRef && !file_path) {
      setLoading(false);
      setError({ message: t('preview.errors.missingFilePath') });
      return;
    }

    let cancelled = false;

    const unsubStatus = bridge.status.on((evt) => {
      if (cancelled) return;
      if (evt.state === 'installing') setStatus('installing');
      else if (evt.state === 'starting') setStatus('starting');
    });

    const start = async () => {
      setLoading(true);
      setStatus('starting');
      setError(null);
      setWatchUrl(null);
      try {
        await pendingWatchCleanup;
        if (cancelled) return;
        const result = await bridge.start.invoke({ file_path, workspace, file: fileRef });
        if (cancelled) return;
        const errorCode = normalizeOfficeWatchErrorCode(result.error);
        if (errorCode) {
          setError({
            code: errorCode,
            message: t(OFFICE_ERROR_I18N_KEYS[errorCode]),
          });
          setLoading(false);
          return;
        }

        const url = result.url;
        if (!url) {
          throw new Error(t(keys.startFailed));
        }
        // Small delay to ensure the watch HTTP server is fully ready for the webview
        await new Promise((r) => setTimeout(r, 300));
        if (!cancelled) {
          const resolvedUrl = resolveOfficeWatchUrl(url, docType);
          setWatchUrl(resolvedUrl);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const backendCode = isBackendHttpError(err) ? normalizeOfficeWatchErrorCode(err.code) : undefined;
          if (backendCode) {
            setError({
              code: backendCode,
              message: t(OFFICE_ERROR_I18N_KEYS[backendCode]),
            });
            setLoading(false);
            return;
          }
          if (isMissingFileError(err)) {
            setError(watchLostError(false, i18n?.language));
            setLoading(false);
            return;
          }
          const msg = err instanceof Error ? err.message : t(keys.startFailed);
          setError({ message: msg });
          setLoading(false);
        }
      }
    };

    const starting = start();

    return () => {
      cancelled = true;
      unsubStatus();
      // [mycowork] start 迟到也须先结束再停；身份取本次闭包，不能在等待后读到下个文件。
      pendingWatchCleanup = Promise.all([pendingWatchCleanup, starting])
        .then(async () => {
          await bridge.stop.invoke({ file_path, file: fileRef });
        })
        .catch(() => {});
    };
  }, [docType, fileRef, file_path, retryKey, t, workspace, i18n?.language]);

  // [mycowork] B4: on web the proxy answers with the SPA's HTML once the officecli watch process is gone (after a page
  // reload or a long idle), and the iframe only logs an EventSource error. Probe the stream once the URL is known and
  // every WATCH_PROBE_MS; after two consecutive misses, replace the stale iframe with a visible state and a "reopen" action.
  useEffect(() => {
    if (!watchUrl || isElectronDesktop()) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const misses = { n: 0 }; // 连续两次探活失败才算断开，一次网络抖动不打扰
    const probe = async () => {
      const gone = watchGone(await isWatchAlive(watchUrl), misses);
      if (stopped || !gone) return;
      clearInterval(timer); // 判定断开后不再探活，也不重复查文件
      resumeScrollY.current = frameScrollY(frameRef.current);
      const kept = await fileStillThere(fileRef, file_path, workspace);
      if (stopped) return;
      setError(watchLostError(kept, i18n?.language));
    };
    void probe();
    timer = setInterval(() => void probe(), WATCH_PROBE_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [watchUrl, i18n?.language, fileRef, file_path, workspace]);

  if (loading) {
    return (
      <div className='h-full w-full flex items-center justify-center bg-bg-1'>
        <div className='flex flex-col items-center gap-12px'>
          <Spin size={32} />
          <span className='text-13px text-t-secondary'>
            {status === 'installing' ? t(keys.installing) : t(keys.loading)}
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    const { showServerInstallGuide, showInstallLink, showRetry } = resolveOfficeErrorActions(
      error.code,
      isElectronDesktop()
    );

    return (
      <div className='h-full w-full flex items-center justify-center bg-bg-1' data-testid='office-watch-error'>
        <div className='text-center max-w-400px'>
          <div role='alert' className={`text-16px mb-8px ${error.gone ? 'text-t-primary' : 'text-danger'}`}>
            {error.message}
          </div>
          {!error.code && !error.gone && !error.missing && (
            <div className='text-12px text-t-secondary mb-12px'>{t(keys.installHint)}</div>
          )}
          {showServerInstallGuide && (
            <div className='text-start mb-12px'>
              <div className='text-12px text-t-secondary mb-8px'>{t('preview.office.serverInstall.hint')}</div>
              <code className='block select-all rounded-8px bg-2 px-10px py-8px text-12px text-t-primary'>
                {OFFICECLI_SERVER_INSTALL_COMMAND}
              </code>
              <div className='text-12px text-t-secondary mt-8px'>{t('preview.office.serverInstall.icuNote')}</div>
            </div>
          )}
          {showInstallLink && (
            <div className='flex justify-center'>
              <Button type='text' size='small' onClick={() => void openExternalUrl(OFFICECLI_INSTALL_URL)}>
                {t('preview.office.installLinkText')}
              </Button>
            </div>
          )}
          {(showRetry || error.gone) && (
            <div className='flex justify-center'>
              <Button size='small' type='primary' onClick={() => setRetryKey((value) => value + 1)}>
                {error.gone ? previewWatchText(i18n?.language).reopen : t('common.retry', { defaultValue: 'Retry' })}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!watchUrl) return null;

  // Electron: use <webview> via WebviewHost for full Electron integration.
  // Web server mode: use <iframe> since <webview> is Electron-only.
  if (isElectronDesktop()) {
    return <WebviewHost url={watchUrl} className='bg-bg-1' />;
  }
  return (
    <iframe
      ref={frameRef}
      src={watchUrl}
      onLoad={() => restoreFrameScroll(frameRef.current, resumeScrollY)}
      className='w-full h-full border-0 bg-bg-1'
      title={IFRAME_TITLE[docType]}
    />
  );
};

export default OfficeWatchViewer;
