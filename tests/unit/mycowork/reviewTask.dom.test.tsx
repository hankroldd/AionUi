/**
 * [mycowork] 审查要求回显与显式沿用；不自动重新执行或替换本轮范围。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { VersionReview } from '@mycowork/ui/reviews/index.ts';
import { getScope, restoreScope, setScopeSelection } from '@mycowork/ui';
import { base, json, ready, refresh, result, setup, start } from './reviewVersion.fixture';

const savedTask = '核对原始事实：\n<img src=x onerror=alert(1)>\n缺少确认的连接方式请提问。';
const saved = () => ({ ...base(), status: 'completed', task: savedTask });
const panel = () => within(screen.getByRole('dialog'));

beforeEach(() => restoreScope({ items: [], views: [], origin: 'turn' }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('shows the saved task as plain text without filling or starting a new review', async () => {
  const f = setup({ recovered: saved() });
  render(<VersionReview {...f.props} />);
  await ready();
  const summary = panel().getByText('审查时的要求', { selector: 'summary' });
  const details = summary.closest('details')!;
  expect(details).not.toHaveAttribute('open');
  fireEvent.click(summary);
  expect(details).toHaveAttribute('open');
  expect(details.textContent).toContain(savedTask);
  expect(details.querySelector('img')).toBeNull();
  expect(panel().getByRole('textbox', { name: '明确审查任务' })).toHaveValue('');
  expect(f.calls.every((call) => call.body === undefined)).toBe(true);
  expect(f.adapter.create).not.toHaveBeenCalled();
  expect(f.adapter.send).not.toHaveBeenCalled();
});

it('copies only the chosen task on demand and keeps an edited task when refreshing saved results', async () => {
  const f = setup({ recovered: saved() });
  render(<VersionReview {...f.props} />);
  await ready();
  const budget = panel().getByRole('spinbutton', { name: 'Token 预算' });
  fireEvent.change(budget, { target: { value: '4321' } });
  fireEvent.blur(budget);
  await act(async () => setScopeSelection({ items: [{ source_id: 'new-source', name: '本轮资料' }], views: [] }));
  fireEvent.click(panel().getByText('审查时的要求', { selector: 'summary' }));
  fireEvent.click(panel().getByRole('button', { name: '沿用此要求' }));
  const task = panel().getByRole('textbox', { name: '明确审查任务' });
  expect(task).toHaveValue(savedTask);
  expect(budget).toHaveValue('4321');
  expect(getScope().items[0]?.source_id).toBe('new-source');
  expect(f.calls.every((call) => call.body === undefined)).toBe(true);
  expect(f.adapter.create).not.toHaveBeenCalled();
  expect(f.adapter.send).not.toHaveBeenCalled();
  fireEvent.change(task, { target: { value: '本轮补充：只核对材料与连接关系。' } });
  await refresh();
  expect(task).toHaveValue('本轮补充：只核对材料与连接关系。');
});

it.each(['reviewing', 'recovery_required'])('does not offer task reuse while status is %s', async (status) => {
  const f = setup({ recovered: { ...saved(), status } });
  render(<VersionReview {...f.props} />);
  await ready();
  fireEvent.click(panel().getByText('审查时的要求', { selector: 'summary' }));
  expect(panel().queryByRole('button', { name: '沿用此要求' })).toBeNull();
  expect(panel().getByRole('textbox', { name: '明确审查任务' })).toBeDisabled();
  expect(f.adapter.create).not.toHaveBeenCalled();
  expect(f.adapter.send).not.toHaveBeenCalled();
});

it('allows explicit task reuse after this attempt completed with warnings without resubmitting it', async () => {
  const f = setup();
  const fetchReview = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchReview(input, init);
      return String(input).endsWith('/rounds')
        ? json({ ...(await response.json()), status: 'completed_with_warnings', task: '检查事实出处与结构' })
        : response;
    })
  );
  render(<VersionReview {...f.props} />);
  await start();
  await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
  vi.mocked(f.adapter.observe).mockResolvedValue({
    status: 'idle',
    outputs: [result()],
    tokensUsed: null,
    renderingVerifiedFrom: 0,
  });
  await refresh();
  fireEvent.click(await panel().findByText('审查时的要求', { selector: 'summary' }));
  const reuse = await panel().findByRole('button', { name: '沿用此要求' });
  fireEvent.click(reuse);
  expect(panel().getByRole('textbox', { name: '明确审查任务' })).toBeEnabled();
  expect(panel().getByRole('textbox', { name: '明确审查任务' })).toHaveValue('检查事实出处与结构');
  expect(panel().getByRole('button', { name: '开始审查' })).toBeEnabled();
  expect(f.calls.filter((call) => call.path === '/bridge/v1/reviews')).toHaveLength(1);
  expect(f.adapter.send).toHaveBeenCalledTimes(1);
});
