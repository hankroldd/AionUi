/**
 * 文件：tests/unit/mycowork/conversationFiles.dom.test.tsx
 * 职责：验证对话目录默认筛选、全部切换、文件监听和范围内搜索。
 * 边界：只替换 HTTP/IPC 传输；实际渲染 Explorer、主仓目录读取与筛选逻辑。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplorerContainer } from '@/renderer/pages/conversation/explorer/ExplorerContainer';
import { peKey, refToKey, type Entry, type PeKey } from '@/renderer/pages/conversation/explorer/explorerModel';
import {
  applyMonitorNotification,
  configureExplorerStore,
  resetExplorerStoreForTest,
} from '@/renderer/pages/conversation/explorer/explorerStore';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';
import {
  applySearchMatch,
  configureSearchStore,
  resetSearchStoreForTest,
} from '@/renderer/pages/conversation/explorer/search/searchStore';

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  project: vi.fn(),
  search: vi.fn(),
  stream: new Set<(message: { conversation_id: string; type: string }) => void>(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'owner' } }),
}));
vi.mock('@/renderer/pages/conversation/Preview', () => ({ usePreviewContext: () => ({ openPreview: vi.fn() }) }));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));
vi.mock('@/common', () => ({
  ipcBridge: {
    project: { get: { invoke: h.project } },
    shell: { checkToolInstalled: { invoke: async () => false } },
    conversation: {
      responseStream: {
        on: (fn: (message: { conversation_id: string; type: string }) => void) => {
          h.stream.add(fn);
          return () => h.stream.delete(fn);
        },
      },
    },
  },
}));

const detail = {
  project_id: 'p1',
  name: '项目',
  explorer: {
    workspace_pe_id: 'work',
    entries: [
      { pe_id: 'work', role: 'workspace', display_path: '/project', runtime_status: 'available', order_index: 0 },
      { pe_id: 'attached', role: 'attached', display_path: '/references', runtime_status: 'available', order_index: 1 },
    ],
  },
};
const file = (name: string): Entry => ({ name, kind: 'file' });
const dir = (name: string): Entry => ({ name, kind: 'dir' });
const snapshots: Record<PeKey, Entry[]> = {
  [peKey('work', '')]: [dir('deck'), file('other.txt')],
  [peKey('attached', '')]: [file('reference.md')],
  [peKey('work', 'deck')]: [dir('c1'), dir('c2'), dir('legacy'), dir('unrelated')],
  [peKey('work', 'deck/c1')]: [file('report-current.pptx'), file('template.pptx'), file('process.md')],
  [peKey('work', 'deck/c2')]: [file('report-next.pptx')],
  [peKey('work', 'deck/legacy')]: [file('report-history.pptx')],
  [peKey('work', 'deck/unrelated')]: [file('report-other.pptx')],
};
const response = (value: unknown, status = 200) => ({ status, ok: status < 300, json: async () => value });
const workspace = (id: string, dirs = [`deck/${id}`]) => ({
  conversation_id: id,
  directory: `deck/${id}`,
  directories: dirs,
});
const mount = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ExplorerContainer projectId='p1' />
    </SWRConfig>
  );

beforeEach(() => {
  resetExplorerStoreForTest();
  resetCurrentConversationForTest();
  resetSearchStoreForTest();
  localStorage.clear();
  h.fetch.mockReset();
  h.project.mockReset().mockResolvedValue(detail);
  h.search.mockReset();
  h.stream.clear();
  vi.stubGlobal('fetch', h.fetch);
  configureExplorerStore({
    subscribe: async (refs) => ({
      snapshots: refs.map((target) => ({ target, entries: snapshots[refToKey(target)] ?? [] })),
    }),
    remount: async () => ({ snapshots: [] }),
    unsubscribe: () => {},
  });
  configureSearchStore({ search: h.search, cancel: vi.fn(), abandon: vi.fn() });
  setCurrentConversation('c1');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('本次对话文件入口', () => {
  it('活动会话尚未读到时不闪出共享项目树，全部入口保持可用', async () => {
    setCurrentConversation(null);
    mount();
    expect(await screen.findByText('暂无本次对话文件')).toBeVisible();
    expect(screen.queryByText('other.txt')).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '显示全部' }));
    expect(await screen.findByText('other.txt')).toBeVisible();
  });

  it('未知归属不回退共享 deck，显示全部仍能进入原项目树', async () => {
    h.fetch.mockResolvedValue(response(null, 404));
    mount();
    expect(await screen.findByText('暂无本次对话文件')).toBeVisible();
    expect(screen.queryByText('other.txt')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示全部' }));
    expect(await screen.findByText('other.txt')).toBeVisible();
    expect(screen.getByText('reference.md')).toBeVisible();
  });

  it('本次对话和登记的历史目录同列，模板、过程和成品都走原文件树及监听', async () => {
    h.fetch.mockResolvedValue(response(workspace('c1', ['deck/c1', 'deck/legacy'])));
    mount();
    expect(await screen.findByText('report-current.pptx')).toBeVisible();
    expect(screen.getByText('template.pptx')).toBeVisible();
    expect(screen.getByText('process.md')).toBeVisible();
    expect(screen.getByText('report-history.pptx')).toBeVisible();
    expect(screen.queryByText('c2')).toBeNull();
    expect(screen.queryByText('other.txt')).toBeNull();
    await act(async () =>
      applyMonitorNotification('fs/delta', {
        target: { pe_id: 'work', relative_path: 'deck/c1' },
        changes: [{ op: 'added', name: 'new.pptx', kind: 'file' }],
      })
    );
    expect(await screen.findByText('new.pptx')).toBeVisible();
  });

  it('同一对话刷新保留全部开关，切会话立即恢复本次对话，晚到的旧结果不覆盖', async () => {
    let finishOld!: (value: ReturnType<typeof response>) => void;
    h.fetch.mockImplementation((url: string) =>
      url.includes('/c1/')
        ? new Promise((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve(response(workspace('c2')))
    );
    mount();
    await waitFor(() => expect(h.fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '显示全部' }));
    expect(await screen.findByText('other.txt')).toBeVisible();
    await act(async () => setCurrentConversation('c2'));
    expect(screen.getByRole('button', { name: '显示全部' })).toBeVisible();
    expect(await screen.findByText('report-next.pptx')).toBeVisible();
    await act(async () => finishOld(response(workspace('c1'))));
    expect(screen.queryByText('report-current.pptx')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示全部' }));
    await act(async () => h.stream.forEach((fn) => fn({ conversation_id: 'c2', type: 'finish' })));
    expect(screen.getByRole('button', { name: '仅本次对话' })).toBeVisible();
  });

  it('搜索只请求本次目录，全部切回时立即隐藏范围外旧命中并重跑查询', async () => {
    h.fetch.mockResolvedValue(response(workspace('c1')));
    let sequence = 0;
    h.search.mockImplementation(() => ({ id: ++sequence, result: new Promise(() => {}) }));
    mount();
    await screen.findByText('report-current.pptx');
    const input = screen.getByRole('textbox', { name: 'conversation.explorer.search.placeholder' });
    fireEvent.change(input, { target: { value: 'report' } });
    await waitFor(() => expect(h.search).toHaveBeenCalledTimes(1));
    expect(h.search.mock.calls[0][0].roots).toEqual([{ pe_id: 'work', relative_path: 'deck/c1' }]);
    await act(async () =>
      applySearchMatch({
        search_id: sequence,
        matches: [{ pe_id: 'work', relative_path: 'deck/unrelated/report-other.pptx', name: 'report-other.pptx' }],
      })
    );
    expect(screen.queryByText('report-other.pptx')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示全部' }));
    await waitFor(() => expect(h.search).toHaveBeenCalledTimes(2));
    await act(async () =>
      applySearchMatch({
        search_id: sequence,
        matches: [{ pe_id: 'work', relative_path: 'deck/unrelated/report-other.pptx', name: 'report-other.pptx' }],
      })
    );
    expect(await screen.findByText('report-other.pptx')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '仅本次对话' }));
    expect(screen.queryByText('report-other.pptx')).toBeNull();
    await waitFor(() => expect(h.search).toHaveBeenCalledTimes(3));
  });

  it('无可靠目录时搜索不会把空根交给后端扩大成整个项目', async () => {
    h.fetch.mockResolvedValue(response({ ...workspace('c1'), directories: ['deck'] }));
    mount();
    await screen.findByText('暂无本次对话文件');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'report' } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(h.search).not.toHaveBeenCalled();
  });
});
