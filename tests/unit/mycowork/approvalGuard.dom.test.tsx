/**
 * [mycowork] D115：MyCowork 会话（挂了 Bridge MCP）里，aionrs 批准卡不给“始终允许”（mcp 类、exec 类）、权限模式不给 YOLO、
 * 带范围新建 Aion CLI 会话不以 YOLO 创建；其余卡片、非 MyCowork 会话不受影响。
 * 只替身外部边界：aioncore（ipcBridge）、Bridge（fetch）、运行时配置读取（useAcpConfigOptions）。
 */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { setScopeSelection } from '@mycowork/ui';
import type { IMessagePermission } from '@/common/chat/chatLib';
import AgentModeSelector from '@/renderer/components/agent/AgentModeSelector';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import MessagePermission from '@/renderer/pages/conversation/Messages/components/MessagePermission';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const { confirmMock, createMock } = vi.hoisted(() => ({ confirmMock: vi.fn(), createMock: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      confirmation: { confirm: { invoke: confirmMock } },
      create: { invoke: (...args: unknown[]) => createMock(...args) },
    },
  },
}));
vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  classifyConfigSetError: () => 'unknown',
  useAcpConfigOptions: () => ({
    setStatus: { state: 'idle' },
    isLoading: false,
    mode: {
      id: 'mode',
      category: 'mode',
      currentValue: 'default',
      options: ['default', 'auto_edit', 'yolo'].map((value) => ({ value, label: value })),
    },
    model: null,
    thoughtLevel: null,
    reload: vi.fn(),
    setConfigOption: vi.fn(),
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'zh-CN' },
  }),
}));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('swr', () => ({ mutate: vi.fn(() => Promise.resolve()) }));
vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));

const MYCOWORK = ['mycowork_bridge'];
const OTHER = ['github'];
const inSession = (mcpServers: string[] | undefined, node: React.ReactNode) => (
  <ConversationProvider value={{ conversation_id: 'conv-1', type: 'aionrs', loadedMcpServers: mcpServers }}>
    {node}
  </ConversationProvider>
);

// aioncore backend_protocol_sink.rs 的卡片形状：title “<类别> wants to use: <工具>”，action = 工具名，command_type = 类别
const card = (tool: string, category: string): IMessagePermission => ({
  id: `m-${tool}`,
  msg_id: `db-${tool}`,
  conversation_id: 'conv-1',
  type: 'permission',
  position: 'left',
  content: {
    id: `c-${tool}`,
    title: `${category} wants to use: ${tool}`,
    description: `MCP mycowork_bridge/${tool}: {}`,
    action: tool,
    call_id: `call-${tool}`,
    command_type: category,
    options: [
      { label: 'Yes, allow once', value: 'proceed_once' },
      { label: 'Yes, allow always', value: 'proceed_always' },
      { label: 'No', value: 'cancel' },
    ],
  },
});
const optionValues = () =>
  Array.from(document.querySelectorAll('[data-testid^="message-permission-option-"]')).map((el) =>
    el.getAttribute('data-testid')?.replace('message-permission-option-', '')
  );

