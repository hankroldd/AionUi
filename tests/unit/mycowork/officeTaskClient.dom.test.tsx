/**
 * 文件：tests/unit/mycowork/officeTaskClient.dom.test.tsx
 * 职责：验证办公提交重放、网络失败与受理后保留续写的提交ID换代。
 * 边界：只替换HTTP边界，使用真实客户端、草稿hook与控制器；数据均为虚构。
 * 关联：ADR-0025第二片；PR03 plan §10 B。
 */
import { useState } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DraftDocument, DraftState, TaskRun } from '@mycowork/contracts';
import { getScope, resetAccountScopedState, restoreScope, usePersistentDraft } from '@mycowork/ui';
import {
  lookupOfficeTask,
  officeTaskAccepted,
  stopOfficeTask,
  submitOfficeTask,
} from '@mycowork/ui/task-send/index.ts';

const empty = (): DraftState => ({ content: '', files: [], sessions: [] });
const submission = 'adfd2c75-f525-4df0-abda-80f0eba443d1';
const document = (state: DraftState, revision = 1): DraftDocument => ({
  draft_id: 'draft-office-fixture',
  input_location: 'guid',
  revision,
  submission_id: submission,
  state,
  updated_at: '2026-10-15T12:00:00Z',
});
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
let saved: DraftDocument;
let task: TaskRun | null;
let loseAck: boolean;
let lookupFailure: number | undefined;
let postFailure: number | undefined;
let delayLookup: (() => Promise<void>) | undefined;
const requests: Array<{ path: string; init?: RequestInit }> = [];
const owner = { ownerKey: 'owner-office', isCurrent: () => true };
const accepted = (): TaskRun => ({
  run_id: 'run-office-fixture',
  submission_id: submission,
  status: 'running',
  created_at: '2026-10-15T12:00:00Z',
  draft_id: saved.draft_id,
  draft_revision: saved.revision,
  conversation_id: 'conversation-office-fixture',
  msg_id: 'user-msg-fixture',
  turn_id: 'host-turn-fixture',
  delivery_phase: 'accepted',
});
const count = (path: string) => requests.filter((request) => request.path === path).length;

it('会话最新任务查询只带conversation_id，并核对响应归属', async () => {
  task = accepted();
  expect(await lookupOfficeTask(owner, { conversationId: 'conversation-office-fixture' })).toEqual(task);
  expect(requests[0].path).toBe('/bridge/v1/tasks/lookup?conversation_id=conversation-office-fixture');
  expect(requests[0].init?.headers).toMatchObject({ 'x-mycowork-draft-owner': 'owner-office' });
  task = { ...task, conversation_id: 'different-conversation' };
  await expect(lookupOfficeTask(owner, { conversationId: 'conversation-office-fixture' })).rejects.toThrow('任务关联');
});

it('会话最新任务查询前后仍核对账号，身份变化不使用返回结果', async () => {
  task = accepted();
  let current = true;
  delayLookup = async () => {
    current = false;
  };
  await expect(
    lookupOfficeTask({ ...owner, isCurrent: () => current }, { conversationId: 'conversation-office-fixture' })
  ).rejects.toThrow('登录状态已变化');
});

beforeEach(() => {
  restoreScope({ items: [], views: [], origin: 'turn' });
  saved = document({ ...empty(), content: '已提交的虚构输入' });
  task = null;
  loseAck = false;
  lookupFailure = undefined;
  postFailure = undefined;
  delayLookup = undefined;
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      requests.push({ path, init });
      if (path.includes('/drafts/')) {
        if (init?.method !== 'PUT') return reply(200, saved);
        const input = JSON.parse(String(init.body));
        if (input.expected_revision !== saved.revision) return reply(409, { error: { code: 'REVISION_CONFLICT' } });
        saved = { ...document(input.state, saved.revision + 1), submission_id: input.submission_id };
        return reply(200, saved);
      }
      if (path.startsWith('/bridge/v1/tasks/lookup?')) {
        if (delayLookup) await delayLookup();
        if (lookupFailure) return reply(lookupFailure, { error: { code: 'UPSTREAM_UNAVAILABLE' } });
        return task ? reply(200, task) : reply(404, { error: { code: 'NOT_FOUND' } });
      }
      if (path === '/bridge/v1/context-plans')
        return reply(201, {
          plan_id: 'plan-office',
          status: 'EMPTY_SCOPE',
          brief: { explicit_empty: true, groups: [] },
        });
      if (path.endsWith('/tokens'))
        return reply(201, {
          workspace: '/fixture/office',
          session_mcp_server: {
            id: 'mycowork_bridge',
            name: 'mycowork_bridge',
            transport: { type: 'streamable_http', url: 'http://fixture.invalid/bridge/mcp', headers: {} },
          },
        });
      if (path.endsWith('/context'))
        return reply(200, {
          plan_id: 'plan-office',
          brief: { groups: [], policy: { strict: false, web: 'off' } },
          used: [],
          withheld: 0,
          superseded: false,
        });
      if (path === '/bridge/v1/tasks') {
        if (postFailure) return reply(postFailure, { error: { code: 'UPSTREAM_UNAVAILABLE' } });
        const input = JSON.parse(String(init?.body));
        task = { ...accepted(), draft_revision: input.draft_revision, submission_id: input.submission_id };
        if (loseAck) {
          loseAck = false;
          throw new TypeError('虚构受理回包丢失');
        }
        return reply(202, task);
      }
      if (path.endsWith('/stop')) return reply(200, { ...task!, status: 'cancelled', stop_confirmed: false });
      throw new Error(`未定义的虚构HTTP路径：${path}`);
    })
  );
});
afterEach(() => {
  cleanup();
  resetAccountScopedState();
  vi.unstubAllGlobals();
});

