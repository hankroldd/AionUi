/**
 * 文件：tests/unit/mycowork/resourceBrowseKeepsScope.dom.test.tsx
 * [mycowork] 职责：R047 合同级核验——会话 A 打开时进空间浏览 / 发起“用这些资料提问”，不改 A 的计划与范围，产出归新会话。
 * 边界：只在账号、原生元数据和 HTTP 边界使用虚构数据；A 的计划绑定只有 Bridge 写接口才能改，故断言期间没有任何非 GET 请求。
 * 关联：MyCowork docs/contracts/navigation-intent.md §1–§2；PR03 R047。
 */
import React from 'react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getScope, setScopeSelection, type ScopeDraft } from '@mycowork/ui';
import { useResourceQuestionNavigation } from '@/renderer/mycowork-resource-navigation';
import MyCoworkRail from '@/renderer/mycowork-rail';

const boundary = vi.hoisted(() => ({ nativeGet: vi.fn(), fetch: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { get: { invoke: boundary.nativeGet } } } }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: 'fixture-owner' } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ activeId: 'system', selectTheme: vi.fn() }),
}));

vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: vi.fn(), clearPreviewForScope: vi.fn() }),
}));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({ useFeedback: () => ({ openFeedback: vi.fn() }) }));

// 项目 A 的会话 plan 覆盖 A 库；B 是另一个项目的资料
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
const draftB: ScopeDraft = {
  items: [{ source_id: 'src_B', name: 'B 项目资料库', resource_ids: ['res_b1'] }],
  views: [],
  requiredResourceIds: ['res_b1'],
};
let ask: (draft: ScopeDraft, signal: AbortSignal) => Promise<void>;
function SpaceHarness() {
  ask = useResourceQuestionNavigation('fixture-owner');
  return <div>空间</div>;
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

beforeEach(() => {
  boundary.nativeGet.mockReset().mockResolvedValue({ project_id: 'project-A', extra: {} });
  boundary.fetch.mockReset().mockResolvedValue({ status: 200, ok: true, json: async () => planA });
  vi.stubGlobal('fetch', boundary.fetch);
  setScopeSelection([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <MemoryRouter initialEntries={['/conversation/convA']}>
      <MyCoworkRail />
      <Routes>
        <Route path='/conversation/:id' element={<div>会话A</div>} />
        <Route path='/office/space' element={<SpaceHarness />} />
        <Route path='/guid' element={<div>新任务</div>} />
      </Routes>
      <Probe />
    </MemoryRouter>
  );
}

it('从会话 A 进空间浏览不发任何请求，也不触碰 A 的范围', () => {
  setScopeSelection([{ source_id: 'src_A', name: 'A 库' }]);
  mount();
  fireEvent.click(screen.getByRole('button', { name: '空间' }));
  expect(screen.getByTestId('route').textContent).toBe('/office/space');
  expect(boundary.fetch).not.toHaveBeenCalled();
  expect(getScope().items.map((i) => i.source_id)).toEqual(['src_A']);
});

it('空间“用这些资料提问”B：只读核对 A，新任务范围只含 B，A 的计划与会话不被写', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: '空间' }));
  await act(async () => {
    await ask(draftB, new AbortController().signal);
  });
  expect(screen.getByTestId('route').textContent).toBe('/guid'); // 新会话入口，不回 /conversation/convA
  const intent = JSON.parse(screen.getByTestId('route').dataset.state!).mycoworkScopeDraft; // /guid 的 GuidScopeSlot 据此装范围
  expect(intent.selection.items.map((i: { source_id: string }) => i.source_id)).toEqual(['src_B']);
  expect(intent.selection.requiredResourceIds).toEqual(['res_b1']);
  expect(intent.selection.projectId).toBe('project-A'); // 工作项目沿用已核对的来源；资料范围只含 B，A 的计划不变
  expect(methods().every((m) => m === 'GET')).toBe(true); // 没有 revisePlan / 改绑 / 建计划
  expect(boundary.fetch.mock.calls.map((c) => String(c[0])).every((u) => !u.includes('context-plans'))).toBe(true);
});
