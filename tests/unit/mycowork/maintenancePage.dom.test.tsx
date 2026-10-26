/**
 * [mycowork] ADR-0011: `/office/maintenance` (MyCowork P16 operations & maintenance, PR12 slice A/B, R003, R064). Only fetch is mocked.
 * Covers: five read-only sections from existing data (instance, component versions from capability checks, own edit-session
 * count), missing data honestly "未检测" (sessions/instance/backup/storage when the call fails), no operation buttons,
 * the runbook pointer, slice B backup record (relative+absolute time, encryption, size, text warnings for plain/older than 7 days,
 * "no record" when null) and storage sizes (partial note); entries from the setup page and P15 paths link to the route.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeConnectionsSlot, OfficeMaintenanceSlot, OfficeSetupSlot } from '@/renderer/mycowork-slots';

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
const CAP = {
  id: 'office.native-edit',
  state: 'ready',
  dependencies: [{ id: 'officecli', required: true, testStatus: 'passed', actualVersion: '9.9.9' }],
  allowedDataScopes: [],
  testedAt: new Date().toISOString(),
  version_verified: true,
};
const INSTANCE = { host: 'box-1', data_dir_label: 'bridge-data', started_at: 'x', build: { commit: 'abc1234' } };
let sessions: () => ReturnType<typeof reply> = () => reply(200, { items: [], next_page: null });
const DAY = 86_400_000;
const MAINT = (last_backup: unknown, partial = false) => ({
  last_backup,
  storage: {
    db_bytes: 2048,
    blobs_bytes: 5 * 1024 * 1024,
    workspaces_bytes: 100,
    total_bytes: 5 * 1024 * 1024 + 2148,
    partial,
    computed_at: 'x',
  },
});
let maint: () => ReturnType<typeof reply> = () => reply(200, MAINT(null));
let instance: () => ReturnType<typeof reply> = () => reply(200, INSTANCE);

const page = (path: string) => (
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path='/office/maintenance' element={<OfficeMaintenanceSlot />} />
      <Route path='/office/setup' element={<OfficeSetupSlot />} />
      <Route path='/office/connections' element={<OfficeConnectionsSlot />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  sessions = () => reply(200, { items: [], next_page: null });
  instance = () => reply(200, INSTANCE);
  maint = () => reply(200, MAINT(null));
  // jsdom 没有 matchMedia，Arco Descriptions 订阅断点时需要
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/providers') || u.includes('/api/settings/client')) return reply(200, { data: {} });
    if (u.endsWith('/bridge/v1/capabilities')) return reply(200, { capabilities: [CAP] });
    if (u.endsWith('/bridge/v1/instance')) return instance();
    if (u.endsWith('/bridge/v1/maintenance')) return maint();
    if (u.includes('/bridge/v1/edit-sessions')) return sessions();
    return reply(404, { error: { code: 'NOT_FOUND' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('P16 运行与维护（只读）', () => {
  it('五节齐全：版本取自能力检查，本人无会话时不说可以升级、提示先确认；没有备份记录与存储用量；没有任何操作按钮', async () => {
    render(page('/office/maintenance'));
    const comps = await screen.findByTestId('maint-components');
    await waitFor(() => expect(within(comps).getByText('9.9.9')).toBeTruthy());
    const none = screen.getByTestId('maint-sessions');
    expect(within(none).getByText(/你自己没有编辑中的会话/)).toBeTruthy();
    expect(none.textContent).toContain('请先确认');
    expect(none.textContent).not.toMatch(/可以升级|可以重启/);
    expect(within(screen.getByTestId('maint-backup')).getByText('还没有备份记录')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('maint-storage').textContent).toContain('5.0 MB'));
    expect(screen.getByTestId('maint-storage').textContent).not.toContain('部分统计');
    expect(screen.getByTestId('maint-backup').textContent).toContain('docs/runbooks/backup-restore.md');
    expect(screen.getByTestId('mycowork-maintenance-ops').textContent).toContain('docs/runbooks/upgrade-bridge.md');
    await waitFor(() => expect(screen.getByTestId('maint-instance').textContent).toContain('数据目录'));
    expect(screen.queryByRole('button', { name: /重启|升级|备份|恢复|Restart|Upgrade/ })).toBeNull();
    // 页面不发任何写请求
    expect(fetchMock.mock.calls.filter(([, i]) => i?.method && i.method !== 'GET')).toEqual([]);
  });

  it('有编辑中的会话：提示先保存关闭，并说明只统计本人', async () => {
    sessions = () => reply(200, { items: [{ session_id: 's1' }, { session_id: 's2' }], next_page: null });
    render(page('/office/maintenance'));
    const box = await screen.findByTestId('maint-sessions');
    await waitFor(() => expect(box.textContent).toContain('有 2 个编辑中的会话，升级/重启前先保存关闭'));
    expect(box.textContent).toContain('只统计你自己的会话');
  });

  it('接口读不到：会话与实例显示“未检测”，不当作没有会话', async () => {
    sessions = () => reply(503, { error: { code: 'UNAVAILABLE' } });
    instance = () => reply(503, { error: { code: 'UNAVAILABLE' } });
    render(page('/office/maintenance'));
    await waitFor(() => expect(within(screen.getByTestId('maint-sessions')).getByText('未检测')).toBeTruthy());
    await waitFor(() => expect(within(screen.getByTestId('maint-instance')).getByText('未检测')).toBeTruthy());
    expect(screen.getByTestId('maint-sessions').textContent).not.toContain('可以升级');
  });
});

describe('P16 切片 B：备份与存储', () => {
  it('新近的加密备份：相对与绝对时间、已加密、大小，无警告', async () => {
    maint = () =>
      reply(
        200,
        MAINT({
          finished_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
          encrypted: true,
          size_bytes: 3 * 1024 * 1024,
        })
      );
    render(page('/office/maintenance'));
    const box = await screen.findByTestId('maint-backup');
    await waitFor(() => expect(box.textContent).toContain('3 小时前'));
    expect(box.textContent).toContain('已加密');
    expect(box.textContent).toContain('3.0 MB');
    expect(box.textContent).not.toContain('警告');
  });

  it('未加密且超过 7 天：两条文字警告', async () => {
    maint = () =>
      reply(
        200,
        MAINT({ finished_at: new Date(Date.now() - 9 * DAY).toISOString(), encrypted: false, size_bytes: 10 })
      );
    render(page('/office/maintenance'));
    const box = await screen.findByTestId('maint-backup');
    await waitFor(() => expect(box.textContent).toContain('9 天前'));
    expect(box.textContent).toContain('没有加密');
    expect(box.textContent).toContain('超过 7 天');
  });

  it('用量部分统计时写明；备份/用量接口读不到显示未检测', async () => {
    maint = () => reply(200, MAINT(null, true));
    const { unmount } = render(page('/office/maintenance'));
    await waitFor(() => expect(screen.getByTestId('maint-storage').textContent).toContain('部分统计'));
    unmount();
    maint = () => reply(503, { error: { code: 'UNAVAILABLE' } });
    render(page('/office/maintenance'));
    await waitFor(() => expect(within(screen.getByTestId('maint-storage')).getByText('未检测')).toBeTruthy());
    expect(within(screen.getByTestId('maint-backup')).getByText('未检测')).toBeTruthy();
  });
});

describe('入口', () => {
  it.each(['/office/setup', '/office/connections'])('%s 的运行位置旁有去 P16 的链接', async (path) => {
    render(page(path));
    const link = await screen.findByTestId('mycowork-setup-where-maintenance');
    expect(link.getAttribute('href')).toBe('#/office/maintenance');
  });
});
