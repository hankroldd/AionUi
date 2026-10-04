/**
 * 文件：tests/unit/mycowork/scopeLifecycle.dom.test.tsx
 * 职责：[mycowork] 复现项目默认迟到响应与发送准备失效，核实范围快照和本轮生命周期拒发（navigation-intent §3）。
 * 边界：仅替换Bridge HTTP；身份切换用真实ScopeChip卸载/重挂建模，不宣称真实认证或后端泄露验证。
 */
import React from 'react';
import { Message } from '@arco-design/web-react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import {
  bindScopedConversation,
  discardScopedSession,
  getScope,
  prepareScopedSession,
  ScopeChip,
  ScopeStrip,
  setScopeSelection,
} from '@mycowork/ui';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const catalog = (actor: string) => ({
  sources: [{ source_id: `src_${actor}`, name: `actor-${actor}-private-source`, provider: 'weknora', counts }],
  projects: [{ project_id: 'P', source_ids: [`src_${actor}`] }],
});
const selected = {
  items: [{ source_id: 'src_a', name: 'A', resource_ids: ['res_1'] }],
  views: [],
  requiredResourceIds: ['res_1'],
};
const token = {
  workspace: '/fixtures/actor-a-workspace',
  session_mcp_server: {
    id: 'bridge',
    name: 'bridge',
    transport: { type: 'streamable_http', url: '/fixtures/mcp', headers: { Authorization: 'Bearer fixture-a' } },
  },
};
const carriedContext = {
  plan_id: 'parent',
  version: 1,
  status: 'OK',
  brief: {
    groups: ['a', 'b'].map((id) => ({ source_id: `src_${id}`, source_name: id.toUpperCase(), mode: 'whole', counts })),
    excluded: 0,
    unauthorized: 0,
    refs: {},
    policy: { strict: false, web: 'off' },
  },
  used: [],
  withheld: 0,
  superseded: false,
};
function deferred() {
  let resolve: (value: ReturnType<typeof reply>) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<ReturnType<typeof reply>>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const changedMessage = '本轮资料范围或发送状态已变化';

describe('scope lifecycle', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setScopeSelection([]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([false, true])('a delayed bind failure only warns for the current send=%s', async (stillCurrent) => {
    const gate = deferred();
    let current = true;
    const warning = vi.spyOn(Message, 'warning');
    setScopeSelection(selected.items, selected.views, selected.requiredResourceIds);
    fetchMock
      .mockResolvedValueOnce(reply(201, { plan_id: 'plan_a', status: 'OK' }))
      .mockResolvedValueOnce(reply(201, token))
      .mockReturnValueOnce(gate.promise);
    await prepareScopedSession('zh-CN');
    const binding = bindScopedConversation('created-a', 'zh-CN', () => current);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    current = stillCurrent;
    gate.resolve(reply(503, {}));
    await binding;
    expect(warning).toHaveBeenCalledTimes(stillCurrent ? 1 : 0);
  });

  it.each([
    ['remount', 'success'],
    ['remount', 'failure'],
    ['project-cycle', 'success'],
    ['project-cycle', 'failure'],
  ])('%s ignores the old same-project %s before the new response', async (transition, result) => {
    const old = deferred();
    const current = deferred();
    fetchMock.mockReturnValueOnce(old.promise);
    if (transition === 'project-cycle') fetchMock.mockResolvedValueOnce(reply(200, { sources: [], projects: [] }));
    fetchMock.mockReturnValueOnce(current.promise);
    const first = render(<ScopeChip lang='zh-CN' projectId='P' />);
    if (transition === 'remount') {
      first.unmount();
      render(<ScopeChip lang='zh-CN' projectId='P' />);
    } else {
      first.rerender(<ScopeChip lang='zh-CN' projectId='Q' />);
      first.rerender(<ScopeChip lang='zh-CN' projectId='P' />);
    }
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(transition === 'remount' ? 2 : 3));
    await act(async () => old.resolve(result === 'success' ? reply(200, catalog('a')) : reply(503, {})));
    expect(screen.queryByText(/actor-a-private-source/)).toBeNull();
    expect(screen.getByRole('button', { name: '资料范围（项目默认）：读取中…' })).toBeInTheDocument();
    await act(async () => current.resolve(reply(200, catalog('b'))));
    expect(screen.getByRole('button', { name: '资料范围（项目默认）：actor-b-private-source' })).toBeInTheDocument();
    expect(getScope().items.map((item) => item.source_id)).toEqual(['src_b']);
  });

  it.each(['scope replacement', 'unmount', 'lifecycle', 'failed token'])(
    '%s rejects late send preparation without installing a pending plan',
    async (change) => {
      const gate = deferred();
      let active = true;
      fetchMock
        .mockResolvedValueOnce(reply(201, { plan_id: 'plan_a', status: 'OK' }))
        .mockReturnValueOnce(gate.promise);
      const mounted = render(<ScopeChip lang='zh-CN' initialScope={selected} />);
      const pending = prepareScopedSession('zh-CN', false, () => active);
      const settled = pending.then(
        (session) => ({ session }),
        (error: unknown) => ({ error })
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      if (change === 'unmount') mounted.unmount();
      else if (change === 'lifecycle') active = false;
      else act(() => setScopeSelection(selected.items, selected.views, selected.requiredResourceIds));
      await act(async () => {
        if (change === 'failed token') gate.reject(new Error('fixture network failure'));
        else gate.resolve(reply(201, token));
      });
      expect(await settled).toMatchObject({
        error: expect.objectContaining({
          message: expect.stringContaining(changedMessage),
          cause: expect.objectContaining({ kind: 'scope_changed' }),
        }),
      });
      await bindScopedConversation('must-not-bind', 'zh-CN');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );

  it.each([false, true])('an invalid lifecycle rejects before HTTP, selected=%s', async (hasSelection) => {
    if (hasSelection) setScopeSelection(selected.items, selected.views, selected.requiredResourceIds);
    await expect(prepareScopedSession('zh-CN', false, () => false)).rejects.toThrow(changedMessage);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['scope replacement', 'lifecycle'])(
    '%s rejects a late plan before requesting its token or installing it',
    async (change) => {
      const gate = deferred();
      let active = true;
      setScopeSelection(selected.items, selected.views, selected.requiredResourceIds);
      fetchMock.mockReturnValueOnce(gate.promise).mockResolvedValueOnce(reply(201, token));
      const pending = prepareScopedSession('zh-CN', false, () => active);
      const settled = pending.then(
        (session) => ({ session }),
        (error: unknown) => ({ error })
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      if (change === 'lifecycle') active = false;
      else setScopeSelection(selected.items, selected.views, selected.requiredResourceIds);
      await act(async () => gate.resolve(reply(201, { plan_id: 'late_plan', status: 'OK' })));
      expect(await settled).toMatchObject({
        error: expect.objectContaining({
          message: expect.stringContaining(changedMessage),
          cause: expect.objectContaining({ kind: 'scope_changed' }),
        }),
      });
      await bindScopedConversation('must-not-bind-late-plan', 'zh-CN');
      expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/tokens'))).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('an unchanged preparation still installs and binds its plan once', async () => {
    setScopeSelection(selected.items, selected.views, selected.requiredResourceIds);
    fetchMock
      .mockResolvedValueOnce(reply(201, { plan_id: 'plan_a', status: 'OK' }))
      .mockResolvedValueOnce(reply(201, token))
      .mockResolvedValueOnce(reply(200, {}));
    await expect(prepareScopedSession('zh-CN', false, () => true)).resolves.toMatchObject({ plan_id: 'plan_a' });
    await bindScopedConversation('current', 'zh-CN');
    await bindScopedConversation('second', 'zh-CN');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ plan_id: 'plan_a' });
  });

  it('discarding an older plan and rejecting an invalid preparation preserve the newer pending plan', async () => {
    setScopeSelection(selected.items, selected.views, selected.requiredResourceIds);
    fetchMock
      .mockResolvedValueOnce(reply(201, { plan_id: 'plan_a', status: 'OK' }))
      .mockResolvedValueOnce(reply(201, token));
    await expect(prepareScopedSession('zh-CN')).resolves.toMatchObject({ plan_id: 'plan_a' });
    fetchMock
      .mockResolvedValueOnce(reply(201, { plan_id: 'plan_b', status: 'OK' }))
      .mockResolvedValueOnce(reply(201, token));
    await prepareScopedSession('zh-CN');
    const scope = getScope();
    discardScopedSession('plan_a');
    await expect(prepareScopedSession('zh-CN', false, () => false)).rejects.toThrow(changedMessage);
    expect(getScope()).toBe(scope);
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await bindScopedConversation('newer-send', 'zh-CN');
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ plan_id: 'plan_b' });
  });

  it('discarding the current pending plan leaves the selection intact and prevents binding', async () => {
    setScopeSelection(selected.items, selected.views, selected.requiredResourceIds);
    fetchMock
      .mockResolvedValueOnce(reply(201, { plan_id: 'plan_a', status: 'OK' }))
      .mockResolvedValueOnce(reply(201, token));
    await prepareScopedSession('en-US');
    const scope = getScope();
    discardScopedSession('plan_a');
    await bindScopedConversation('cancelled-send', 'en-US');
    expect(getScope()).toBe(scope);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('can prepare the project selector while its unchanged frontend defaults are still loading', async () => {
    const defaults = deferred();
    fetchMock
      .mockReturnValueOnce(defaults.promise)
      .mockResolvedValueOnce(reply(201, { plan_id: 'plan_p', status: 'OK' }))
      .mockResolvedValueOnce(reply(201, token));
    const mounted = render(<ScopeChip lang='zh-CN' projectId='P' />);
    expect(screen.getByRole('button', { name: '资料范围（项目默认）：读取中…' })).toBeInTheDocument();
    await expect(prepareScopedSession('zh-CN', false, () => true)).resolves.toMatchObject({ plan_id: 'plan_p' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      working_project_id: 'P',
      use_project_defaults: false,
      scopes: [{ selector: 'project', id: 'P' }],
    });
    mounted.unmount();
    await act(async () => defaults.resolve(reply(200, catalog('a'))));
    expect(getScope().items).toEqual([]);
  });

  it.each([false, true])(
    'the prepared scope guard preserves the exact completion snapshot, selected=%s',
    async (hasSelection) => {
      if (hasSelection) {
        setScopeSelection(selected.items, selected.views, selected.requiredResourceIds);
        fetchMock
          .mockResolvedValueOnce(reply(201, { plan_id: 'plan_a', status: 'OK' }))
          .mockResolvedValueOnce(reply(201, token));
      }
      const prepared = vi.fn();
      await prepareScopedSession('zh-CN', false, () => true, prepared);
      expect(prepared).toHaveBeenCalledTimes(1);
      const [isScopeCurrent] = prepared.mock.calls[0];
      expect(isScopeCurrent()).toBe(true);
      setScopeSelection(selected.items, selected.views, selected.requiredResourceIds);
      expect(isScopeCurrent()).toBe(false);
      if (hasSelection) discardScopedSession('plan_a');
    }
  );

  it('keeps a carried plan across token failure and clears it only after a current successful retry', async () => {
    let tokenCalls = 0;
    const prepared = vi.fn();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/context')) return reply(200, carriedContext);
      if (url.endsWith('/scopes'))
        return reply(200, {
          sources: ['a', 'b'].map((id) => ({
            source_id: `src_${id}`,
            name: id.toUpperCase(),
            provider: 'weknora',
            counts,
          })),
          projects: [],
        });
      if (url.endsWith('/tags')) return reply(200, { tags: [] });
      if (url.endsWith('/saved-views')) return reply(200, { views: [] });
      if (url === '/bridge/v1/context-plans')
        return reply(201, { plan_id: 'shrunk', status: 'OK', succession: 'shrunk' });
      if (url.endsWith('/tokens')) return ++tokenCalls === 1 ? reply(503, {}) : reply(201, token);
      if (init?.method === 'PUT') return reply(200, {});
      throw new Error(`Unexpected fixture request: ${url}`);
    });
    render(<ScopeStrip lang='zh-CN' conversationId='fixture-conversation' onStrictShrink={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '更改范围' }));
    fireEvent.click(await screen.findByText('B'));
    fireEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => expect(getScope().carriedPlanId).toBe('shrunk'));
    await expect(prepareScopedSession('zh-CN', false, () => true, prepared)).rejects.toThrow('资料服务暂不可用');
    expect(prepared).not.toHaveBeenCalled();
    expect(getScope().carriedPlanId).toBe('shrunk');
    await expect(prepareScopedSession('zh-CN', false, () => true, prepared)).resolves.toMatchObject({
      plan_id: 'shrunk',
    });
    expect(getScope().carriedPlanId).toBeUndefined();
    expect(prepared).toHaveBeenCalledTimes(1);
    expect(prepared.mock.calls[0][0]()).toBe(true);
    await bindScopedConversation('current-shrink', 'zh-CN');
    const posts = fetchMock.mock.calls.filter(([url]) => url === '/bridge/v1/context-plans');
    expect(posts).toHaveLength(1);
    const bindings = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(bindings).toHaveLength(1);
    expect(JSON.parse(bindings[0][1].body)).toEqual({ plan_id: 'shrunk' });
  });
});
