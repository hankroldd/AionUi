/**
 * 文件：tests/unit/mycowork/capabilityReturn.dom.test.tsx
 * 职责：R036 缺能力 → 能力中心 → 回到原任务（navigation-intent §9）：意图白名单/账号负例、发送受阻给“去配置”、
 *       能力中心按意图给“回到原任务”、回到首页后真实持久草稿恢复并只读核对资料范围、不自动发送。
 * 边界：只替换身份、HTTP 与 IPC 边界；草稿控制器、范围仓库与意图解析均为真实实现；数据虚构。
 */
import React, { useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message, Notification } from '@arco-design/web-react';
import type { DraftState } from '@mycowork/contracts';
import {
  BridgeError,
  capabilityReturnTarget,
  getScope,
  notifyCapabilityBlocked,
  parseCapabilityReturn,
  resetAccountScopedState,
  restoreScope,
} from '@mycowork/ui';
import { useGuidPersistentDraft } from '@/renderer/mycowork-drafts';
import { OfficeCapabilitiesSlot } from '@/renderer/mycowork-slots';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const edge = vi.hoisted(() => ({ owner: 'owner-a' as string | undefined, send: vi.fn() }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: edge.owner }, status: edge.owner ? 'authenticated' : 'unauthenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: (k: string) => k }) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('@/renderer/mycowork-slots', async (original) => ({
  ...(await original<typeof import('@/renderer/mycowork-slots')>()),
  sendOfficeDraft: (...args: unknown[]) => edge.send(...args),
}));

