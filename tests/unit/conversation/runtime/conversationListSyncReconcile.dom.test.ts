/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reconcile wiring: `reconcileGeneratingFromRuntime` lets an authoritative
 * runtime summary (hydrate / send-accepted) relight the sidebar spinner when a
 * WS stream frame was missed (window reload/reconnect race). It must only
 * ever turn the flag ON — clearing stays exclusively with terminal stream
 * frames / turn.completed.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConversations, events } = vi.hoisted(() => ({
  getConversations: vi.fn<() => Promise<{ items: Array<{ id: string; name?: string }> }>>(),
  events: new Map<string, (value: unknown) => void>(),
}));

const subscribe = (name: string) => (callback: (value: unknown) => void) => {
  events.set(name, callback);
  return () => events.delete(name);
};

vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: getConversations },
    },
    conversation: {
      listChanged: { on: subscribe('listChanged') },
      responseStream: { on: subscribe('responseStream') },
      turnCompleted: { on: subscribe('turnCompleted') },
      confirmation: { remove: { on: () => () => {} } },
    },
    application: {
      writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  addEventListener: (name: string, callback: (value: unknown) => void) => subscribe(name)(callback),
}));

let sync: typeof import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');

beforeEach(async () => {
  vi.resetModules();
  events.clear();
  getConversations.mockReset().mockImplementation(() => new Promise(() => {}));
  sync = await import('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync');
});

afterEach(() => vi.restoreAllMocks());

