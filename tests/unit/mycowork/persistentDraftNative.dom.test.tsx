/**
 * 文件：tests/unit/mycowork/persistentDraftNative.dom.test.tsx
 * 职责：验证首页发送先保存且受理前保留输入，外部边界仅替换IPC与导航。
 * 边界：不启动runtime，不把创建会话成功当作消息受理。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const edge = vi.hoisted(() => ({ create: vi.fn(), flush: vi.fn(), handoff: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { create: { invoke: edge.create } } } }));
vi.mock('@/renderer/mycowork-slots', () => ({
  withGuidScope: async (extra: unknown) => extra,
  bindGuidScope: async () => {},
  notifyCapabilityBlocked: () => false, // R036：发送失败不走“去配置”通知，原错误分支照旧
  handoffGuidDraft: (...args: unknown[]) => edge.handoff(...args),
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));
vi.mock('swr', () => ({ mutate: async () => {} }));
vi.mock('@arco-design/web-react', () => ({ Message: { warning: vi.fn(), error: vi.fn() } }));

function deps(ready = true): GuidSendDeps {
  return {
    input: '虚构草稿',
    files: [{ kind: 'local', path: '/fixture/report.txt' }],
    dir: '/fixture',
    setInput: vi.fn(),
    setFiles: vi.fn(),
    setDir: vi.fn(),
    setLoading: vi.fn(),
    loading: false,
    selectedAssistantId: 'assistant-a',
    selectedAssistantBackend: 'aionrs',
    selectedMode: 'default',
    selectedAcpModel: null,
    current_model: { id: 'provider-a', use_model: 'model-a', models: ['model-a'] } as never,
    availableMcpServers: [],
    selectedMcpServerIds: [],
    isGoogleAuth: false,
    guidDisabledBuiltinSkills: [],
    guidEnabledSkills: [],
    assistantDefaultMcpIds: [],
    setMentionOpen: vi.fn(),
    setMentionQuery: vi.fn(),
    setMentionSelectorOpen: vi.fn(),
    setMentionActiveIndex: vi.fn(),
    navigate: vi.fn(async () => {}),
    t: ((key: string) => key) as never,
    localeKey: 'zh-CN',
    persistentDraft: { ready, status: ready ? 'saved' : 'error', flush: edge.flush, isCurrent: () => true } as never,
  } as GuidSendDeps;
}

beforeEach(() => {
  sessionStorage.clear();
  edge.create.mockReset().mockResolvedValue({ id: 'conversation-a' });
  edge.flush
    .mockReset()
    .mockResolvedValue({
      revision: 3,
      input_location: 'guid',
      submission_id: 'submission-a',
      state: { content: '虚构草稿', files: [], sessions: [] },
    });
  edge.handoff.mockReset().mockResolvedValue(undefined);
});

describe('持久草稿首页原生发送边界', () => {
  it('保存失败时禁止创建会话且保留正文附件目录', async () => {
    edge.flush.mockRejectedValue(new Error('save failed'));
    const value = deps();
    const { result } = renderHook(() => useGuidSend(value));
    act(() => result.current.sendMessageHandler());
    await waitFor(() => expect(value.setLoading).toHaveBeenLastCalledWith(false));
    expect(edge.create).not.toHaveBeenCalled();
    expect(value.setInput).not.toHaveBeenCalled();
    expect(value.setFiles).not.toHaveBeenCalled();
    expect(value.setDir).not.toHaveBeenCalled();
  });
  it('创建会话后先持久交接，源输入保留到首条消息受理', async () => {
    const value = deps();
    const { result } = renderHook(() => useGuidSend(value));
    act(() => result.current.sendMessageHandler());
    await waitFor(() => expect(value.navigate).toHaveBeenCalled());
    expect(edge.flush).toHaveBeenCalledTimes(1);
    expect(edge.handoff).toHaveBeenCalledWith(
      'conversation-a',
      expect.objectContaining({ revision: 3 }),
      expect.anything()
    );
    expect(value.setInput).not.toHaveBeenCalled();
    expect(value.setFiles).not.toHaveBeenCalled();
    expect(value.setDir).not.toHaveBeenCalled();
  });
  it('未恢复或恢复失败时按钮和直接发送都禁发', async () => {
    const { result } = renderHook(() => useGuidSend(deps(false)));
    expect(result.current.isButtonDisabled).toBe(true);
    await act(async () => result.current.handleSend());
    expect(edge.create).not.toHaveBeenCalled();
  });
});
