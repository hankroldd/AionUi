/**
 * 文件：tests/unit/mycowork/outputProfileSend.dom.test.tsx
 * 职责：验证首页“写作结构”（输出 Profile，D277）：选综述后办公发送与令牌请求带 profile；默认不带；没有计划时不显示也不读登记。
 * 边界：只替换HTTP边界，使用真实 ScopeChip、范围 store 与办公提交客户端；数据均为虚构。
 * 关联：MyCowork docs/contracts/output-profile.md §3；R051。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DraftDocument } from '@mycowork/contracts';
import { getScope, resetAccountScopedState, restoreScope, ScopeChip } from '@mycowork/ui';
import { submitOfficeTask } from '@mycowork/ui/task-send/index.ts';

const scene = 'mycowork-scene-ppt';
const draft: DraftDocument = {
  draft_id: 'draft-profile-fixture',
  input_location: 'guid',
  revision: 1,
  submission_id: '5b0d1f0e-3c51-4f7e-9a51-0b3f1e6c2a10',
  state: { content: '虚构的综述要求', files: [], sessions: [], choices: { assistant_id: scene, backend: 'aionrs' } },
  updated_at: '2026-10-17T12:00:00Z',
};
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
const posted: Record<string, Record<string, unknown>> = {};

beforeEach(() => {
  restoreScope({ items: [], views: [], origin: 'turn' });
  for (const key of Object.keys(posted)) delete posted[key];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.body) posted[path.endsWith('/tokens') ? 'tokens' : path] = JSON.parse(String(init.body));
      if (path === '/bridge/v1/output-profiles')
        return reply(200, {
          items: [
            { id: 'review', name: '综述' },
            { id: 'patent', name: '专利草稿' },
          ],
        });
      if (path.startsWith('/bridge/v1/tasks/lookup?')) return reply(404, { error: { code: 'NOT_FOUND' } });
      if (path === '/bridge/v1/context-plans')
        return reply(201, { plan_id: 'plan-profile', status: 'EMPTY_SCOPE', brief: { explicit_empty: true } });
      if (path.endsWith('/tokens'))
        return reply(201, {
          workspace: '/fixture/office',
          session_mcp_server: {
            id: 'mycowork_bridge',
            name: 'mycowork_bridge',
            transport: { type: 'streamable_http', url: 'http://fixture.invalid/bridge/mcp', headers: {} },
          },
        });
      if (path === '/bridge/v1/tasks')
        return reply(202, {
          run_id: 'run-profile',
          submission_id: draft.submission_id,
          status: 'running',
          created_at: '2026-10-17T12:00:00Z',
          draft_id: draft.draft_id,
          draft_revision: 1,
          conversation_id: 'conversation-profile',
          msg_id: 'msg-profile',
          turn_id: 'turn-profile',
          delivery_phase: 'accepted',
        });
      throw new Error(`未定义的虚构HTTP路径：${path}`);
    })
  );
});
afterEach(() => {
  cleanup();
  resetAccountScopedState();
  vi.unstubAllGlobals();
});

const send = () => submitOfficeTask({ ownerKey: 'owner-profile', isCurrent: () => true, draft, assistantId: scene });

it('选“综述”后，办公发送与令牌请求都带 profile=review', async () => {
  render(<ScopeChip lang='zh-CN' assistantId={scene} />);
  fireEvent.click(await screen.findByRole('combobox', { name: '写作结构' }));
  fireEvent.click(await screen.findByText('综述'));
  await waitFor(() => expect(getScope().profile).toBe('review'));
  await act(async () => void (await send()));
  expect(posted['/bridge/v1/tasks']?.profile).toBe('review');
  expect(posted.tokens?.profile).toBe('review');
});

it('默认不带 profile，发送请求与原来一致', async () => {
  render(<ScopeChip lang='zh-CN' assistantId={scene} />);
  expect(await screen.findByRole('combobox', { name: '写作结构' })).toHaveTextContent('默认');
  await act(async () => void (await send()));
  expect(posted['/bridge/v1/tasks']).not.toHaveProperty('profile');
  expect(posted.tokens).not.toHaveProperty('profile');
});

it('没有资料也不是场景助手（普通对话）时不显示写作结构', async () => {
  render(<ScopeChip lang='zh-CN' />);
  await screen.findByRole('button', { name: /资料范围/ });
  expect(screen.queryByRole('combobox', { name: '写作结构' })).toBeNull();
  expect(vi.mocked(fetch)).not.toHaveBeenCalled(); // 不展开就不读登记，普通对话没有额外请求
});
