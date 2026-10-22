/**
 * 文件：tests/unit/mycowork/reviewAdapterReport.dom.test.tsx
 * 职责：核查结构化审查候选只接受已登记轮次的成功工具输出，并沿用严格报告解析。
 * 边界：只模拟公开 IPC 消息；不执行模型，不放宽版本、证据或看图顺序。
 * 关联：review-loop.md §7a；renderer/mycowork-reviews.tsx。
 */
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Review } from '@mycowork/contracts';
import { parseReport } from '@mycowork/ui/reviews/report.ts';
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
const execution = { conversation_id: 'fixture-conversation', message_id: 'ack', turn_id: 'fixture-turn' };
const review = {
  review_id: 'report-fixture',
  resource_id: 'resource-fixture',
  input_revision_id: 'revision-fixture',
} as Review;
const workspace = '/fixture/MyCowork 审查 report-fixture';
const finding = {
  location: '第 1 段',
  evidence: [],
  severity: 'medium',
  fix_action: '标题写"接管验收空间"，正文写"工具共享"，请统一主题。',
  needed_info: null,
  requires_authorization: false,
};
const candidate = {
  review_id: review.review_id,
  input_revision_id: review.input_revision_id,
  incomparable: false,
  findings: [finding],
};
const ack = {
  id: execution.message_id,
  conversation_id: execution.conversation_id,
  position: 'right',
  type: 'text',
  content: { content: '虚构审查请求' },
};
function tool(changes: Record<string, unknown> = {}) {
  return {
    id: 'candidate',
    conversation_id: execution.conversation_id,
    backend_turn_id: execution.turn_id,
    position: 'left',
    type: 'tool_call',
    content: {
      name: 'review_report_candidate',
      status: 'completed',
      output: JSON.stringify(candidate),
      ...changes,
    },
  };
}
function image() {
  const path = `${workspace}/render-1.png`;
  return tool({
    name: 'ViewImage',
    input: { file_path: path },
    output: `Image loaded from ${path} and attached to the next model turn.`,
  });
}
function messages(items: unknown[]) {
  api.messages.mockResolvedValue({ items: [ack, ...items], has_more_after: false });
}
beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({
    id: execution.conversation_id,
    type: 'aionrs',
    extra: { workspace },
    runtime: { state: 'idle' },
  });
  api.read.mockResolvedValue(
    JSON.stringify({
      resource_id: review.resource_id,
      input_revision_id: review.input_revision_id,
      format: 'text',
      render: null,
    })
  );
  api.usage.mockResolvedValue({});
  messages([tool()]);
});
afterEach(cleanup);

it.each(['review_report_candidate', 'mcp__mycowork_bridge_review_report_candidate'])(
  'accepts the successful %s result with quoted text through the unchanged strict parser',
  async (name) => {
    messages([
      tool({ name }),
      {
        ...ack,
        id: 'invalid-model-text',
        position: 'left',
        status: 'finish',
        content: { content: '{"findings":[{"fix_action":"标题写"接管验收空间""}]}' },
      },
    ]);
    const { result } = renderHook(() => useReviewAdapter());
    const observed = await result.current.observe(execution, review);
    expect(observed.outputs[0]).toBe(JSON.stringify(candidate));
    expect(parseReport(observed, review, execution)).toEqual({
      input_revision_id: review.input_revision_id,
      message_id: execution.message_id,
      turn_id: execution.turn_id,
      tokens_used: null,
      incomparable: false,
      findings: [finding],
    });
  }
);

it.each([
  { name: 'read' },
  { name: 'mcp__other_review_report_candidate' },
  { name: 'mcp__mycowork_bridge__review_report_candidate' },
  { status: 'running' },
  { status: 'error' },
  { error: 'MCP 请求失败' },
  { output: undefined },
])('ignores a different tool or unsuccessful candidate %#', async (changes) => {
  messages([tool(changes)]);
  const { result } = renderHook(() => useReviewAdapter());
  const observed = await result.current.observe(execution, review);
  expect(observed.outputs).toEqual([]);
  expect(parseReport(observed, review, execution)).toBeNull();
});

it.each(['different-turn', undefined])('ignores a candidate without the registered backend turn %s', async (turn) => {
  const call = tool();
  messages([{ ...call, backend_turn_id: turn }]);
  const { result } = renderHook(() => useReviewAdapter());
  expect((await result.current.observe(execution, review)).outputs).toEqual([]);
});

it('ignores candidates before the ACK and after a later user message', async () => {
  api.messages.mockResolvedValue({
    items: [tool(), ack, { ...ack, id: 'later-user' }, tool()],
    has_more_after: false,
  });
  const { result } = renderHook(() => useReviewAdapter());
  expect((await result.current.observe(execution, review)).outputs).toEqual([]);
});

it.each([true, false])(
  'retains image-before-report ordering for a structured candidate: imagesFirst=%s',
  async (imagesFirst) => {
    api.read.mockResolvedValue(
      JSON.stringify({
        resource_id: review.resource_id,
        input_revision_id: review.input_revision_id,
        format: 'pptx',
        render: { expected_pages: 1, completed_pages: 1, pages: [{ page: 1, png: 'render-1.png' }] },
      })
    );
    messages(imagesFirst ? [image(), tool()] : [tool(), image()]);
    const { result } = renderHook(() => useReviewAdapter());
    const observed = await result.current.observe(execution, review);
    expect(observed.renderingVerifiedFrom).toBe(imagesFirst ? 0 : 1);
    expect(parseReport(observed, review, execution) !== null).toBe(imagesFirst);
  }
);
