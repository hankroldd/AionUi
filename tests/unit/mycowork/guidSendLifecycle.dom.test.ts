/**
 * 文件：tests/unit/mycowork/guidSendLifecycle.dom.test.ts
 * [mycowork] 职责：经真实 Guid 发送链核验计划、令牌与原生创建的异步生命周期。
 * 边界：账号、HTTP、原生创建与通知使用虚构数据；观察真实草稿 setter 与首条消息存储。
 * 关联：MyCowork docs/contracts/navigation-intent.md §3；PR11 B2b。
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { Message } from '@arco-design/web-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bindScopedConversation, prepareScopedSession, ScopeStrip, setScopeSelection } from '@mycowork/ui';
import { uploadFileRef } from '@/common/types/chatFile';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const boundary = vi.hoisted(() => ({
  actor: 'actor-a',
  create: vi.fn(),
  fetch: vi.fn(),
  afterPrepared: undefined as (() => void) | undefined,
}));
vi.mock('@mycowork/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mycowork/ui')>();
  return {
    ...actual,
    prepareScopedSession: async (...args: Parameters<typeof actual.prepareScopedSession>) => {
      const session = await actual.prepareScopedSession(...args);
      boundary.afterPrepared?.();
      return session;
    },
  };
});
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { create: { invoke: (...args: unknown[]) => boundary.create(...args) } } },
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));
vi.mock('swr', () => ({ mutate: vi.fn(() => Promise.resolve()) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));

type SendInput = GuidSendDeps & { ownerKey: string; locationKey: string };
const response = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const token = (actor: string) => ({
  token: `fixture-token-${actor}`,
  expires_at: '2026-10-03T23:00:00Z',
  mcp: {},
  workspace: `/fixtures/${actor}/workspace`,
  session_mcp_server: {
    id: 'mycowork_bridge',
    name: 'mycowork_bridge',
    transport: {
      type: 'streamable_http',
      url: 'https://fixture.invalid/bridge/mcp',
      headers: { Authorization: `Bearer fixture-token-${actor}` },
    },
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function input(backend: string): SendInput {
  return {
    ownerKey: 'actor-a',
    locationKey: 'guid-a',
    input: '应保留的虚构输入',
    files: [uploadFileRef('/fixtures/retained.md')],
    setInput: vi.fn(),
    setFiles: vi.fn(),
    dir: '',
    setDir: vi.fn(),
    loading: false,
    setLoading: vi.fn(),
    selectedAssistantId: 'fixture-assistant',
    selectedAssistantBackend: backend,
    selectedMode: 'default',
    selectedAcpModel: null,
    current_model: { use_model: 'fixture-model' } as NonNullable<GuidSendDeps['current_model']>,
    guidDisabledBuiltinSkills: undefined,
    guidEnabledSkills: undefined,
    availableMcpServers: [],
    selectedMcpServerIds: undefined,
    isGoogleAuth: false,
    setMentionOpen: vi.fn(),
    setMentionQuery: vi.fn(),
    setMentionSelectorOpen: vi.fn(),
    setMentionActiveIndex: vi.fn(),
    navigate: vi.fn(async () => {}),
    t: vi.fn((key: string) => key) as unknown as GuidSendDeps['t'],
    localeKey: 'zh-CN',
  };
}
function successfulHttp() {
  boundary.fetch.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/context-plans')
      return response(201, { plan_id: `plan_${boundary.actor}`, version: 1, status: 'OK' });
    if (url.endsWith('/tokens')) return response(201, token(url.includes('actor-b') ? 'actor-b' : 'actor-a'));
    return response(200, null);
  });
}
const bindings = () => boundary.fetch.mock.calls.filter(([url]) => String(url).endsWith('/plan'));
let showError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  boundary.actor = 'actor-a';
  boundary.afterPrepared = undefined;
  boundary.create.mockReset();
  boundary.fetch.mockReset();
  boundary.create.mockResolvedValue({ id: 'created_a' });
  vi.stubGlobal('fetch', boundary.fetch);
  showError = vi.spyOn(Message, 'error').mockImplementation(() => () => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  sessionStorage.clear();
  setScopeSelection([{ source_id: 'src_a', name: '虚构A', resource_ids: ['res_a'] }]);
  successfulHttp();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(['claude', 'aionrs'].flatMap((backend) => ['actor', 'route', 'unmount'].map((change) => [backend, change])))(
  '%s rejects delayed token after %s changes and preserves the draft',
  async (backend, change) => {
    const gate = deferred<ReturnType<typeof response>>();
    const normal = boundary.fetch.getMockImplementation()!;
    boundary.fetch.mockImplementation((url: string, options: unknown) =>
      url.endsWith('/tokens') ? gate.promise : normal(url, options)
    );
    const d = input(backend);
    const hook = renderHook((props: SendInput) => useGuidSend(props), { initialProps: d });
    act(() => hook.result.current.sendMessageHandler());
    await waitFor(() => expect(boundary.fetch.mock.calls.some(([url]) => String(url).endsWith('/tokens'))).toBe(true));
    if (change === 'unmount') hook.unmount();
    else {
      boundary.actor = change === 'actor' ? 'actor-b' : 'actor-a';
      hook.rerender({ ...d, ownerKey: boundary.actor, locationKey: change === 'route' ? 'guid-next' : 'guid-a' });
    }
    const loadingCalls = vi.mocked(d.setLoading).mock.calls.length;
    await act(async () => {
      gate.resolve(response(201, token('actor-a')));
    });
    expect(d.setLoading).toHaveBeenCalledTimes(loadingCalls);
    expect(d.setLoading).toHaveBeenLastCalledWith(change === 'unmount');
    expect(boundary.create).not.toHaveBeenCalled();
    expect(d.setInput).not.toHaveBeenCalled();
    expect(d.setFiles).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
    expect(bindings()).toEqual([]);
    expect(sessionStorage.length).toBe(0);
    expect(showError).not.toHaveBeenCalled();
  }
);

it.each(['claude', 'aionrs'])('%s permanently invalidates a send after actor A to B to A', async (backend) => {
  const gate = deferred<ReturnType<typeof response>>();
  const normal = boundary.fetch.getMockImplementation()!;
  boundary.fetch.mockImplementation((url: string, options: unknown) =>
    url.endsWith('/tokens') ? gate.promise : normal(url, options)
  );
  const d = input(backend);
  const hook = renderHook((props: SendInput) => useGuidSend(props), { initialProps: d });
  act(() => hook.result.current.sendMessageHandler());
  await waitFor(() => expect(boundary.fetch.mock.calls.some(([url]) => String(url).endsWith('/tokens'))).toBe(true));
  hook.rerender({ ...d, ownerKey: 'actor-b' });
  hook.rerender(d);
  await act(async () => {
    gate.resolve(response(201, token('actor-a')));
  });
  await waitFor(() => expect(d.setLoading).toHaveBeenLastCalledWith(false));
  expect(boundary.create).not.toHaveBeenCalled();
  expect(d.setInput).not.toHaveBeenCalled();
  expect(d.setFiles).not.toHaveBeenCalled();
  expect(d.navigate).not.toHaveBeenCalled();
});

it.each(['claude', 'aionrs'].flatMap((backend) => ['actor', 'route', 'scope'].map((change) => [backend, change])))(
  '%s checks %s again between real preparation completion and native create',
  async (backend, change) => {
    const d = input(backend);
    const hook = renderHook((props: SendInput) => useGuidSend(props), { initialProps: d });
    boundary.afterPrepared = () => {
      if (change === 'scope') setScopeSelection([{ source_id: 'src_b', name: '虚构B' }]);
      else
        hook.rerender({
          ...d,
          ownerKey: change === 'actor' ? 'actor-b' : d.ownerKey,
          locationKey: change === 'route' ? 'guid-b' : d.locationKey,
        });
    };
    act(() => hook.result.current.sendMessageHandler());
    await waitFor(() => expect(d.setLoading).toHaveBeenLastCalledWith(false));
    expect(boundary.create).not.toHaveBeenCalled();
    expect(d.setInput).not.toHaveBeenCalled();
    expect(d.setFiles).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
    await bindScopedConversation('stale_preparation', 'zh-CN');
    expect(bindings()).toEqual([]);
  }
);

it.each(['claude', 'aionrs'])('%s rejects a late plan before issuing a token for a changed actor', async (backend) => {
  const gate = deferred<ReturnType<typeof response>>();
  const normal = boundary.fetch.getMockImplementation()!;
  boundary.fetch.mockImplementation((url: string, options: unknown) =>
    url === '/bridge/v1/context-plans' ? gate.promise : normal(url, options)
  );
  const d = input(backend);
  const hook = renderHook((props: SendInput) => useGuidSend(props), { initialProps: d });
  act(() => hook.result.current.sendMessageHandler());
  await waitFor(() => expect(boundary.fetch).toHaveBeenCalledTimes(1));
  boundary.actor = 'actor-b';
  hook.rerender({ ...d, ownerKey: 'actor-b' });
  await act(async () => {
    gate.resolve(response(201, { plan_id: 'plan_actor-a', version: 1, status: 'OK' }));
  });
  await waitFor(() => expect(d.setLoading).toHaveBeenLastCalledWith(false));
  expect(boundary.fetch.mock.calls.some(([url]) => String(url).endsWith('/tokens'))).toBe(false);
  expect(boundary.create).not.toHaveBeenCalled();
  expect(d.setInput).not.toHaveBeenCalled();
  expect(d.setFiles).not.toHaveBeenCalled();
  expect(d.navigate).not.toHaveBeenCalled();
});

it.each(['claude', 'aionrs'])(
  '%s discards a token after deliberate scope reselection without clearing the new choice',
  async (backend) => {
    const gate = deferred<ReturnType<typeof response>>();
    const normal = boundary.fetch.getMockImplementation()!;
    boundary.fetch.mockImplementation((url: string, options: unknown) =>
      url.endsWith('/tokens') ? gate.promise : normal(url, options)
    );
    const d = input(backend);
    const hook = renderHook(() => useGuidSend(d));
    act(() => hook.result.current.sendMessageHandler());
    await waitFor(() => expect(boundary.fetch.mock.calls.some(([url]) => String(url).endsWith('/tokens'))).toBe(true));
    setScopeSelection([{ source_id: 'src_b', name: '虚构B' }]);
    await act(async () => {
      gate.resolve(response(201, token('actor-a')));
    });
    await waitFor(() => expect(d.setLoading).toHaveBeenLastCalledWith(false));
    expect(boundary.create).not.toHaveBeenCalled();
    expect(d.setInput).not.toHaveBeenCalled();
    expect(d.setFiles).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(expect.stringContaining('未发送'));
  }
);

it.each(['claude', 'aionrs'].flatMap((backend) => ['actor', 'route', 'unmount'].map((change) => [backend, change])))(
  '%s stops a late accepted native create result after %s changes',
  async (backend, change) => {
    const gate = deferred<{ id: string }>();
    boundary.create.mockReturnValue(gate.promise);
    const d = input(backend);
    const hook = renderHook((props: SendInput) => useGuidSend(props), { initialProps: d });
    act(() => hook.result.current.sendMessageHandler());
    await waitFor(() => expect(boundary.create).toHaveBeenCalledTimes(1));
    if (change === 'unmount') hook.unmount();
    else {
      boundary.actor = change === 'actor' ? 'actor-b' : 'actor-a';
      hook.rerender({ ...d, ownerKey: boundary.actor, locationKey: change === 'route' ? 'guid-next' : 'guid-a' });
    }
    const loadingCalls = vi.mocked(d.setLoading).mock.calls.length;
    await act(async () => {
      gate.resolve({ id: 'created_a' });
    });
    expect(d.setLoading).toHaveBeenCalledTimes(loadingCalls);
    expect(d.setLoading).toHaveBeenLastCalledWith(change === 'unmount');
    expect(bindings()).toEqual([]);
    expect(d.navigate).not.toHaveBeenCalled();
    expect(d.setInput).not.toHaveBeenCalled();
    expect(d.setFiles).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  }
);

it('discarding an old accepted create cannot remove a newer actor pending plan', async () => {
  const gate = deferred<{ id: string }>();
  boundary.create.mockReturnValue(gate.promise);
  const d = input('claude');
  const hook = renderHook((props: SendInput) => useGuidSend(props), { initialProps: d });
  act(() => hook.result.current.sendMessageHandler());
  await waitFor(() => expect(boundary.create).toHaveBeenCalledTimes(1));
  boundary.actor = 'actor-b';
  hook.rerender({ ...d, ownerKey: 'actor-b' });
  setScopeSelection([{ source_id: 'src_b', name: '虚构B' }]);
  await prepareScopedSession('zh-CN');
  await act(async () => {
    gate.resolve({ id: 'created_a' });
  });
  await waitFor(() => expect(d.setLoading).toHaveBeenLastCalledWith(false));
  expect(bindings()).toEqual([]);
  await bindScopedConversation('created_b', 'zh-CN');
  expect(bindings().map(([url, options]) => [url, JSON.parse(options.body)])).toEqual([
    ['/bridge/v1/conversations/created_b/plan', { plan_id: 'plan_actor-b' }],
  ]);
});

it.each(['claude', 'aionrs'])(
  '%s ordinary successful send still creates, binds and preserves the selected workspace',
  async (backend) => {
    const d = input(backend);
    d.dir = '/fixtures/chosen';
    const hook = renderHook(() => useGuidSend(d));
    await act(async () => {
      await hook.result.current.handleSend();
    });
    expect(boundary.create).toHaveBeenCalledTimes(1);
    expect(boundary.create.mock.calls[0][0].extra.workspace).toBe('/fixtures/chosen');
    expect(d.navigate).toHaveBeenCalledWith('/conversation/created_a');
  }
);

it.each(['claude', 'aionrs'])(
  '%s sends a real strict-shrink carried plan once after its scope reset',
  async (backend) => {
    const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
    const sources = ['a', 'b'].map((key) => ({
      source_id: `src_${key}`,
      name: `虚构${key.toUpperCase()}`,
      provider: 'weknora',
      counts,
    }));
    const normal = boundary.fetch.getMockImplementation()!;
    boundary.fetch.mockImplementation((url: string, options: unknown) => {
      if (url.endsWith('/context'))
        return Promise.resolve(
          response(200, {
            plan_id: 'plan_old',
            version: 1,
            status: 'OK',
            brief: {
              groups: sources.map((s) => ({ source_id: s.source_id, source_name: s.name, mode: 'whole', counts })),
              refs: {},
              policy: { strict: false, web: 'off' },
              excluded: 0,
              unauthorized: 0,
            },
            used: [],
            withheld: 0,
            superseded: false,
          })
        );
      if (url === '/bridge/v1/scopes') return Promise.resolve(response(200, { sources, projects: [] }));
      if (url === '/bridge/v1/tags') return Promise.resolve(response(200, { tags: [] }));
      if (url === '/bridge/v1/saved-views') return Promise.resolve(response(200, { views: [] }));
      if (url === '/bridge/v1/context-plans')
        return Promise.resolve(
          response(201, { plan_id: 'plan_shrunk', version: 2, status: 'OK', succession: 'shrunk' })
        );
      return normal(url, options);
    });
    const onStrictShrink = vi.fn();
    const strip = render(createElement(ScopeStrip, { lang: 'zh-CN', conversationId: 'fixture_old', onStrictShrink }));
    fireEvent.click(await screen.findByRole('button', { name: '更改范围' }));
    fireEvent.click(await screen.findByText('虚构B'));
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(onStrictShrink).toHaveBeenCalledOnce());
    strip.unmount();
    const d = input(backend);
    d.files = [];
    const hook = renderHook(() => useGuidSend(d));
    await act(async () => {
      await hook.result.current.handleSend();
    });
    expect(boundary.create).toHaveBeenCalledOnce();
    expect(boundary.fetch.mock.calls.filter(([url]) => url === '/bridge/v1/context-plans')).toHaveLength(1);
    expect(boundary.fetch.mock.calls.some(([url]) => url === '/bridge/v1/context-plans/plan_shrunk/tokens')).toBe(true);
    expect(bindings().map(([, options]) => JSON.parse(options.body))).toEqual([{ plan_id: 'plan_shrunk' }]);
    expect(d.navigate).toHaveBeenCalledWith('/conversation/created_a');
  }
);
