/**
 * [mycowork] A197: the scene assistant ("Report / PPT", id `mycowork-scene-*`) gets the Bridge tools with an explicit EMPTY
 * scope plan when nothing is selected; any other assistant keeps the plain no-scope send. A scope picked by hand or a project
 * default behaves exactly as before. The scope strip says "no sources selected" for the explicit empty plan (never a library).
 * Only external boundaries are mocked (Bridge = fetch).
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { isSceneAssistant, setScopeSelection } from '@mycowork/ui';
import { enterProject, setProjectDefaults } from '@mycowork/ui/scope-picker/scope-store.ts';
import { ConversationScopeSlot, withGuidScope } from '@/renderer/mycowork-slots';

vi.mock('@/common', () => ({
  ipcBridge: { conversation: { responseStream: { on: () => () => {} } } },
}));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ state: null }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const SERVER = {
  id: 'mycowork_bridge',
  name: 'mycowork_bridge',
  transport: {
    type: 'streamable_http',
    url: 'http://127.0.0.1:25900/bridge/mcp',
    headers: { Authorization: 'Bearer t' },
  },
};
const TOKEN = {
  token: 't',
  expires_at: '2026-10-08T20:00:00Z',
  mcp: {},
  session_mcp_server: SERVER,
  workspace: '/data/ws/1',
};
const EMPTY_PLAN = {
  plan_id: 'plan_e',
  version: 1,
  status: 'EMPTY_SCOPE',
  brief: { groups: [], explicit_empty: true, policy: { strict: false, web: 'off' } },
};
const SCENE = 'mycowork-scene-ppt';

describe('withGuidScope for the scene assistant (A197)', () => {
  beforeEach(() => {
    setScopeSelection([]);
    enterProject(undefined);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends an explicit empty plan and mounts the Bridge MCP server when no scope is selected', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, EMPTY_PLAN)).mockResolvedValueOnce(reply(201, TOKEN));
    const overrides = { permission: 'yolo' };
    const out = await withGuidScope({ workspace: '', custom_workspace: false }, overrides, SCENE);
    expect(fetchMock.mock.calls[0][0]).toBe('/bridge/v1/context-plans');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ explicit_empty: true, use_project_defaults: false });
    expect(fetchMock.mock.calls[1][0]).toBe('/bridge/v1/context-plans/plan_e/tokens');
    expect(out.selected_session_mcp_servers).toEqual([SERVER]);
    expect(out).toMatchObject({ workspace: '/data/ws/1', custom_workspace: true });
    expect(overrides.permission).toBe('default'); // D115 unchanged for scoped sessions
  });

  it('keeps the working project on the empty plan when the project has no default scope', async () => {
    enterProject('proj-1');
    setProjectDefaults('proj-1', []);
    fetchMock.mockResolvedValueOnce(reply(201, EMPTY_PLAN)).mockResolvedValueOnce(reply(201, TOKEN));
    await withGuidScope({}, undefined, SCENE);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      working_project_id: 'proj-1',
      explicit_empty: true,
      use_project_defaults: false,
    });
  });

  it('does nothing for other assistants, and for no assistant id: extra unchanged, no Bridge call', async () => {
    for (const id of ['assistant-1', 'builtin-claude', 'x-mycowork-scene-ppt', 'mycowork-scenery', '', undefined]) {
      const extra = { workspace: '', custom_workspace: false };
      await expect(withGuidScope(extra, undefined, id)).resolves.toBe(extra);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with a hand-picked scope the request is the same as for any assistant (no explicit_empty)', async () => {
    setScopeSelection([{ source_id: 'src_a', name: 'A' }]);
    fetchMock
      .mockResolvedValueOnce(reply(201, { plan_id: 'plan_1', version: 1, status: 'OK' }))
      .mockResolvedValueOnce(reply(201, TOKEN));
    await withGuidScope({}, undefined, SCENE);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      scopes: [{ selector: 'knowledge_base', id: 'src_a' }],
      use_project_defaults: false,
    });
  });

  it('with project default sources the request is the project selector (no explicit_empty)', async () => {
    enterProject('proj-1');
    setProjectDefaults('proj-1', [{ source_id: 'src_a', name: 'A' }]);
    fetchMock
      .mockResolvedValueOnce(reply(201, { plan_id: 'plan_1', version: 1, status: 'OK' }))
      .mockResolvedValueOnce(reply(201, TOKEN));
    await withGuidScope({}, undefined, SCENE);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      working_project_id: 'proj-1',
      scopes: [{ selector: 'project', id: 'proj-1' }],
      use_project_defaults: false,
    });
  });

  it('refuses to send when the Bridge answers an explicit empty request with an unmarked EMPTY_SCOPE plan', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(201, { plan_id: 'plan_x', version: 1, status: 'EMPTY_SCOPE', brief: { groups: [] } })
    );
    await expect(withGuidScope({}, undefined, SCENE)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no token issued
  });

  it('recognises only ids that start with mycowork-scene-', () => {
    expect([SCENE, 'mycowork-scene-x'].every(isSceneAssistant)).toBe(true);
    expect(['mycowork-scene', 'MyCowork-scene-ppt', ' mycowork-scene-ppt', undefined].some(isSceneAssistant)).toBe(
      false
    );
  });
});

describe('scope strip for the explicit empty plan (A197)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const context = (brief: object) => ({
    plan_id: 'plan_e',
    version: 1,
    status: 'EMPTY_SCOPE',
    brief,
    used: [],
    withheld: 0,
    superseded: false,
  });

  it('says no sources are selected and cites none, not a library and not "not searchable"', async () => {
    fetchMock.mockResolvedValue(
      reply(200, context({ groups: [], explicit_empty: true, policy: { strict: false, web: 'off' } }))
    );
    render(<ConversationScopeSlot conversation_id='conv-e' />);
    expect(await screen.findByText(/未选资料（本轮不引用任何资料）/)).toBeInTheDocument();
    expect(screen.queryByText(/当前不可检索/)).toBeNull();
    expect(screen.getByRole('button', { name: '更改范围' })).toBeInTheDocument(); // the user can still open the picker
  });

  it('an emptied plan that is not explicit keeps the "not searchable" wording', async () => {
    fetchMock.mockResolvedValue(reply(200, context({ groups: [], policy: { strict: false, web: 'off' } })));
    render(<ConversationScopeSlot conversation_id='conv-r' />);
    expect(await screen.findByText(/所选资料当前不可检索/)).toBeInTheDocument();
    expect(screen.queryByText(/未选资料（本轮/)).toBeNull();
  });
});
