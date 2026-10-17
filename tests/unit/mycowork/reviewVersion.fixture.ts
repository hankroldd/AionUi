/**
 * [mycowork] adapted：共享夹具（拆自 reviewVersion.dom.test.tsx）。
 */
import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { Review, ReviewExecution, ReviewReport } from '@mycowork/contracts';
import { type ReviewAdapter } from '@mycowork/ui/reviews/index.ts';

export const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
export const fenced = (value: string) => `审查说明\n\`\`\`json\n${value}\n\`\`\`\n以上为本轮意见。`;
export const base = (): Review => ({
  review_id: 'review-1',
  status: 'reviewing',
  mode: 'review_only',
  resource_id: 'resource-1',
  base_revision_id: 'revision-old',
  input_revision_id: 'revision-old',
  context_plan_id: 'review-plan',
  max_rounds: 1,
  budget_tokens: 100000,
  tokens_used: 0,
  policy: { strict: true, web: 'off' },
  rounds: [],
  unresolved: [],
  created_at: '2026-10-16T00:00:00Z',
  updated_at: '2026-10-16T00:00:00Z',
});
export const result = (extra = {}) =>
  JSON.stringify({
    review_id: 'review-1',
    input_revision_id: 'revision-old',
    incomparable: false,
    findings: [
      {
        location: '第1段',
        severity: 'high',
        fix_action: '<img src=x onerror=alert(1)>补充出处',
        needed_info: '需要规范版本',
        requires_authorization: false,
        evidence: [{ source: 'reviewer_query', resource_id: 'evidence-1', query: '虚构查询', locator: '第2页' }],
      },
    ],
    ...extra,
  });
export type Call = { path: string; body: Record<string, unknown> | undefined };
export function setup(
  options: { fail?: string; recovered?: Review; createUnknown?: boolean; sendUnknown?: boolean } = {}
) {
  let review = options.recovered;
  let fail = options.fail;
  const calls: Call[] = [];
  const order: string[] = [];
  const adapter: ReviewAdapter = {
    create: vi.fn(async () => {
      order.push('create');
      if (options.createUnknown) throw new Error('unknown');
      return 'actual-conversation';
    }),
    verify: vi.fn(async () => {
      order.push('verify');
    }),
    send: vi.fn(async () => {
      order.push('send');
      if (options.sendUnknown) throw new Error('unknown');
      return { message_id: 'actual-message', turn_id: 'actual-turn' };
    }),
    observe: vi.fn(async () => ({ status: 'running', outputs: [], tokensUsed: null, renderingVerifiedFrom: 0 })),
    cancel: vi.fn(async () => {
      order.push('cancel');
    }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ path, body });
      if (path === '/bridge/v1/review-rules')
        return json({
          enabled_by_default: false,
          modes: ['review_only', 'review_and_revise'],
          rounds: { default: 2, min: 1, max: 3 },
          budget_tokens: { default: 100000, max: 500000 },
          stop_conditions: ['max_rounds'],
          pause_conditions: [],
          rules: ['只审查这一固定版本，不修改原稿。'],
        });
      if (path.startsWith('/bridge/v1/reviews?'))
        return json({ items: review ? [review] : [], total: review ? 1 : 0, page: 1 });
      if (path === '/bridge/v1/context-plans') {
        order.push('plan');
        return json({ plan_id: 'evidence-plan', status: 'EMPTY_SCOPE', brief: { explicit_empty: true, groups: [] } });
      }
      if (path === '/bridge/v1/reviews') {
        order.push('review');
        review = base();
        return json(review);
      }
      const stage = path.split('/').at(-1)!;
      order.push(stage);
      if (stage === fail || (fail === 'turn-execution' && stage === 'execution' && body?.message_id)) {
        fail = undefined;
        return json({ error: { code: 'TEMPORARY' } }, 409);
      }
      if (stage === 'session')
        return json({
          review_id: 'review-1',
          plan_id: 'review-plan',
          workspace: '/review/1',
          session_mcp_server: {
            id: 'review-mcp',
            name: 'Review',
            transport: { type: 'streamable_http', url: 'http://bridge/review', headers: {} },
          },
          prompt: '可信固定版本任务，不含Writer历史',
          input_revision_id: 'revision-old',
          input_content_sha256: 'a'.repeat(64),
        });
      if (stage === 'execution') {
        review = { ...review!, execution: body as ReviewExecution };
        return json(review);
      }
      if (stage === 'lost') {
        review = {
          ...review!,
          status: 'recovery_required',
          execution_issue: body?.reason as Review['execution_issue'],
        };
        return json(review);
      }
      if (stage === 'stop') {
        review = { ...review!, status: 'cancelled', stop_reason: 'user_stopped' };
        return json(review);
      }
      if (stage === 'rounds') {
        const report = body as ReviewReport;
        const findings = report.findings.map((f, i) => ({
          ...f,
          finding_id: `finding-${i}`,
          round: 1,
          revision_id: 'revision-old',
        }));
        review = {
          ...review!,
          status: report.incomparable ? 'failed' : 'completed',
          ...(report.incomparable ? { execution_issue: 'incomparable' as const } : {}),
          unresolved: findings,
          rounds: [
            {
              round: 1,
              input_revision_id: 'revision-old',
              output_revision_id: null,
              tokens_used: report.tokens_used ?? 0,
              usage_observed: report.tokens_used !== null,
              findings,
              created_at: '2026-10-16T00:00:00Z',
            },
          ],
        };
        return json(review);
      }
      throw new Error(`Unexpected ${path}`);
    })
  );
  const props = {
    resourceId: 'resource-1',
    revisionId: 'revision-old',
    label: '虚构报告 · v1',
    ownerKey: 'owner-a',
    lang: 'zh-CN',
    adapter,
    open: true,
    onClose: vi.fn(),
  };
  return { adapter, calls, order, props, getReview: () => review };
}
export async function ready() {
  await screen.findByText('只审查这一固定版本，不修改原稿。');
}
export async function start() {
  await ready();
  fireEvent.change(screen.getByRole('textbox', { name: '明确审查任务' }), { target: { value: '检查事实出处与结构' } });
  fireEvent.click(screen.getByRole('button', { name: '开始审查' }));
}
export async function refresh() {
  fireEvent.click(screen.getByRole('button', { name: '刷新意见' }));
  await act(async () => {
    await Promise.resolve();
  });
}