const intent = { ownerKey: 'owner-a', capabilityId: 'knowledge.retrieval', origin: 'guid' };
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const draftState: DraftState = {
  content: '虚构：整理第三季度周报',
  files: [{ kind: 'local', path: '/fixture/周报草稿.txt' }],
  sessions: [],
  workspace: '/fixture/workspace',
  scope: { items: [{ source_id: 'kb-a', name: '虚构库' }], views: [], origin: 'turn' },
};
let catalog: string[] = ['kb-a'];
let calls: Array<{ url: string; method: string }> = [];
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  edge.owner = 'owner-a';
  edge.send.mockReset();
  catalog = ['kb-a'];
  calls = [];
  resetAccountScopedState();
  restoreScope({ items: [], views: [], origin: 'turn' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      if (String(url).includes('/drafts/')) {
        const put = init?.method === 'PUT' ? JSON.parse(String(init.body)) : undefined;
        return reply(200, {
          draft_id: 'draft-guid',
          input_location: 'guid',
          revision: put ? put.expected_revision + 1 : 2,
          submission_id: put?.submission_id ?? '14a16b25-58d5-4f96-8739-c2b257cdb417',
          state: put?.state ?? draftState,
          updated_at: '2026-10-17T00:00:00Z',
        });
      }
      if (url === '/bridge/v1/scopes')
        return reply(200, {
          sources: catalog.map((source_id) => ({ source_id, name: '虚构库', counts })),
          projects: [],
        });
      if (url === '/bridge/v1/capabilities')
        return reply(200, {
          capabilities: [
            {
              id: 'knowledge.retrieval',
              state: 'not_configured',
              dependencies: [],
              allowedDataScopes: [],
              reason: '未配置',
              testedAt: new Date().toISOString(),
              version_verified: true,
            },
          ],
        });
      if (String(url).endsWith('/check'))
        return reply(200, {
          id: 'knowledge.retrieval',
          state: 'ready',
          dependencies: [],
          allowedDataScopes: [],
          testedAt: new Date().toISOString(),
          version_verified: true,
        });
      return reply(404, { error: { code: 'NOT_FOUND' } });
    })
  );
});
afterEach(() => {
  cleanup();
  Notification.clear();
  Message.clear();
  resetAccountScopedState();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('意图解析（白名单与账号）', () => {
  it('只认同账号、已知能力与白名单来源；回程路由取自查表', () => {
    const ok = parseCapabilityReturn({ mycoworkCapabilityReturn: intent }, 'owner-a');
    expect(ok).toEqual(intent);
    expect(capabilityReturnTarget(ok!)).toEqual({
      path: '/guid',
      state: { mycoworkCapabilityReturned: { ownerKey: 'owner-a' } },
    });
    const bad = [
      [null, 'owner-a'],
      [{ mycoworkCapabilityReturn: intent }, undefined],
      [{ mycoworkCapabilityReturn: intent }, 'owner-b'],
      [{ mycoworkCapabilityReturn: { ...intent, capabilityId: 'model.chat' } }, 'owner-a'],
      [{ mycoworkCapabilityReturn: { ...intent, origin: '/conversation/x' } }, 'owner-a'],
      [{ mycoworkCapabilityReturn: { ...intent, origin: 'https://example.invalid/guid' } }, 'owner-a'],
      [{ mycoworkCapabilityReturn: { ...intent, origin: 'toString' } }, 'owner-a'],
      [{ mycoworkCapabilityReturn: [intent] }, 'owner-a'],
    ] as const;
    for (const [state, owner] of bad) expect(parseCapabilityReturn(state, owner)).toBeNull();
  });
});

function sendDeps(ownerKey: string | undefined, navigate = vi.fn(async () => {})): GuidSendDeps {
  return {
    input: '虚构：整理第三季度周报',
    files: [],
    dir: '',
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
    navigate,
    t: ((key: string) => key) as never,
    localeKey: 'zh-CN',
    persistentDraft: {
      ready: true,
      status: 'saved',
      ownerKey,
      flush: async () => ({ revision: 2, input_location: 'guid', state: draftState }),
      captureSnapshot: () => draftState,
      isCurrent: () => true,
    } as never,
  } as GuidSendDeps;
}

describe('发送受阻 → 去配置', () => {
  const blocked = (detail?: string) =>
    new Error('未发送：资料服务暂不可用（虚构）', { cause: new BridgeError('unavailable', detail) });

  it('Bridge 503 给带“去配置”的通知，点击带结构化意图去能力中心，不弹原错误', async () => {
    edge.send.mockRejectedValue(blocked());
    const error = vi.spyOn(Message, 'error');
    const value = sendDeps('owner-a');
    const { result } = renderHook(() => useGuidSend(value));
    act(() => result.current.sendMessageHandler());
    fireEvent.click(await screen.findByRole('button', { name: '去配置' }));
    expect(value.navigate).toHaveBeenCalledWith('/office/capabilities', {
      state: { mycoworkCapabilityReturn: intent },
    });
    expect(error).not.toHaveBeenCalled();
    expect(value.setInput).not.toHaveBeenCalled();
  });

  it('网络连不上或未登录不当作缺能力，仍按原样报错', async () => {
    const go = vi.fn();
    expect(notifyCapabilityBlocked(blocked(), undefined, 'zh-CN', go)).toBe(false); // 未登录：不给按钮
    expect(go).not.toHaveBeenCalled();
    for (const cause of [blocked('UNREACHABLE'), new Error('其他失败')]) {
      await waitFor(() => expect(screen.queryByRole('button', { name: '去配置' })).toBeNull()); // 上一例的通知已关
      edge.send.mockRejectedValueOnce(cause);
      const error = vi.spyOn(Message, 'error');
      const value = sendDeps('owner-a');
      const { result, unmount } = renderHook(() => useGuidSend(value));
      act(() => result.current.sendMessageHandler());
      await waitFor(() => expect(error).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: '去配置' })).toBeNull();
      unmount();
      error.mockRestore();
    }
  });
});

const Where = () => <output data-testid='where'>{JSON.stringify(useLocation().state)}</output>;
const renderCapabilities = (state: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/office/capabilities', state }]}>
      <Routes>
        <Route path='/office/capabilities' element={<OfficeCapabilitiesSlot />} />
        <Route path='/guid' element={<Where />} />
      </Routes>
    </MemoryRouter>
  );

