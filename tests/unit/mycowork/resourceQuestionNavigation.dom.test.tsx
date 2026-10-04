/**
 * 文件：tests/unit/mycowork/resourceQuestionNavigation.dom.test.tsx
 * [mycowork] 职责：经真实 Router、ScopeChip 与 Bridge 客户端核验资料提问意图。
 * 边界：只在账号、原生元数据和 HTTP 边界使用虚构数据，不依赖服务或公司资料。
 * 关联：MyCowork docs/contracts/navigation-intent.md；PR11 B2b。
 */
import React from 'react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button } from '@arco-design/web-react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BridgeError, getScope, setScopeSelection, type ScopeDraft } from '@mycowork/ui';
import type { ConversationContext } from '@mycowork/contracts';
import { GuidScopeSlot } from '@/renderer/mycowork-slots';
import { useResourceQuestionNavigation } from '@/renderer/mycowork-resource-navigation';
import MyCoworkRail from '@/renderer/mycowork-rail';
import { LayoutContext, useLayoutContext, type GuidWorkContext } from '@/renderer/hooks/context/LayoutContext';

const boundary = vi.hoisted(() => ({
  owner: 'fixture-owner',
  nativeGet: vi.fn(),
  fetch: vi.fn(),
  workspace: '/fixture/controlled',
}));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { get: { invoke: boundary.nativeGet } } } }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: boundary.owner } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('@/renderer/pages/conversation/Preview/components/editors', () => ({
  CodeEditor: (): null => null,
  MarkdownEditor: (): null => null,
}));
vi.mock('@/renderer/components/Markdown', () => ({ default: (): null => null }));
vi.mock('@/renderer/pages/conversation/Preview/components/viewers', () => ({ MarkdownViewer: (): null => null }));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({ useFeedback: () => ({ openFeedback: vi.fn() }) }));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ activeId: 'system', selectTheme: vi.fn() }),
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: vi.fn(), clearPreviewForScope: vi.fn() }),
}));

