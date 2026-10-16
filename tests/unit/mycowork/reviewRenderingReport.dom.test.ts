/**
 * [mycowork] PR10 E1：没有逐页看图证据时，不把模型的可比较报告记为完成。
 * 边界：仅替换宿主观察与 HTTP；保留真实解析及报告登记路径。
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { Review } from '@mycowork/contracts';
import type { ReviewAdapter, ReviewObservation } from '@mycowork/ui';
import { parseReport } from '@mycowork/ui/reviews/report.ts';
import { observeReview } from '@mycowork/ui/reviews/flow.ts';

const execution = { conversation_id: 'conversation', message_id: 'message', turn_id: 'turn' };
const review: Review = {
  review_id: 'review',
  resource_id: 'resource',
  base_revision_id: 'revision',
  input_revision_id: 'revision',
  context_plan_id: 'plan',
  mode: 'review_only',
  max_rounds: 1,
  status: 'reviewing',
  policy: { strict: true, web: 'off' },
  rounds: [],
  unresolved: [],
  execution,
};
const report = {
  review_id: 'review',
  input_revision_id: 'revision',
  incomparable: false,
  findings: [],
};
afterEach(() => vi.unstubAllGlobals());

it.each([null, 0, 1])('accepts a comparable report only after the images at output index %s', (from) => {
  const observation: ReviewObservation = {
    status: 'idle',
    outputs: [JSON.stringify(report)],
    tokensUsed: null,
    renderingVerifiedFrom: from,
  };
  expect(parseReport(observation, review, execution) !== null).toBe(from === 0);
});

it('retains an explicit incomparable report with the missing-image reason', () => {
  const finding = {
    location: '幻灯片',
    severity: 'high',
    fix_action: '改用支持图片的模型重新审查',
    needed_info: '尚未查看逐页图片',
    requires_authorization: false,
    evidence: [],
  };
  expect(
    parseReport(
      {
        status: 'idle',
        tokensUsed: null,
        renderingVerifiedFrom: null,
        outputs: [JSON.stringify({ ...report, incomparable: true, findings: [finding] })],
      },
      review,
      execution
    )
  ).toMatchObject({ incomparable: true, findings: [finding] });
});

it('idle without image evidence reports a useful error and does not register completion', async () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  const adapter: ReviewAdapter = {
    create: vi.fn(),
    verify: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    observe: vi.fn(async () => ({
      status: 'idle',
      outputs: [JSON.stringify(report)],
      tokensUsed: null,
      renderingVerifiedFrom: null,
    })),
  };
  await expect(observeReview(review, adapter, () => {})).rejects.toThrow('review_images_unconfirmed');
  expect(adapter.observe).toHaveBeenCalledWith(execution, review);
  expect(request).not.toHaveBeenCalled();
});
