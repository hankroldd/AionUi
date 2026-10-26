/**
 * 文件：tests/unit/mycowork/resourceSwitchScopeEntry.dom.test.tsx
 * [mycowork] 职责：R047 显式切换入口——空间浏览视图“切换原对话资料范围”只在有来源对话时出现，导航回该对话并预填“更改范围”确认框；确认前不写任何东西；被篡改的意图一律忽略。
 * 边界：只在账号、原生元数据和 HTTP 边界使用虚构数据。
 * 关联：MyCowork docs/contracts/navigation-intent.md §2b；PR03 R047。
 */
import React from 'react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScopeStrip, type ScopeDraft } from '@mycowork/ui';
import { useResourceScopeSwitch, useScopeChangeProposal } from '@/renderer/mycowork-resource-navigation';

const boundary = vi.hoisted(() => ({ nativeGet: vi.fn(), fetch: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { get: { invoke: boundary.nativeGet } } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'fixture-owner' } }),
}));

const planA = {
  plan_id: 'plan_A',
  version: 3,
  status: 'OK',
  working_project_id: 'project-A',
  brief: { groups: [], refs: {}, excluded: 0, unauthorized: 0, policy: { strict: true, web: 'off' } },
  used: [],
  withheld: 0,
  superseded: false,
};
const draftB: ScopeDraft = { items: [{ source_id: 'src_B', name: 'B 库', resource_ids: ['res_b1'] }], views: [] };
const origin = { ownerKey: 'fixture-owner', originConversationId: 'convA' };
let sw: ReturnType<typeof useResourceScopeSwitch>;
function Space() {
  sw = useResourceScopeSwitch('fixture-owner');
  return <div>空间</div>;
}
function Conversation() {
  const { proposed, handled } = useScopeChangeProposal('fixture-owner', 'convA');
  return (
    <ScopeStrip
      lang='zh-CN'
      conversationId='convA'
      onStrictShrink={() => {}}
      proposed={proposed}
      onProposedHandled={handled}
    />
  );
}
function Probe() {
  const l = useLocation();
  return (
    <output data-testid='route' data-state={JSON.stringify(l.state)}>
      {l.pathname}
    </output>
  );
}
const methods = () => boundary.fetch.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? 'GET');
const mount = (entry: unknown) =>
  render(
    <MemoryRouter initialEntries={[entry as string]}>
      <Routes>
        <Route path='/office/space' element={<Space />} />
        <Route path='/conversation/:id' element={<Conversation />} />
      </Routes>
      <Probe />
    </MemoryRouter>
  );

beforeEach(() => {
  boundary.nativeGet.mockReset().mockResolvedValue({ project_id: 'project-A', extra: {} });
  boundary.fetch.mockReset().mockImplementation(async (url: string) => ({
    status: 200,
    ok: true,
    json: async () =>
      String(url).includes('/context')
        ? planA
        : { sources: [{ source_id: 'src_B', name: 'B 库' }], tags: [], views: [] },
  }));
  vi.stubGlobal('fetch', boundary.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('没有来源对话时不提供切换入口', () => {
  mount({ pathname: '/office/space', state: { mycoworkResourceOrigin: { ownerKey: 'fixture-owner' } } } as never);
  expect(sw).toBeUndefined();
});

it('有来源对话：回到该对话并打开“更改范围”确认框预填 B；确认前没有写请求', async () => {
  mount({ pathname: '/office/space', state: { mycoworkResourceOrigin: origin } } as never);
  expect(sw).toBeTypeOf('function');
  await act(async () => {
    await sw!(draftB, new AbortController().signal);
  });
  expect(screen.getByTestId('route').textContent).toBe('/conversation/convA');
  await waitFor(() => expect(screen.getByText('更改本会话的资料范围')).toBeTruthy());
  expect(methods().every((m) => m === 'GET')).toBe(true);
  await waitFor(() => expect(screen.getByTestId('route').dataset.state).toBe('null')); // 一次性意图已清
});

it.each([
  ['别的账号', { ownerKey: 'other', conversationId: 'convA', selection: draftB }],
  ['别的对话 id', { ownerKey: 'fixture-owner', conversationId: 'convX', selection: draftB }],
  ['非白名单 id', { ownerKey: 'fixture-owner', conversationId: '../x', selection: draftB }],
  [
    '条目结构被篡改',
    { ownerKey: 'fixture-owner', conversationId: 'convA', selection: { items: [{ source_id: 1 }], views: [] } },
  ],
])('被篡改的意图被忽略（%s）：不弹确认框', async (_n, intent) => {
  mount({ pathname: '/conversation/convA', state: { mycoworkScopeChange: intent } } as never);
  await waitFor(() => expect(screen.getByTestId('mycowork-scope-strip').textContent).toContain('更改范围'));
  expect(screen.queryByText('更改本会话的资料范围')).toBeNull();
});
