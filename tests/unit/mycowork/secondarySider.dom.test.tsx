/**
 * 文件：tests/unit/mycowork/secondarySider.dom.test.tsx
 * 职责：桌面/手机偏好隔离与二级栏头部的原生搜索、收起接线。
 * 边界：真实持久化 hook/Arco 按钮；搜索内部查询沿用上游，用边界替身记录调用。
 * 关联：ADR-0022；PR11 W4-2。
 */
import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';

const route = vi.hoisted(() => ({ path: '/guid' }));
const collapse = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: route.path }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}));
vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false, siderCollapsed: false, setSiderCollapsed: collapse }),
}));
vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({
  default: ({
    renderTrigger,
    onConversationSelect,
  }: {
    renderTrigger: (props: { onClick: () => void }) => React.ReactNode;
    onConversationSelect: () => void;
  }) => renderTrigger({ onClick: onConversationSelect }),
}));
import SecondaryHeader, { mycoworkSiderId, useMyCoworkSecondaryCollapse } from '@/renderer/mycowork-secondary';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  route.path = '/guid';
});

describe('secondary preference', () => {
  it('mobile toggles preserve the desktop preference across viewport changes', () => {
    const { result, rerender } = renderHook(({ mobile }) => useMyCoworkSecondaryCollapse(mobile), {
      initialProps: { mobile: false },
    });
    act(() => result.current.setCollapsed(true));
    rerender({ mobile: true });
    act(() => result.current.setCollapsed(false));
    expect(localStorage.getItem('mycowork:sider-collapsed')).toBe('true');
    rerender({ mobile: false });
    expect(result.current.collapsed).toBe(true);
    rerender({ mobile: true });
    expect(result.current.collapsed).toBe(true);
  });

  it('desktop toggles restore after remount', () => {
    const first = renderHook(() => useMyCoworkSecondaryCollapse(false));
    act(() => first.result.current.setCollapsed(true));
    first.unmount();
    expect(renderHook(() => useMyCoworkSecondaryCollapse(false)).result.current.collapsed).toBe(true);
  });

  it('storage denial does not disable the current session sidebar', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      const { result } = renderHook(() => useMyCoworkSecondaryCollapse(false));
      act(() => result.current.setCollapsed(true));
      expect(result.current.collapsed).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('secondary header', () => {
  it('only Space, Trash and Memory use connected Office sidebar containers', () => {
    expect(mycoworkSiderId('/office/memory')).toBe('mycowork-memory-sider');
    expect(mycoworkSiderId('/office/memory/')).toBe('mycowork-memory-sider');
    expect(mycoworkSiderId('/office/space')).toBe('mycowork-space-sider');
    expect(mycoworkSiderId('/office/resources')).toBe('mycowork-space-sider');
    expect(mycoworkSiderId('/office/trash')).toBe('mycowork-space-sider');
    expect(mycoworkSiderId('/office/trash/')).toBe('mycowork-space-sider');
    expect(mycoworkSiderId('/scheduled')).toBe('mycowork-scheduled-sider');
    expect(mycoworkSiderId('/scheduled/job-1')).toBe('mycowork-scheduled-sider');
    expect(mycoworkSiderId('/scheduledx')).toBeNull();
    for (const path of ['/office/resources/res_fixture/versions', '/office/imports', '/office/knowledge'])
      expect(mycoworkSiderId(path)).toBeNull();
  });

  it('Home uses native search selection and the Layout collapse action', () => {
    const selected = vi.fn();
    render(<SecondaryHeader onConversationSelect={selected} />);
    fireEvent.click(screen.getByRole('button', { name: 'conversation.historySearch.tooltip' }));
    expect(selected).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(collapse).toHaveBeenCalledWith(true);
    expect(screen.getByRole('heading').textContent).toBe('首页');
  });

  it.each(['/scheduled', '/scheduled/job-1'])('Scheduled route %s does not display conversation search', (path) => {
    route.path = path;
    render(<SecondaryHeader onConversationSelect={vi.fn()} />);
    expect(screen.getByRole('heading').textContent).toBe('定时任务');
    expect(screen.queryByRole('button', { name: 'conversation.historySearch.tooltip' })).toBeNull();
  });

  it('Scheduled route fills its own container with a one-line note instead of the Home conversation list', () => {
    route.path = '/scheduled';
    const host = document.createElement('div');
    host.id = 'mycowork-scheduled-sider';
    document.body.append(host);
    try {
      render(<SecondaryHeader onConversationSelect={vi.fn()} />);
      expect(host.textContent).toBe('任务列表与新建在右侧页面。');
    } finally {
      host.remove();
    }
  });
});