function useFixtureDraft() {
  const [state, setState] = useState<DraftState>(empty);
  const draft = usePersistentDraft({ ownerKey: 'owner-office', inputLocation: 'guid', state, onRestore: setState });
  return { draft, state, setState };
}

it('已受理旧版本后保留用户续写，并为下一轮生成新submission_id', async () => {
  const { result } = renderHook(useFixtureDraft);
  await waitFor(() => expect(result.current.draft.ready).toBe(true));
  const original = saved;
  act(() => result.current.setState({ ...result.current.state, content: '下一轮的虚构续写' }));
  await act(async () => {
    await result.current.draft.settleTaskSubmission(original, original.revision, empty());
  });
  expect(result.current.state.content).toBe('下一轮的虚构续写');
  expect(saved.state.content).toBe('下一轮的虚构续写');
  expect(saved.submission_id).not.toBe(original.submission_id);
});

it('受理当前原版本才清输入，并保存下一轮UUID', async () => {
  const { result } = renderHook(useFixtureDraft);
  await waitFor(() => expect(result.current.draft.ready).toBe(true));
  const original = saved;
  await act(async () =>
    expect(await result.current.draft.settleTaskSubmission(original, original.revision, empty())).toBe(true)
  );
  expect(result.current.state.content).toBe('');
  expect(saved.submission_id).not.toBe(original.submission_id);
});

it('刷新查回更旧受理版本时不清当前草稿，仍换下一轮UUID', async () => {
  saved = document({ ...empty(), content: '已保存的下一轮输入' }, 3);
  const { result } = renderHook(useFixtureDraft);
  await waitFor(() => expect(result.current.draft.ready).toBe(true));
  const current = saved;
  await act(async () => expect(await result.current.draft.settleTaskSubmission(current, 1, empty())).toBe(false));
  expect(saved.state.content).toBe('已保存的下一轮输入');
  expect(saved.submission_id).not.toBe(current.submission_id);
});

it('首次场景发送保留精确草稿指针和拼接正文，所有任务请求携捕获owner', async () => {
  saved.state.choices = { assistant_id: 'mycowork-scene-ppt', backend: 'aionrs' };
  const result = await submitOfficeTask({
    ...owner,
    draft: saved,
    deliveryContent: '> 虚构引用\n\n已提交的虚构输入',
    lang: 'en-US',
  });
  expect(result?.replayed).toBe(false);
  expect(officeTaskAccepted(result!.run)).toBe(true);
  const posted = requests.find((request) => request.path === '/bridge/v1/tasks')!;
  expect(JSON.parse(String(posted.init?.body))).toEqual({
    submission_id: submission,
    draft_id: saved.draft_id,
    draft_revision: 1,
    draft_version: '1',
    context_plan_id: 'plan-office',
    capability_profile: 'office',
    locale: 'en-US',
    delivery_content: '> 虚构引用\n\n已提交的虚构输入',
  });
  for (const request of requests.filter(({ path }) => path.startsWith('/bridge/v1/tasks')))
    expect(request.init?.headers).toMatchObject({ 'x-mycowork-draft-owner': owner.ownerKey });
});

it('受理后ACK丢失不自动重投；刷新同键先查原run，不再新建计划或消息', async () => {
  saved.state.choices = { assistant_id: 'mycowork-scene-ppt', backend: 'aionrs' };
  loseAck = true;
  await expect(submitOfficeTask({ ...owner, draft: saved })).rejects.toThrow();
  expect(saved.submission_id).toBe(submission);
  const found = await submitOfficeTask({ ...owner, draft: saved });
  expect(found).toEqual({ run: task, replayed: true });
  expect(count('/bridge/v1/tasks')).toBe(1);
  expect(count('/bridge/v1/context-plans')).toBe(1);
});