const deferredList = () => {
  let resolve!: (value: { items: Array<{ id: string; name?: string }> }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ items: Array<{ id: string; name?: string }> }>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('reconcileGeneratingFromRuntime', () => {
  it('marks a conversation generating when isProcessing is true', () => {
    const { result } = renderHook(() => sync.useConversationListSync());

    act(() => {
      sync.reconcileGeneratingFromRuntime('conv-a', true);
    });

    expect(result.current.isConversationGenerating('conv-a')).toBe(true);
  });

  it('does not touch other conversations when reconciling one id', () => {
    const { result } = renderHook(() => sync.useConversationListSync());

    act(() => {
      sync.reconcileGeneratingFromRuntime('conv-b', true);
    });

    expect(result.current.isConversationGenerating('conv-b')).toBe(true);
    expect(result.current.isConversationGenerating('conv-c')).toBe(false);
  });

  it('leaves the generating state unchanged when isProcessing is false', () => {
    const { result } = renderHook(() => sync.useConversationListSync());

    act(() => {
      sync.reconcileGeneratingFromRuntime('conv-d', false);
    });

    expect(result.current.isConversationGenerating('conv-d')).toBe(false);
  });
});

describe('conversation list refresh', () => {
  it('coalesces changes during a pending response and then loads the latest list', async () => {
    const first = deferredList();
    const latest = deferredList();
    getConversations.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => sync.useConversationListSync());

    act(() => {
      events.get('listChanged')!({ conversation_id: 'new', action: 'created' });
      events.get('listChanged')!({ conversation_id: 'old', action: 'deleted' });
      events.get('turnCompleted')!({ session_id: 'new', turn_id: 'turn-1', state: 'ai_waiting_input' });
      events.get('chat.history.refresh')!(undefined);
    });
    expect(getConversations).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve({ items: [{ id: 'old' }] }));
    expect(getConversations).toHaveBeenCalledTimes(2);
    await act(async () => latest.resolve({ items: [{ id: 'new', name: 'Latest name' }] }));
    expect(result.current.conversations.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'new', name: 'Latest name' },
    ]);
  });

  it('does not keep refreshing for stream frames whose conversation is absent from the list', async () => {
    const first = deferredList();
    const trailing = deferredList();
    getConversations.mockReturnValueOnce(first.promise).mockReturnValueOnce(trailing.promise);
    renderHook(() => sync.useConversationListSync());
    const stream = () => events.get('responseStream')!({ conversation_id: 'absent', type: 'content' });

    act(() => {
      for (let i = 0; i < 50; i++) stream();
    });
    expect(getConversations).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ items: [] }));
    expect(getConversations).toHaveBeenCalledTimes(2);

    act(() => {
      for (let i = 0; i < 50; i++) stream();
    });
    await act(async () => trailing.resolve({ items: [] }));
    act(stream);
    expect(getConversations).toHaveBeenCalledTimes(2);
  });

  it('retries the same streamed id after failure without retrying successfully absent ids', async () => {
    const failed = deferredList();
    const recovered = deferredList();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getConversations
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(recovered.promise);
    const { result } = renderHook(() => sync.useConversationListSync());
    await act(async () => {});
    const stream = (id: string) => events.get('responseStream')!({ conversation_id: id, type: 'content' });
    await act(async () => stream('absent'));
    act(() => {
      for (let i = 0; i < 50; i++) stream('recoverable');
    });
    expect(getConversations).toHaveBeenCalledTimes(3);

    await act(async () => failed.reject(new Error('List unavailable')));
    act(() => {
      for (let i = 0; i < 50; i++) stream('recoverable');
      stream('absent');
    });
    expect(getConversations).toHaveBeenCalledTimes(4);
    await act(async () => recovered.resolve({ items: [{ id: 'recoverable' }] }));
    expect({
      requests: getConversations.mock.calls.length,
      ids: result.current.conversations.map(({ id }) => id),
    }).toEqual({ requests: 4, ids: ['recoverable'] });
  });

  it.each([
    ['created', 'listChanged', { conversation_id: 'new', action: 'created' }],
    ['renamed', 'listChanged', { conversation_id: 'new', action: 'updated' }],
    ['deleted', 'listChanged', { conversation_id: 'old', action: 'deleted' }],
    ['completed', 'turnCompleted', { session_id: 'new', turn_id: 'turn-1', state: 'ai_waiting_input' }],
    ['explicitly refreshed', 'chat.history.refresh', undefined],
  ] as const)('loads a change that was %s while the list was pending', async (_label, event, payload) => {
    const first = deferredList();
    const latest = deferredList();
    getConversations.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => sync.useConversationListSync());
    act(() => events.get(event)!(payload));

    await act(async () => first.resolve({ items: [{ id: 'old' }] }));
    expect(getConversations).toHaveBeenCalledTimes(2);
    await act(async () => latest.resolve({ items: [{ id: 'new', name: 'Latest name' }] }));
    expect(result.current.conversations.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'new', name: 'Latest name' },
    ]);
  });

  it('keeps changes that arrive while the trailing response is pending', async () => {
    const first = deferredList();
    const second = deferredList();
    const latest = deferredList();
    getConversations
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => sync.useConversationListSync());
    act(() => events.get('listChanged')!({ conversation_id: 'new', action: 'created' }));
    await act(async () => first.resolve({ items: [] }));
    act(() => events.get('listChanged')!({ conversation_id: 'new', action: 'updated' }));
    expect(getConversations).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve({ items: [{ id: 'new', name: 'Old name' }] }));
    expect(getConversations).toHaveBeenCalledTimes(3);
    await act(async () => latest.resolve({ items: [{ id: 'new', name: 'Latest name' }] }));
    expect(result.current.conversations[0]?.name).toBe('Latest name');
  });

  it('discovers a later new conversation from its stream even after another id stayed absent', async () => {
    getConversations.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => sync.useConversationListSync());
    await act(async () => {});
    await act(async () => events.get('responseStream')!({ conversation_id: 'absent', type: 'content' }));

    getConversations.mockResolvedValue({ items: [{ id: 'later' }] });
    await act(async () => events.get('responseStream')!({ conversation_id: 'later', type: 'content' }));
    expect(getConversations).toHaveBeenCalledTimes(3);
    expect(result.current.conversations.map(({ id }) => id)).toEqual(['later']);
  });

  it('loads a real creation event for an id that was absent on its earlier stream', async () => {
    getConversations.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => sync.useConversationListSync());
    await act(async () => {});
    await act(async () => events.get('responseStream')!({ conversation_id: 'later', type: 'content' }));

    getConversations.mockResolvedValue({ items: [{ id: 'later' }] });
    await act(async () => events.get('listChanged')!({ conversation_id: 'later', action: 'created' }));
    expect(getConversations).toHaveBeenCalledTimes(3);
    expect(result.current.conversations.map(({ id }) => id)).toEqual(['later']);
  });

  it('reports a failed refresh and lets an explicit retry recover the list', async () => {
    const failed = deferredList();
    const error = new Error('List unavailable');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    getConversations.mockResolvedValueOnce({ items: [{ id: 'old' }] }).mockReturnValueOnce(failed.promise);
    const { result } = renderHook(() => sync.useConversationListSync());
    await act(async () => {});
    act(() => events.get('chat.history.refresh')!(undefined));
    await act(async () => failed.reject(error));
    expect(errorLog).toHaveBeenCalledWith('[WorkspaceGroupedHistory] Failed to load conversations:', error);
    expect(result.current.conversations).toEqual([]);

    getConversations.mockResolvedValueOnce({ items: [{ id: 'recovered' }] });
    await act(async () => events.get('chat.history.refresh')!(undefined));
    expect({
      requests: getConversations.mock.calls.length,
      ids: result.current.conversations.map(({ id }) => id),
    }).toEqual({
      requests: 3,
      ids: ['recovered'],
    });
  });

  it('still applies a queued real change when the earlier refresh fails', async () => {
    const first = deferredList();
    const latest = deferredList();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getConversations.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => sync.useConversationListSync());
    act(() => events.get('listChanged')!({ conversation_id: 'new', action: 'created' }));

    await act(async () => first.reject(new Error('List unavailable')));
    expect(getConversations).toHaveBeenCalledTimes(2);
    await act(async () => latest.resolve({ items: [{ id: 'new' }] }));
    expect(result.current.conversations.map(({ id }) => id)).toEqual(['new']);
  });
});
