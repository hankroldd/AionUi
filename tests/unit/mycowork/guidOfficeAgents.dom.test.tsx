/**
 * [mycowork] A567（D326）：首页（办公工作台）不列本部署未放开登录态的编程 agent；默认助手是办公场景助手，选过 Claude Code 等不被记成默认。
 * 只替身外部边界：助手目录（useCustomAgentsLoader = aioncore assistants.list）、运行时配置读写（configService）、托管 agent 目录。
 */
import { act, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import AssistantSelectionArea from '@/renderer/pages/guid/components/AssistantSelectionArea';
import { useGuidAssistantSelection } from '@/renderer/pages/guid/hooks/useGuidAssistantSelection';

const { configGetMock, configSetMock, catalog } = vi.hoisted(() => ({
  configGetMock: vi.fn(),
  configSetMock: vi.fn(),
  catalog: { current: [] as Assistant[] },
}));
vi.mock('@/common/config/configService', () => ({
  configService: { get: configGetMock, set: configSetMock, whenReady: () => Promise.resolve() },
}));
vi.mock('@/renderer/pages/guid/hooks/useCustomAgentsLoader', () => ({
  useCustomAgentsLoader: () => ({ assistants: catalog.current }),
}));
vi.mock('@/renderer/hooks/agent/useManagedAgents', () => ({ useManagedAgentRuntimeCatalog: () => [] }));
vi.mock('@/renderer/hooks/assistant/useAssistantOrder', () => ({ useAssistantOrder: () => ({ assistantOrder: [] }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key }),
}));

const assistant = (id: string, name: string, agent: Assistant['agent'], source: Assistant['source']): Assistant => ({
  id,
  source,
  name,
  name_i18n: {},
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  agent_id: `agent-${id}`,
  agent,
  enabled_skills: [],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
  agent_status: 'online',
  team_selectable: true,
  deletable: false,
});
const AIONRS = { type: 'aionrs', source: 'internal' } as const;
const CATALOG = [
  // aioncore 把检测到的 CLI 排在最前（generated），正是上游默认会选中的位置
  assistant('gen-claude', 'Claude Code', { type: 'acp', source: 'builtin', acp_backend: 'claude' }, 'generated'),
  assistant('gen-codex', 'Codex', { type: 'acp', source: 'builtin', acp_backend: 'codex' }, 'generated'),
  assistant('gen-gemini', 'Gemini CLI', { type: 'acp', source: 'builtin', acp_backend: 'gemini' }, 'generated'),
  assistant('gen-aion', 'Aion CLI', AIONRS, 'generated'),
  assistant('mycowork-scene-ppt', '汇报 / PPT', AIONRS, 'user'),
  assistant('mycowork-scene-materials', '材料生成专家', AIONRS, 'user'),
];
const ids = (list: Assistant[]) => list.map((a) => a.id);

describe('[mycowork] A567 首页助手', () => {
  beforeEach(() => {
    catalog.current = CATALOG;
    configGetMock.mockReset().mockReturnValue(undefined);
    configSetMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('测试栈（构建未放开任何 agent）：列表与下拉都没有 Claude Code、Codex、Gemini CLI', () => {
    const { result } = renderHook(() => useGuidAssistantSelection({}));
    expect(ids(result.current.assistants)).toEqual(['gen-aion', 'mycowork-scene-ppt', 'mycowork-scene-materials']);
    render(
      <AssistantSelectionArea
        assistants={result.current.assistants}
        localeKey='zh-CN'
        maxVisibleAssistants={8}
        onSelectAssistant={vi.fn()}
      />
    );
    expect(screen.queryByText('Claude Code')).toBeNull();
    expect(screen.queryByText('Codex')).toBeNull();
    expect(screen.getByText('汇报 / PPT')).toBeTruthy();
  });

  it('默认助手是「汇报 / PPT」；以前被记成 Claude Code 的值作废', () => {
    configGetMock.mockImplementation((key: string) => (key === 'guid.lastAssistantId' ? 'gen-claude' : undefined));
    const { result } = renderHook(() => useGuidAssistantSelection({}));
    expect(result.current.selectedAssistantId).toBe('mycowork-scene-ppt');
  });

  it('上次用的办公场景助手是默认；选普通助手只影响本次、不被记住', () => {
    configGetMock.mockImplementation((key: string) =>
      key === 'guid.lastAssistantId' ? 'mycowork-scene-materials' : undefined
    );
    const { result } = renderHook(() => useGuidAssistantSelection({ resetAssistant: true, locationKey: 'a' }));
    expect(result.current.selectedAssistantId).toBe('mycowork-scene-materials');
    act(() => result.current.setSelectedAssistantId('gen-aion'));
    expect(result.current.selectedAssistantId).toBe('gen-aion');
    expect(configSetMock).not.toHaveBeenCalled();
    act(() => result.current.setSelectedAssistantId('mycowork-scene-ppt'));
    expect(configSetMock).toHaveBeenCalledWith('guid.lastAssistantId', 'mycowork-scene-ppt');
  });

  it('负责人实例（D260 放开 codex、claude）：可选但不被记成默认，其余编程 agent 仍不列', () => {
    vi.stubGlobal('__MYCOWORK_RELEASED_AGENTS__', 'codex,claude');
    const { result } = renderHook(() => useGuidAssistantSelection({}));
    expect(ids(result.current.assistants)).toEqual([
      'gen-claude',
      'gen-codex',
      'gen-aion',
      'mycowork-scene-ppt',
      'mycowork-scene-materials',
    ]);
    expect(result.current.selectedAssistantId).toBe('mycowork-scene-ppt');
    act(() => result.current.setSelectedAssistantId('gen-claude'));
    expect(result.current.selectedAssistantId).toBe('gen-claude');
    expect(configSetMock).not.toHaveBeenCalled();
  });
});
