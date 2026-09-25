/**
 * [mycowork] ADR-0011: "scope this turn" strip above the conversation body (MyCowork PR03 spec §6 item 8, 01 §6.4).
 * Only external boundaries are mocked: Bridge = fetch, aioncore stream = ipcBridge.conversation.responseStream.
 * Covers the summary line, 404 = plain chat, used-sources list, refresh on turn finish, and error states.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationScopeSlot } from '@/renderer/mycowork-slots';

type StreamMessage = { type: string; conversation_id: string };
const streamListeners = new Set<(m: StreamMessage) => void>();
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: (fn: (m: StreamMessage) => void) => {
          streamListeners.add(fn);
          return () => streamListeners.delete(fn);
        },
      },
    },
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = (ready: number, indexing: number, failed: number, unavailable: number) => ({
  total: ready + indexing + failed + unavailable,
  ready,
  indexing,
  failed,
  unavailable,
});
const CONTEXT = {
  plan_id: 'plan_1',
  version: 1,
  status: 'OK',
  brief: {
    groups: [
      { source_id: 'src_a', source_name: '项目A资料', mode: 'whole', counts: counts(3, 1, 0, 0) },
      { source_id: 'src_b', source_name: '产品库', mode: 'whole', counts: counts(5, 0, 1, 1) },
    ],
    excluded: 0,
    unauthorized: 0,
    refs: {},
    policy: { strict: false, web: 'off' },
  },
  used: [
    { resource_id: 'r1', source_id: 'src_b', file_name: '产品手册.md', reads: 2, last_read_at: '2026-09-25T02:00:00Z' },
  ],
  withheld: 1,
};
const SUMMARY = '项目A资料 + 产品库；公网关闭；可检索 8 · 处理中 1 · 不可用 2';

const emit = (m: StreamMessage) => act(() => streamListeners.forEach((fn) => fn(m)));

describe('ConversationScopeSlot', () => {
  beforeEach(() => {
    streamListeners.clear();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows sources, web policy and searchable/processing/unavailable counts', async () => {
    fetchMock.mockResolvedValue(reply(200, CONTEXT));
    render(<ConversationScopeSlot conversation_id='conv 1' />);
    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/bridge/v1/conversations/conv%201/context', {
      credentials: 'same-origin',
    });
  });

  it('says "plain chat only" when the conversation has no plan (404)', async () => {
    fetchMock.mockResolvedValue(reply(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    expect(await screen.findByText('未选择资料：仅普通对话')).toBeInTheDocument();
    expect(screen.queryByText(/查看本轮使用资料/)).toBeNull();
  });

  it('lists the used sources with source name and read count, and the withheld count', async () => {
    fetchMock.mockResolvedValue(reply(200, CONTEXT));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    fireEvent.click(await screen.findByRole('button', { name: '查看本轮使用资料（1）' }));
    expect(screen.getByText('产品手册.md')).toBeInTheDocument();
    expect(screen.getByText(/产品库 · 读取 2 次/)).toBeInTheDocument();
    expect(screen.getByText('另有 1 项因授权撤销不再列出')).toBeInTheDocument();
    expect(screen.getByText('只统计工具已返回的内容，不代表都已进入模型上下文')).toBeInTheDocument();
  });

  it('refetches when an assistant turn of this conversation finishes, not for other conversations', async () => {
    fetchMock.mockResolvedValue(reply(200, CONTEXT));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    await screen.findByText(SUMMARY);
    emit({ type: 'finish', conversation_id: 'conv-other' });
    emit({ type: 'content', conversation_id: 'conv-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    emit({ type: 'finish', conversation_id: 'conv-1' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('shows the Bridge error instead of pretending nothing was selected, and recovers on refresh', async () => {
    fetchMock.mockResolvedValueOnce(reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } }));
    fetchMock.mockResolvedValue(reply(200, CONTEXT));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    expect(await screen.findByText('资料服务暂不可用，请稍后重试')).toBeInTheDocument();
    expect(screen.queryByText('未选择资料：仅普通对话')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
  });

  it('treats a malformed context as a failure', async () => {
    fetchMock.mockResolvedValue(reply(200, { ...CONTEXT, used: [{ resource_id: 'r1' }] }));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    expect(await screen.findByText('资料范围处理失败（invalid context response）')).toBeInTheDocument();
  });

  it('marks an empty-scope plan and a web-allowed policy', async () => {
    const empty = {
      ...CONTEXT,
      status: 'EMPTY_SCOPE',
      brief: { ...CONTEXT.brief, policy: { strict: true, web: 'allowed' } },
    };
    fetchMock.mockResolvedValue(reply(200, empty));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    expect(await screen.findByText(/所选资料当前不可检索；可补充公开资料/)).toBeInTheDocument();
  });
});
