/**
 * [mycowork] ADR-0011: sidebar project-row entry (MyCowork 02 P03 "ask about this project / link knowledge bases").
 * Shown only when a conversation of the group carries an AionUi project_id. "Set as project default" is a separate,
 * explicit PUT /bridge/v1/projects/{id}/binding (only affects future tasks, R009); failures are surfaced and the
 * drawer stays open. "Ask" opens the Guid page with the project's workspace + mycoworkProjectId and writes nothing.
 * Only the Bridge boundary (fetch) is mocked.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { TChatConversation } from '@/common/config/storage';
import { ProjectScopeSlot } from '@/renderer/mycowork-slots';

vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = { total: 3, ready: 3, indexing: 0, failed: 0, unavailable: 0 };
const CATALOG = {
  sources: [
    { source_id: 'src_a', name: '产品知识库', provider: 'weknora', counts },
    { source_id: 'src_b', name: '项目A资料', provider: 'weknora', counts },
  ],
  projects: [{ project_id: 'proj-1', source_ids: ['src_b'] }],
};
const conv = (id: string, project_id?: string) => ({ id, project_id }) as unknown as TChatConversation;

const GuidProbe: React.FC = () => <div data-testid='guid-state'>{JSON.stringify(useLocation().state)}</div>;
const renderRow = (conversations: TChatConversation[]) =>
  render(
    <MemoryRouter initialEntries={['/conversation/c1']}>
      <Routes>
        <Route
          path='/conversation/:id'
          element={<ProjectScopeSlot group={{ workspace: '/w/a', conversations }} isMobile={false} />}
        />
        <Route path='/guid' element={<GuidProbe />} />
      </Routes>
    </MemoryRouter>
  );
const openEntry = async () => {
  fireEvent.click(screen.getByRole('button', { name: '项目资料范围与提问' }));
  await screen.findByText('项目默认资料范围');
};
// Arco keeps a closed drawer mounted; its wrapper is display:block only while open (after the 300 ms transition)
const drawerOpen = () =>
  screen.getByText('项目默认资料范围').closest('.arco-drawer')?.parentElement?.style.display === 'block';
const bindingCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('/binding'));

describe('ProjectScopeSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders nothing when no conversation of the group carries a project id', () => {
    renderRow([conv('c1'), conv('c2')]);
    expect(screen.queryByRole('button', { name: '项目资料范围与提问' })).toBeNull();
  });

  it('pre-checks the saved default and saves the new one with an explicit JSON PUT', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/bridge/v1/scopes' ? reply(200, CATALOG) : reply(200, JSON.parse(String(init?.body)))
    );
    renderRow([conv('c1'), conv('c2', 'proj-1')]);
    await openEntry();
    expect(
      screen.getByText(
        '这里保存的是项目默认，只影响之后新建的任务，不改正在运行的任务。只想改这一次，请在新建任务页的“资料范围”里改。'
      )
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByText('产品知识库'));
    fireEvent.click(screen.getByRole('button', { name: '设为项目默认' }));
    expect(await screen.findByText('已保存为项目默认；只影响之后新建的任务')).toBeInTheDocument();
    const [[url, init]] = bindingCalls();
    expect(url).toBe('/bridge/v1/projects/proj-1/binding');
    expect(init).toMatchObject({ method: 'PUT', headers: { 'content-type': 'application/json' } });
    // Bridge order = catalog order; the saved default was pre-checked
    expect(JSON.parse(init.body)).toEqual({ source_ids: ['src_a', 'src_b'] });
    await waitFor(() => expect(drawerOpen()).toBe(false));
  });

  it('surfaces a rejected save and keeps the drawer open', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/bridge/v1/scopes'
        ? reply(200, CATALOG)
        : reply(403, { error: { code: 'FORBIDDEN', message: 'source not granted' } })
    );
    renderRow([conv('c1', 'proj-1')]);
    await openEntry();
    await screen.findByText('产品知识库');
    fireEvent.click(screen.getByRole('button', { name: '设为项目默认' }));
    expect(await screen.findByText('未保存项目默认：资料范围处理失败（FORBIDDEN）')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 400));
    expect(drawerOpen()).toBe(true);
    expect(bindingCalls()).toHaveLength(1);
  });

  it('surfaces an unreachable Bridge on save', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/scopes') return reply(200, CATALOG);
      throw new TypeError('network');
    });
    renderRow([conv('c1', 'proj-1')]);
    await openEntry();
    await screen.findByText('产品知识库');
    fireEvent.click(screen.getByRole('button', { name: '设为项目默认' }));
    expect(await screen.findByText('未保存项目默认：资料服务暂不可用，请稍后重试')).toBeInTheDocument();
  });

  it('cancel writes nothing', async () => {
    fetchMock.mockResolvedValue(reply(200, CATALOG));
    renderRow([conv('c1', 'proj-1')]);
    await openEntry();
    fireEvent.click(await screen.findByText('产品知识库'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(drawerOpen()).toBe(false));
    expect(bindingCalls()).toEqual([]);
  });

  it('"ask about this project" opens the Guid page in the project workspace with its id, writing nothing', async () => {
    fetchMock.mockResolvedValue(reply(200, CATALOG));
    renderRow([conv('c1', 'proj-1')]);
    await openEntry();
    fireEvent.click(await screen.findByText('产品知识库')); // unsaved change must not be written by "ask"
    fireEvent.click(screen.getByRole('button', { name: '基于本项目提问' }));
    const state = JSON.parse((await screen.findByTestId('guid-state')).textContent ?? 'null');
    expect(state).toEqual({ workspace: '/w/a', mycoworkProjectId: 'proj-1' });
    expect(bindingCalls()).toEqual([]);
  });
});
