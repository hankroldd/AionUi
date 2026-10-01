/**
 * 文件：tests/unit/mycowork/secondarySearchHotkey.dom.test.tsx
 * 职责：真实原生搜索快捷键在展开/收起二级栏时只有一份查询与弹窗。
 * 边界：Popover、Header、Titlebar 真实运行；IPC 和弹窗外形用边界替身，不运行 Electron。
 * 关联：ADR-0022；PR11 W4-2；重复 document 快捷键监听回归。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';

const state = vi.hoisted(() => ({ collapsed: false, path: '/guid' }));
const search = vi.hoisted(() => vi.fn().mockResolvedValue({ items: [], has_more: false }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: state.path, search: '', hash: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}));
vi.mock('@/common', () => ({
  ipcBridge: { database: { searchConversationMessages: { invoke: search } } },
}));
vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div role='dialog'>{children}</div> : null,
}));
vi.mock('@/renderer/components/base', () => ({
  AionSearchInput: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label='query' value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  ),
}));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false, siderCollapsed: state.collapsed, setSiderCollapsed: vi.fn() }),
}));
vi.mock('@/renderer/hooks/context/NavigationHistoryContext', () => ({ useNavigationHistory: () => null }));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({ useFeedback: () => ({ openFeedback: vi.fn() }) }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true, isMacOS: () => true }));
vi.mock('@/renderer/components/layout/Titlebar/MobileConversationBrand', () => ({ default: () => null }));
import Header from '@/renderer/mycowork-secondary';
import Titlebar from '@/renderer/components/layout/Titlebar';

const Owners = () => (
  <>
    <Header onConversationSelect={vi.fn()} />
    <Titlebar workspaceAvailable={false} />
  </>
);

const shortcut = () => {
  const event = new KeyboardEvent('keydown', {
    key: 'f',
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => document.dispatchEvent(event));
  return event;
};

beforeEach(() => {
  state.collapsed = false;
  state.path = '/guid';
  search.mockClear();
  localStorage.clear();
  vi.stubGlobal('electronAPI', undefined);
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
});
afterEach(() => vi.unstubAllGlobals());

it('keeps exactly one native search listener and query after the header is hidden', async () => {
  const view = render(<Owners />);
  expect(screen.getAllByRole('button', { name: 'conversation.historySearch.tooltip' })).toHaveLength(1);
  expect(shortcut().defaultPrevented).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: 'query' }), { target: { value: 'fixture' } });
  await waitFor(() => expect(search).toHaveBeenCalledOnce());
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  state.collapsed = true;
  view.rerender(<Owners />);
  search.mockClear();
  expect(screen.getAllByRole('button', { name: 'conversation.historySearch.tooltip' })).toHaveLength(1);
  expect(shortcut().defaultPrevented).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: 'query' }), { target: { value: 'fixture-next' } });
  await waitFor(() => expect(search).toHaveBeenCalledOnce());
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

it('leaves the browser shortcut unchanged without the desktop IPC bridge', () => {
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  render(<Owners />);
  expect(shortcut().defaultPrevented).toBe(false);
  expect(screen.queryByRole('dialog')).toBeNull();
});
