/**
 * [mycowork] ADR-0011: `/office/connections` (MyCowork P15 connections & data sources, PR12 slice A, R002/R036). Only fetch is mocked.
 * Covers: five sections with status from existing data (arXiv honestly "未检测", never a key); "测试连接" POSTs the existing
 * capability check and shows time + version; return context is whitelist-only (negative cases: absolute URL, `//x`,
 * `javascript:`, unknown key/section/account); "返回" re-checks then goes to the capability page; the capability page
 * offers "去配置" only on non-ready knowledge/office rows and carries the section + return target.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { connectionsEntryState, connectionsReturnTarget, parseConnectionsReturn } from '@mycowork/ui';
import { OfficeCapabilitiesSlot, OfficeConnectionsSlot } from '@/renderer/mycowork-slots';

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-a' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' }, t: (k: string) => k }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const cap = (id: string, state: string, over: object = {}) => ({
  id,
  state,
  dependencies: [{ id: 'officecli', required: true, testStatus: 'passed', actualVersion: '9.9.9' }],
  allowedDataScopes: [],
  testedAt: new Date().toISOString(),
  version_verified: true,
  ...over,
});
const LIST = [
  cap('knowledge.retrieval', 'not_configured'),
  cap('office.native-edit', 'ready'),
  cap('office.online-edit', 'limited'),
];
const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST').map(([u]) => String(u));

const Probe = () => {
  const l = useLocation();
  return <div data-testid='at'>{`${l.pathname}|${JSON.stringify(l.state)}`}</div>;
};
const at = (entry: object) => (
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path='/office/connections' element={<OfficeConnectionsSlot />} />
      <Route path='/office/capabilities' element={<OfficeCapabilitiesSlot />} />
      <Route path='*' element={<Probe />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/providers') || u.includes('/api/settings/client')) return reply(200, { data: {} });
    if (u.endsWith('/check')) return reply(200, cap(u.split('/').at(-2)!, 'ready'));
    if (u.endsWith('/bridge/v1/capabilities')) return reply(200, { capabilities: LIST });
    return reply(404, { error: { code: 'NOT_FOUND' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('返回意图（白名单）', () => {
  const ok = { ownerKey: 'owner-a', section: 'office', to: 'capabilities' };
  it('只认同账号、已知小节与白名单去向；回程路由查表', () => {
    expect(parseConnectionsReturn({ mycoworkConnectionsReturn: ok }, 'owner-a')).toEqual({
      section: 'office',
      kind: 'capabilities',
    });
    expect(connectionsReturnTarget({ section: 'office', kind: 'capabilities' })).toEqual({
      path: '/office/capabilities',
    });
    const task = { ownerKey: 'owner-a', capabilityId: 'knowledge.retrieval', origin: 'guid' };
    const parsed = parseConnectionsReturn({ mycoworkConnectionsReturn: { ...ok, to: 'task', task } }, 'owner-a');
    expect(parsed && connectionsReturnTarget(parsed).path).toBe('/guid');
    const bad = [
      [{ mycoworkConnectionsReturn: { ...ok, to: 'https://example.invalid/x' } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: { ...ok, to: '//x' } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: { ...ok, to: 'javascript:alert(1)' } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: { ...ok, to: 'toString' } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: { ...ok, section: 'unknown' } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: { ...ok, section: '__proto__' } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: ok }, 'owner-b'],
      [{ mycoworkConnectionsReturn: ok }, undefined],
      [{ mycoworkConnectionsReturn: { ...ok, to: 'task', task: { ...task, origin: '//x' } } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: { ...ok, to: 'task', task: { ...task, origin: 'javascript:1' } } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: { ...ok, to: 'task', task: { ...task, capabilityId: 'model.chat' } } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: { ...ok, to: 'task' } }, 'owner-a'],
      [{ mycoworkConnectionsReturn: [ok] }, 'owner-a'],
      [null, 'owner-a'],
    ] as const;
    for (const [state, owner] of bad) expect(parseConnectionsReturn(state, owner)).toBeNull();
  });
  it('进入 state 只为知识/Office 能力构造', () => {
    expect(connectionsEntryState('owner-a', 'model.chat')).toBeUndefined();
    expect(connectionsEntryState(undefined, 'knowledge.retrieval')).toBeUndefined();
    expect(connectionsEntryState('owner-a', 'office.online-edit')).toEqual({
      mycoworkConnectionsReturn: { ownerKey: 'owner-a', section: 'office', to: 'capabilities' },
    });
  });
});

describe('OfficeConnectionsSlot', () => {
  it('五节齐全，arXiv 未检测，密钥只有固定说明；测试连接走既有重检并带时间与版本', async () => {
    render(at({ pathname: '/office/connections' }));
    for (const k of ['model', 'knowledge', 'office', 'arxiv', 'paths'])
      expect(await screen.findByTestId(`conn-${k}`)).toBeInTheDocument();
    expect(within(screen.getByTestId('conn-arxiv')).getByText('未检测')).toBeInTheDocument();
    expect(screen.getByTestId('mycowork-connections-keys').textContent).toContain('密钥在部署配置里修改');
    expect(screen.getByTestId('mycowork-connections-keys').textContent).toContain('docs/runbooks/offline-deploy.md');
    const k = screen.getByTestId('conn-knowledge');
    expect(within(k).getByText('未配置')).toBeInTheDocument();
    fireEvent.click(within(k).getByRole('button', { name: '测试连接' }));
    await waitFor(() => expect(within(k).getByText('可使用')).toBeInTheDocument());
    expect(posts()).toEqual(['/bridge/v1/capabilities/knowledge.retrieval/check']);
    expect(k.textContent).toContain('检查于');
    expect(k.textContent).toContain('officecli 9.9.9');
  });

  it('带返回意图：返回先重检该节能力再跳转；意图非法则不显示返回', async () => {
    const entry = (state: object) => ({ pathname: '/office/connections', state });
    const view = render(
      at(entry({ mycoworkConnectionsReturn: { ownerKey: 'owner-a', section: 'office', to: '//x' } }))
    );
    await screen.findByTestId('conn-office');
    expect(screen.queryByTestId('mycowork-connections-return')).toBeNull();
    view.unmount();
    render(at(entry({ mycoworkConnectionsReturn: { ownerKey: 'owner-a', section: 'office', to: 'capabilities' } })));
    fireEvent.click(await screen.findByRole('button', { name: '返回能力中心' }));
    await screen.findByTestId('mycowork-capabilities');
    expect(posts().sort()).toEqual([
      '/bridge/v1/capabilities/office.native-edit/check',
      '/bridge/v1/capabilities/office.online-edit/check',
    ]);
  });
});

describe('能力中心“去配置”', () => {
  it('只在未就绪的知识/Office 行出现，点后带小节与返回目标到 P15', async () => {
    render(at({ pathname: '/office/capabilities' }));
    const ready = await screen.findByTestId('capability-office.native-edit');
    expect(within(ready).queryByRole('button', { name: '去配置' })).toBeNull();
    fireEvent.click(
      within(screen.getByTestId('capability-knowledge.retrieval')).getByRole('button', { name: '去配置' })
    );
    await screen.findByTestId('mycowork-connections');
    expect(await screen.findByRole('button', { name: '返回能力中心' })).toBeInTheDocument();
  });
});
