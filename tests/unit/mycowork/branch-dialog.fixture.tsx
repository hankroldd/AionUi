/**
 * [mycowork] adapted：共享夹具（拆自 branch-dialog.dom.test.tsx）。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { BranchDialog, type BranchAdapter } from '@mycowork/ui/branches/index.ts';

export const anchor = {
  conversation_id: 'source-conversation',
  message_id: 'message-7',
  is_last_message: false,
  has_turn_anchor: true,
};
export const ownerKey = 'test-owner';
export const skillContent = '\ufeff# 合成 Skill\r\n  原样正文\n';
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
export type Call = { path: string; method: string; body: any };
export function setup(
  options: {
    context?: boolean;
    failure?: string;
    createUnknown?: boolean;
    workspace?: string;
    skills?: { skill_id: string; content?: string }[];
    content?: string;
    profileTokenSha256?: string | null;
    systemPrompt?: string;
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
      ...(options.profileTokenSha256 === undefined ? {} : { profileTokenSha256: options.profileTokenSha256 }),
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
          ...(options.systemPrompt === undefined ? {} : { system_prompt: options.systemPrompt }),
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
export const mount = (adapter: BranchAdapter, extra = {}) =>
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
export const create = async () => {
  const button = await screen.findByRole('button', { name: '创建会话' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
};
