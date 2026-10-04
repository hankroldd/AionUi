/**
 * [mycowork] ADR-0011/0012: Guid send mount point. Scope selected → plan + token → conversation carries the
 * Bridge MCP server and workspace; no scope → unchanged; Bridge failure → no conversation is created.
 * After create, the conversation is bound to the plan (PUT .../plan); a failed bind only warns (T05c-2).
 * Only external boundaries are mocked (Bridge = fetch, aioncore = ipcBridge.conversation.create).
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import { prepareScopedSession, setScopeSelection } from '@mycowork/ui';
import { uploadFileRef } from '@/common/types/chatFile';
import { bindGuidScope, withGuidScope } from '@/renderer/mycowork-slots';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const createConversationMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: { conversation: { create: { invoke: (...args: unknown[]) => createConversationMock(...args) } } },
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('swr', () => ({ mutate: vi.fn(() => Promise.resolve()) }));
vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));

const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const SERVER = {
  id: 'mycowork_bridge',
  name: 'mycowork_bridge',
  transport: {
    type: 'streamable_http',
    url: 'http://127.0.0.1:25900/bridge/mcp',
    headers: { Authorization: 'Bearer t' },
  },
};
const TOKEN = {
  token: 't',
  expires_at: '2026-09-25T20:00:00Z',
  mcp: {},
  session_mcp_server: SERVER,
  workspace: '/data/ws/1',
};
const bridgeOk = () =>
  fetchMock
    .mockResolvedValueOnce(reply(201, { plan_id: 'plan_1', version: 1, status: 'OK' }))
    .mockResolvedValueOnce(reply(201, TOKEN));

const deps = (): GuidSendDeps =>
  ({
    input: 'hello',
    setInput: vi.fn(),
    files: [],
    setFiles: vi.fn(),
    dir: '',
    setDir: vi.fn(),
    setLoading: vi.fn(),
    loading: false,
    selectedAssistantId: 'assistant-1',
    selectedAssistantBackend: 'claude',
    selectedMode: 'default',
    selectedAcpModel: null,
    current_model: undefined,
    guidDisabledBuiltinSkills: undefined,
    guidEnabledSkills: undefined,
    availableMcpServers: [],
    selectedMcpServerIds: undefined,
    isGoogleAuth: false,
    setMentionOpen: vi.fn(),
    setMentionQuery: vi.fn(),
    setMentionSelectorOpen: vi.fn(),
    setMentionActiveIndex: vi.fn(),
    navigate: vi.fn(() => Promise.resolve()),
    t: vi.fn((key: string) => key),
    localeKey: 'zh-CN',
    ownerKey: 'fixture-user',
    locationKey: 'fixture-guid',
  }) as unknown as GuidSendDeps;

describe('withGuidScope', () => {
  beforeEach(() => {
    setScopeSelection([]);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns extra untouched and calls no Bridge API when no scope is selected', async () => {
    const extra = { workspace: '', custom_workspace: false, selected_session_mcp_servers: [] };
    await expect(withGuidScope(extra)).resolves.toBe(extra);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('freezes a plan for the chosen knowledge bases as JSON, then issues a token for that plan', async () => {
    setScopeSelection([
      { source_id: 'src_a', name: 'A' },
      { source_id: 'src_b', name: 'B' },
    ]);
    bridgeOk();
    await withGuidScope({ workspace: '', custom_workspace: false });
    const [planUrl, planInit] = fetchMock.mock.calls[0];
    expect(planUrl).toBe('/bridge/v1/context-plans');
    expect(planInit.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(planInit.body)).toEqual({
      scopes: [
        { selector: 'knowledge_base', id: 'src_a' },
        { selector: 'knowledge_base', id: 'src_b' },
      ],
      use_project_defaults: false,
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/bridge/v1/context-plans/plan_1/tokens');
  });

  it('sends knowledge-base narrowing (tags, picked files) and smart groups as selectors; zero picked files never becomes the whole base (D144, R010)', async () => {
    setScopeSelection(
      [
        { source_id: 'src_a', name: 'A', tag_ids: ['tag_1'] },
        { source_id: 'src_b', name: 'B', resource_ids: ['res_1', 'res_2'] },
        { source_id: 'src_c', name: 'C', tag_ids: [], resource_ids: [] },
      ],
      [{ view_id: 'view_1', name: 'G' }]
    );
    bridgeOk();
    await withGuidScope({ workspace: '', custom_workspace: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).scopes).toEqual([
      { selector: 'knowledge_base', id: 'src_a', tag_ids: ['tag_1'] },
      { selector: 'knowledge_base', id: 'src_b', resource_ids: ['res_1', 'res_2'] },
      { selector: 'saved_view', id: 'view_1' },
    ]);
  });

  it('appends the Bridge MCP server to existing session servers and uses the Bridge workspace', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    bridgeOk();
    const builtin = { id: 'builtin', name: 'b', transport: { type: 'stdio' as const, command: 'x' } };
    const out = await withGuidScope({
      workspace: '',
      custom_workspace: false,
      selected_session_mcp_servers: [builtin],
    });
    expect(out.selected_session_mcp_servers).toEqual([builtin, SERVER]);
    expect(out).toMatchObject({ workspace: '/data/ws/1', custom_workspace: true });
  });

  it('keeps a workspace the user picked', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    bridgeOk();
    const out = await withGuidScope({ workspace: '/home/me/proj', custom_workspace: true });
    expect(out).toMatchObject({ workspace: '/home/me/proj', custom_workspace: true });
  });

  it('rejects with a localized "not sent" error when the Bridge is unavailable', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    fetchMock.mockResolvedValueOnce(reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } }));
    await expect(withGuidScope({})).rejects.toThrow('未发送：资料服务暂不可用，请稍后重试');
  });

  it('rejects instead of sending with an empty scope', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    fetchMock.mockResolvedValueOnce(reply(201, { plan_id: 'plan_1', version: 1, status: 'EMPTY_SCOPE' }));
    // D144：按标签/挑选收窄后为空也一样拒发，并说明不会退回整个知识库
    await expect(withGuidScope({})).rejects.toThrow(
      '所选范围里没有可用的文件（按标签或挑选收窄后为空时不会退回整个知识库）'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('binds the next created conversation to the frozen plan with a JSON PUT', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    bridgeOk();
    fetchMock.mockResolvedValueOnce(reply(200, null));
    await withGuidScope({});
    await bindGuidScope('conv-9');
    const [url, init] = fetchMock.mock.calls[2];
    expect(url).toBe('/bridge/v1/conversations/conv-9/plan');
    expect(init).toMatchObject({ method: 'PUT', headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(init.body)).toEqual({ plan_id: 'plan_1' });
    // bound once: a second call has nothing pending
    await bindGuidScope('conv-10');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not bind a plan left over from an earlier send once the scope is cleared', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    bridgeOk();
    await withGuidScope({});
    setScopeSelection([]);
    await withGuidScope({});
    await bindGuidScope('conv-plain');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a token response that is not a streamable_http MCP server', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    fetchMock
      .mockResolvedValueOnce(reply(201, { plan_id: 'plan_1', version: 1, status: 'OK' }))
      .mockResolvedValueOnce(
        reply(201, { ...TOKEN, session_mcp_server: { ...SERVER, transport: { ...SERVER.transport, type: 'stdio' } } })
      );
    await expect(withGuidScope({})).rejects.toThrow('资料范围处理失败（invalid token response）');
  });

  it('freezes every required selected file as evidence with strict scope and web off', async () => {
    setScopeSelection(
      [
        { source_id: 'src_a', name: 'A', resource_ids: ['res_1', 'res_2'] },
        { source_id: 'src_b', name: 'B', resource_ids: ['res_3'] },
      ],
      [],
      ['res_1', 'res_2', 'res_3']
    );
    bridgeOk();
    await withGuidScope({});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      use_project_defaults: false,
      scopes: [
        { selector: 'knowledge_base', id: 'src_a', resource_ids: ['res_1', 'res_2'] },
        { selector: 'knowledge_base', id: 'src_b', resource_ids: ['res_3'] },
      ],
      refs: ['res_1', 'res_2', 'res_3'].map((resource_id) => ({ resource_id, role: 'evidence' })),
      policy: { strict: true, web: 'off' },
    });
  });

  it('a deliberate reselection clears the old required-file gate and preserves ordinary 500-file scope semantics', async () => {
    const files = Array.from({ length: 500 }, (_, i) => `res_${i}`);
    setScopeSelection([{ source_id: 'src_a', name: 'A', resource_ids: ['res_1'] }], [], ['res_1']);
    setScopeSelection([{ source_id: 'src_b', name: 'B', resource_ids: files }]);
    bridgeOk();
    await withGuidScope({});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      use_project_defaults: false,
      scopes: [{ selector: 'knowledge_base', id: 'src_b', resource_ids: files }],
    });
  });

  it('rejects an empty required-file intent locally instead of returning plain chat', async () => {
    setScopeSelection([], [], []);
    await expect(withGuidScope({})).rejects.toThrow('未发送');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects additional materials before freezing a required-file plan and keeps the selected-file intent for retry', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A', resource_ids: ['res_1'] }], [], ['res_1']);
    bridgeOk();
    await expect(prepareScopedSession('zh-CN', true)).rejects.toThrow(
      '请移除未选中的附件后再用这些文件提问；输入已保留'
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await prepareScopedSession('zh-CN');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).refs).toEqual([{ resource_id: 'res_1', role: 'evidence' }]);
  });

  it('ordinary scope still permits additional materials without a required-file marker', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    bridgeOk();
    await expect(prepareScopedSession('en-US', true)).resolves.toMatchObject({ plan_id: 'plan_1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('refs');
  });
});

describe('useGuidSend with a selected scope', () => {
  beforeEach(() => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(reply(200, null)); // PUT .../plan after create
    vi.stubGlobal('fetch', fetchMock);
    createConversationMock.mockReset();
    createConversationMock.mockResolvedValue({ id: 'conv-1' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates the conversation with the Bridge MCP server and workspace', async () => {
    bridgeOk();
    const { result } = renderHook(() => useGuidSend(deps()));
    await act(async () => {
      await result.current.handleSend();
    });
    const extra = createConversationMock.mock.calls[0][0].extra;
    expect(extra.selected_session_mcp_servers).toEqual([SERVER]);
    expect(extra).toMatchObject({ workspace: '/data/ws/1', custom_workspace: true });
  });

  it('binds the created conversation id to the plan after create, before navigating', async () => {
    bridgeOk();
    const d = deps();
    const { result } = renderHook(() => useGuidSend(d));
    await act(async () => {
      await result.current.handleSend();
    });
    expect(fetchMock.mock.calls[2][0]).toBe('/bridge/v1/conversations/conv-1/plan');
    expect(createConversationMock.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[2]);
    expect(d.navigate).toHaveBeenCalledWith('/conversation/conv-1');
  });

  it('still opens the conversation and only warns when binding the plan fails', async () => {
    const warn = vi.spyOn(Message, 'warning').mockImplementation(() => () => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridgeOk();
    fetchMock.mockResolvedValueOnce(reply(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    const d = deps();
    const { result } = renderHook(() => useGuidSend(d));
    await act(async () => {
      await result.current.handleSend();
    });
    expect(d.navigate).toHaveBeenCalledWith('/conversation/conv-1');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('未能关联到会话'));
    warn.mockRestore();
  });

  it('does not create a conversation when the Bridge call fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    const { result } = renderHook(() => useGuidSend(deps()));
    await act(async () => {
      await expect(result.current.handleSend()).rejects.toThrow('未发送');
    });
    expect(createConversationMock).not.toHaveBeenCalled();
  });

  it('keeps the draft and creates no token or conversation when any required file is rejected', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A', resource_ids: ['res_1'] }], [], ['res_1']);
    fetchMock.mockResolvedValueOnce(reply(409, { error: { code: 'SCOPE_CONFLICT', message: 'scope changed' } }));
    const d = deps();
    const showError = vi.spyOn(Message, 'error').mockImplementation(() => () => {});
    const { result } = renderHook(() => useGuidSend(d));
    await act(async () => {
      result.current.sendMessageHandler();
    });
    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith(expect.stringContaining('未发送：所选资料已发生变化或权限已撤销'))
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createConversationMock).not.toHaveBeenCalled();
    expect(d.setInput).not.toHaveBeenCalled();
    expect(d.setFiles).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
    showError.mockRestore();
  });

  it('creates no conversation and keeps input for an invalid empty selected-file intent', async () => {
    setScopeSelection([], [], []);
    const d = deps();
    const showError = vi.spyOn(Message, 'error').mockImplementation(() => () => {});
    const { result } = renderHook(() => useGuidSend(d));
    await act(async () => {
      result.current.sendMessageHandler();
    });
    await waitFor(() => expect(showError).toHaveBeenCalledWith(expect.stringContaining('未发送')));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createConversationMock).not.toHaveBeenCalled();
    expect(d.setInput).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
    showError.mockRestore();
  });

  it.each(['claude', 'aionrs'])(
    '%s keeps extra attachments and refuses a selected-file send before any Bridge call',
    async (backend) => {
      setScopeSelection([{ source_id: 'src_a', name: 'A', resource_ids: ['res_1'] }], [], ['res_1']);
      const d = deps();
      d.selectedAssistantBackend = backend;
      d.files = [uploadFileRef('/fixtures/outside-selection.md')];
      d.current_model = { use_model: 'fixture-model' } as NonNullable<GuidSendDeps['current_model']>;
      const showError = vi.spyOn(Message, 'error').mockImplementation(() => () => {});
      const { result } = renderHook(() => useGuidSend(d));
      await act(async () => {
        result.current.sendMessageHandler();
      });
      await waitFor(() => expect(showError).toHaveBeenCalledWith(expect.stringContaining('请移除未选中的附件')));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(createConversationMock).not.toHaveBeenCalled();
      expect(d.setInput).not.toHaveBeenCalled();
      expect(d.setFiles).not.toHaveBeenCalled();
      expect(d.files).toEqual([uploadFileRef('/fixtures/outside-selection.md')]);
      expect(d.navigate).not.toHaveBeenCalled();
      showError.mockRestore();
    }
  );
});
