/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 文件：Messages/useAutoScroll.ts
 * 职责：保持消息底部跟随、明确跳转与预览分屏时的操作位置。
 * 关联：navigation-intent §15、ADR-0032；只补偿本消息滚动区。
 *
 * Strategy:
 * - Track whether the user has intentionally scrolled away from the bottom.
 * - Observe content/scroller size changes and keep the list pinned to bottom
 *   only while auto-follow mode is active.
 * - Use DOM-native scrollIntoView for explicit message jumps.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TMessage } from '@/common/chat/chatLib';

const PROGRAMMATIC_SCROLL_GUARD_MS = 150;
const AT_BOTTOM_THRESHOLD_PX = 100;
const FOLLOW_BOTTOM_THRESHOLD_PX = 4;

interface UseAutoScrollOptions {
  messages: TMessage[];
  itemCount: number;
}

interface ScrollElementIntoViewOptions {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
}

interface UseAutoScrollReturn {
  handleScrollerRef: (ref: HTMLDivElement | null) => void;
  handleContentRef: (ref: HTMLDivElement | null) => void;
  handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  handleWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  handlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  showScrollButton: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollElementIntoView: (element: HTMLElement | null, options?: ScrollElementIntoViewOptions) => void;
  hideScrollButton: () => void;
}

const getBottomGap = (element: HTMLElement): number => {
  return element.scrollHeight - element.clientHeight - element.scrollTop;
};

