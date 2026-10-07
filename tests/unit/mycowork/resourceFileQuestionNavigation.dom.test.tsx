/**
 * 文件：resourceFileQuestionNavigation.dom.test.tsx
 * 职责：真实原生导航适配携带一次性问题与精确文件范围，保留账号、项目与取消边界。
 * 边界：只替换原生会话读取和 Bridge HTTP，不替换被测导航 Hook 或 Router。
 */
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type ScopeDraft } from '@mycowork/ui';
import { useResourceQuestionNavigation } from '@/renderer/mycowork-resource-navigation';

const boundary = vi.hoisted(() => ({ owner: 'fixture-owner', nativeGet: vi.fn(), fetch: vi.fn() }));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { get: { invoke: boundary.nativeGet } } } }));
const selected: ScopeDraft = {
  items: [{ source_id: 'src_fixture', name: '虚构库', resource_ids: ['res_one'] }],
  views: [],
  requiredResourceIds: ['res_one'],
};
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
let ask: (draft: ScopeDraft, signal: AbortSignal, question?: string) => Promise<void>;
let navigate: ReturnType<typeof useNavigate>;
function Space() {
  ask = useResourceQuestionNavigation(boundary.owner);
  return <div>空间</div>;
}
function Probe() {
  const location = useLocation();
  navigate = useNavigate();
  return <output data-testid='route'>{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>;
}
function tree(state: unknown = null) {
  return (
    <MemoryRouter initialEntries={[{ pathname: '/office/space', state }]}>
      <Routes>
        <Route path='/office/space' element={<Space />} />
        <Route path='/guid' element={<div>新对话草稿</div>} />
        <Route path='/settings' element={<div>设置</div>} />
      </Routes>
      <Probe />
    </MemoryRouter>
  );
}
const route = () => JSON.parse(screen.getByTestId('route').textContent!);
beforeEach(() => {
  boundary.owner = 'fixture-owner';
  boundary.nativeGet.mockReset();
  boundary.fetch.mockReset();
  vi.stubGlobal('fetch', boundary.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('carries the question as the native one-shot prefill next to the owned single-file intent', async () => {
  render(
    tree({
      mycoworkResourceOrigin: { ownerKey: boundary.owner, projectId: 'confirmed-project' },
    })
  );
  await act(async () => {
    await ask(selected, new AbortController().signal, '解释这个文件的关键变化');
  });
  expect(route()).toEqual({
    pathname: '/guid',
    state: {
      mycoworkScopeDraft: {
        ownerKey: boundary.owner,
        selection: { ...selected, projectId: 'confirmed-project' },
      },
      prefillPrompt: '解释这个文件的关键变化',
    },
  });
  expect(boundary.nativeGet).not.toHaveBeenCalled();
  expect(boundary.fetch).not.toHaveBeenCalled();
});

it('keeps the existing scope-only navigation shape when no question is supplied', async () => {
  render(tree());
  await act(async () => {
    await ask(selected, new AbortController().signal);
  });
  expect(route()).toEqual({
    pathname: '/guid',
    state: { mycoworkScopeDraft: { ownerKey: boundary.owner, selection: selected } },
  });
});

it('rejects another owner origin without looking up its project, directory or conversation', async () => {
  render(tree({ mycoworkResourceOrigin: { ownerKey: 'other-owner', originConversationId: 'private-conversation' } }));
  await expect(ask(selected, new AbortController().signal, '私有问题')).rejects.toMatchObject({ kind: 'failed' });
  expect(route().pathname).toBe('/office/space');
  expect(boundary.nativeGet).not.toHaveBeenCalled();
  expect(boundary.fetch).not.toHaveBeenCalled();
});

it.each(['abort', 'route', 'owner'])(
  'late preparation after %s changes cannot install the question or navigate',
  async (change) => {
    let finish!: (value: unknown) => void;
    boundary.nativeGet.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    boundary.fetch.mockResolvedValue(reply(404, { error: { code: 'NOT_FOUND' } }));
    const view = render(
      tree({ mycoworkResourceOrigin: { ownerKey: boundary.owner, originConversationId: 'fixture-conversation' } })
    );
    const controller = new AbortController();
    const pending = ask(selected, controller.signal, '迟到问题');
    if (change === 'abort') controller.abort();
    if (change === 'route')
      await act(async () => {
        await navigate('/settings');
      });
    if (change === 'owner') {
      boundary.owner = 'next-owner';
      view.rerender(tree());
    }
    await act(async () => {
      finish({ project_id: 'fixture-project', extra: { workspace: '/fixture/old' } });
      await pending;
    });
    expect(route().pathname).not.toBe('/guid');
    expect(JSON.stringify(route().state)).not.toContain('迟到问题');
  }
);
