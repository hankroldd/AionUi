/**
 * 文件：tests/unit/mycowork/reviewAdapterRendering.dom.test.tsx
 * 职责：核查固定PPT每页必须有本轮真实ViewImage成功记录，不能用模型声明冒充。
 * 边界：仅模拟公开IPC；不执行模型、命令或读取真实资料。
 * 关联：PR10 E1；renderer/mycowork-reviews.tsx。
 */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Review } from '@mycowork/contracts';
import { useReviewAdapter } from '@/renderer/mycowork-reviews';

const api = vi.hoisted(() => ({ get: vi.fn(), read: vi.fn(), messages: vi.fn(), usage: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { get: { invoke: api.get }, getUsage: { invoke: api.usage } },
    database: { getConversationMessages: { invoke: api.messages } },
    fs: { readFile: { invoke: api.read } },
  },
}));
vi.mock('@/renderer/mycowork-resource-navigation', () => ({ useOwnerKey: () => 'fixture-owner' }));
vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({ current_model: undefined, modelList: [] }),
}));
const review = {
  review_id: 'render-fixture',
  resource_id: 'resource-fixture',
  input_revision_id: 'revision-fixture',
} as Review;
const execution = { conversation_id: 'fixture-conversation', message_id: 'ack', turn_id: 'fixture-turn' };
const workspace = '/fixture/MyCowork 审查 render-fixture';
const manifest = {
  resource_id: review.resource_id,
  input_revision_id: review.input_revision_id,
  format: 'pptx',
  render: {
    expected_pages: 2,
    completed_pages: 2,
    pages: [
      { page: 1, png: 'render-1.png' },
      { page: 2, png: 'render-2.png' },
    ],
  },
};
const ack = {
  id: execution.message_id,
  conversation_id: execution.conversation_id,
  position: 'right',
  type: 'text',
  content: { content: '虚构审查请求' },
};
const finish = {
  id: 'finish',
  conversation_id: execution.conversation_id,
  position: 'left',
  type: 'text',
  status: 'finish',
  content: { content: '{"incomparable":false,"findings":[]}' },
};
function image(page: number, changes: Record<string, unknown> = {}) {
  const path = `${workspace}/render-${page}.png`;
  return {
    id: `view-${page}`,
    conversation_id: execution.conversation_id,
    backend_turn_id: execution.turn_id,
    type: 'tool_call',
    content: {
      name: 'ViewImage',
      status: 'completed',
      input: { file_path: path },
      output: `Image loaded from ${path} and attached to the next model turn.`,
      ...changes,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({
    id: execution.conversation_id,
    type: 'aionrs',
    extra: { workspace },
    runtime: { state: 'idle' },
  });
  api.read.mockResolvedValue(JSON.stringify(manifest));
  api.messages.mockResolvedValue({ items: [ack, image(1), image(2), finish], has_more_after: false });
  api.usage.mockResolvedValue({});
});
afterEach(cleanup);

it.each([
  { name: 'Read', output: '(binary file, 20000 bytes)' },
  { status: 'error' },
  { error: 'Image input unsupported' },
  { input: { file_path: 'render-2.png' } },
  { input: { file_path: '/fixture/other/render-2.png' } },
  { output: '(binary file, 20000 bytes)' },
])('does not accept incomplete or unsuccessful image input %#', async (changes) => {
  api.messages.mockResolvedValue({ items: [ack, image(1), image(2, changes), finish], has_more_after: false });
  const { result } = renderHook(() => useReviewAdapter());
  const observation = await result.current.observe(execution, review);
  expect(observation.renderingVerifiedFrom).toBeNull();
  expect(observation.outputs).toEqual([finish.content.content]);
});

it('accepts only after both pages succeed through the actual public read and anchored pagination, including reopen', async () => {
  const pages = () =>
    api.messages
      .mockResolvedValueOnce({ items: [image(2), ack, image(1)], has_more_after: true, newest_cursor: 'page-2' })
      .mockResolvedValueOnce({ items: [image(2), finish, { ...ack, id: 'later-user' }], has_more_after: false });
  pages();
  const first = renderHook(() => useReviewAdapter());
  expect((await first.result.current.observe(execution, review)).renderingVerifiedFrom).toBe(0);
  first.unmount();
  pages();
  const reopened = renderHook(() => useReviewAdapter());
  expect((await reopened.result.current.observe(execution, review)).renderingVerifiedFrom).toBe(0);
  expect(api.read).toHaveBeenCalledWith({ path: `${workspace}/review-input.json`, workspace });
  expect(api.messages.mock.calls[1]![0]).toMatchObject({ after: 'page-2' });
});

it('does not borrow a page from before the ACK or after the next user message', async () => {
  api.messages.mockResolvedValue({
    items: [image(2), ack, image(1), finish, { ...ack, id: 'later-user' }, image(2)],
    has_more_after: false,
  });
  const { result } = renderHook(() => useReviewAdapter());
  expect((await result.current.observe(execution, review)).renderingVerifiedFrom).toBeNull();
});

it('does not borrow an image from a different backend turn', async () => {
  api.messages.mockResolvedValue({
    items: [ack, image(1), { ...image(2), backend_turn_id: 'different-turn' }, finish],
    has_more_after: false,
  });
  const { result } = renderHook(() => useReviewAdapter());
  expect((await result.current.observe(execution, review)).renderingVerifiedFrom).toBeNull();
});

it.each([
  { name: 'JSON before images remains unverified', items: [finish, image(1), image(2)], from: 1, count: 1 },
  { name: 'images before JSON permit the first output', items: [image(1), image(2), finish], from: 0, count: 1 },
  {
    name: 'only new JSON after images is eligible',
    items: [finish, image(1), image(2), { ...finish, id: 'new-finish' }],
    from: 1,
    count: 2,
  },
])('$name', async ({ items, from, count }) => {
  api.messages.mockResolvedValue({ items: [ack, ...items], has_more_after: false });
  const { result } = renderHook(() => useReviewAdapter());
  const observed = await result.current.observe(execution, review);
  expect(observed.renderingVerifiedFrom).toBe(from);
  expect(observed.outputs).toHaveLength(count);
});

it.each([
  { ...manifest, input_revision_id: 'different-revision' },
  { ...manifest, resource_id: 'different-resource' },
  { ...manifest, render: { ...manifest.render, completed_pages: 1 } },
  { ...manifest, render: { ...manifest.render, pages: [manifest.render.pages[0]] } },
  { ...manifest, format: 'text' },
  null,
])('rejects mismatched or incomplete trusted input metadata %#', async (input) => {
  api.read.mockResolvedValue(input === null ? null : JSON.stringify(input));
  const { result } = renderHook(() => useReviewAdapter());
  await expect(result.current.observe(execution, review)).rejects.toThrow('review_input_unconfirmed');
});

it('rejects a different review workspace before requesting any file', async () => {
  api.get.mockResolvedValue({
    id: execution.conversation_id,
    type: 'aionrs',
    extra: { workspace: workspace + '-old' },
  });
  const { result } = renderHook(() => useReviewAdapter());
  await expect(result.current.observe(execution, review)).rejects.toThrow('review_isolation_mismatch');
  expect(api.read).not.toHaveBeenCalled();
});
