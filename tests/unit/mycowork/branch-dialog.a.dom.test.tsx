/**
 * [mycowork] adapted：分支创建 UI 状态机（拆分a，原 branch-dialog.dom.test.tsx，用例原样）。
 */
import React from 'react';
import { createHash, webcrypto } from 'node:crypto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { anchor, skillContent, setup, mount, create } from './branch-dialog.fixture';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('分支创建的真实UI状态机', () => {
  it('消息分支POST固定源计划并申请独立快照，后续令牌和绑定用返回计划及真实会话ID', async () => {
    const s = setup();
    mount(s.adapter);
    fireEvent.click(await screen.findByRole('button', { name: /技术细节/ })); // 技能明细默认折叠
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
    fireEvent.click(await screen.findByRole('button', { name: /技术细节/ }));
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
});
