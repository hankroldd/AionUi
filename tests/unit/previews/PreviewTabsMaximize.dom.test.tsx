/**
 * 文件：tests/unit/previews/PreviewTabsMaximize.dom.test.tsx
 * 职责：验证预览按钮键盘操作、最大化状态与原有关闭回调。
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import userEvent from '@testing-library/user-event';
import PreviewTabs from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewTabs';

// t returns the key verbatim so tooltips assert against the raw i18n key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const baseProps = () => ({
  tabs: [{ id: 't1', title: 'file.md' }],
  activeTabId: 't1',
  tabFadeState: { left: false, right: false },
  tabsContainerRef: React.createRef<HTMLDivElement>(),
  onSwitchTab: vi.fn(),
  onCloseTab: vi.fn(),
  onContextMenu: vi.fn(),
  onClosePanel: vi.fn(),
});

describe('PreviewTabs maximize button', () => {
  afterEach(() => cleanup());

  it('hides the maximize button when no toggle handler is provided (mobile)', () => {
    render(<PreviewTabs {...baseProps()} />);
    expect(screen.queryByTitle('preview.expandPreview')).toBeNull();
    expect(screen.queryByTitle('preview.restorePanel')).toBeNull();
  });

  it('shows the maximize tooltip when not maximized', () => {
    render(<PreviewTabs {...baseProps()} isMaximized={false} onToggleMaximize={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'preview.expandPreview', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'preview.expandPreview' })).toHaveStyle({ color: 'var(--text-primary)' });
    expect(screen.getByRole('button', { name: 'preview.returnToConversation' })).toHaveStyle({
      color: 'var(--text-primary)',
    });
    expect(screen.queryByTitle('preview.restorePanel')).toBeNull();
  });

  it('shows the restore tooltip when maximized', () => {
    render(<PreviewTabs {...baseProps()} isMaximized={true} onToggleMaximize={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'preview.restorePanel', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'preview.restorePanel' })).toHaveStyle({ color: 'var(--text-primary)' });
    expect(screen.queryByTitle('preview.expandPreview')).toBeNull();
  });

  it('invokes the toggle handler on click', () => {
    const onToggleMaximize = vi.fn();
    render(<PreviewTabs {...baseProps()} isMaximized={false} onToggleMaximize={onToggleMaximize} />);
    fireEvent.click(screen.getByTitle('preview.expandPreview'));
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);
  });
});

describe('PreviewTabs keyboard controls', () => {
  afterEach(() => cleanup());

  const actions = [
    [0, 'file.md', 'onSwitchTab', ['t1']],
    [1, 'preview.closeTabTitle: file.md', 'onCloseTab', ['t1']],
    [2, 'preview.browser.newTab', 'onNewBrowserTab', []],
    [3, 'preview.expandPreview', 'onToggleMaximize', []],
    [4, 'preview.returnToConversation', 'onClosePanel', []],
  ] as const;

  describe.each(['{Enter}', ' '])('activation with %s', (key) => {
    it.each(actions)(
      'reaches control %i (%s) by Tab and activates only its action',
      async (index, name, handler, args) => {
        const user = userEvent.setup();
        const props = { ...baseProps(), onNewBrowserTab: vi.fn(), onToggleMaximize: vi.fn() };
        render(<PreviewTabs {...props} />);

        for (let step = 0; step <= index; step++) {
          // Each Tab depends on the previous focus target.
          // eslint-disable-next-line no-await-in-loop
          await user.tab();
        }
        expect(screen.getByRole('button', { name, exact: true })).toHaveFocus();
        await user.keyboard(key);
        expect(props[handler]).toHaveBeenCalledTimes(1);
        if (args.length) expect(props[handler]).toHaveBeenCalledWith(...args);
        expect(props.onSwitchTab).toHaveBeenCalledTimes(handler === 'onSwitchTab' ? 1 : 0);
      }
    );
  });

  it('routes a dirty tab close and middle-click through the same close callback without selecting it', async () => {
    const user = userEvent.setup();
    const props = { ...baseProps(), tabs: [{ id: 't1', title: 'file.md', isDirty: true }] };
    render(<PreviewTabs {...props} />);

    await user.click(screen.getByRole('button', { name: 'preview.closeTabTitle: file.md' }));
    fireEvent(screen.getByText('file.md'), new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));

    expect(props.onCloseTab.mock.calls).toEqual([['t1'], ['t1']]);
    expect(props.onSwitchTab).not.toHaveBeenCalled();
  });
});