const selected: ScopeDraft = {
  items: [{ source_id: 'src_fixture', name: '所选虚构库', resource_ids: ['res_one'] }],
  views: [],
  requiredResourceIds: ['res_one'],
};
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const context = (projectId?: string): ConversationContext => ({
  plan_id: 'plan_fixture',
  version: 1,
  status: 'OK',
  ...(projectId ? { working_project_id: projectId } : {}),
  brief: { groups: [], refs: {}, excluded: 0, unauthorized: 0, policy: { strict: true, web: 'off' } },
  used: [],
  withheld: 0,
  superseded: false,
});
let ask: (draft: ScopeDraft, signal: AbortSignal) => Promise<void>;
let navigate: ReturnType<typeof useNavigate>;
function SpaceHarness() {
  ask = useResourceQuestionNavigation(boundary.owner);
  return <div>空间</div>;
}
function RouteProbe() {
  const location = useLocation();
  navigate = useNavigate();
  return <output data-testid='route'>{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>;
}
function GuidHarness() {
  return (
    <>
      <GuidScopeSlot workspace={boundary.workspace} />
      <Button onClick={() => setScopeSelection([{ source_id: 'src_other', name: '重选库' }])}>重选</Button>
    </>
  );
}
function LayoutHarness({ children }: { children: React.ReactNode }) {
  const [guidWork, setGuidWork] = React.useState<GuidWorkContext | null>(null);
  return (
    <LayoutContext.Provider
      value={{ isMobile: false, siderCollapsed: false, setSiderCollapsed: vi.fn(), guidWork, setGuidWork }}
    >
      <MyCoworkRail />
      <WorkProbe />
      {children}
    </LayoutContext.Provider>
  );
}
function WorkProbe() {
  return <output data-testid='work'>{JSON.stringify(useLayoutContext()?.guidWork)}</output>;
}
function tree(state: unknown = null, pathname = '/office/space') {
  return (
    <MemoryRouter initialEntries={[{ pathname, state }]}>
      <LayoutHarness>
        <Routes>
          <Route path='/office/space' element={<SpaceHarness />} />
          <Route path='/guid' element={<GuidHarness />} />
          <Route path='/settings/agent' element={<div>设置</div>} />
          <Route path='/conversation/:id' element={<div>会话</div>} />
        </Routes>
        <RouteProbe />
      </LayoutHarness>
    </MemoryRouter>
  );
}
function mount(state: unknown = null, pathname = '/office/space') {
  return render(tree(state, pathname));
}
function origin(extra = {}) {
  return {
    mycoworkResourceOrigin: { ownerKey: 'fixture-owner', originConversationId: 'fixture/conversation', ...extra },
  };
}
async function submit(signal = new AbortController().signal) {
  await act(async () => {
    await ask(selected, signal);
  });
}

beforeEach(() => {
  boundary.owner = 'fixture-owner';
  boundary.workspace = '/fixture/controlled';
  boundary.nativeGet.mockReset();
  boundary.fetch.mockReset();
  vi.stubGlobal('fetch', boundary.fetch);
  boundary.nativeGet.mockResolvedValue({ project_id: 'native-project', extra: { workspace: '/fixture/native' } });
  boundary.fetch.mockResolvedValue(reply(200, context('bridge-project')));
  setScopeSelection([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('bound Bridge project wins over native project and consumes transfer without loading defaults', async () => {
  mount(origin());
  await submit();
  await screen.findByRole('button', { name: '资料范围（本轮修改）：所选虚构库（挑选 1 份）' });
  expect(getScope()).toMatchObject({ ...selected, projectId: 'bridge-project' });
  expect(boundary.nativeGet).toHaveBeenCalledExactlyOnceWith({ id: 'fixture%2Fconversation' });
  expect(boundary.fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('route').textContent).toBe(JSON.stringify({ pathname: '/guid', state: null }));
});

it('bound temporary plan never falls back to native project', async () => {
  boundary.fetch.mockResolvedValue(reply(200, context()));
  mount(origin());
  await submit();
  expect(getScope().projectId).toBeUndefined();
  expect(getScope().requiredResourceIds).toEqual(['res_one']);
});

it('only missing Bridge binding permits the verified native project fallback', async () => {
  boundary.fetch.mockResolvedValue(reply(404, { error: { code: 'NOT_FOUND' } }));
  mount(origin());
  await submit();
  expect(getScope().projectId).toBe('native-project');
});

it('direct Space entry starts a temporary task and ignores an unverified project on the draft', async () => {
  mount();
  await act(async () => {
    await ask({ ...selected, projectId: 'not-authoritative' }, new AbortController().signal);
  });
  expect(getScope().projectId).toBeUndefined();
  expect(boundary.nativeGet).not.toHaveBeenCalled();
  expect(boundary.fetch).not.toHaveBeenCalled();
});

it.each(['native', 'bridge'])('%s metadata failure rejects preparation and stays in Space', async (failed) => {
  if (failed === 'native') boundary.nativeGet.mockRejectedValue(new Error('fixture failure'));
  else boundary.fetch.mockResolvedValue(reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE' } }));
  mount(origin());
  await expect(ask(selected, new AbortController().signal)).rejects.toMatchObject({ kind: 'failed' });
  expect(screen.getByTestId('route').textContent).toContain('/office/space');
});

it('an origin from another actor is rejected without metadata calls', async () => {
  mount(origin({ ownerKey: 'other-actor' }));
  await expect(ask(selected, new AbortController().signal)).rejects.toBeInstanceOf(BridgeError);
  expect(boundary.nativeGet).not.toHaveBeenCalled();
  expect(boundary.fetch).not.toHaveBeenCalled();
});

it.each(['abort', 'route', 'owner'])('late metadata cannot navigate after %s changes', async (change) => {
  let resolve!: (value: unknown) => void;
  boundary.nativeGet.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const view = mount(origin());
  const controller = new AbortController();
  const pending = ask(selected, controller.signal);
  if (change === 'abort') controller.abort();
  if (change === 'route')
    await act(async () => {
      await navigate('/settings/agent');
    });
  if (change === 'owner') {
    boundary.owner = 'changed-owner';
    view.rerender(tree(origin()));
  }
  await act(async () => {
    resolve({ project_id: 'native-project', extra: { workspace: '/fixture/native' } });
    await pending;
  });
  expect(getScope().requiredResourceIds).toBeUndefined();
  expect(screen.queryByRole('button', { name: /资料范围/ })).toBeNull();
});

it('preparation callback is stable across unrelated rerenders', () => {
  const view = mount(origin());
  const first = ask;
  view.rerender(tree(origin()));
  expect(ask).toBe(first);
});

it('consumed intent cannot overwrite a subsequent manual choice; a plain new task clears it', async () => {
  mount(
    { mycoworkScopeDraft: { ownerKey: 'fixture-owner', selection: selected }, workspace: '/fixture/chosen' },
    '/guid'
  );
  await waitFor(() => expect(screen.getByTestId('route').textContent).toContain('"state":null'));
  fireEvent.click(screen.getByRole('button', { name: '重选' }));
  expect(getScope().items[0]?.source_id).toBe('src_other');
  await act(async () => {
    await navigate('/guid', { state: null });
  });
  expect(getScope().items).toEqual([]);
  expect(getScope().requiredResourceIds).toBeUndefined();
});

it('wrong-actor explicit Guid intent installs empty required scope instead of ordinary chat', async () => {
  mount({ mycoworkScopeDraft: { ownerKey: 'other-owner', selection: selected } }, '/guid');
  await waitFor(() => expect(getScope().requiredResourceIds).toEqual([]));
  expect(getScope().items).toEqual([]);
  expect(boundary.fetch).not.toHaveBeenCalled();
});

it('ordinary Guid navigation retains its existing temporary hand-selected scope', async () => {
  mount(null, '/guid');
  fireEvent.click(screen.getByRole('button', { name: '重选' }));
  await act(async () => {
    await navigate('/guid', { state: { prefillPrompt: 'An unrelated prompt' } });
  });
  expect(getScope().items[0]?.source_id).toBe('src_other');
});

it('Guid rail captures the installed project and current controlled workspace after intent consumption', async () => {
  const state = {
    mycoworkScopeDraft: { ownerKey: 'fixture-owner', selection: { ...selected, projectId: 'confirmed-project' } },
  };
  const view = mount(state, '/guid');
  await waitFor(() => expect(screen.getByTestId('route').textContent).toContain('"state":null'));
  boundary.workspace = '/fixture/edited';
  view.rerender(tree(state, '/guid'));
  fireEvent.click(screen.getByRole('button', { name: '空间' }));
  expect(JSON.parse(screen.getByTestId('route').textContent!).state).toEqual({
    mycoworkResourceOrigin: {
      ownerKey: 'fixture-owner',
      projectId: 'confirmed-project',
      workspace: '/fixture/edited',
    },
  });
});

it('rail never carries a previous actor work context after account changes', async () => {
  const state = {
    mycoworkScopeDraft: { ownerKey: 'fixture-owner', selection: { ...selected, projectId: 'old-project' } },
  };
  const view = mount(state, '/guid');
  await waitFor(() => expect(screen.getByTestId('route').textContent).toContain('"state":null'));
  boundary.owner = 'changed-owner';
  view.rerender(tree(state, '/guid'));
  expect(screen.getByTestId('work').textContent).toBe(JSON.stringify({ ownerKey: 'changed-owner', workspace: '' }));
  fireEvent.click(screen.getByRole('button', { name: '空间' }));
  expect(JSON.parse(screen.getByTestId('route').textContent!).state).toEqual({
    mycoworkResourceOrigin: { ownerKey: 'changed-owner' },
  });
  expect(screen.getByTestId('work').textContent).toBe('null');
});

it('conversation rail captures the current decoded route id without querying or guessing a project', () => {
  mount(null, '/conversation/fixture%2Fconversation');
  fireEvent.click(screen.getByRole('button', { name: '空间' }));
  expect(JSON.parse(screen.getByTestId('route').textContent!).state).toEqual({
    mycoworkResourceOrigin: { ownerKey: 'fixture-owner', originConversationId: 'fixture/conversation' },
  });
  expect(boundary.nativeGet).not.toHaveBeenCalled();
  expect(boundary.fetch).not.toHaveBeenCalled();
});
