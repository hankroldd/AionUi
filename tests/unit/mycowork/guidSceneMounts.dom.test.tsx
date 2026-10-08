/**
 * [mycowork] A197/A220/A221: the mount lines pass the selected assistant id. useGuidSend (both the aionrs and the other
 * branch) creates a scene-assistant conversation with the Bridge MCP server of an explicit empty plan and no scope picked;
 * a plain assistant is created without any Bridge call. The home chip tells a scene assistant "no sources selected".
 * Only external boundaries are mocked (Bridge = fetch, aioncore = ipcBridge.conversation.create).
 */

import { act, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { setScopeSelection } from '@mycowork/ui';
import { GuidScopeSlot } from '@/renderer/mycowork-slots';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const createConversationMock = vi.fn();
const fetchMock = vi.fn();
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { create: { invoke: (...args: unknown[]) => createConversationMock(...args) } } },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'fixture-owner' } }),
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('swr', () => ({ mutate: vi.fn(() => Promise.resolve()) }));
vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
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
const SCENE = 'mycowork-scene-ppt';

const deps = (assistant: string, backend: string): GuidSendDeps =>
  ({
    input: 'hello',
    setInput: vi.fn(),
    files: [],
    setFiles: vi.fn(),
    dir: '',
    setDir: vi.fn(),
    setLoading: vi.fn(),
    loading: false,
    selectedAssistantId: assistant,
    selectedAssistantBackend: backend,
    selectedMode: 'default',
    selectedAcpModel: null,
    current_model: { use_model: 'm' },
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
  }) as unknown as GuidSendDeps;

describe('useGuidSend passes the selected assistant to withGuidScope', () => {
  beforeEach(() => {
    setScopeSelection([]);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/context-plans')
        return reply(201, {
          plan_id: 'plan_e',
          version: 1,
          status: 'EMPTY_SCOPE',
          brief: { groups: [], explicit_empty: true },
        });
      if (url === '/bridge/v1/context-plans/plan_e/tokens')
        return reply(201, {
          token: 't',
          expires_at: 'x',
          mcp: {},
          session_mcp_server: SERVER,
          workspace: '/data/ws/1',
        });
      return reply(200, null);
    });
    vi.stubGlobal('fetch', fetchMock);
    createConversationMock.mockReset();
    createConversationMock.mockResolvedValue({ id: 'conv-1' });
  });
  afterEach(() => vi.unstubAllGlobals());

  for (const backend of ['aionrs', 'claude']) {
    it(`${backend} branch: scene assistant without scope gets the empty plan's Bridge MCP server and the plan is bound`, async () => {
      const { result } = renderHook(() => useGuidSend(deps(SCENE, backend)));
      await act(async () => {
        await result.current.handleSend();
      });
      const planBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(planBody).toMatchObject({ explicit_empty: true });
      const extra = createConversationMock.mock.calls[0][0].extra;
      expect(extra.selected_session_mcp_servers).toEqual([SERVER]);
      expect(extra).toMatchObject({ workspace: '/data/ws/1', custom_workspace: true });
      expect(fetchMock.mock.calls.some(([u]) => u === '/bridge/v1/conversations/conv-1/plan')).toBe(true);
    });

    it(`${backend} branch: a plain assistant without scope sends no Bridge request and carries no Bridge server`, async () => {
      const { result } = renderHook(() => useGuidSend(deps('assistant-1', backend)));
      await act(async () => {
        await result.current.handleSend();
      });
      expect(fetchMock).not.toHaveBeenCalled();
      const extra = createConversationMock.mock.calls[0][0].extra;
      expect(JSON.stringify(extra)).not.toContain('mycowork_bridge');
    });
  }
});

describe('home scope chip for the scene assistant', () => {
  beforeEach(() => {
    setScopeSelection([]);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const chip = (assistantId?: string) =>
    render(
      <MemoryRouter initialEntries={['/guid']}>
        <GuidScopeSlot assistantId={assistantId} />
      </MemoryRouter>
    );

  it('says no sources are selected and cites none', () => {
    chip(SCENE);
    expect(screen.getByRole('button', { name: /资料范围：未选资料（本轮不引用任何资料）/ })).toBeInTheDocument();
    expect(screen.queryByText(/未选择/)).toBeNull();
  });

  it('keeps the old wording for other assistants and when no assistant is known', () => {
    chip('assistant-1');
    expect(screen.getByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
  });

  it('a hand-picked scope is shown as before for the scene assistant', () => {
    setScopeSelection([{ source_id: 'src_a', name: '产品库' }]);
    chip(SCENE);
    expect(screen.getByRole('button', { name: '资料范围：产品库' })).toBeInTheDocument();
  });

  it('an empty required file set is not "no sources selected": the chip keeps the plain wording', () => {
    setScopeSelection([], [], []);
    chip(SCENE);
    expect(screen.getByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
  });
});
