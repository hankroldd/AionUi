/**
 * [mycowork] PR10 C2/C3：消息/固定版本重建、入口哈希、目录核对和失败重试顺序。
 * 只假设HTTP/宿主边界；实际运行自有分支状态机，不执行模型、不改真实文件。
 */
import React from 'react';
import { createHash, webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { BranchDialog, BranchMessageButton, type BranchAdapter } from '@mycowork/ui/branches/index.ts';
import { VersionTimeline } from '@mycowork/ui/pages/versions/VersionTimeline.tsx';
import { versionsText } from '@mycowork/ui/pages/versions/index.ts';

const anchor = {
  conversation_id: 'source-conversation',
  message_id: 'message-7',
  is_last_message: false,
  has_turn_anchor: true,
};
const ownerKey = 'test-owner';
const skillContent = '\ufeff# 合成 Skill\r\n  原样正文\n';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
type Call = { path: string; method: string; body: any };
function setup(
  options: {
    context?: boolean;
    failure?: string;
    createUnknown?: boolean;
    workspace?: string;
    skills?: { skill_id: string; content?: string }[];
    content?: string;
  } = {}
) {
  const calls: Call[] = [];
  const order: string[] = [];
  const conversations = new Map<string, string>();
  const actualId = '07f02230';
  let fail = options.failure;
  let unknown = options.createUnknown;
  const createConversation = vi.fn(async (id: string, session: { workspace: string }) => {
    order.push('create');
    conversations.set(actualId, options.workspace ?? session.workspace);
    if (unknown) {
      unknown = false;
      throw new Error('creation response lost');
    }
    return actualId;
  });
  const adapter: BranchAdapter = {
    prepare: vi.fn(async () => ({
      label: '合成助手 · 合成模型',
      content: options.content ?? '仅所选消息',
      skills: options.skills ?? [{ skill_id: 'synthetic-skill', content: skillContent }],
      createConversation,
    })),
    readWorkspace: vi.fn(async (id: string) => {
      order.push('read');
      return conversations.get(id) ?? null;
    }),
    openConversation: vi.fn(() => {
      order.push('open');
    }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, method, body });
      if (path.endsWith('/context'))
        return options.context === false
          ? json({ error: { code: 'NOT_FOUND' } }, 404)
          : json({
              plan_id: 'source-plan',
              brief: { groups: [], policy: {} },
              used: [],
              withheld: 0,
              superseded: false,
            });
      if (path === '/bridge/v1/context-plans') {
        order.push('plan');
        return json({ plan_id: 'empty-plan', status: 'EMPTY_SCOPE', brief: { explicit_empty: true, groups: [] } });
      }
      const stage =
        path === '/bridge/v1/branches'
          ? 'branch'
          : path.endsWith('/tokens')
            ? 'token'
            : path.endsWith('/execution')
              ? 'execution'
              : path.endsWith('/plan')
                ? 'bind'
                : path.startsWith('/bridge/v1/drafts/')
                  ? 'draft'
                  : undefined;
      if (stage) order.push(stage);
      if (stage && stage === fail) {
        fail = undefined;
        return json({ error: { code: 'BRANCH_STATE_CONFLICT' } }, 409);
      }
      if (stage === 'branch')
        return json({
          branch_id: 'branch-1',
          mode: 'rebuild',
          workspace: '/synthetic/branch',
          manifest: {
            anchor: body.anchor,
            context_plan: body.independent_context_plan
              ? { plan_id: 'branch-plan', version: 1, source_plan_id: body.context_plan_id }
              : { plan_id: body.context_plan_id, version: 1 },
            files: body.files.map((f: any) => ({ ...f, file_name: '合成资料.md', content_sha256: 'f'.repeat(64) })),
            skills: [],
          },
          execution: null,
        });
      if (stage === 'token')
        return json({
          workspace: '/synthetic/branch',
          session_mcp_server: {
            id: 'branch-mcp',
            name: 'Branch MCP',
            transport: { type: 'streamable_http', url: '/bridge/v1/mcp', headers: {} },
          },
        });
      if (stage === 'draft')
        return json({
          draft_id: 'draft-1',
          input_location: decodeURIComponent(path.split('/').at(-1)!),
          revision: 1,
          submission_id: body.submission_id,
          state: body.state,
          updated_at: '2026-10-15T00:00:00Z',
        });
      if (stage) return json({});
      if (path.startsWith('/bridge/v1/resources?'))
        return json({
          items: [
            {
              resource_id: 'file-1',
              file_name: '合成资料.md',
              origin: 'imports',
              tag_ids: [],
              updated_at: '2026-10-15T00:00:00Z',
            },
          ],
          total: 1,
          page_size: 50,
        });
      if (path.endsWith('/revisions'))
        return json({
          total: 2,
          file_name: '合成资料.md',
          current_revision_id: 'rev-2',
          items: [
            { revision_id: 'rev-2', created_at: '2026-10-15T00:00:00Z' },
            { revision_id: 'rev-1', created_at: '2026-10-14T00:00:00Z' },
          ],
        });
      throw new Error(`Unexpected request: ${method} ${path}`);
    })
  );
  return { adapter, createConversation, calls, order, conversations, actualId };
}
const mount = (adapter: BranchAdapter, extra = {}) =>
  render(
    <BranchDialog
      anchor={anchor}
      ownerKey={ownerKey}
      adapter={adapter}
      lang='zh-CN'
      onCancel={vi.fn()}
      files={[]}
      {...extra}
    />
  );
