/**
 * [mycowork] adapted：固定版本 Review UI（拆分a，原 reviewVersion.dom.test.tsx，用例原样）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { Review } from '@mycowork/contracts';
import { VersionReview, ReviewCreationNotStarted } from '@mycowork/ui/reviews/index.ts';
import { restoreScope } from '@mycowork/ui';
import { result, setup, ready, start, refresh } from './reviewVersion.fixture';

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
    expect(f.order.slice(0, 4)).toEqual(['plan', 'review', 'session', 'create']);
    expect(f.order.slice(4, 8)).toEqual(['verify', 'execution', 'send', 'execution']);
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
        vi.mocked(f.adapter.observe).mockResolvedValue({
          status: 'idle',
          outputs: [result()],
          tokensUsed: null,
          renderingVerifiedFrom: 0,
        });
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
});
