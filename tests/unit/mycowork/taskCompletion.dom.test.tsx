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
import type { TaskRun as CompletionRun } from '@mycowork/contracts';
import { TaskCompletion } from '@mycowork/ui';

vi.mock('@/common/adapter/httpBridge', () => ({ wsEmitter: () => ({ on: () => () => {} }) }));
const { watchTurnEnd, watchTurnEnded } = await import('@/renderer/mycowork-task-send');

const owner = { ownerKey: 'u1', isCurrent: () => true };
const base = {
  run_id: 'r1',
  submission_id: 's1',
  created_at: '2026-10-17T00:00:00Z',
  conversation_id: 'c1',
  turn_id: 't1',
};
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
  const t = (run: CompletionRun) => render(<TaskCompletion run={run} lang='zh-CN' onAccept={async () => {}} />);
  t(mk({ turn_end: null }));
  expect(screen.queryByText('标记本轮完成')).toBeNull();
  cleanup();
  t(mk({ turn_end: 'ok' }));
  expect(screen.getByText('本轮回复已结束，可继续补充要求')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '标记本轮完成' })).toBeInTheDocument();
  cleanup();
  t(mk({ turn_end: 'ok', status: 'failed' }));
  expect(screen.queryByRole('button')).toBeNull();
});

it('turn.completed 无state时只重读run并显示待确认，不转发turn-end', async () => {
  const onEnded = vi.fn();
  let cb: (raw: Record<string, unknown>) => void = () => {};
  watchTurnEnded(owner, base, onEnded, (c) => ((cb = c), () => {}));
  const calls0: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls0.push(url);
    return new Response(JSON.stringify(mk({})), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  cb({ conversation_id: 'c2', turn_id: 't1', status: 'finished' });
  cb({ conversation_id: 'c1', turn_id: 't1', status: 'finished' });
  cb({ conversation_id: 'c1', turn_id: 't1', status: 'finished' });
  await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
  expect(calls0).toEqual(['/bridge/v1/tasks/r1']);
  expect(calls).toHaveLength(0);
  render(<TaskCompletion run={mk({})} turnEnded lang='zh-CN' onAccept={async () => {}} />);
  expect(screen.getByText('本轮回复已结束，可继续补充要求')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '标记本轮完成' })).toBeInTheDocument();
});

it('接受遇到409：隐藏按钮，显示本轮尚未结束', async () => {
  const onAccept = vi.fn(async () => {
    throw new Error('REVISION_CONFLICT');
  });
  render(<TaskCompletion run={mk({})} turnEnded lang='zh-CN' onAccept={onAccept} />);
  fireEvent.click(screen.getByRole('button', { name: '标记本轮完成' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('本轮尚未结束'));
  expect(screen.queryByRole('button')).toBeNull();
});

it('接受后显示已完成 / 完成有提醒（zh 与 en）', async () => {
  const onAccept = vi.fn(async () => {});
  const { rerender } = render(<TaskCompletion run={mk({ turn_end: 'ok' })} lang='en' onAccept={onAccept} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mark this turn complete' }));
  expect(onAccept).toHaveBeenCalledWith('r1');
  rerender(<TaskCompletion run={mk({ status: 'completed' })} lang='zh-CN' onAccept={onAccept} />);
  expect(screen.getByRole('status')).toHaveTextContent('本轮已标记完成');
  rerender(<TaskCompletion run={mk({ status: 'completed_with_warnings' })} lang='zh-CN' onAccept={onAccept} />);
  expect(screen.getByRole('status')).toHaveTextContent('本轮已标记完成（未登记文件成果）');
  rerender(<TaskCompletion run={mk({ status: 'completed' })} lang='en' onAccept={onAccept} />);
  expect(screen.getByRole('status')).toHaveTextContent('Turn marked complete');
});

it('TURN_ERROR 显示轮次出错，其他失败仅显示未能完成', () => {
  render(
    <TaskCompletion
      run={mk({ status: 'failed', delivery_error: 'TURN_ERROR' })}
      lang='zh-CN'
      onAccept={async () => {}}
    />
  );
  expect(screen.getByRole('status')).toHaveTextContent('本轮运行出错（原因未知）');
  cleanup();
  const { container } = render(
    <TaskCompletion run={mk({ status: 'failed', delivery_error: 'X' })} lang='zh-CN' onAccept={async () => {}} />
  );
  expect(container).toHaveTextContent('本轮任务未能完成');
  expect(container).not.toHaveTextContent('本轮运行出错');
});

it('取消订阅后，在途的重读返回也不回调（新一轮或卸载不被旧结果覆盖）', async () => {
  const onEnded = vi.fn();
  let cb: (raw: { conversation_id?: string; turn_id?: string; status?: string }) => void = () => {};
  let release: () => void = () => {};
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((r) => {
        release = () =>
          r(new Response(JSON.stringify(mk({})), { status: 200, headers: { 'content-type': 'application/json' } }));
      })
  );
  const stop = watchTurnEnded(owner, base, onEnded, (c) => ((cb = c), () => {}));
  cb({ conversation_id: 'c1', turn_id: 't1', status: 'finished' });
  stop();
  release();
  await new Promise((r) => setTimeout(r, 20));
  expect(onEnded).not.toHaveBeenCalled();
});

it('watchTurnEnd：取消订阅后，在途的转发返回也不回调', async () => {
  const onRun = vi.fn();
  let cb: (raw: Record<string, unknown>) => void = () => {};
  let release: () => void = () => {};
  vi.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((r) => {
        release = () =>
          r(new Response(JSON.stringify(mk({})), { status: 200, headers: { 'content-type': 'application/json' } }));
      })
  );
  const stop = watchTurnEnd(owner, base, onRun, (c) => ((cb = c), () => {}));
  cb({ conversation_id: 'c1', turn_id: 't1', state: 'ai_waiting_input' });
  stop();
  release();
  await new Promise((r) => setTimeout(r, 20));
  expect(onRun).not.toHaveBeenCalled();
});

it('run 缺 turn_id 时不订阅，无 id 事件不触发转发', () => {
  const subscribe = vi.fn(() => () => {});
  const noTurn = { run_id: 'r1', conversation_id: 'c1' };
  watchTurnEnd(owner, noTurn, vi.fn(), subscribe);
  watchTurnEnded(owner, noTurn, vi.fn(), subscribe);
  expect(subscribe).not.toHaveBeenCalled();
});