it('查找任务的503不是404，不建计划、不降级为普通发送', async () => {
  saved.state.choices = { assistant_id: 'mycowork-scene-ppt' };
  lookupFailure = 503;
  await expect(submitOfficeTask({ ...owner, draft: saved })).rejects.toThrow();
  expect(count('/bridge/v1/tasks')).toBe(0);
  expect(count('/bridge/v1/context-plans')).toBe(0);
});

it('lookup等待期间范围被重新选择时拒发，不把原输入配到新范围', async () => {
  let release!: () => void;
  delayLookup = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const sending = submitOfficeTask({ ...owner, draft: saved });
  restoreScope({ items: [], views: [], origin: 'turn', projectId: 'new-project-fixture' });
  release();
  await expect(sending).rejects.toThrow('资料范围已变化');
  expect(count('/bridge/v1/tasks')).toBe(0);
  expect(count('/bridge/v1/context-plans')).toBe(0);
  expect(saved.state.content).toBe('已提交的虚构输入');
});

it('carried-only任务POST前失败后重试仍沿原计划，不退为普通发送', async () => {
  restoreScope({ items: [], views: [], origin: 'turn', carriedPlanId: 'carried-office-fixture' });
  saved.state.scope = { ...getScope() };
  postFailure = 503;
  await expect(submitOfficeTask({ ...owner, draft: saved })).rejects.toThrow();
  expect(getScope().carriedPlanId).toBe('carried-office-fixture');
  postFailure = undefined;
  expect((await submitOfficeTask({ ...owner, draft: saved }))?.run.delivery_phase).toBe('accepted');
  expect(count('/bridge/v1/context-plans')).toBe(0);
  expect(count('/bridge/v1/tasks')).toBe(2);
  for (const request of requests.filter(({ path }) => path === '/bridge/v1/tasks'))
    expect(JSON.parse(String(request.init?.body)).context_plan_id).toBe('carried-office-fixture');
});

it('查到unknown或failed只返回原记录，不重投、不宣称可清输入', async () => {
  for (const phase of ['unknown', 'rejected'] as const) {
    task = { ...accepted(), delivery_phase: phase, status: phase === 'unknown' ? 'recovery_required' : 'failed' };
    const result = await submitOfficeTask({ ...owner, draft: saved });
    expect(result?.replayed).toBe(true);
    expect(officeTaskAccepted(result!.run)).toBe(false);
    expect(saved.state.content).toBe('已提交的虚构输入');
    expect(saved.submission_id).toBe(submission);
  }
  expect(count('/bridge/v1/tasks')).toBe(0);
});

it('后续发送复用当前会话计划，不重新建计划', async () => {
  await submitOfficeTask({ ...owner, draft: saved, conversationId: 'conversation-office-fixture' });
  expect(count('/bridge/v1/context-plans')).toBe(0);
  expect(count('/bridge/v1/conversations/conversation-office-fixture/context')).toBe(1);
  expect(JSON.parse(String(requests.find(({ path }) => path === '/bridge/v1/tasks')!.init?.body)).conversation_id).toBe(
    'conversation-office-fixture'
  );
});

it('普通无范围、空输入及非aionrs不进入任务投递', async () => {
  expect(await submitOfficeTask({ ...owner, draft: saved })).toBeNull();
  expect(await submitOfficeTask({ ...owner, draft: document(empty()) })).toBeNull();
  expect(
    await submitOfficeTask({ ...owner, draft: document({ ...saved.state, choices: { backend: 'acp' } }) })
  ).toBeNull();
  expect(count('/bridge/v1/tasks')).toBe(0);
});

it('旧账号失效阻止查询和投递，同键错草稿不关联到当前输入', async () => {
  await expect(submitOfficeTask({ ...owner, isCurrent: () => false, draft: saved })).rejects.toThrow('登录状态已变化');
  expect(requests).toHaveLength(0);
  task = { ...accepted(), draft_id: 'another-fixture-draft' };
  await expect(submitOfficeTask({ ...owner, draft: saved })).rejects.toThrow('另一份草稿');
  expect(count('/bridge/v1/tasks')).toBe(0);
});

it('按确切会话轮次查回停止，HTTP200不冒充stop_confirmed', async () => {
  task = accepted();
  const found = await lookupOfficeTask(owner, { conversationId: task.conversation_id!, turnId: task.turn_id! });
  const stopped = await stopOfficeTask(owner, found!.run_id);
  expect(stopped.stop_confirmed).toBe(false);
  expect(stopped.status).toBe('cancelled');
  expect(JSON.parse(String(requests.find(({ path }) => path.endsWith('/stop'))!.init?.body))).toEqual({});
});
