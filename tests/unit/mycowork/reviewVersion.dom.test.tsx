/**
 * [mycowork] PR10 E1：真实自有审查组件的单次执行、ACK 重试和版本绑定。
 * 边界：仅替换 HTTP / 宿主 IPC，不替换被测状态机；只用虚构成果和意见。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { Review, ReviewExecution, ReviewReport } from '@mycowork/contracts';
import { VersionReview, ReviewCreationNotStarted, type ReviewAdapter } from '@mycowork/ui/reviews/index.ts';
import { getScope, restoreScope, setScopeSelection } from '@mycowork/ui';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const base = (): Review => ({
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
const result = (extra = {}) =>
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
type Call = { path: string; body: Record<string, unknown> | undefined };
function setup(options: { fail?: string; recovered?: Review; createUnknown?: boolean; sendUnknown?: boolean } = {}) {
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
    observe: vi.fn(async () => ({ status: 'running', outputs: [], tokensUsed: null })),
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
async function ready() {
  await screen.findByText('只审查这一固定版本，不修改原稿。');
}
async function start() {
  await ready();
  fireEvent.change(screen.getByRole('textbox', { name: '明确审查任务' }), { target: { value: '检查事实出处与结构' } });
  fireEvent.click(screen.getByRole('button', { name: '开始审查' }));
}
async function refresh() {
  fireEvent.click(screen.getByRole('button', { name: '刷新意见' }));
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  restoreScope({ items: [], views: [], origin: 'turn' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fixed-version Review UI', () => {
  it('confirms rules and freezes an independent explicit-empty scope, then records real ACK before one send', async () => {
    const f = setup();
    render(<VersionReview {...f.props} />);
    await start();
    await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
    expect(f.order.slice(0, 8)).toEqual([
      'plan',
      'review',
      'session',
      'create',
      'verify',
      'execution',
      'send',
      'execution',
    ]);
    expect(f.calls.find((x) => x.path.endsWith('/context-plans'))?.body).toEqual({
      explicit_empty: true,
      use_project_defaults: false,
      policy: { strict: true, web: 'off' },
    });
    expect(f.calls.find((x) => x.path === '/bridge/v1/reviews')?.body).toMatchObject({
      resource_id: 'resource-1',
      revision_id: 'revision-old',
      mode: 'review_only',
      policy: { strict: true, web: 'off' },
    });
    expect(f.calls.filter((x) => x.path.endsWith('/execution')).map((x) => x.body)).toEqual([
      { conversation_id: 'actual-conversation' },
      { conversation_id: 'actual-conversation', message_id: 'actual-message', turn_id: 'actual-turn' },
    ]);
    expect(f.adapter.send).toHaveBeenCalledWith('actual-conversation', '可信固定版本任务，不含Writer历史');
  });

  it.each(['execution', 'turn-execution', 'rounds'])(
    'retries a failed %s registration without creating or sending twice',
    async (stage) => {
      const f = setup({ fail: stage });
      render(<VersionReview {...f.props} />);
      await start();
      if (stage === 'execution' || stage === 'turn-execution') {
        await screen.findByText(/审查请求失败/);
        expect(f.adapter.send).toHaveBeenCalledTimes(stage === 'execution' ? 0 : 1);
        fireEvent.click(screen.getByRole('button', { name: '重试登记' }));
        await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
      } else {
        await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
        vi.mocked(f.adapter.observe).mockResolvedValue({ status: 'idle', outputs: [result()], tokensUsed: null });
        await refresh();
        await screen.findByText(/审查请求失败/);
        await refresh();
        await waitFor(() => expect(f.getReview()?.status).toBe('completed'));
      }
      expect(f.adapter.create).toHaveBeenCalledTimes(1);
      expect(f.adapter.send).toHaveBeenCalledTimes(1);
    }
  );

  it('retries a proven pre-POST failure on the original review; no lost status or second review', async () => {
    const f = setup();
    vi.mocked(f.adapter.create).mockRejectedValueOnce(new ReviewCreationNotStarted(new Error('model not ready')));
    render(<VersionReview {...f.props} />);
    await start();
    await screen.findByText(/审查请求失败/);
    fireEvent.click(screen.getByRole('button', { name: '重试登记' }));
    await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
    expect(f.calls.filter((x) => x.path === '/bridge/v1/reviews')).toHaveLength(1);
    expect(f.calls.some((x) => x.path.endsWith('/lost'))).toBe(false);
  });

  it('stops the acknowledged turn when its second execution registration failed', async () => {
    const f = setup({ fail: 'turn-execution' });
    render(<VersionReview {...f.props} />);
    await start();
    await screen.findByText(/审查请求失败/);
    fireEvent.click(screen.getAllByRole('button', { name: '停止审查' })[0]!);
    await waitFor(() =>
      expect(f.adapter.cancel).toHaveBeenCalledWith({
        conversation_id: 'actual-conversation',
        message_id: 'actual-message',
        turn_id: 'actual-turn',
      })
    );
    expect(f.order.slice(-2)).toEqual(['stop', 'cancel']);
    expect(f.adapter.create).toHaveBeenCalledTimes(1);
    expect(f.adapter.send).toHaveBeenCalledTimes(1);
  });

  it.each(['create', 'send'])('records unknown %s and never replays it', async (stage) => {
    const f = setup({ createUnknown: stage === 'create', sendUnknown: stage === 'send' });
    render(<VersionReview {...f.props} />);
    await start();
    await waitFor(() => expect(f.getReview()?.status).toBe('recovery_required'));
    await refresh();
    expect(f.calls.find((x) => x.path.endsWith('/lost'))?.body?.reason).toBe(
      stage === 'create' ? 'creation_unknown' : 'submission_unknown'
    );
    expect(f.adapter.create).toHaveBeenCalledTimes(1);
    expect(f.adapter.send).toHaveBeenCalledTimes(stage === 'create' ? 0 : 1);
    expect(screen.getByRole('button', { name: '重试登记' })).toBeDisabled();
  });

  it('rejects foreign version JSON and idle as success; accepts matching data without HTML execution or false zero usage', async () => {
    const f = setup();
    render(<VersionReview {...f.props} />);
    await start();
    await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
    vi.mocked(f.adapter.observe).mockResolvedValue({
      status: 'idle',
      outputs: [
        result({ input_revision_id: 'revision-new' }),
        result({ review_id: 'foreign-review' }),
        result({ extra: true }),
      ],
      tokensUsed: null,
    });
    await refresh();
    await screen.findByText(/会话已空闲，但未取得匹配/);
    expect(f.calls.filter((x) => x.path.endsWith('/rounds'))).toHaveLength(0);
    vi.mocked(f.adapter.observe).mockResolvedValue({ status: 'idle', outputs: [result()], tokensUsed: null });
    await refresh();
    await waitFor(() => expect(f.getReview()?.status).toBe('completed'));
    const report = f.calls.find((x) => x.path.endsWith('/rounds'))!.body;
    expect(report).toMatchObject({
      input_revision_id: 'revision-old',
      message_id: 'actual-message',
      turn_id: 'actual-turn',
      tokens_used: null,
    });
    const shown = screen.getAllByTestId('version-review-results')[0]!;
    expect(within(shown).getByText('用量未观测')).toBeInTheDocument();
    expect(within(shown).getByText('Reviewer 查询: 虚构查询')).toBeInTheDocument();
    expect(shown.querySelector('img')).toBeNull();
    expect(shown.querySelector('[data-revision-id]')?.getAttribute('data-revision-id')).toBe('revision-old');
  });

  it('reopens an existing ACK for observation only and revokes before cancelling its original turn', async () => {
    const saved = {
      ...base(),
      execution: { conversation_id: 'existing', message_id: 'known-msg', turn_id: 'known-turn' },
    };
    const f = setup({ recovered: saved });
    vi.mocked(f.adapter.cancel).mockImplementation(async () => {
      f.order.push('cancel');
      throw new Error('fixture cancellation unknown');
    });
    render(<VersionReview {...f.props} />);
    await ready();
    await waitFor(() => expect(f.adapter.observe).toHaveBeenCalledWith(saved.execution));
    expect(f.adapter.create).not.toHaveBeenCalled();
    expect(f.adapter.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: '停止审查' })[0]!);
    await waitFor(() => expect(f.adapter.cancel).toHaveBeenCalledWith(saved.execution));
    expect(f.order.slice(-2)).toEqual(['stop', 'cancel']);
    expect(await screen.findByText(/审查授权已撤销；原轮次取消结果尚未确认/)).toBeInTheDocument();
    expect(f.getReview()?.status).toBe('cancelled');
  });

  it('marks an existing missing executor lost without recreating it', async () => {
    const f = setup({
      recovered: { ...base(), execution: { conversation_id: 'missing', message_id: 'known', turn_id: 'known' } },
    });
    vi.mocked(f.adapter.observe).mockRejectedValue(new Error('review_executor_lost'));
    render(<VersionReview {...f.props} />);
    await waitFor(() => expect(f.getReview()?.execution_issue).toBe('executor_lost'));
    expect(f.adapter.create).not.toHaveBeenCalled();
    expect(f.adapter.send).not.toHaveBeenCalled();
  });

  it('restores the old scope on close, but never across account changes', async () => {
    setScopeSelection({ items: [{ source_id: 'old-source', name: '旧范围' }], views: [] });
    const f = setup();
    const view = render(<VersionReview {...f.props} />);
    await ready();
    expect(getScope().items).toHaveLength(0);
    view.rerender(<VersionReview {...f.props} open={false} />);
    await waitFor(() => expect(getScope().items[0]?.source_id).toBe('old-source'));
    view.rerender(<VersionReview {...f.props} open />);
    await ready();
    view.rerender(<VersionReview {...f.props} ownerKey='owner-b' open={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getScope().items).toHaveLength(0);
  });

  it('closing the panel does not stop or cancel an existing execution', async () => {
    const f = setup({
      recovered: { ...base(), execution: { conversation_id: 'existing', message_id: 'msg', turn_id: 'turn' } },
    });
    const view = render(<VersionReview {...f.props} />);
    await ready();
    view.rerender(<VersionReview {...f.props} open={false} />);
    expect(f.calls.some((x) => x.path.endsWith('/stop'))).toBe(false);
    expect(f.adapter.cancel).not.toHaveBeenCalled();
  });
});
