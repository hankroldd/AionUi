/**
 * [mycowork] adapted：持久草稿与原生适配（拆分a，原 persistentDraftAdapter.dom.test.tsx，用例原样）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftDocument, DraftState } from '@mycowork/contracts';
import { collectChatFileRefs, splitChatFileRefs } from '@/renderer/utils/file/messageFiles';
import { getScope, resetAccountScopedState, restoreScope } from '@mycowork/ui';
import {
  DraftStatus,
  handoffGuidDraft,
  useConversationPersistentDraft,
  useGuidPersistentDraft,
} from '@/renderer/mycowork-drafts';

const identity = vi.hoisted(() => ({ owner: 'owner-a' as string | undefined }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: identity.owner }, status: identity.owner ? 'authenticated' : 'unauthenticated' }),
}));

const sourceState: DraftState = {
  content: '虚构首页正文',
  files: [
    { kind: 'project', pe_id: 'pe-a', relative_path: '虚构报告.txt' },
    { kind: 'local', path: '/fixture/local.txt' },
  ],
  sessions: [],
  workspace: '/fixture/workspace',
  scope: {
    items: [{ source_id: 'kb-a', name: '虚构库', resource_ids: [] }],
    views: [],
    origin: 'turn',
    projectId: 'project-a',
    carriedPlanId: 'plan-a',
  },
  choices: {
    assistant_id: 'assistant-a',
    backend: 'aionrs',
    model_provider_id: 'provider-a',
    model_id: 'model-a',
    permission: 'default',
    skill_ids: ['skill-a'],
    disabled_builtin_skill_ids: [],
    mcp_ids: ['mcp-a'],
  },
};
const doc = (location: string, state = sourceState, revision = 1): DraftDocument => ({
  draft_id: `draft-${location}`,
  input_location: location,
  revision,
  submission_id: '14a16b25-58d5-4f96-8739-c2b257cdb417',
  state,
  updated_at: '2026-10-15T00:00:00Z',
});
const docs = new Map<string, DraftDocument>();
const writes: Array<{ location: string; state: DraftState; expected_revision: number }> = [];
let failRead = false;
let failWrite = false;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetAccountScopedState();
  restoreScope({ items: [], views: [], origin: 'turn' });
  identity.owner = 'owner-a';
  sessionStorage.clear();
  docs.clear();
  writes.length = 0;
  failRead = false;
  failWrite = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const location = decodeURIComponent(String(url).split('/drafts/')[1] ?? '');
      if (new Headers(init?.headers).get('x-mycowork-draft-owner') !== identity.owner)
        return reply(403, { error: { code: 'FORBIDDEN' } });
      if (init?.method === 'PUT') {
        if (failWrite) return reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE' } });
        const value = JSON.parse(String(init.body));
        const old = docs.get(location);
        if (value.expected_revision !== (old?.revision ?? 0))
          return reply(409, { error: { code: 'REVISION_CONFLICT' } });
        const saved = { ...doc(location, value.state, (old?.revision ?? 0) + 1), submission_id: value.submission_id };
        writes.push({ location, state: value.state, expected_revision: value.expected_revision });
        docs.set(location, saved);
        return reply(200, saved);
      }
      if (failRead) return reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE' } });
      return docs.has(location) ? reply(200, docs.get(location)) : reply(404, { error: { code: 'NOT_FOUND' } });
    })
  );
});
afterEach(() => {
  cleanup();
  resetAccountScopedState();
  vi.unstubAllGlobals();
});

function GuidHarness({
  navigation = null,
  unavailable = false,
}: {
  navigation?: Record<string, unknown> | null;
  unavailable?: boolean;
}) {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<DraftState['files']>([]);
  const [dir, setDir] = useState('');
  const [assistant, setAssistant] = useState('assistant-default');
  const [mode, setMode] = useState('default');
  const [model, setModel] = useState({ id: 'provider-default', use_model: 'model-default', models: ['model-default'] });
  const [skills, setSkills] = useState<string[] | undefined>([]);
  const [disabledSkills, setDisabledSkills] = useState<string[] | undefined>([]);
  const [mcp, setMcp] = useState<string[] | undefined>([]);
  const draft = useGuidPersistentDraft({
    input: { input, setInput, files, setFiles, dir, setDir } as never,
    agent: {
      assistants: [
        { id: 'assistant-a', enabled: true },
        { id: 'assistant-default', enabled: true },
      ],
      selectedAssistantId: assistant,
      setSelectedAssistantId: setAssistant,
      selectedAssistantBackend: 'aionrs',
      selectedMode: mode,
      setSelectedMode: setMode,
      selectedThoughtLevelValue: '',
      setSelectedThoughtLevelValue: vi.fn(),
      selectedAcpModel: null,
      setSelectedAcpModel: vi.fn(),
      currentAgentModeOptions: [{ value: 'default' }],
      currentThoughtLevelOption: null,
    } as never,
    model: {
      modelList: unavailable ? [] : [{ id: 'provider-a', models: ['model-a'], apiKey: 'never-persist' }],
      current_model: model,
      setCurrentModel: async (next: never) => setModel(next),
    } as never,
    skills: [{ name: 'skill-a' }],
    servers: [{ id: 'mcp-a', enabled: true }] as never,
    choices: {
      assistant_id: assistant,
      backend: 'aionrs',
      model_provider_id: model.id,
      model_id: model.use_model,
      permission: mode,
      thought_level: '',
      skill_ids: skills,
      disabled_builtin_skill_ids: disabledSkills,
      mcp_ids: mcp,
    },
    setSkills,
    setDisabledSkills,
    setMcp,
    navigation,
  });
  return (
    <>
      <DraftStatus draft={draft} lang='zh-CN' />
      <textarea value={input} onChange={(e) => setInput(e.target.value)} aria-label='首页输入' />
      <output>{JSON.stringify({ files, dir, assistant, model: model.use_model, skills, mcp })}</output>
      <output data-testid='blocked'>{draft.blockedReason}</output>
      <button disabled={!draft.ready} onClick={() => void draft.flush()}>
        发送门禁
      </button>
    </>
  );
}

function ConversationHarness({ send, auto = true }: { send: (state: DraftState) => Promise<void>; auto?: boolean }) {
  const [state, setState] = useState<DraftState>({ content: '', files: [], sessions: [] });
  const restore = useCallback((next: DraftState) => {
    const { uploadFiles, atPath } = splitChatFileRefs(next.files);
    setState({ ...next, files: collectChatFileRefs(uploadFiles, atPath) });
  }, []);
  const draft = useConversationPersistentDraft('conversation-a', state, restore, true);
  useEffect(() => {
    if (auto && draft.ready) void draft.initial(send).catch(() => {});
  }, [auto, draft, send]);
  return (
    <>
      <DraftStatus draft={draft} lang='zh-CN' />
      <textarea
        aria-label='对话输入'
        value={state.content}
        onChange={(e) => setState({ ...state, content: e.target.value })}
      />
      <output data-testid='restored'>{JSON.stringify(state)}</output>
      <button onClick={() => void draft.finishInitial(state)}>完成明确受理</button>
    </>
  );
}

describe('真实持久草稿与原生适配', () => {
  it('恢复完整附件、工作项目、严格计划及能力ID，序列化不含provider密钥', async () => {
    docs.set('guid', doc('guid'));
    render(<GuidHarness />);
    await waitFor(() => expect(screen.getByLabelText('首页输入')).toHaveValue(sourceState.content));
    await waitFor(() => expect(screen.getByRole('button', { name: '发送门禁' })).toBeEnabled());
    expect(screen.getByText(/虚构报告.txt/)).toHaveTextContent('model-a');
    // A535：旧草稿里的严格收缩来源标记不再恢复，也不再写回
    expect(getScope()).toMatchObject({ projectId: 'project-a', items: [{ resource_ids: [] }] });
    expect(getScope().carriedPlanId).toBeUndefined();
    fireEvent.change(screen.getByLabelText('首页输入'), { target: { value: '继续输入' } });
    await waitFor(() => expect(writes.some((value) => value.state.content === '继续输入')).toBe(true));
    expect(writes.every((value) => value.state.scope?.carriedPlanId === undefined)).toBe(true);
    expect(JSON.stringify(writes)).not.toContain('never-persist');
  });
  it('对话中刚严格收缩带来的新计划不被旧草稿的范围覆盖', async () => {
    docs.set('guid', doc('guid'));
    restoreScope({
      items: [{ source_id: 'src-keep', name: '保留库' }],
      views: [],
      origin: 'turn',
      carriedPlanId: 'plan-new',
    });
    render(<GuidHarness />);
    await waitFor(() => expect(screen.getByLabelText('首页输入')).toHaveValue(sourceState.content));
    expect(getScope()).toMatchObject({ carriedPlanId: 'plan-new', items: [{ source_id: 'src-keep' }] });
    resetAccountScopedState(); // 换账号：上一个账号收缩带来的计划不能留给下一个账号
    expect(getScope().carriedPlanId).toBeUndefined();
  });
  it('A535：严格收缩来源标记不写进草稿，离开首页即清，之后的新会话不再带着它', async () => {
    docs.set('guid', doc('guid'));
    restoreScope({
      items: [{ source_id: 'src-keep', name: '保留库' }],
      views: [],
      origin: 'turn',
      carriedPlanId: 'plan-new',
    });
    const first = render(<GuidHarness />);
    await waitFor(() => expect(screen.getByLabelText('首页输入')).toHaveValue(sourceState.content));
    fireEvent.change(screen.getByLabelText('首页输入'), { target: { value: '收缩后输入' } });
    await waitFor(() => expect(writes.some((value) => value.state.content === '收缩后输入')).toBe(true));
    expect(writes.every((value) => value.state.scope?.carriedPlanId === undefined)).toBe(true);
    first.unmount();
    expect(getScope().carriedPlanId).toBeUndefined();
    render(<GuidHarness />);
    await waitFor(() => expect(screen.getByLabelText('首页输入')).toBeInTheDocument());
    expect(getScope().carriedPlanId).toBeUndefined();
  });
  it('明确路由提问和目录优先，已保存范围不覆盖明确项目意图', async () => {
    docs.set('guid', doc('guid'));
    restoreScope({ items: [], views: [], origin: 'turn', projectId: 'explicit-project' });
    render(
      <GuidHarness
        navigation={{ prefillPrompt: '新明确问题', workspace: '/explicit', mycoworkProjectId: 'explicit-project' }}
      />
    );
    await waitFor(() => expect(screen.getByLabelText('首页输入')).toHaveValue('新明确问题'));
    expect(screen.getByText(/"dir"/)).toHaveTextContent('/explicit');
    expect(getScope().projectId).toBe('explicit-project');
  });
  it('失效模型保留原模型ID并禁发，不悄悄换默认模型', async () => {
    docs.set('guid', doc('guid'));
    render(<GuidHarness unavailable />);
    await screen.findByText('草稿中的模型已不可用，请重新选择模型后发送。');
    expect(screen.getByRole('button', { name: '发送门禁' })).toBeDisabled();
    expect(docs.get('guid')?.state.choices?.model_id).toBe('model-a');
  });
  it('读取失败可见且可重试，失败时不写空草稿', async () => {
    docs.set('guid', doc('guid'));
    failRead = true;
    render(<GuidHarness />);
    await screen.findByText(/草稿尚未保存/);
    expect(writes).toHaveLength(0);
    expect(screen.getByRole('button', { name: '发送门禁' })).toBeDisabled();
    failRead = false;
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    await waitFor(() => expect(screen.getByLabelText('首页输入')).toHaveValue(sourceState.content));
  });
  it('交接先写目标，等待明确受理时首页源和sessionStorage均保留', async () => {
    const source = doc('guid');
    docs.set('guid', source);
    await handoffGuidDraft('conversation-a', source, { ownerKey: 'owner-a', isCurrent: () => true });
    expect(docs.get('conversation:conversation-a')?.state).toEqual(sourceState);
    const send = vi.fn(() => new Promise<void>(() => {}));
    render(<ConversationHarness send={send} />);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(docs.get('guid')?.state.content).toBe(sourceState.content);
    expect(sessionStorage.getItem('aionrs_initial_message_conversation-a')).not.toBeNull();
    expect(screen.getByLabelText('对话输入')).toHaveValue(sourceState.content);
  });
});
