/**
 * 文件：tests/unit/mycowork/guidSendActorLoading.dom.test.ts
 * [mycowork] 职责：经真实 Guid 发送 hook 核验账号/路由切换后的在途标记、提示和 loading 归属。
 * 边界：只替换原生创建、通知与刷新边界；普通无范围发送运行真实 Scope 准备。
 * 关联：MyCowork docs/contracts/navigation-intent.md §3；PR11 B2b A102。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setScopeSelection } from '@mycowork/ui';
import { uploadFileRef } from '@/common/types/chatFile';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const create = vi.hoisted(() => vi.fn());
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { create: { invoke: (...args: unknown[]) => create(...args) } } },
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: vi.fn() } }));
vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({ updateWorkspaceTime: vi.fn() }));
vi.mock('swr', () => ({ mutate: vi.fn(() => Promise.resolve()) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, failed) => {
    resolve = ok;
    reject = failed;
  });
  return { promise, resolve, reject };
}
function input(backend: string): GuidSendDeps {
  return {
    ownerKey: 'actor-a',
    locationKey: 'guid-a',
    input: '虚构A输入',
    files: [uploadFileRef('/fixtures/a.md')],
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
beforeEach(() => {
  create.mockReset();
  setScopeSelection([], []);
  sessionStorage.clear();
  vi.spyOn(Message, 'error').mockImplementation(() => () => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it.each(
  ['claude', 'aionrs'].flatMap((backend) =>
    ['actor', 'route'].flatMap((change) => ['resolve', 'reject'].map((ending) => [backend, change, ending]))
  )
)(
  '%s lets the new %s send start and ignores the old create %s while its loading stays active',
  async (backend, change, ending) => {
    const oldCreate = deferred<{ id: string }>();
    const newCreate = deferred<{ id: string }>();
    create.mockReturnValueOnce(oldCreate.promise).mockReturnValueOnce(newCreate.promise);
    const a = input(backend);
    const hook = renderHook((props: GuidSendDeps) => useGuidSend(props), { initialProps: a });
    act(() => hook.result.current.sendMessageHandler());
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    const b = {
      ...a,
      ownerKey: change === 'actor' ? 'actor-b' : a.ownerKey,
      locationKey: 'guid-b',
      input: '虚构B新输入',
      files: [uploadFileRef('/fixtures/b.md')],
    };
    hook.rerender(b);
    act(() => hook.result.current.sendMessageHandler());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(b.setLoading).toHaveBeenLastCalledWith(true);
    await act(async () => {
      if (ending === 'resolve') oldCreate.resolve({ id: 'created_a' });
      else oldCreate.reject(new Error('fixture old request rejected'));
    });
    expect(b.setLoading).toHaveBeenLastCalledWith(true);
    expect(b.setInput).not.toHaveBeenCalled();
    expect(b.setFiles).not.toHaveBeenCalled();
    expect(b.navigate).not.toHaveBeenCalled();
    expect(Message.error).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    await act(async () => {
      newCreate.resolve({ id: 'created_b' });
    });
    await waitFor(() => expect(b.setLoading).toHaveBeenLastCalledWith(false));
    expect(b.navigate).toHaveBeenCalledTimes(1);
    expect(b.navigate).toHaveBeenCalledWith('/conversation/created_b');
    expect(b.setInput).toHaveBeenCalledWith('');
    expect(b.setFiles).toHaveBeenCalledWith([]);
    expect(sessionStorage.length).toBe(1);
    const message = sessionStorage.getItem(`${backend === 'aionrs' ? 'aionrs' : 'acp'}_initial_message_created_b`)!;
    expect(JSON.parse(message).input).toBe('虚构B新输入');
  }
);
