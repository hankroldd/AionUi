/**
 * [mycowork] ADR-0011: Guid page opened from a project ("ask about this project", router state mycoworkProjectId).
 * The chip starts from the project's default sources (GET /bridge/v1/scopes projects[]); sending freezes a plan with
 * working_project_id + the `project` selector; changing the scope applies to this turn only and never PUTs the binding
 * (MyCowork 01 §5, R009). Without a project id the behaviour is unchanged. Only the Bridge boundary (fetch) is mocked.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { Button } from '@arco-design/web-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { GuidScopeSlot, withGuidScope } from '@/renderer/mycowork-slots';

vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = { total: 3, ready: 3, indexing: 0, failed: 0, unavailable: 0 };
const catalog = (projects: Array<{ project_id: string; source_ids: string[] }>) => ({
  sources: [
    { source_id: 'src_a', name: '产品知识库', provider: 'weknora', counts },
    { source_id: 'src_b', name: '项目A资料', provider: 'weknora', counts },
  ],
  projects,
});
const TOKEN = {
  token: 't',
  expires_at: '2026-09-25T20:00:00Z',
  mcp: {},
  session_mcp_server: {
    id: 'mycowork_bridge',
    name: 'mycowork_bridge',
    transport: {
      type: 'streamable_http',
      url: 'http://127.0.0.1:25900/bridge/mcp',
      headers: { Authorization: 'Bearer t' },
    },
  },
  workspace: '/data/ws/1',
};

/** Route every Bridge call by URL; returns the plan request bodies sent. */
const bridge = (scopes: () => Promise<unknown> | unknown) => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/scopes') return scopes();
    if (url === '/bridge/v1/context-plans') return reply(201, { plan_id: 'plan_1', version: 1, status: 'OK' });
    if (url === '/bridge/v1/context-plans/plan_1/tokens') return reply(201, TOKEN);
    return reply(500, { error: { code: 'UNEXPECTED', message: url } });
  });
};
const planBodies = () =>
  fetchMock.mock.calls.filter(([url]) => url === '/bridge/v1/context-plans').map(([, init]) => JSON.parse(init.body));
const neverWritesBinding = () =>
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/binding'))).toBe(false);

// AionUi's own "new chat" re-navigates to /guid without our state while the page stays mounted
const PlainNewChat: React.FC = () => {
  const navigate = useNavigate();
  return <Button onClick={() => void navigate('/guid', { state: null })}>plain new chat</Button>;
};
const renderGuid = (state: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/guid', state }]}>
      <GuidScopeSlot />
      <PlainNewChat />
    </MemoryRouter>
  );