describe('能力中心 → 回到原任务', () => {
  it('带本人意图时提示状态；重新检查可用后返回 /guid 只带账号标记', async () => {
    renderCapabilities({ mycoworkCapabilityReturn: intent });
    const tip = await screen.findByTestId('mycowork-capability-return');
    await waitFor(() => expect(tip).toHaveTextContent('「知识库检索」当前是「未配置」'));
    const row = screen.getByTestId('capability-knowledge.retrieval');
    fireEvent.click(within(row).getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(tip).toHaveTextContent('「知识库检索」现在可以使用了'));
    fireEvent.click(within(tip).getByRole('button', { name: '回到原任务' }));
    expect(JSON.parse(screen.getByTestId('where').textContent!)).toEqual({
      mycoworkCapabilityReturned: { ownerKey: 'owner-a' },
    });
  });

  it('别的账号、外部地址或未知能力的意图不显示返回动作', async () => {
    for (const state of [
      { mycoworkCapabilityReturn: { ...intent, ownerKey: 'owner-b' } },
      { mycoworkCapabilityReturn: { ...intent, origin: 'https://example.invalid/' } },
      { mycoworkCapabilityReturn: { ...intent, capabilityId: 'unknown' } },
      null,
    ]) {
      const { unmount } = renderCapabilities(state);
      await screen.findByTestId('capability-knowledge.retrieval');
      expect(screen.queryByTestId('mycowork-capability-return')).toBeNull();
      unmount();
    }
  });
});

function GuidHarness({ navigation }: { navigation: Record<string, unknown> | null }) {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<DraftState['files']>([]);
  const [dir, setDir] = useState('');
  const draft = useGuidPersistentDraft({
    input: { input, setInput, files, setFiles, dir, setDir } as never,
    agent: {
      assistants: [],
      selectedAssistantId: '',
      currentAgentModeOptions: [],
      currentThoughtLevelOption: null,
    } as never,
    model: { modelList: [], current_model: undefined } as never,
    skills: [],
    servers: [],
    choices: {},
    setSkills: vi.fn(),
    setDisabledSkills: vi.fn(),
    setMcp: vi.fn(),
    navigation,
  });
  void draft;
  return <output data-testid='restored'>{JSON.stringify({ input, files, dir })}</output>;
}

describe('回到首页：恢复草稿并重新核对', () => {
  const restored = async () => {
    await waitFor(() => expect(screen.getByTestId('restored')).toHaveTextContent(draftState.content));
    expect(JSON.parse(screen.getByTestId('restored').textContent!)).toEqual({
      input: draftState.content,
      files: draftState.files,
      dir: draftState.workspace,
    });
    expect(getScope().items.map((i) => i.source_id)).toEqual(['kb-a']);
  };
  const sent = () => calls.filter((c) => /context-plans|tasks/.test(c.url));

  it('本人标记：恢复输入、附件与范围，只读核对目录后提示，不发送', async () => {
    render(<GuidHarness navigation={{ mycoworkCapabilityReturned: { ownerKey: 'owner-a' } }} />);
    await restored();
    expect(await screen.findByText(/已回到原任务：输入、附件和资料范围已恢复/)).toBeInTheDocument();
    expect(calls.filter((c) => c.url === '/bridge/v1/scopes')).toHaveLength(1);
    expect(sent()).toEqual([]);
  });

  it('已选知识库不再可见时给范围变化提示，仍不发送', async () => {
    catalog = [];
    render(<GuidHarness navigation={{ mycoworkCapabilityReturned: { ownerKey: 'owner-a' } }} />);
    await restored();
    expect(await screen.findByText(/所选资料已发生变化或权限已撤销/)).toBeInTheDocument();
    expect(sent()).toEqual([]);
  });

  it('别的账号的标记或普通进入只恢复草稿，不做核对', async () => {
    for (const navigation of [{ mycoworkCapabilityReturned: { ownerKey: 'owner-b' } }, null]) {
      calls = [];
      const { unmount } = render(<GuidHarness navigation={navigation} />);
      await restored();
      expect(calls.some((c) => c.url === '/bridge/v1/scopes')).toBe(false);
      unmount();
      restoreScope({ items: [], views: [], origin: 'turn' });
    }
  });
});
