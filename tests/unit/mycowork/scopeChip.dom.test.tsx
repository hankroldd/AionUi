/**
 * [mycowork] ADR-0011: scope chip + drawer from @mycowork/ui (MyCowork packages/ui).
 * Only the Bridge boundary (fetch) is mocked. Covers counts copy, apply, cancel-keeps-selection,
 * and the unauthenticated / unavailable / no-source states (MyCowork PR03 spec §6 items 3, 11).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Same as renderer/main.tsx: Arco's global Message needs the React 19 adapter (tests load the CJS lib build).
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ScopeChip, setScopeSelection } from '@mycowork/ui';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = (total: number, ready: number, indexing: number) => ({
  total,
  ready,
  indexing,
  failed: 0,
  unavailable: 0,
});
const CATALOG = {
  sources: [
    { source_id: 'src_a', name: '产品知识库', provider: 'weknora', counts: counts(12, 8, 4) },
    { source_id: 'src_b', name: '项目A资料', provider: 'weknora', counts: counts(3, 3, 0) },
  ],
  projects: [],
};

const openDrawer = async () => {
  fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
  await screen.findByText('选择这次可以检索的资料范围');
};

describe('ScopeChip', () => {
  beforeEach(() => {
    setScopeSelection([]);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows "未选择" and the 02 §7 empty hint before any source is chosen', async () => {
    fetchMock.mockResolvedValue(reply(200, CATALOG));
    render(<ScopeChip lang='zh-CN' />);
    expect(screen.getByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
    await openDrawer();
    expect(screen.getByText('尚未选择资料；可以直接聊天，也可选择项目或知识库')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/bridge/v1/scopes', { credentials: 'same-origin' });
  });

  it('lists sources with partial-processing counts', async () => {
    fetchMock.mockResolvedValue(reply(200, CATALOG));
    render(<ScopeChip lang='zh-CN' />);
    await openDrawer();
    expect(await screen.findByText('已存 12 项，8 项可检索，4 项处理中')).toBeInTheDocument();
    expect(screen.getByText('已存 3 项，3 项可检索')).toBeInTheDocument();
  });

  it('applies the checked sources to this round and shows them on the chip', async () => {
    fetchMock.mockResolvedValue(reply(200, CATALOG));
    render(<ScopeChip lang='zh-CN' />);
    await openDrawer();
    fireEvent.click(await screen.findByText('产品知识库'));
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    expect(await screen.findByRole('button', { name: '资料范围：产品知识库' })).toBeInTheDocument();
    expect(await screen.findByText('已更新本轮范围；未修改项目默认')).toBeInTheDocument();
    // R009: applying to this turn only reads the catalog; it never writes a project binding
    expect(fetchMock.mock.calls.every(([url, init]) => url === '/bridge/v1/scopes' && !init?.method)).toBe(true);
  });

  it('keeps the previous selection when the drawer is cancelled', async () => {
    fetchMock.mockResolvedValue(reply(200, CATALOG));
    setScopeSelection([{ source_id: 'src_b', name: '项目A资料' }]);
    render(<ScopeChip lang='zh-CN' />);
    await openDrawer();
    fireEvent.click(await screen.findByText('产品知识库'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '资料范围：项目A资料' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /产品知识库/ })).toBeNull();
  });

  it('drops a previously applied source that the Bridge no longer lists', async () => {
    fetchMock.mockResolvedValue(reply(200, { sources: [CATALOG.sources[0]], projects: [] }));
    setScopeSelection([{ source_id: 'src_revoked', name: '已撤销库' }]);
    render(<ScopeChip lang='zh-CN' />);
    await openDrawer();
    await screen.findByText('产品知识库');
    fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
    expect(await screen.findByRole('button', { name: '资料范围：未选择' })).toBeInTheDocument();
  });

  it('shows the re-login copy when the Bridge answers 401', async () => {
    fetchMock.mockResolvedValue(reply(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    render(<ScopeChip lang='zh-CN' />);
    await openDrawer();
    expect(await screen.findByText('需要重新登录才能打开资料')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用到本轮' })).toBeDisabled();
  });

  it('shows unavailable with retry when the Bridge cannot be reached, then recovers', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(reply(200, CATALOG));
    render(<ScopeChip lang='zh-CN' />);
    await openDrawer();
    expect(await screen.findByText('资料服务暂不可用，请稍后重试')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('产品知识库')).toBeInTheDocument();
  });

  it('says so when there is no source to choose', async () => {
    fetchMock.mockResolvedValue(reply(200, { sources: [], projects: [] }));
    render(<ScopeChip lang='zh-CN' />);
    await openDrawer();
    expect(await screen.findByText('当前没有可选择的知识库')).toBeInTheDocument();
  });

  it('treats a malformed catalog as a failure instead of an empty list', async () => {
    fetchMock.mockResolvedValue(reply(200, { sources: [{ source_id: 'src_a' }] }));
    render(<ScopeChip lang='zh-CN' />);
    await openDrawer();
    expect(await screen.findByText(/资料范围处理失败/)).toBeInTheDocument();
  });

  it('clears the round selection when the chip unmounts (leaving the page)', () => {
    setScopeSelection([{ source_id: 'src_a', name: '产品知识库' }]);
    const { unmount } = render(<ScopeChip lang='zh-CN' />);
    unmount();
    render(<ScopeChip lang='en-US' />);
    expect(screen.getByRole('button', { name: 'Sources: none' })).toBeInTheDocument();
  });
});
