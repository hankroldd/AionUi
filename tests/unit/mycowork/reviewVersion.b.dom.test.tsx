/**
 * [mycowork] adapted：固定版本 Review UI（拆分b，原 reviewVersion.dom.test.tsx，用例原样）。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { Review, ReviewReport } from '@mycowork/contracts';
import { VersionReview } from '@mycowork/ui/reviews/index.ts';
import { getScope, restoreScope, setScopeSelection } from '@mycowork/ui';
import { fenced, base, result, setup, ready, start, refresh } from './reviewVersion.fixture';

beforeEach(() => {
  restoreScope({ items: [], views: [], origin: 'turn' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fixed-version Review UI', () => {
  it('rejects foreign version JSON and idle as success; accepts matching data without HTML execution or false zero usage', async () => {
    const f = setup();
    render(<VersionReview {...f.props} />);
    await start();
    await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
    const checked = JSON.parse(result()) as { findings: { evidence: Record<string, unknown>[] }[] };
    checked.findings[0]!.evidence.push({ source: 'program_check', query: null });
    vi.mocked(f.adapter.observe).mockResolvedValue({
      status: 'idle',
      outputs: [
        result({ input_revision_id: 'revision-new' }),
        result({ review_id: 'foreign-review' }),
        result({ extra: true }),
        fenced(result()) + '\n' + fenced(result()),
        fenced(result().replace('"query":"虚构查询"', '"query":null')),
      ],
      tokensUsed: null,
      renderingVerifiedFrom: 0,
    });
    await refresh();
    await screen.findByText(/会话已空闲，但未取得匹配/);
    expect(f.calls.filter((x) => x.path.endsWith('/rounds'))).toHaveLength(0);
    vi.mocked(f.adapter.observe).mockResolvedValue({
      status: 'idle',
      outputs: [fenced(JSON.stringify(checked))],
      tokensUsed: null,
      renderingVerifiedFrom: 0,
    });
    await refresh();
    await waitFor(() => expect(f.getReview()?.status).toBe('completed'));
    const report = f.calls.find((x) => x.path.endsWith('/rounds'))!.body!;
    expect(report).toMatchObject({
      input_revision_id: 'revision-old',
      message_id: 'actual-message',
      turn_id: 'actual-turn',
      tokens_used: null,
    });
    expect((report.findings as ReviewReport['findings'])[0]!.evidence[1]).toEqual({ source: 'program_check' });
    const shown = screen.getAllByTestId('version-review-results')[0]!;
    expect(within(shown).getByText('用量未观测')).toBeInTheDocument();
    expect(within(shown).getByText('审查者查询: 虚构查询')).toBeInTheDocument();
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
    await waitFor(() => expect(f.adapter.observe).toHaveBeenCalledWith(saved.execution, saved));
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
  it.each(['completed', 'stopped'])(
    'offers 重新审查 only after a %s review, and it submits a new submission id',
    async (end) => {
      const f = setup();
      render(<VersionReview {...f.props} />);
      await start();
      await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('button', { name: '重新审查' })).toBeNull();
      if (end === 'completed') {
        vi.mocked(f.adapter.observe).mockResolvedValue({
          status: 'idle',
          outputs: [result()],
          tokensUsed: null,
          renderingVerifiedFrom: 0,
        });
        await refresh();
        await waitFor(() => expect(f.getReview()?.status).toBe('completed'));
      } else {
        fireEvent.click(screen.getAllByRole('button', { name: '停止审查' })[0]!);
        await waitFor(() => expect(f.getReview()?.status).toBe('cancelled'));
      }
      fireEvent.click(await screen.findByRole('button', { name: '重新审查' }));
      fireEvent.click(await screen.findByRole('button', { name: '开始审查' }));
      await waitFor(() => expect(f.calls.filter((x) => x.path === '/bridge/v1/reviews')).toHaveLength(2));
      const ids = f.calls.filter((x) => x.path === '/bridge/v1/reviews').map((x) => x.body?.submission_id);
      expect(ids[0]).toBeTruthy();
      expect(ids[1]).not.toBe(ids[0]);
    }
  );
});
