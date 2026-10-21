/**
 * 文件：tests/unit/mycowork/officeTaskSend.fixture.ts
 * 职责：提供办公发送DOM测试的虚构HTTP、IPC响应和请求记录。
 * 边界：不导入发送框、任务客户端或控制器，不替换被测业务逻辑。
 * 关联：ADR-0025第二片；officeTaskSend.dom.test.tsx。
 */
import type { DraftDocument, TaskRun } from '@mycowork/contracts';
import type { TConversationRuntimeSummary } from '@/common/config/storage';

export const idle = (): TConversationRuntimeSummary => ({
  state: 'idle',
  turn_id: null,
  has_task: false,
  can_send_message: true,
  is_processing: false,
  pending_confirmations: 0,
});
export const fixture = {
  calls: [] as Array<{ path: string; payload: unknown }>,
  requests: [] as Array<{ path: string; init?: RequestInit }>,
  runtime: idle(),
  conversation: 'conversation-native',
  scene: true,
  task: null as TaskRun | null,
  rejectTask: false,
  stopConfirmed: false,
  savedResults: undefined as TaskRun['saved_results'],
  delayPut: undefined as (() => Promise<void>) | undefined,
  docs: new Map<string, DraftDocument>(),
};
let sequence = 0;
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
export const count = (path: string) => fixture.requests.filter((request) => request.path === path).length;
export const ipcCount = (path: string) => fixture.calls.filter((request) => request.path === path).length;

/** 每个用例使用独立会话及HTTP记录，不借用前一用例的草稿或运行信号。 */
export function resetFixture(): void {
  fixture.conversation = `conversation-native-${++sequence}`;
  fixture.runtime = idle();
  fixture.scene = true;
  fixture.task = null;
  fixture.rejectTask = false;
  fixture.stopConfirmed = false;
  fixture.savedResults = undefined;
  fixture.delayPut = undefined;
  fixture.calls.length = 0;
  fixture.requests.length = 0;
  fixture.docs.clear();
}

/** 只替换公开IPC端点，所有原生hook、SendBox和任务用例保持真实实现。 */
export function createIPCFixture(): { ipcBridge: object } {
  const node = (path: string): object => {
    const children = new Map<PropertyKey, unknown>();
    return new Proxy(
      {},
      {
        get(_target, key) {
          if (key === 'then') return undefined;
          if (children.has(key)) return children.get(key);
          const value =
            key === 'on'
              ? () => () => {}
              : key === 'invoke'
                ? async (payload: unknown): Promise<unknown> => {
                    fixture.calls.push({ path, payload });
                    if (path === 'conversation.create') return { id: fixture.conversation };
                    if (path === 'conversation.get')
                      return {
                        id: fixture.conversation,
                        type: 'aionrs',
                        extra: { workspace: '/fixture/native' },
                        model: { id: 'provider-fixture', use_model: 'model-fixture' },
                        runtime: fixture.runtime,
                      };
                    if (path === 'conversation.ensureRuntime')
                      return { recovered: false, config_options: [], runtime: fixture.runtime };
                    if (path === 'conversation.sendMessage')
                      return {
                        msg_id: 'native-msg',
                        turn_id: 'native-turn',
                        runtime: {
                          ...fixture.runtime,
                          turn_id: 'native-turn',
                          is_processing: true,
                          can_send_message: false,
                          state: 'running',
                        },
                      };
                    if (path === 'conversation.stop') return { runtime: idle() };
                    if (path === 'conversation.getSlashCommands') return { commands: [] };
                    return [];
                  }
                : node(path ? `${path}.${String(key)}` : String(key));
          children.set(key, value);
          return value;
        },
      }
    );
  };
  return { ipcBridge: node('') };
}

