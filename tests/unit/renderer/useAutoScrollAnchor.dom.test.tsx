/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 文件：tests/unit/renderer/useAutoScrollAnchor.dom.test.tsx
 * 职责：验证分屏操作位置保持及主动滚动、跳转、发送后的锚点失效。
 * 边界：真实滚动 hook；仅用独立浏览器记录的矩形变化替代 jsdom 布局。
 * 关联：navigation-intent §15、ADR-0032。
 */
import type { KeyboardEvent, MouseEvent, UIEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@/common/chat/chatLib';
import { useAutoScroll } from '@/renderer/pages/conversation/Messages/useAutoScroll';
let resizeObserverCallback: ResizeObserverCallback | null = null;
class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {
    resizeObserverCallback = null;
  }
}
const createMessage = (position: 'left' | 'right', content: string): TMessage =>
  ({
    id: position,
    msg_id: position,
    conversation_id: 'conversation-1',
    type: 'text',
    position,
    content: { content },
    created_at: 1,
  }) as TMessage;
const fireScroll = (handler: (event: UIEvent<HTMLDivElement>) => void, scroller: HTMLDivElement, top: number) => {
  scroller.scrollTop = top;
  act(() => handler({ currentTarget: scroller } as UIEvent<HTMLDivElement>));
};
function readingPositionFixture() {
  const scroller = document.createElement('div');
  Object.defineProperties(scroller, {
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 420 },
    clientWidth: { configurable: true, value: 900 },
  });
  scroller.scrollTo = vi.fn((options?: ScrollToOptions | number, y?: number) => {
    const top = typeof options === 'number' ? y : options?.top;
    if (typeof top === 'number') scroller.scrollTop = top;
  });
  const content = document.createElement('div'),
    button = document.createElement('button'),
    label = document.createElement('span');
  button.append(label);
  content.append(button);
  scroller.append(content);
  document.body.append(scroller);
  let buttonTop = 889;
  scroller.getBoundingClientRect = () => new DOMRect(0, 120, scroller.clientWidth, scroller.clientHeight);
  button.getBoundingClientRect = () => new DOMRect(0, 120 + buttonTop - scroller.scrollTop, 420, 92);
  const view = renderHook(({ messages }) => useAutoScroll({ messages, itemCount: messages.length }), {
    initialProps: { messages: [createMessage('left', 'saved reply')] },
  });
  act(() => {
    view.result.current.handleScrollerRef(scroller);
    view.result.current.handleContentRef(content);
  });
  act(() => vi.runAllTimers());
  vi.advanceTimersByTime(200);
  fireScroll(view.result.current.handleScroll, scroller, 600);
  const reflow = (width: number, shift: number, height = 420) => {
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: height });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: width });
    buttonTop += shift;
    act(() => {
      resizeObserverCallback?.([], {} as ResizeObserver);
      vi.runAllTimers();
    });
  };
  const activate = () =>
    act(() =>
      view.result.current.handleClick({
        target: label,
        currentTarget: scroller,
      } as unknown as MouseEvent<HTMLDivElement>)
    );
  return { ...view, scroller, button, label, activate, reflow };
}
describe('分屏滚动锚点', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T12:00:00.000Z'));
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });
  it('鼠标打开和关闭分屏保持实际按钮位置，程序 scroll 不取消锚点', () => {
    const view = readingPositionFixture();
    view.activate();
    view.reflow(500, 176);
    expect(view.button.getBoundingClientRect().top).toBe(409);
    fireScroll(view.result.current.handleScroll, view.scroller, view.scroller.scrollTop);
    view.reflow(900, -176);
    expect(view.button.getBoundingClientRect().top).toBe(409);
  });

  it.each(['wheel', 'scroll', 'jump', 'send', 'PageDown'])('%s 后不拉回旧操作锚点', (action) => {
    const view = readingPositionFixture();
    view.activate();
    act(() => {
      if (action === 'wheel')
        view.result.current.handleWheel({ deltaX: 0, deltaY: -80 } as React.WheelEvent<HTMLDivElement>);
      if (action === 'jump') view.result.current.scrollElementIntoView(view.button);
      if (action === 'send')
        view.rerender({ messages: [createMessage('left', 'saved reply'), createMessage('right', 'new question')] });
      if (action === 'PageDown')
        view.result.current.handleKeyDown({
          key: action,
          target: view.scroller,
        } as unknown as KeyboardEvent<HTMLDivElement>);
    });
    if (action === 'scroll') fireScroll(view.result.current.handleScroll, view.scroller, 650);
    act(() => vi.runAllTimers());
    view.reflow(500, 176);
    expect(view.button.getBoundingClientRect().top).not.toBe(409);
  });

  it('展开隐藏后的零尺寸不丢失锚点，还原到原宽度仍恢复位置', () => {
    const view = readingPositionFixture();
    view.activate();
    view.reflow(500, 176);
    view.reflow(0, 0, 0);
    vi.advanceTimersByTime(200);
    fireScroll(view.result.current.handleScroll, view.scroller, 0);
    view.reflow(500, 0);
    expect(view.button.getBoundingClientRect().top).toBe(409);
  });

  it('已有底部跟随回调排队时，点击后的宽度补偿优先', () => {
    const view = readingPositionFixture();
    act(() => {
      view.result.current.hideScrollButton();
      resizeObserverCallback?.([], {} as ResizeObserver);
    });
    view.activate();
    view.reflow(500, 176);
    expect(view.button.getBoundingClientRect().top).toBe(409);
  });

  it('操作按钮移除后不再使用旧节点的位置', () => {
    const view = readingPositionFixture();
    view.activate();
    view.button.remove();
    view.reflow(500, 176);
    expect(view.scroller.scrollTop).toBe(600);
  });
});