describe('D115 批准卡', () => {
  beforeEach(() => confirmMock.mockReset().mockResolvedValue(undefined));

  it.each(['office_edit', 'office_register_output', 'office_copy_to_workspace'])(
    'MyCowork 会话里写工具 %s 的卡片只有“允许一次/拒绝”，允许一次不带 always_allow',
    async (tool) => {
      render(inSession(MYCOWORK, <MessagePermission message={card(tool, 'mcp')} />));
      expect(optionValues()).toEqual(['proceed_once', 'cancel']);
      fireEvent.click(screen.getByTestId('message-permission-option-proceed_once'));
      await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
      expect(confirmMock.mock.calls[0][0]).toMatchObject({ data: { value: 'proceed_once' }, always_allow: false });
    }
  );

  it('写工具卡片在取不到会话信息时也不给“始终允许”（按工具名，含同名冲突时的前缀名）', () => {
    render(<MessagePermission message={card('mcp__mycowork_bridge_office_edit', 'mcp')} />);
    expect(optionValues()).toEqual(['proceed_once', 'cancel']);
  });

  it.each([
    ['memory_suggest', ['bridge']],
    ['mcp__mycowork_bridge_memory_suggest', OTHER],
  ])(
    '[mycowork] A85：%s 卡片即使会话未识别为 MyCowork（Bridge 以别名挂载）也不给“始终允许”（点了会按 mcp 类连带放行写工具）',
    (tool, servers) => {
      render(inSession(servers, <MessagePermission message={card(tool, 'mcp')} />));
      expect(optionValues()).toEqual(['proceed_once', 'cancel']);
    }
  );

  it.each([
    ['search', 'mcp'],
    ['read', 'mcp'],
    ['memory_suggest', 'mcp'],
    ['ExecCommand', 'exec'],
  ])('[mycowork] A85：取不到会话信息时 %s（%s 类）卡片按 MyCowork 会话处理，不给“始终允许”', (tool, category) => {
    render(<MessagePermission message={card(tool, category)} />);
    expect(optionValues()).toEqual(['proceed_once', 'cancel']);
  });

  it('[mycowork] A85：已知的空 MCP 列表不算“取不到会话信息”，mcp 卡片照常给“始终允许”', () => {
    render(inSession([], <MessagePermission message={card('create_issue', 'mcp')} />));
    expect(optionValues()).toEqual(['proceed_once', 'proceed_always', 'cancel']);
  });

  it('MyCowork 会话里其他 mcp 卡片也不给（aionrs 始终允许按类别记住，会连带放行写工具）', () => {
    render(inSession(MYCOWORK, <MessagePermission message={card('other_tool', 'mcp')} />));
    expect(optionValues()).toEqual(['proceed_once', 'cancel']);
  });

  it.each(['ExecCommand', 'Spawn'])(
    '[mycowork] D115 M3：MyCowork 会话里 exec 类卡片 %s 也不给（否则 shell 免批准后可直连 Bridge MCP 调写工具）',
    (tool) => {
      render(inSession(MYCOWORK, <MessagePermission message={card(tool, 'exec')} />));
      expect(optionValues()).toEqual(['proceed_once', 'cancel']);
    }
  );

  it('[mycowork] D115 M3：非 MyCowork 会话的 exec 类卡片不受影响', () => {
    render(inSession(OTHER, <MessagePermission message={card('ExecCommand', 'exec')} />));
    expect(optionValues()).toEqual(['proceed_once', 'proceed_always', 'cancel']);
  });

  it('MyCowork 会话里 info / edit 类卡片不受影响（auto_edit 本就放行这两类）', () => {
    render(inSession(MYCOWORK, <MessagePermission message={card('Write', 'edit')} />));
    expect(optionValues()).toEqual(['proceed_once', 'proceed_always', 'cancel']);
  });

  it('非 MyCowork 会话的 mcp 卡片不受影响', () => {
    render(inSession(OTHER, <MessagePermission message={card('create_issue', 'mcp')} />));
    expect(optionValues()).toEqual(['proceed_once', 'proceed_always', 'cancel']);
  });
});

const openModes = async () => {
  fireEvent.click(screen.getByTestId('agent-mode-selector-aionrs'));
  await waitFor(() => expect(document.querySelector('[data-mode-value="default"]')).not.toBeNull());
  return Array.from(document.querySelectorAll('[data-mode-value]')).map((el) => el.getAttribute('data-mode-value'));
};

describe('D115 权限模式', () => {
  afterEach(() => document.body.replaceChildren());

  it('MyCowork 会话的权限菜单没有 YOLO', async () => {
    render(inSession(MYCOWORK, <AgentModeSelector backend='aionrs' conversation_id='conv-1' compact />));
    expect(await openModes()).toEqual(['default', 'auto_edit']);
  });

  it('非 MyCowork 会话的权限菜单照旧有 YOLO', async () => {
    render(inSession(OTHER, <AgentModeSelector backend='aionrs' conversation_id='conv-1' compact />));
    expect(await openModes()).toEqual(['default', 'auto_edit', 'yolo']);
  });
});

const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const fetchMock = vi.fn();
const deps = (selectedMode: string): GuidSendDeps =>
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
    selectedAssistantBackend: 'aionrs',
    selectedMode,
    selectedAcpModel: null,
    current_model: { id: 'p1', use_model: 'zhanlu/x' },
    availableMcpServers: [],
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
const send = async (selectedMode: string) => {
  const { result } = renderHook(() => useGuidSend(deps(selectedMode)));
  await act(async () => {
    await result.current.handleSend();
  });
  return createMock.mock.calls[0][0].assistant.conversation_overrides.permission;
};

describe('D115 新建任务（Aion CLI）', () => {
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(reply(200, null));
    vi.stubGlobal('fetch', fetchMock);
    createMock.mockReset().mockResolvedValue({ id: 'conv-1' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('带资料范围时选了 YOLO 也以 default 创建', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    fetchMock.mockResolvedValueOnce(reply(201, { plan_id: 'plan_1', version: 1, status: 'OK' })).mockResolvedValueOnce(
      reply(201, {
        token: 't',
        expires_at: '2026-09-27T20:00:00Z',
        mcp: {},
        session_mcp_server: {
          id: 'mycowork_bridge',
          name: 'mycowork_bridge',
          transport: { type: 'streamable_http', url: 'http://127.0.0.1:25900/bridge/mcp', headers: {} },
        },
        workspace: '/data/ws/1',
      })
    );
    expect(await send('yolo')).toBe('default');
  });

  it('没有资料范围时保留用户所选 YOLO（非 MyCowork 会话不受影响）', async () => {
    setScopeSelection([]);
    expect(await send('yolo')).toBe('yolo');
  });
});
