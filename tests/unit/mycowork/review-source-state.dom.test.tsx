/**
 * 文件：tests/unit/mycowork/review-source-state.dom.test.tsx
 * 职责：验证审查原始需求的显式选择、冻结、身份清理及历史回显。
 * 边界：使用公开组件和真实请求边界；不代替浏览器或模型验收。
 * 关联：PR10 D329；review-loop.md §7c。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { VersionReview } from '@mycowork/ui/reviews/index.ts';
import { restoreScope } from '@mycowork/ui';
import { base, json, ready, setup, start } from './reviewVersion.fixture';

const choices = [
  { submission_id: '11111111-1111-4111-8111-111111111111', label: '材料与连接方式' },
  { submission_id: '22222222-2222-4222-8222-222222222222', label: '没有确认自动定位' },
];
const panel = () => within(screen.getByRole('dialog'));
type Choice = (typeof choices)[number];
function addSelector(f: ReturnType<typeof setup>) {
  let latestChange: (value: Choice[]) => void;
  Object.assign(f.adapter, {
    renderSourceSelector: ({
      disabled,
      value,
      onChange,
    }: {
      disabled: boolean;
      value: Choice[];
      onChange: typeof latestChange;
    }) => {
      latestChange = onChange;
      return (
        <fieldset disabled={disabled} aria-label='对照原始需求'>
          {choices.map((choice) => (
            <label key={choice.submission_id}>
              <input
                type='checkbox'
                checked={value.some((item) => item.submission_id === choice.submission_id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, choice]
                      : value.filter((item) => item.submission_id !== choice.submission_id)
                  )
                }
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
      );
    },
  });
  return (value: Choice[]) => latestChange(value);
}

beforeEach(() => restoreScope({ items: [], views: [], origin: 'turn' }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('freezes explicitly selected IDs in order across a failed session retry without sending labels as content', async () => {
  const f = setup({ fail: 'session' });
  const lateSelection = addSelector(f);
  render(<VersionReview {...f.props} />);
  await ready();
  expect(
    panel()
      .getAllByRole('checkbox')
      .every((box) => !(box as HTMLInputElement).checked)
  ).toBe(true);
  fireEvent.click(panel().getByRole('checkbox', { name: choices[1]!.label }));
  fireEvent.click(panel().getByRole('checkbox', { name: choices[0]!.label }));
  await start();
  await screen.findByText(/审查请求失败/);
  expect(panel().getByRole('checkbox', { name: choices[1]!.label })).toBeDisabled();
  await act(async () => lateSelection([]));
  fireEvent.click(panel().getByRole('button', { name: '重试登记' }));
  await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
  const requests = f.calls.filter((call) => call.path.endsWith('/session'));
  expect(requests).toHaveLength(2);
  for (const request of requests)
    expect(request.body).toEqual({
      task: '检查事实出处与结构',
      input_revision_id: 'revision-old',
      source_submission_ids: [choices[1]!.submission_id, choices[0]!.submission_id],
    });
  expect(panel().getByRole('checkbox', { name: choices[1]!.label })).toBeChecked();
});

it('waits for the chosen original lookup before starting, and does not submit automatically when it resolves', async () => {
  const f = setup();
  let resolveSelection: (value: Choice[]) => void;
  const selection = new Promise<Choice[]>((resolve) => {
    resolveSelection = resolve;
  });
  Object.assign(f.adapter, {
    renderSourceSelector: ({
      disabled,
      onChange,
      onPendingChange,
    }: {
      disabled: boolean;
      onChange: (value: Choice[]) => void;
      onPendingChange?: (pending: boolean) => void;
    }) => (
      <button
        disabled={disabled}
        onClick={() => {
          onPendingChange?.(true);
          void selection.then((value) => {
            onChange(value);
            onPendingChange?.(false);
          });
        }}
      >
        选择原始需求
      </button>
    ),
  });
  render(<VersionReview {...f.props} />);
  await ready();
  fireEvent.change(panel().getByRole('textbox', { name: '明确审查任务' }), { target: { value: '核对原话' } });
  fireEvent.click(panel().getByRole('button', { name: '选择原始需求' }));
  const begin = panel().getByRole('button', { name: '开始审查' });
  expect(begin).toBeDisabled();
  fireEvent.click(begin);
  expect(f.calls.every((call) => call.body === undefined)).toBe(true);
  await act(async () => resolveSelection([choices[1]!]));
  await waitFor(() => expect(begin).toBeEnabled());
  expect(f.calls.every((call) => call.body === undefined)).toBe(true);
  expect(f.adapter.send).not.toHaveBeenCalled();
  fireEvent.click(begin);
  await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
  expect(f.calls.find((call) => call.path.endsWith('/session'))?.body?.source_submission_ids).toEqual([
    choices[1]!.submission_id,
  ]);
});

it('stops a review with a definitely rejected original before letting the user remove it and start again', async () => {
  const f = setup();
  addSelector(f);
  const fetchReview = globalThis.fetch;
  let rejectSource = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchReview(input, init);
      if (String(input).endsWith('/session') && rejectSource) {
        rejectSource = false;
        return json({ error: { code: 'REVIEW_SOURCE_UNAVAILABLE' } }, 404);
      }
      return response;
    })
  );
  render(<VersionReview {...f.props} />);
  await ready();
  fireEvent.click(panel().getByRole('checkbox', { name: choices[0]!.label }));
  await start();
  await panel().findByText(/原始需求不可用/);
  expect(f.getReview()?.status).toBe('cancelled');
  expect(f.adapter.cancel).not.toHaveBeenCalled();
  expect(f.adapter.create).not.toHaveBeenCalled();
  expect(panel().getByRole('textbox', { name: '明确审查任务' })).toHaveValue('检查事实出处与结构');
  fireEvent.click(panel().getByRole('checkbox', { name: choices[0]!.label }));
  fireEvent.click(panel().getByRole('button', { name: '开始审查' }));
  await waitFor(() => expect(f.adapter.send).toHaveBeenCalledTimes(1));
  expect(f.calls.filter((call) => call.path === '/bridge/v1/reviews')).toHaveLength(2);
  expect(f.calls.findLast((call) => call.path.endsWith('/session'))?.body?.source_submission_ids).toEqual([]);
});

it.each(['ownerKey', 'resourceId', 'revisionId'] as const)(
  'keeps a selection on close/reopen but clears it when %s changes',
  async (field) => {
    const f = setup();
    addSelector(f);
    const view = render(<VersionReview {...f.props} />);
    await ready();
    fireEvent.click(panel().getByRole('checkbox', { name: choices[0]!.label }));
    view.rerender(<VersionReview {...f.props} open={false} />);
    view.rerender(<VersionReview {...f.props} open />);
    await ready();
    expect(panel().getByRole('checkbox', { name: choices[0]!.label })).toBeChecked();
    view.rerender(<VersionReview {...f.props} {...{ [field]: 'new-identity' }} />);
    await ready();
    expect(panel().getByRole('checkbox', { name: choices[0]!.label })).not.toBeChecked();
    expect(f.adapter.create).not.toHaveBeenCalled();
  }
);

it('shows frozen originals collapsed and escaped, and reuses only that explicit selection without starting', async () => {
  const original = '原始要求：\n<img src=x onerror=alert(1)>\n不要增加自动定位。';
  const f = setup({
    recovered: {
      ...base(),
      status: 'completed',
      task: '检查事实',
      source_inputs: [
        {
          submission_id: choices[1]!.submission_id,
          conversation_id: 'old-conversation',
          message_id: 'old-message',
          content: original,
          content_sha256: 'a'.repeat(64),
        },
      ],
    },
  });
  addSelector(f);
  render(<VersionReview {...f.props} />);
  await ready();
  const summary = panel().getByText('选中的原始需求（1 条）', { selector: 'summary' });
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(summary);
  expect(summary.closest('details')?.textContent).toContain(original);
  expect(summary.closest('details')?.querySelector('img')).toBeNull();
  expect(panel().getByRole('checkbox', { name: choices[1]!.label })).not.toBeChecked();
  fireEvent.click(panel().getByText('审查时的要求', { selector: 'summary' }));
  fireEvent.click(panel().getByRole('button', { name: '沿用此要求' }));
  expect(panel().getByRole('textbox', { name: '明确审查任务' })).toHaveValue('检查事实');
  expect(panel().getByRole('checkbox', { name: choices[1]!.label })).toBeChecked();
  fireEvent.click(panel().getByRole('checkbox', { name: choices[1]!.label }));
  expect(panel().getByRole('checkbox', { name: choices[1]!.label })).not.toBeChecked();
  expect(f.calls.every((call) => call.body === undefined)).toBe(true);
  expect(f.adapter.create).not.toHaveBeenCalled();
  expect(f.adapter.send).not.toHaveBeenCalled();
});

it.each(['missing-content', 'bad-hash', 'duplicate', 'too-long'])(
  'rejects a %s original snapshot at the HTTP boundary',
  async (fault) => {
    const source = {
      submission_id: choices[0]!.submission_id,
      conversation_id: 'chat',
      message_id: 'message',
      content: '明确的用户原话',
      content_sha256: 'a'.repeat(64),
    };
    const bad =
      fault === 'missing-content'
        ? { ...source, content: '' }
        : fault === 'bad-hash'
          ? { ...source, content_sha256: 'untrusted' }
          : fault === 'too-long'
            ? { ...source, content: '字'.repeat(20001) }
            : source;
    const f = setup({
      recovered: {
        ...base(),
        status: 'completed',
        task: '检查事实',
        source_inputs: fault === 'duplicate' ? [bad, bad] : [bad],
      },
    });
    render(<VersionReview {...f.props} />);
    await screen.findByText(/审查请求失败/);
    expect(panel().queryByText('审查时的要求', { selector: 'summary' })).toBeNull();
    expect(f.adapter.create).not.toHaveBeenCalled();
  }
);
