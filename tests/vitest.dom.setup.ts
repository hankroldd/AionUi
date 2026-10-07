/**
 * Vitest DOM Test Setup
 * Configuration for React component and hook tests using jsdom
 */

import '@testing-library/jest-dom/vitest';
import { afterAll } from 'vitest';

// [mycowork] PR11 (A125): when a test file ends, jsdom is torn down. Work that React or Arco queued shortly before —
// a react-transition-group exit timer (Arco popups, <= 400ms), Arco's deferred root unmount (0ms), a scheduler task —
// then ran without `window` and threw `ReferenceError: window is not defined` (all tests pass, vitest reports Errors 1;
// seen under load from scopeChip and officeDrop). Let that work finish while the environment still exists.
// Real timers are captured here so a file that leaves fake timers on cannot hang the hook.
// Ceiling: a timer longer than 500ms that a test's own code leaves behind is still that test's to clear.
const realSetTimeout = globalThis.setTimeout;
const realSetImmediate = globalThis.setImmediate;
export async function settlePendingReactWork(): Promise<void> {
  // Toasts, notifications and confirms live in roots RTL does not clean up. A toast left on screen closes itself seconds
  // later and only then starts its exit animation, so waiting alone cannot outlast it: close them now. Arco is imported
  // only when such a layer is on the page, so files that never load it do not pay for it.
  if (document.querySelector('.arco-message-wrapper, .arco-notification-wrapper, .arco-modal-wrapper')) {
    const [{ Message, Modal, Notification }, { act }] = await Promise.all([
      import('@arco-design/web-react'),
      import('react'),
    ]);
    act(() => {
      Message.clear();
      Notification.clear();
      Modal.destroyAll();
    });
  }
  await new Promise((resolve) => realSetTimeout(resolve, 500)); // every transition timer due before this fires first
  await new Promise((resolve) => realSetTimeout(resolve, 5)); // 0ms timers those callbacks queued (deferred unmount)
  await new Promise((resolve) => realSetImmediate(resolve)); // scheduler tasks queued by those timers
  await new Promise((resolve) => realSetImmediate(resolve)); // and the passive effects they schedule in turn
}
afterAll(settlePendingReactWork);

// Make this a module

// Extend global types for testing
interface ElectronAPI {
  emit: () => Promise<void>;
  on: () => void;
  windowControls: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    unmaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: () => () => void;
  };
}

declare global {
  // eslint-disable-next-line no-var
  var electronAPI: ElectronAPI;
}

const noop = () => Promise.resolve();

// Mock Electron APIs for testing
const windowControlsMock = {
  minimize: noop,
  maximize: noop,
  unmaximize: noop,
  close: noop,
  isMaximized: () => Promise.resolve(false),
  onMaximizedChange: (): (() => void) => () => void 0,
};

global.electronAPI = {
  emit: noop,
  on: () => {},
  windowControls: windowControlsMock,
};

if (typeof window !== 'undefined') {
  (window as unknown as { electronAPI: ElectronAPI }).electronAPI = global.electronAPI;
}

// Mock ResizeObserver for Virtuoso
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock;

// Mock IntersectionObserver
class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

// Mock requestAnimationFrame
global.requestAnimationFrame = (callback: FrameRequestCallback) => {
  return setTimeout(() => callback(Date.now()), 0) as unknown as number;
};

global.cancelAnimationFrame = (id: number) => {
  clearTimeout(id);
};

// Mock scrollTo
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

// Mock localStorage (not always available in jsdom)
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage?.clear !== 'function') {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
  }
}