/** 虚构合同响应支持CAS与任务受理；未知路径仅用于无关原生配置读取。 */
export async function fixtureFetch(raw: string, init?: RequestInit): Promise<Response> {
  const path = String(raw);
  fixture.requests.push({ path, init });
  if (path === '/api/auth/user')
    return reply(200, { success: true, user: { id: 'owner-native', username: 'fixture' } });
  if (path.includes('/drafts/')) {
    const location = decodeURIComponent(path.split('/drafts/')[1]);
    if (init?.method !== 'PUT')
      return fixture.docs.has(location)
        ? reply(200, fixture.docs.get(location))
        : reply(404, { error: { code: 'NOT_FOUND' } });
    if (fixture.delayPut) await fixture.delayPut();
    const input = JSON.parse(String(init.body));
    const previous = fixture.docs.get(location);
    if (input.expected_revision !== (previous?.revision ?? 0))
      return reply(409, { error: { code: 'REVISION_CONFLICT' } });
    const saved = {
      draft_id: `draft-${location}`,
      input_location: location,
      revision: (previous?.revision ?? 0) + 1,
      submission_id: input.submission_id,
      state: input.state,
      updated_at: '2026-10-15T12:00:00Z',
    };
    fixture.docs.set(location, saved);
    return reply(200, saved);
  }
  if (path.startsWith('/bridge/v1/tasks/lookup?')) {
    const query = new URL(path, 'http://fixture.invalid').searchParams;
    const matches =
      fixture.task &&
      (!query.has('submission_id') || fixture.task.submission_id === query.get('submission_id')) &&
      (!query.has('conversation_id') || fixture.task.conversation_id === query.get('conversation_id')) &&
      (!query.has('turn_id') || fixture.task.turn_id === query.get('turn_id'));
    return matches ? reply(200, fixture.task) : reply(404, { error: { code: 'NOT_FOUND' } });
  }
  if (path === '/bridge/v1/context-plans')
    return reply(201, { plan_id: 'plan-native', status: 'EMPTY_SCOPE', brief: { explicit_empty: true, groups: [] } });
  if (path.endsWith('/tokens'))
    return reply(201, {
      workspace: '/fixture/native',
      session_mcp_server: {
        id: 'mycowork_bridge',
        name: 'mycowork_bridge',
        transport: { type: 'streamable_http', url: 'http://fixture.invalid/bridge/mcp', headers: {} },
      },
    });
  if (path.endsWith('/context'))
    return fixture.scene
      ? reply(200, {
          plan_id: 'plan-native',
          brief: { groups: [], policy: { strict: false, web: 'off' } },
          used: [],
          withheld: 0,
          superseded: false,
        })
      : reply(404, { error: { code: 'NOT_FOUND' } });
  if (path === '/bridge/v1/tasks') {
    const body = JSON.parse(String(init?.body));
    fixture.runtime = {
      ...idle(),
      state: 'running',
      has_task: true,
      is_processing: true,
      can_send_message: false,
      turn_id: 'host-task-turn',
    };
    fixture.task = {
      run_id: 'run-native',
      submission_id: body.submission_id,
      draft_id: body.draft_id,
      draft_revision: body.draft_revision,
      created_at: '2026-10-15T12:00:00Z',
      status: fixture.rejectTask ? 'failed' : 'running',
      delivery_phase: fixture.rejectTask ? 'rejected' : 'accepted',
      ...(fixture.rejectTask ? { failure: { kind: 'rate_limited' } } : {}), // R068：拒绝带分型原因
      conversation_id: fixture.conversation,
      msg_id: 'user-task-msg',
      turn_id: 'host-task-turn',
      runtime: fixture.runtime,
    };
    return reply(202, fixture.task);
  }
  if (path.endsWith('/stop'))
    return reply(200, {
      ...fixture.task!,
      status: 'cancelled',
      stop_confirmed: fixture.stopConfirmed,
      ...(fixture.savedResults ? { saved_results: fixture.savedResults } : {}),
      runtime: fixture.stopConfirmed ? idle() : fixture.runtime,
    });
  if (path === '/bridge/v1/tasks/run-native') return reply(200, fixture.task);
  return reply(200, { success: true, data: [] });
}
