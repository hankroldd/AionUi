/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PreviewToolbar from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@icon-park/react', () => ({
  Close: () => <span aria-hidden='true'>×</span>,
}));

/**
 * Baseline props for an editable `code` tab. Individual tests override the
 * save-related flags. Everything here is required by PreviewToolbar.
 */
const baseProps = {
  content_type: 'code',
  isMarkdown: false,
  isHTML: false,
  viewMode: 'source' as const,
  isSplitScreenEnabled: false,
  showOpenInSystemButton: false,
  hasFilePath: true,
  onViewModeChange: vi.fn(),
  onSplitScreenToggle: vi.fn(),
  onOpenInSystem: vi.fn(),
  onDownload: vi.fn(),
  onClose: vi.fn(),
};

describe('PreviewToolbar save button', () => {
  it('does not render the save button when showSave is false', () => {
    render(<PreviewToolbar {...baseProps} showSave={false} />);
    expect(screen.queryByTestId('preview-save')).not.toBeInTheDocument();
  });

  it('fires onSave when clicked while there are unsaved changes', () => {
    const onSave = vi.fn();
    render(<PreviewToolbar {...baseProps} showSave saveActionable onSave={onSave} />);

    fireEvent.click(screen.getByTestId('preview-save'));

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('is shown but inert when there are no unsaved changes', () => {
    const onSave = vi.fn();
    render(<PreviewToolbar {...baseProps} showSave saveActionable={false} onSave={onSave} />);

    const save = screen.getByTestId('preview-save');
    expect(save).toBeInTheDocument();
    expect(save.className).toContain('cursor-not-allowed');

    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders the save button last (rightmost) in the toolbar, after refresh', () => {
    const { container } = render(
      <PreviewToolbar {...baseProps} refreshState='idle' refreshActionable showSave saveActionable onSave={vi.fn()} />
    );

    const save = container.querySelector('[data-testid="preview-save"]')!;
    const refresh = container.querySelector('[data-testid="preview-refresh"]')!;

    // Save must be the final child of the right-hand action group...
    expect(save.parentElement?.lastElementChild).toBe(save);
    // ...and it must come after the refresh control in DOM order.
    expect(refresh.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

afterEach(cleanup);

describe('PreviewToolbar keyboard actions', () => {
  it.each(['{Enter}', ' '])('Tab reaches visible actions and %s uses each original callback', async (key) => {
    const user = userEvent.setup();
    const props = {
      ...baseProps,
      content_type: 'html',
      isHTML: true,
      showOpenInSystemButton: true,
      refreshState: 'idle',
      refreshActionable: true,
      onRefresh: vi.fn(),
      showSave: true,
      saveActionable: true,
      onSave: vi.fn(),
      onViewModeChange: vi.fn(),
      onSplitScreenToggle: vi.fn(),
      onOpenInSystem: vi.fn(),
      onDownload: vi.fn(),
      onInspectModeToggle: vi.fn(),
    };
    render(<PreviewToolbar {...props} />);
    for (const name of [
      'preview.code',
      'preview.preview',
      'preview.openSplitScreen',
      'preview.refresh.label',
      'preview.openInSystemApp',
      'preview.downloadFile',
      'preview.html.inspectElementEnable',
      'common.save',
    ]) {
      // Each activation depends on the preceding keyboard focus.
      // eslint-disable-next-line no-await-in-loop
      await user.tab();
      expect(screen.getByRole('button', { name, exact: true })).toHaveFocus();
      // eslint-disable-next-line no-await-in-loop
      await user.keyboard(key);
    }
    expect(props.onViewModeChange.mock.calls).toEqual([['source'], ['preview']]);
    expect(
      [
        props.onSplitScreenToggle,
        props.onRefresh,
        props.onOpenInSystem,
        props.onDownload,
        props.onInspectModeToggle,
        props.onSave,
      ].map((handler) => handler.mock.calls.length)
    ).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('exposes disabled refresh and save without allowing keyboard activation', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn(),
      onSave = vi.fn();
    render(
      <PreviewToolbar
        {...baseProps}
        hasFilePath={false}
        refreshState='disabled'
        refreshActionable={false}
        onRefresh={onRefresh}
        showSave
        saveActionable={false}
        onSave={onSave}
      />
    );
    expect(screen.getByTestId('preview-refresh')).toBeDisabled();
    expect(screen.getByTestId('preview-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('preview-refresh'));
    await user.tab();
    expect(screen.getByRole('button', { name: 'preview.downloadFile' })).toHaveFocus();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
