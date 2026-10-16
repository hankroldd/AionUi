/**
 * [mycowork] PR09 R058: the scope strip shows "记忆建议 n" for this conversation's candidates and accepts/rejects in place.
 * Only Bridge HTTP and Arco notifications are substituted; the real strip and InlineSuggest run together.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ScopeStrip } from '@mycowork/ui';

const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const context = {
  plan_id: 'plan_1',
  version: 1,
  status: 'OK',
  used: [],
  withheld: 0,
  superseded: false,
  brief: {
    groups: [{ source_id: 's', source_name: '虚构库', mode: 'whole', member_count: 1, counts }],
    excluded: 0,
    unauthorized: 0,
    refs: {},
    policy: { strict: true, web: 'off' },
  },
};
const item = (n: number, revision = 1) => ({
  memory_id: `m${n}`,
  kind: 'preference',
  scope: { type: 'personal' },
  text: `虚构偏好${n}`,
  sources: { resource_ids: ['r1'], conversation_id: 'conv_a' },
  status: 'candidate',
  revision,
  exportable: false,
  created_at: '2026-10-17T00:00:00Z',
  updated_at: '2026-10-17T00:00:00Z',
});
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const fetchMock = vi.fn();
let pending: ReturnType<typeof item>[] = [];
let actionStatus = 200;
const actions = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/actions'));
const props = { lang: 'zh-CN', conversationId: 'conv_a', onStrictShrink: vi.fn() };

beforeEach(() => {
  pending = [item(1, 3), item(2)];
  actionStatus = 200;
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
  fetchMock.mockReset().mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url.endsWith('/context')) return reply(200, context);
    if (url.startsWith('/bridge/v1/memory-items?')) {
      expect(url).toContain('conversation_id=conv_a');
      expect(url).toContain('status=candidate');
      return reply(200, { items: pending, page: 1, page_size: 50, total: pending.length });
    }
    if (url.includes('/actions')) {
      if (actionStatus === 200) pending = pending.filter((p) => !url.includes(p.memory_id));
      return reply(actionStatus, actionStatus === 200 ? {} : { error: { code: 'REVISION_CONFLICT', message: 'x' } });
    }
    throw new Error(`Unexpected HTTP: ${url} ${init?.body ?? ''}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('hides the badge when the conversation has no candidates', async () => {
  pending = [];
  render(<ScopeStrip {...props} />);
  await screen.findByText(/虚构库/);
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/bridge/v1/memory-items'))).toBe(true));
  expect(screen.queryByTestId('memory-suggest-badge')).toBeNull();
});

it('shows n, accepts with expected_revision and updates the count', async () => {
  render(<ScopeStrip {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '记忆建议 2' }));
  const list = await screen.findByTestId('memory-suggest-list');
  expect(within(list).getByText('虚构偏好1')).toBeTruthy();
  fireEvent.click(within(list).getAllByRole('button', { name: '接受' })[0]!);
  await screen.findByRole('button', { name: '记忆建议 1' });
  expect(actions()).toHaveLength(1);
  expect(actions()[0]![0]).toBe('/bridge/v1/memory-items/m1/actions');
  expect(JSON.parse(actions()[0]![1].body)).toEqual({ action: 'accept', expected_revision: 3 });
});

it('rejects the last candidate and the badge disappears', async () => {
  pending = [item(2)];
  render(<ScopeStrip {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '记忆建议 1' }));
  fireEvent.click(await screen.findByRole('button', { name: '拒绝' }));
  await waitFor(() => expect(screen.queryByTestId('memory-suggest-badge')).toBeNull());
  expect(JSON.parse(actions()[0]![1].body)).toEqual({ action: 'reject', expected_revision: 1 });
});

it('shows the P11 conflict text on a 409 and re-reads', async () => {
  actionStatus = 409;
  render(<ScopeStrip {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: '记忆建议 2' }));
  fireEvent.click((await screen.findAllByRole('button', { name: '接受' }))[0]!);
  await waitFor(() => expect(Message.error).toHaveBeenCalled());
  expect(vi.mocked(Message.error).mock.calls[0]![0]).toContain('条目已被更新');
});
