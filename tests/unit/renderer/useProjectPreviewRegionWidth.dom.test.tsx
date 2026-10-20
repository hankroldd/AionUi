/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectPreviewRegionWidth } from '@/renderer/hooks/ui/useProjectPreviewRegionWidth';

const MIN_CHAT = 360;
const MIN_PREVIEW = 340;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('chat-preview-width-px', '480'); // requested width
});

describe('useProjectPreviewRegionWidth (P4 ordered clamp)', () => {
  it('uses the requested width when there is ample room', () => {
    // available 2000, explorer 300 → max = 2000-360-300 = 1340 → min(480,1340)=480
    const { result } = renderHook(() => useProjectPreviewRegionWidth(2000, 300, true));
    expect(result.current.widthPx).toBe(480);
  });

  it('clamps so chat keeps MIN_CHAT after the explorer + preview chrome', () => {
    // available 1256, explorer 501, preview chrome 24 (ml-8+mr-12+border+buffer)
    // → max = 1256-360-501-24 = 371 → min(480,371)=371
    // ⇒ occupied preview+chrome = 371+24 = 395; content = 1256-501-395 = 360 = MIN_CHAT
    const CHROME = 24;
    const { result } = renderHook(() => useProjectPreviewRegionWidth(1256, 501, true));
    expect(result.current.widthPx).toBe(371);
    expect(1256 - 501 - result.current.widthPx - CHROME).toBe(MIN_CHAT);
  });

  it('gets more room when the explorer is collapsed (width 0)', () => {
    // available 1256, explorer 0 → max = 896 → min(480,896)=480
    const { result } = renderHook(() => useProjectPreviewRegionWidth(1256, 0, true));
    expect(result.current.widthPx).toBe(480);
  });

  it('never drops below MIN_PREVIEW even when the row is very tight', () => {
    // available 900, explorer 400 → max = max(340, 900-360-400=140) = 340 (floor)
    const { result } = renderHook(() => useProjectPreviewRegionWidth(900, 400, true));
    expect(result.current.widthPx).toBe(MIN_PREVIEW);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([false, true])('受限窗口未横向拖动（同X移动：%s），恢复宽窗仍保留原宽度', (moveAtSameX) => {
  localStorage.setItem('chat-preview-width-px', '640');
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  const Harness = ({ available }: { available: number }) => {
    const { widthPx, createDragHandle } = useProjectPreviewRegionWidth(available, 0, true);
    return (
      <div>
        <output>{widthPx}</output>
        {createDragHandle({ reverse: true })}
      </div>
    );
  };
  const { container, rerender } = render(<Harness available={940} />);
  const handle = container.querySelector('.cursor-col-resize')!;
  fireEvent.pointerDown(handle, { clientX: 500, button: 0, pointerType: 'mouse', pointerId: 1 });
  if (moveAtSameX) {
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 40, buttons: 1 }));
    });
  }
  act(() => {
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 500 }));
  });
  expect(container.querySelector('output')?.textContent).toBe('556');
  expect(localStorage.getItem('chat-preview-width-px')).toBe('640');
  rerender(<Harness available={1228} />);
  expect(container.querySelector('output')?.textContent).toBe('640');
});

it.each([640, 1200])('受限窗口从当前显示宽度起拖，不受已存 %dpx 偏好的死区影响', (storedWidth) => {
  localStorage.setItem('chat-preview-width-px', String(storedWidth));
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  const Harness = ({ available }: { available: number }) => {
    const { widthPx, createDragHandle } = useProjectPreviewRegionWidth(available, 0, true);
    return (
      <div>
        <output>{widthPx}</output>
        {createDragHandle({ reverse: true })}
      </div>
    );
  };
  const { container, rerender } = render(<Harness available={940} />);
  expect(container.querySelector('output')?.textContent).toBe('556');
  expect(localStorage.getItem('chat-preview-width-px')).toBe(String(storedWidth));

  const handle = container.querySelector('.cursor-col-resize')!;
  fireEvent.pointerDown(handle, { clientX: 500, button: 0, pointerType: 'mouse', pointerId: 1 });
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 530, buttons: 1 }));
  });
  expect(container.querySelector('output')?.textContent).toBe('526');
  expect(localStorage.getItem('chat-preview-width-px')).toBe(String(storedWidth));
  act(() => {
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 530 }));
  });
  expect(container.querySelector('output')?.textContent).toBe('526');
  expect(localStorage.getItem('chat-preview-width-px')).toBe('526');
  rerender(<Harness available={1228} />);
  expect(container.querySelector('output')?.textContent).toBe('526');
});

it('给旧窄预览可读宽度，窄窗临时约束不覆盖偏好，恢复窗口后可继续手动调整', () => {
  localStorage.setItem('chat-preview-width-px', '339');
  const { result, rerender, unmount } = renderHook(
    ({ available, explorer }) => useProjectPreviewRegionWidth(available, explorer, true),
    { initialProps: { available: 1228, explorer: 0 } }
  );
  expect(result.current.widthPx).toBe(640);
  rerender({ available: 800, explorer: 220 });
  expect(result.current.widthPx).toBe(340);
  expect(localStorage.getItem('chat-preview-width-px')).toBe('339');
  rerender({ available: 1228, explorer: 0 });
  expect(result.current.widthPx).toBe(640);
  unmount();

  const Harness = () => {
    const { widthPx, createDragHandle } = useProjectPreviewRegionWidth(1228, 0, true);
    return (
      <div>
        <output>{widthPx}</output>
        {createDragHandle()}
      </div>
    );
  };
  const { container } = render(<Harness />);
  const handle = container.querySelector('.cursor-col-resize')!;
  fireEvent.pointerDown(handle, { clientX: 0, button: 0, pointerType: 'mouse', pointerId: 1 });
  act(() => {
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: -90 }));
  });
  expect(container.querySelector('output')?.textContent).toBe('550');
  expect(localStorage.getItem('chat-preview-width-px')).toBe('550');
});