export function useAutoScroll({ messages, itemCount }: UseAutoScrollOptions): UseAutoScrollReturn {
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const userScrolledRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const previousListLengthRef = useRef(messages.length);
  const previousLastMessageRef = useRef<TMessage | undefined>(messages[messages.length - 1]);
  const lastProgrammaticScrollTimeRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const pendingAutoFollowFrameRef = useRef<number | null>(null);
  const userInputActiveRef = useRef(false);
  const readingAnchorRef = useRef<{ element: HTMLElement; offset: number; width: number } | null>(null);

  const cancelAutoFollow = useCallback(() => {
    if (pendingAutoFollowFrameRef.current !== null) {
      cancelAnimationFrame(pendingAutoFollowFrameRef.current);
      pendingAutoFollowFrameRef.current = null;
    }
  }, []);

  const markProgrammaticScroll = useCallback(() => {
    lastProgrammaticScrollTimeRef.current = Date.now();
  }, []);

  const updateBottomState = useCallback((element: HTMLDivElement) => {
    const bottomGap = getBottomGap(element);
    const withinButtonThreshold = bottomGap <= AT_BOTTOM_THRESHOLD_PX;
    const pinnedToBottom = bottomGap <= FOLLOW_BOTTOM_THRESHOLD_PX;
    setShowScrollButton(!withinButtonThreshold);

    if (pinnedToBottom) {
      userScrolledRef.current = false;
      userInputActiveRef.current = false;
      lastProgrammaticScrollTimeRef.current = Date.now() - (PROGRAMMATIC_SCROLL_GUARD_MS - 50);
    }

    return pinnedToBottom;
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (itemCount <= 0 || !scrollerEl) return;

      markProgrammaticScroll();
      scrollerEl.scrollTo({
        top: scrollerEl.scrollHeight - scrollerEl.clientHeight,
        behavior,
      });
      userScrolledRef.current = false;
      setShowScrollButton(false);
    },
    [itemCount, markProgrammaticScroll, scrollerEl]
  );

  const scheduleAutoFollow = useCallback(() => {
    if (!scrollerEl || userScrolledRef.current) return;

    if (pendingAutoFollowFrameRef.current !== null) {
      cancelAnimationFrame(pendingAutoFollowFrameRef.current);
    }

    pendingAutoFollowFrameRef.current = requestAnimationFrame(() => {
      pendingAutoFollowFrameRef.current = null;
      if (!scrollerEl || userScrolledRef.current) return;

      const gap = getBottomGap(scrollerEl);
      if (gap > 2) {
        scrollToBottom('auto');
      }
    });
  }, [scrollerEl, scrollToBottom]);

  const handleScrollerRef = useCallback((ref: HTMLDivElement | null) => {
    setScrollerEl(ref);
  }, []);

  const handleContentRef = useCallback((ref: HTMLDivElement | null) => {
    setContentEl(ref);
  }, []);

  const scrollElementIntoView = useCallback(
    (element: HTMLElement | null, options?: ScrollElementIntoViewOptions) => {
      if (!element) return;

      readingAnchorRef.current = null;
      cancelAutoFollow();
      userScrolledRef.current = false;
      setShowScrollButton(false);
      markProgrammaticScroll();
      element.scrollIntoView({
        behavior: options?.behavior ?? 'smooth',
        block: options?.block ?? 'start',
        inline: 'nearest',
      });
    },
    [cancelAutoFollow, markProgrammaticScroll]
  );

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      if (readingAnchorRef.current && (target.clientWidth === 0 || target.clientHeight === 0)) return;
      const currentScrollTop = target.scrollTop;
      const timeSinceGuard = Date.now() - lastProgrammaticScrollTimeRef.current;
      const delta = currentScrollTop - lastScrollTopRef.current;
      const bottomGap = getBottomGap(target);
      const pinnedToBottom = bottomGap <= FOLLOW_BOTTOM_THRESHOLD_PX;

      if (Math.abs(delta) > 2 && (userInputActiveRef.current || timeSinceGuard >= PROGRAMMATIC_SCROLL_GUARD_MS)) {
        readingAnchorRef.current = null;
        if (!pinnedToBottom) userScrolledRef.current = true;
      }

      if (pinnedToBottom) {
        userInputActiveRef.current = false;
      } else if (Math.abs(delta) > 2) {
        userInputActiveRef.current = false;
      }

      lastScrollTopRef.current = currentScrollTop;
      updateBottomState(target);
    },
    [updateBottomState]
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) > 0 || Math.abs(e.deltaX) > 0) {
      userInputActiveRef.current = true;
      readingAnchorRef.current = null;
    }
  }, []);

  const captureReadingAnchor = useCallback(
    (target: EventTarget | null) => {
      const element = target instanceof Element ? target.closest<HTMLElement>('button, a, [role="button"]') : null;
      readingAnchorRef.current =
        element && scrollerEl?.contains(element)
          ? {
              element,
              offset: element.getBoundingClientRect().top - scrollerEl.getBoundingClientRect().top,
              width: scrollerEl.clientWidth,
            }
          : null;
      if (readingAnchorRef.current) cancelAutoFollow();
    },
    [cancelAutoFollow, scrollerEl]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      userInputActiveRef.current = true;
      captureReadingAnchor(event.target);
    },
    [captureReadingAnchor]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        userInputActiveRef.current = true;
        captureReadingAnchor(event.target);
      } else if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
        userInputActiveRef.current = true;
        readingAnchorRef.current = null;
      }
    },
    [captureReadingAnchor]
  );

  useEffect(() => {
    if (!scrollerEl || !contentEl) return;

    const observer = new ResizeObserver(() => {
      const anchor = readingAnchorRef.current;
      if (anchor && !scrollerEl.contains(anchor.element)) readingAnchorRef.current = null;
      if (anchor && (scrollerEl.clientWidth === 0 || scrollerEl.clientHeight === 0)) {
        anchor.width = 0;
        return;
      }
      if (anchor && readingAnchorRef.current && anchor.width !== scrollerEl.clientWidth) {
        cancelAutoFollow();
        userInputActiveRef.current = false;
        markProgrammaticScroll();
        const rect = anchor.element.getBoundingClientRect();
        const offset = Math.max(0, Math.min(anchor.offset, scrollerEl.clientHeight - rect.height));
        scrollerEl.scrollTop += rect.top - scrollerEl.getBoundingClientRect().top - offset;
        anchor.width = scrollerEl.clientWidth;
        lastScrollTopRef.current = scrollerEl.scrollTop;
        userScrolledRef.current = true;
        updateBottomState(scrollerEl);
        return;
      }
      scheduleAutoFollow();
      updateBottomState(scrollerEl);
    });

    observer.observe(scrollerEl);
    observer.observe(contentEl);

    return () => observer.disconnect();
  }, [cancelAutoFollow, contentEl, markProgrammaticScroll, scheduleAutoFollow, scrollerEl, updateBottomState]);

  useEffect(() => {
    if (!scrollerEl || initialScrollDoneRef.current || itemCount === 0) return;

    initialScrollDoneRef.current = true;
    requestAnimationFrame(() => {
      scrollToBottom('auto');
      lastScrollTopRef.current = scrollerEl.scrollTop;
    });
  }, [itemCount, scrollerEl, scrollToBottom]);

  useEffect(() => {
    const currentListLength = messages.length;
    const previousLength = previousListLengthRef.current;
    const lastMessage = messages[messages.length - 1];
    const previousLastMessage = previousLastMessageRef.current;
    const isNewMessage = currentListLength > previousLength;
    const isLastMessageUpdated = currentListLength > 0 && lastMessage !== previousLastMessage;
    if (lastMessage?.conversation_id !== previousLastMessage?.conversation_id) readingAnchorRef.current = null;

    previousListLengthRef.current = currentListLength;
    previousLastMessageRef.current = lastMessage;

    if (!isNewMessage) {
      if (isLastMessageUpdated) {
        scheduleAutoFollow();
      }
      return;
    }

    if (lastMessage?.position !== 'right') {
      scheduleAutoFollow();
      return;
    }

    readingAnchorRef.current = null;
    userScrolledRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBottom('auto');
      });
    });
  }, [messages, scheduleAutoFollow, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (pendingAutoFollowFrameRef.current !== null) {
        cancelAnimationFrame(pendingAutoFollowFrameRef.current);
      }
    };
  }, []);

  const hideScrollButton = useCallback(() => {
    readingAnchorRef.current = null;
    cancelAutoFollow();
    userScrolledRef.current = false;
    setShowScrollButton(false);
  }, [cancelAutoFollow]);

  return {
    handleScrollerRef,
    handleContentRef,
    handleScroll,
    handleWheel,
    handlePointerDown,
    handleKeyDown,
    showScrollButton,
    scrollToBottom,
    scrollElementIntoView,
    hideScrollButton,
  };
}
