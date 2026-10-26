/**
 * 文件：tests/unit/mycowork/taskCompletionLateAccept.dom.test.tsx
 * 职责：A529——“标记本轮完成”的迟到响应不得覆盖新轮、切换后的会话或已卸载组件的状态。
 * 边界：仅用可控 promise 替换 fetch；acceptOfficeRun、acceptOfficeTask、TaskCompletion 为真实代码，Host 复刻宿主的状态与接线。
 * 关联：A529；R068；task-states.md。
 */
import '@testing-library/jest-dom/vitest';
import React, { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TaskRun } from '@mycowork/contracts';
import { TaskCompletion } from '@mycowork/ui';

vi.mock('@/common/adapter/httpBridge', () => ({ wsEmitter: () => ({ on: () => () => {} }) }));
const { acceptOfficeRun } = await import('@/renderer/mycowork-task-send');

const mk = (o: Partial<TaskRun>) =>
  ({
    run_id: 'r1',
    submission_id: 's1',
    created_at: '2026-10-21T00:00:00Z',
    conversation_id: 'c1',
    turn_id: 't1',
    status: 'running',
    turn_end: 'ok',
    ...o,
  }) as TaskRun;
const json = (run: TaskRun) =>
  new Response(JSON.stringify(run), { status: 200, headers: { 'content-type': 'application/json' } });

let release: (r: Response) => void;
let handle: { setRun: (r: TaskRun | null) => void } | undefined;
const seen: Array<TaskRun | null> = [];

beforeEach(() => {
  seen.length = 0;
  vi.stubGlobal('fetch', () => new Promise<Response>((res) => (release = res)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 复刻 AionrsSendBox：officeRun 状态、conversation 最新值 ref、onAccept 接线。 */
function Host(p: { conversationId: string; initial: TaskRun }) {
  const [run, setRun] = useState<TaskRun | null>(p.initial);
  handle = { setRun };
  const conv = useRef(p.conversationId);
  conv.current = p.conversationId;
  const captured = p.conversationId;
  seen.push(run);
  return run ? (
    <TaskCompletion
      key={run.run_id}
      run={run}
      lang='zh-CN'
      onAccept={(id) =>
        acceptOfficeRun({ ownerKey: 'u1', isCurrent: () => true }, id, () => conv.current === captured, setRun)
      }
    />
  ) : null;
}
const click = () => fireEvent.click(screen.getByRole('button', { name: '标记本轮完成' }));
const settle = async (run: TaskRun) => act(async () => release(json(run)));

it('正控：没有切换时，迟到的接受结果正常生效', async () => {
  render(<Host conversationId='c1' initial={mk({})} />);
  click();
  await settle(mk({ status: 'completed' }));
  expect(screen.getByRole('status')).toHaveTextContent('本轮已标记完成');
});

it('点完成后新发送开始：旧 accept 迟到不覆盖新 run', async () => {
  render(<Host conversationId='c1' initial={mk({})} />);
  click();
  act(() => handle!.setRun(mk({ run_id: 'r2', turn_id: 't2' })));
  await settle(mk({ status: 'completed' }));
  expect(screen.getByRole('status')).toHaveTextContent('本轮回复已结束');
  expect(screen.getByRole('button', { name: '标记本轮完成' })).toBeEnabled();
});

it('点完成后恢复失效（run 被清空）：旧 accept 迟到不回填', async () => {
  render(<Host conversationId='c1' initial={mk({})} />);
  click();
  act(() => handle!.setRun(null));
  await settle(mk({ status: 'completed' }));
  expect(screen.queryByTestId('mycowork-task-completion')).toBeNull();
});

it('点完成后切换会话：旧结果不回填', async () => {
  const { rerender } = render(<Host conversationId='c1' initial={mk({})} />);
  click();
  rerender(<Host conversationId='c2' initial={mk({})} />);
  await settle(mk({ status: 'completed' }));
  expect(screen.getByRole('status')).toHaveTextContent('本轮回复已结束');
});

it('点完成后组件卸载：不报错也不回填', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { unmount } = render(<Host conversationId='c1' initial={mk({})} />);
  click();
  const before = seen.length;
  unmount();
  await settle(mk({ status: 'completed' }));
  expect(seen.length).toBe(before);
  expect(err).not.toHaveBeenCalled();
  err.mockRestore();
});