const create = async () => {
  const button = await screen.findByRole('button', { name: '创建会话' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('分支创建的真实UI状态机', () => {
  it('消息分支POST固定源计划并申请独立快照，后续令牌和绑定用返回计划及真实会话ID', async () => {
    const s = setup();
    mount(s.adapter);
    await screen.findByText(/入口哈希已冻结/);
    expect(s.calls).toHaveLength(0);
    await create();
    await waitFor(() => expect(s.adapter.openConversation).toHaveBeenCalledOnce());
    expect(s.order).toEqual(['branch', 'token', 'create', 'read', 'execution', 'bind', 'draft', 'open']);
    const request = s.calls.find((c) => c.path === '/bridge/v1/branches')!.body;
    expect(request).toMatchObject({
      anchor,
      context_plan_id: 'source-plan',
      independent_context_plan: true,
      skills: [
        {
          skill_id: 'synthetic-skill',
          content_sha256: createHash('sha256').update(skillContent, 'utf8').digest('hex'),
        },
      ],
    });
    const proposedId = s.createConversation.mock.calls[0]![0];
    expect(proposedId).not.toBe(s.actualId);
    const id = s.actualId;
    expect(s.calls.find((c) => c.path.endsWith('/tokens'))!.path).toBe('/bridge/v1/context-plans/branch-plan/tokens');
    expect(s.createConversation.mock.calls[0]![1]).toMatchObject({ plan_id: 'branch-plan' });
    expect(s.adapter.readWorkspace).toHaveBeenCalledWith(id, ['synthetic-skill']);
    expect(s.calls.find((c) => c.path.endsWith('/execution'))!.body.conversation_id).toBe(id);
    expect(s.calls.find((c) => c.path.endsWith('/plan'))!.path).toBe(`/bridge/v1/conversations/${id}/plan`);
    expect(s.calls.find((c) => c.path.endsWith('/plan'))!.body).toEqual({ plan_id: 'branch-plan' });
    expect(s.adapter.openConversation).toHaveBeenCalledWith(id);
    const draft = s.calls.find((c) => c.path.startsWith('/bridge/v1/drafts/'))!;
    expect(draft.path).toBe(`/bridge/v1/drafts/${encodeURIComponent(`conversation:${id}`)}`);
    expect(draft.body).toEqual({
      expected_revision: 0,
      submission_id: request.submission_id,
      state: { content: '仅所选消息', files: [], sessions: [], workspace: '/synthetic/branch' },
    });
  });

  it.each(['branch', 'token', 'execution', 'bind', 'draft'])(
    '%s失败不导航；显式重试继续同一创建身份',
    async (failure) => {
      const s = setup({ failure });
      mount(s.adapter);
      await create();
      const retry = await screen.findByRole('button', { name: '重试' });
      expect(s.adapter.openConversation).not.toHaveBeenCalled();
      const before = s.calls.filter((c) => c.path === '/bridge/v1/branches').map((c) => c.body);
      fireEvent.click(retry);
      await waitFor(() => expect(s.adapter.openConversation).toHaveBeenCalledOnce());
      const branches = s.calls.filter((c) => c.path === '/bridge/v1/branches').map((c) => c.body);
      expect(branches.every((body) => JSON.stringify(body) === JSON.stringify(before[0]))).toBe(true);
      expect(s.createConversation).toHaveBeenCalledOnce();
      expect(s.adapter.prepare).toHaveBeenCalledOnce();
      expect(
        s.calls.filter((c) => c.path.endsWith('/execution')).every((c) => c.body.conversation_id === s.actualId)
      ).toBe(true);
      expect(s.adapter.openConversation).toHaveBeenCalledWith(s.actualId);
    }
  );

  it('创建响应未知时保留现场并提示会话列表检查，结果未确认按钮禁用，不再创建或GET预设ID', async () => {
    const s = setup({ createUnknown: true });
    mount(s.adapter);
    await create();
    expect(await screen.findByText('创建结果未确认，请在会话列表检查；不会重复创建。')).toBeInTheDocument();
    const unconfirmed = screen.getByRole('button', { name: '结果未确认' });
    expect(unconfirmed).toBeDisabled();
    fireEvent.click(unconfirmed);
    await screen.findByText('创建结果未确认，请在会话列表检查；不会重复创建。');
    expect(s.createConversation).toHaveBeenCalledOnce();
    expect(s.adapter.readWorkspace).not.toHaveBeenCalled();
    expect(s.adapter.openConversation).not.toHaveBeenCalled();
    expect(s.calls.some((c) => c.path.endsWith('/execution'))).toBe(false);
    expect(s.calls.filter((c) => c.path === '/bridge/v1/branches')).toHaveLength(1);
    expect(screen.queryByText(/重试将继续未完成的步骤/)).toBeNull();
    expect(screen.getByTestId('branch-config')).toHaveTextContent('合成助手 · 合成模型');
  });

  it('同一会话目录已存在但Skill核验拒绝，显式重试也不能绕过进入execution', async () => {
    const s = setup();
    vi.mocked(s.adapter.readWorkspace).mockImplementation(async (id, skillIds) => {
      expect(skillIds).toEqual(['synthetic-skill']);
      if (s.conversations.has(id)) throw new Error('SKILL_MISMATCH');
      return null;
    });
    mount(s.adapter);
    await create();
    fireEvent.click(await screen.findByRole('button', { name: '重试' }));
    await waitFor(() => expect(s.adapter.readWorkspace).toHaveBeenCalledTimes(2));
    expect(s.createConversation).toHaveBeenCalledOnce();
    expect(s.calls.some((c) => c.path.endsWith('/execution'))).toBe(false);
    expect(s.adapter.openConversation).not.toHaveBeenCalled();
  });

  it('会话目录读回不匹配，停止在execution之前', async () => {
    const s = setup({ workspace: '/synthetic/wrong' });
    mount(s.adapter);
    await create();
    await screen.findByText(/新会话目录未能核实/);
    expect(s.order).toEqual(['branch', 'token', 'create', 'read']);
    expect(s.adapter.openConversation).not.toHaveBeenCalled();
  });

  it('无原会话计划时明确创建空范围；缺Skill正文仅名称，不添加假哈希', async () => {
    const s = setup({ context: false, skills: [{ skill_id: 'missing-skill' }] });
    mount(s.adapter);
    await screen.findByText(/仅名称，未冻结正文/);
    await create();
    await waitFor(() => expect(s.adapter.openConversation).toHaveBeenCalledOnce());
    expect(s.calls.find((c) => c.path === '/bridge/v1/context-plans')!.body).toEqual({
      explicit_empty: true,
      use_project_defaults: false,
    });
    expect(s.calls.find((c) => c.path === '/bridge/v1/branches')!.body).toMatchObject({
      context_plan_id: 'empty-plan',
      skills: [{ skill_id: 'missing-skill' }],
    });
  });

  it('哈希能力失效时拒绝创建，不降级成仅名称', async () => {
    const s = setup();
    vi.stubGlobal('crypto', {
      randomUUID: () => webcrypto.randomUUID(),
      subtle: { digest: vi.fn().mockRejectedValue(new Error('hash unavailable')) },
    });
    mount(s.adapter);
    await screen.findByText(/无法计算 Skill 入口哈希/);
    expect(screen.getByRole('button', { name: '创建会话' })).toBeDisabled();
    expect(s.calls).toHaveLength(0);
  });

  it('超长消息明确报错，不截断、不发写请求', async () => {
    const s = setup({ content: 'x'.repeat(262145) });
    mount(s.adapter);
    await screen.findByText(/所选消息超过输入框可保存的长度/);
    expect(s.calls).toHaveLength(0);
  });

  it.each(['owner', 'unmount'])('在途配置准备期间%s变化后不继续创建', async (change) => {
    const s = setup();
    let release!: (value: any) => void;
    const original = await s.adapter.prepare(anchor);
    vi.mocked(s.adapter.prepare).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const view = mount(s.adapter);
    if (change === 'owner')
      view.rerender(
        <BranchDialog
          anchor={anchor}
          files={[]}
          ownerKey='other-owner'
          adapter={s.adapter}
          lang='zh-CN'
          onCancel={vi.fn()}
        />
      );
    else view.unmount();
    await act(async () => release(original));
    expect(s.calls).toHaveLength(0);
    expect(s.adapter.openConversation).not.toHaveBeenCalled();
  });

  it.each(['owner', 'unmount'])('在途会话创建期间%s变化后不登记、不绑定、不导航', async (change) => {
    const s = setup();
    let release!: () => void;
    s.createConversation.mockImplementationOnce(async (id, session) => {
      s.conversations.set(s.actualId, session.workspace);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return s.actualId;
    });
    const view = mount(s.adapter);
    await create();
    await waitFor(() => expect(s.createConversation).toHaveBeenCalledOnce());
    if (change === 'owner')
      view.rerender(
        <BranchDialog
          anchor={anchor}
          files={[]}
          ownerKey='other-owner'
          adapter={s.adapter}
          lang='zh-CN'
          onCancel={vi.fn()}
        />
      );
    else view.unmount();
    await act(async () => release());
    expect(
      s.calls.some((c) => c.path.endsWith('/execution') || c.path.endsWith('/plan') || c.path.includes('/drafts/'))
    ).toBe(false);
    expect(s.adapter.openConversation).not.toHaveBeenCalled();
  });

  it('P04必须明确选择不复制文件；不宣称冻结整个文件现场', async () => {
    const s = setup();
    render(<BranchMessageButton anchor={anchor} ownerKey={ownerKey} adapter={s.adapter} lang='zh-CN' />);
    fireEvent.click(screen.getByRole('button', { name: '基于此内容新建会话' }));
    await screen.findByText(/入口哈希已冻结/);
    expect(screen.getByRole('button', { name: '创建会话' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('不复制文件，仅基于这条消息创建'));
    await create();
    await waitFor(() => expect(s.adapter.openConversation).toHaveBeenCalledOnce());
    expect(s.calls.find((c) => c.path === '/bridge/v1/branches')!.body.files).toEqual([]);
  });

  it('P04从授权资源列表明确选择历史版本，冻结并在草稿说明所复制版本', async () => {
    const s = setup();
    render(<BranchMessageButton anchor={anchor} ownerKey={ownerKey} adapter={s.adapter} lang='zh-CN' />);
    fireEvent.click(screen.getByRole('button', { name: '基于此内容新建会话' }));
    fireEvent.click(screen.getByLabelText('复制选定文件版本'));
    await waitFor(() => expect(s.calls.some((c) => c.path.startsWith('/bridge/v1/resources?'))).toBe(true));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '选择文件' })).not.toHaveClass('arco-select-disabled')
    );
    fireEvent.click(screen.getByRole('combobox', { name: '选择文件' }));
    fireEvent.click(await screen.findByText('合成资料.md'));
    await waitFor(() => expect(s.calls.some((c) => c.path.endsWith('/file-1/revisions'))).toBe(true));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '选择版本' })).not.toHaveClass('arco-select-disabled')
    );
    fireEvent.click(screen.getByRole('combobox', { name: '选择版本' }));
    fireEvent.click(await screen.findByText('v1 · 2026-10-14T00:00:00Z'));
    fireEvent.click(screen.getByRole('button', { name: '加入分支' }));
    await create();
    await waitFor(() => expect(s.adapter.openConversation).toHaveBeenCalledOnce());
    expect(s.calls.find((c) => c.path === '/bridge/v1/branches')!.body.files).toEqual([
      { resource_id: 'file-1', revision_id: 'rev-1' },
    ]);
    expect(s.calls.find((c) => c.path.includes('/drafts/'))!.body.state.content).toContain('合成资料.md (rev-1)');
  });

  it('P12更多菜单固定选中历史版本，anchor:null且不查询原会话计划', async () => {
    const s = setup();
    const props = {
      items: [
        { revision_id: 'historical-rev', origin: 'edit', created_at: '2026-10-14T00:00:00Z', current: false } as any,
      ],
      pubs: [],
      pubsStale: false,
      selected: undefined,
      lang: 'zh-CN',
      text: versionsText('zh-CN'),
      vOf: () => 'v1',
      kbName: () => undefined,
      canAct: true,
      more: { has: false, loading: false, onLoad: vi.fn() },
      onSelect: vi.fn(),
      onRestore: vi.fn(),
      resourceId: 'file-1',
      headRevisionId: 'latest-rev',
      ownerKey,
      fileName: '合成文件.md',
      onAccept: vi.fn(),
      onRetry: vi.fn(),
      branchAdapter: s.adapter,
    };
    render(<VersionTimeline {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作 v1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '从此分支' }));
    expect(await screen.findByText(/只复制所选版本，不继承原会话/)).toBeInTheDocument();
    await create();
    await waitFor(() => expect(s.adapter.openConversation).toHaveBeenCalledOnce());
    expect(s.adapter.prepare).toHaveBeenCalledWith(null);
    expect(s.calls.some((c) => c.path.endsWith('/context'))).toBe(false);
    expect(s.calls.find((c) => c.path === '/bridge/v1/branches')!.body).toMatchObject({
      anchor: null,
      files: [{ resource_id: 'file-1', revision_id: 'historical-rev' }],
      context_plan_id: 'empty-plan',
    });
    expect(s.calls.find((c) => c.path === '/bridge/v1/branches')!.body).not.toHaveProperty('independent_context_plan');
    expect(s.calls.find((c) => c.path.includes('/drafts/'))!.body.state.content).toContain(
      '合成资料.md (historical-rev)'
    );
  });
});
