/**
 * 文件：tests/unit/mycowork/taskCompletion.dom.test.tsx
 * 职责：验证轮次结束转发的过滤（会话+轮次、显式state、每轮一次）与“接受/出错”显示。
 * 边界：仅替换fetch与WS订阅；转发逻辑、Bridge客户端与组件为真实代码。
 * 关联：R068 切片2；PR03。
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskCompletion, type CompletionRun } from '@mycowork/ui';

vi.mock('@/common/adapter/httpBridge', () => ({ wsEmitter: () => ({ on: () => () => {} }) }));
const { watchTurnEnd } = await import('@/renderer/mycowork-task-send');

const owner = { ownerKey: 'u1', isCurrent: () => true };
const base = { run_id: 'r1', submission_id: 's1', created_at: '2026-10-17T00:00:00Z', conversation_id: 'c1', turn_id: 't1' };
const mk = (o: Partial<CompletionRun>) => ({ ...base, status: 'running', ...o }) as CompletionRun;
const calls: Array<{ url: string; body: unknown }> = [];
let reply: Partial<CompletionRun> = {};
beforeEach(() => {
  calls.length = 0;
  reply = { turn_end: 'ok' };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(mk(reply)), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function feed(events: Array<Record<string, unknown>>) {
  const onRun = vi.fn();
  let cb: (raw: Record<string, unknown>) => void = () => {};
  watchTurnEnd(owner, base, onRun, (c) => ((cb = c), () => {}));
  events.forEach((e) => cb(e));
  return onRun;
}

it('只转发本会话+本轮的事件', async () => {
  const onRun = feed([
    { conversation_id: 'c2', turn_id: 't1', state: 'ai_waiting_input' },
    { conversation_id: 'c1', turn_id: 't9', state: 'ai_waiting_input' },
    { conversation_id: 'c1', turn_id: 't1', state: 'ai_waiting_input' },
  ]);
  await waitFor(() => expect(onRun).toHaveBeenCalled());
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain('/bridge/v1/tasks/r1/turn-end');
  expect(calls[0].body).toEqual({ turn_id: 't1', state: 'ai_waiting_input' });
});

it('没有显式state或state不认识时不转发', async () => {
  feed([
    { conversation_id: 'c1', turn_id: 't1', status: 'finished' },
    { conversation_id: 'c1', turn_id: 't1', state: 'unknown' },
    { conversation_id: 'c1', turn_id: 't1', state: 'ai_generating' },
  ]);
  await new Promise((r) => setTimeout(r, 20));
  expect(calls).toHaveLength(0);
});

it('每轮只转发一次', async () => {
  const ev = { conversation_id: 'c1', turn_id: 't1', state: 'error' };
  const onRun = feed([ev, ev, ev]);
  await waitFor(() => expect(onRun).toHaveBeenCalledTimes(1));
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({ turn_id: 't1', state: 'error' });
});

it('只有turn_end=ok且running才显示接受', () => {
  const t = (run: CompletionRun) => render(<TaskCompletion run={run} lang="zh-CN" onAccept={async () => {}} />);
  t(mk({ turn_end: null }));
  expect(screen.queryByText('接受')).toBeNull();
  cleanup();
  t(mk({ turn_end: 'ok' }));
  expect(screen.getByText('本轮已结束，待确认')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '接受' })).toBeInTheDocument();
  cleanup();
  t(mk({ turn_end: 'ok', status: 'failed' }));
  expect(screen.queryByRole('button')).toBeNull();
});

it('接受后显示已完成 / 完成有提醒（zh 与 en）', async () => {
  const onAccept = vi.fn(async () => {});
  const { rerender } = render(<TaskCompletion run={mk({ turn_end: 'ok' })} lang="en" onAccept={onAccept} />);
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  expect(onAccept).toHaveBeenCalledWith('r1');
  rerender(<TaskCompletion run={mk({ status: 'completed' })} lang="zh-CN" onAccept={onAccept} />);
  expect(screen.getByRole('status')).toHaveTextContent('已完成（你已确认）');
  rerender(<TaskCompletion run={mk({ status: 'completed_with_warnings' })} lang="zh-CN" onAccept={onAccept} />);
  expect(screen.getByRole('status')).toHaveTextContent('完成，有提醒：本轮未登记文件成果');
  rerender(<TaskCompletion run={mk({ status: 'completed' })} lang="en" onAccept={onAccept} />);
  expect(screen.getByRole('status')).toHaveTextContent('Completed (confirmed by you)');
});

it('TURN_ERROR 显示出错，其他失败不冒充', () => {
  render(<TaskCompletion run={mk({ status: 'failed', delivery_error: 'TURN_ERROR' })} lang="zh-CN" onAccept={async () => {}} />);
  expect(screen.getByRole('status')).toHaveTextContent('本轮运行出错（原因未知）');
  cleanup();
  const { container } = render(<TaskCompletion run={mk({ status: 'failed', delivery_error: 'X' })} lang="zh-CN" onAccept={async () => {}} />);
  expect(container).toBeEmptyDOMElement();
});