describe('Guid scope chip entered from a project', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the project default sources and sends the project selector with working_project_id', async () => {
    bridge(() => reply(200, catalog([{ project_id: 'proj-1', source_ids: ['src_b', 'src_revoked'] }])));
    renderGuid({ workspace: '/w/a', mycoworkProjectId: 'proj-1' });
    expect(await screen.findByRole('button', { name: '资料范围（项目默认）：项目A资料' })).toBeInTheDocument();

    const out = await withGuidScope({ workspace: '/w/a', custom_workspace: true });
    expect(planBodies()).toEqual([
      { working_project_id: 'proj-1', scopes: [{ selector: 'project', id: 'proj-1' }], use_project_defaults: false },
    ]);
    // the project's own workspace wins: the conversation stays in the project
    expect(out).toMatchObject({ workspace: '/w/a', custom_workspace: true });
    neverWritesBinding();
  });

  it('shows the empty-scope copy and sends a plain chat when the project has no default', async () => {
    bridge(() => reply(200, catalog([])));
    renderGuid({ workspace: '/w/a', mycoworkProjectId: 'proj-1' });
    expect(await screen.findByRole('button', { name: '资料范围（项目默认）：未选择' })).toBeInTheDocument();
    const extra = { workspace: '/w/a', custom_workspace: true };
    await expect(withGuidScope(extra)).resolves.toBe(extra);
    expect(planBodies()).toEqual([]);
  });

  it('changing the scope applies to this turn only: knowledge_base selectors, same project, no binding write', async () => {
    bridge(() => reply(200, catalog([{ project_id: 'proj-1', source_ids: ['src_b'] }])));
    renderGuid({ workspace: '/w/a', mycoworkProjectId: 'proj-1' });
    fireEvent.click(await screen.findByRole('button', { name: '资料范围（项目默认）：项目A资料' }));
    fireEvent.click(await screen.findByText('产品知识库'));
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    expect(
      await screen.findByRole('button', { name: '资料范围（本轮修改）：产品知识库、项目A资料' })
    ).toBeInTheDocument();
    expect(await screen.findByText('已更新本轮范围；未修改项目默认')).toBeInTheDocument();

    await withGuidScope({});
    expect(planBodies()).toEqual([
      {
        working_project_id: 'proj-1',
        scopes: [
          { selector: 'knowledge_base', id: 'src_a' },
          { selector: 'knowledge_base', id: 'src_b' },
        ],
        use_project_defaults: false,
      },
    ]);
    neverWritesBinding();
  });

  it('a this-turn choice made while the defaults are loading is not overwritten when they arrive', async () => {
    let releaseFirst: ((v: unknown) => void) | undefined;
    const first = new Promise((r) => (releaseFirst = r));
    let calls = 0;
    const full = reply(200, catalog([{ project_id: 'proj-1', source_ids: ['src_b'] }]));
    bridge(() => (++calls === 1 ? first : full));
    renderGuid({ mycoworkProjectId: 'proj-1' });
    fireEvent.click(await screen.findByRole('button', { name: '资料范围（项目默认）：读取中…' }));
    fireEvent.click(await screen.findByText('产品知识库'));
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    await screen.findByRole('button', { name: '资料范围（本轮修改）：产品知识库' });
    releaseFirst?.(full);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('button', { name: '资料范围（本轮修改）：产品知识库' })).toBeInTheDocument();
  });

  it('when the defaults cannot be read, says so and still lets the Bridge resolve the project default', async () => {
    bridge(() => reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } }));
    renderGuid({ mycoworkProjectId: 'proj-1' });
    expect(
      await screen.findByRole('button', { name: '资料范围（项目默认）：未能读取，发送时由资料服务按项目默认解析' })
    ).toBeInTheDocument();
    await withGuidScope({});
    expect(planBodies()).toEqual([
      { working_project_id: 'proj-1', scopes: [{ selector: 'project', id: 'proj-1' }], use_project_defaults: false },
    ]);
  });

  it('without a project id nothing changes: no catalog read on mount, plain chat on send', async () => {
    bridge(() => reply(200, catalog([{ project_id: 'proj-1', source_ids: ['src_b'] }])));
    renderGuid({ workspace: '/w/a' });
    expect(screen.getByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
    const extra = { workspace: '/w/a', custom_workspace: true };
    await expect(withGuidScope(extra)).resolves.toBe(extra);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a non-string project id in router state', async () => {
    bridge(() => reply(200, catalog([])));
    renderGuid({ mycoworkProjectId: { evil: true } });
    expect(screen.getByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it('a plain new chat on the still-mounted Guid page drops the project scope', async () => {
    bridge(() => reply(200, catalog([{ project_id: 'proj-1', source_ids: ['src_b'] }])));
    renderGuid({ mycoworkProjectId: 'proj-1' });
    await screen.findByRole('button', { name: '资料范围（项目默认）：项目A资料' });
    fireEvent.click(screen.getByRole('button', { name: 'plain new chat' }));
    expect(await screen.findByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
    await expect(withGuidScope({})).resolves.toEqual({});
    expect(planBodies()).toEqual([]);
  });

  it('leaving the project clears its scope (no project leaks into the next plain task)', async () => {
    bridge(() => reply(200, catalog([{ project_id: 'proj-1', source_ids: ['src_b'] }])));
    const { unmount } = renderGuid({ mycoworkProjectId: 'proj-1' });
    await screen.findByRole('button', { name: '资料范围（项目默认）：项目A资料' });
    unmount();
    renderGuid(null);
    expect(screen.getByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
    await expect(withGuidScope({})).resolves.toEqual({});
    expect(planBodies()).toEqual([]);
  });
});
