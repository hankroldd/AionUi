/**
 * [mycowork] PR03 A481: a late revision cannot write into a new conversation or draft lifecycle.
 * Only Bridge HTTP and notification outputs are substituted; real strip, dialog and store run together.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ScopeStrip, getScope } from '@mycowork/ui';
import { enterProject, setScopeSelection } from '@mycowork/ui/scope-picker/scope-store';

const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const sources = ['a', 'b', 'new'].map((id) => ({ source_id: `src_${id}`, name: `虚构库${id}`, counts }));
const excludes = [{ kind: 'resource', id: 'r_excluded' }];
const policy = { strict: true, web: 'off' };
const context = {
  plan_id: 'plan_original',
  version: 1,
  status: 'OK',
  working_project_id: 'project_original',
  used: [],
  withheld: 0,
  superseded: false,
  brief: {
    groups: sources.slice(0, 2).map((s) => ({ ...s, source_name: s.name, mode: 'subset', member_count: 1 })),
    excluded: 1,
    unauthorized: 0,
    refs: {},
    excludes,
    policy,
  },
};
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const fetchMock = vi.fn();
const shrink = vi.fn();
let release: ((response: unknown) => void) | undefined;
const props = { lang: 'zh-CN', conversationId: 'conv_a', onStrictShrink: shrink };
const posts = () =>
  fetchMock.mock.calls.filter(([url, init]) => url === '/bridge/v1/context-plans' && init?.method === 'POST');
const reads = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/context')).length;

beforeEach(() => {
  enterProject(undefined);
  release = undefined;
  shrink.mockReset();
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/context')) return reply(200, context);
    if (url === '/bridge/v1/scopes') return reply(200, { sources, projects: [] });
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url.startsWith('/bridge/v1/resources?'))
      return reply(200, {
        total: 2,
        page: 1,
        page_size: 50,
        items: [1, 2].map((n) => ({
          resource_id: `r_file${n}`,
          file_name: `虚构文件${n}.md`,
          origin: 'kb_native',
          tag_ids: [],
          updated_at: '2026-10-12T00:00:00Z',
          state: 'ready',
        })),
      });
    if (url === '/bridge/v1/resources/r_file1/preview') return { ...reply(200, {}), text: async () => '虚构只读正文' };
    if (url === '/bridge/v1/context-plans')
      return new Promise((resolve) => {
        release = resolve;
      });
    throw new Error(`Unexpected HTTP: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  enterProject(undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function start(strict = false, expansion = false, preselectFile = false) {
  const component = <ScopeStrip {...props} />;
  const mounted = render(strict ? <React.StrictMode>{component}</React.StrictMode> : component);
  fireEvent.click(await screen.findByRole('button', { name: '更改范围' }));
  fireEvent.click(await screen.findByText(expansion ? '虚构库new' : '虚构库b'));
  if (preselectFile) {
    const browser = await openBasket();
    fireEvent.click(await within(browser).findByRole('checkbox', { name: '虚构文件1.md' }));
    fireEvent.click(within(browser).getByRole('button', { name: '使用已选文件' }));
    await within(screen.getByTestId('mycowork-scope-narrow-src_a')).findByText('虚构文件1.md');
  }
  fireEvent.click(screen.getByRole('button', { name: '应用', exact: true }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  return mounted;
}
async function finish(result: 'shrunk' | 'expanded' | 'error') {
  const done = release!;
  release = undefined;
  await act(async () => {
    done(
      result === 'error'
        ? reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE' } })
        : reply(201, { plan_id: 'plan_next', version: 2, status: 'OK', succession: result })
    );
  });
}

for (const invalidation of ['unmount', 'clear', 'replace', 'conversation', 'conversation ABA'] as const) {
  for (const result of ['shrunk', 'expanded', 'error'] as const) {
    it(`${invalidation}: late ${result} cannot write, navigate, notify or refresh`, async () => {
      const mounted = await start(false, result === 'expanded');
      if (invalidation === 'unmount') mounted.unmount();
      if (invalidation === 'clear') enterProject(undefined);
      if (invalidation === 'replace') setScopeSelection([{ source_id: 'src_new', name: '新草稿资料' }]);
      if (invalidation.startsWith('conversation')) {
        mounted.rerender(<ScopeStrip {...props} conversationId='conv_b' />);
        await screen.findByRole('button', { name: '更改范围' });
        if (invalidation === 'conversation ABA') {
          mounted.rerender(<ScopeStrip {...props} />);
          await screen.findByRole('button', { name: '更改范围' });
        }
      }
      const current = getScope();
      const beforeReads = reads();
      await finish(result);
      expect(getScope()).toBe(current);
      expect(shrink).not.toHaveBeenCalled();
      expect(Message.success).not.toHaveBeenCalled();
      expect(Message.error).not.toHaveBeenCalled();
      expect(reads()).toBe(beforeReads);
    });
  }
}

it.each([false, true])('active narrowing retains project, subset and rules (StrictMode=%s)', async (strict) => {
  await start(strict);
  await finish('shrunk');
  expect(shrink).toHaveBeenCalledTimes(1);
  expect(getScope()).toMatchObject({
    projectId: 'project_original',
    carriedPlanId: 'plan_next',
    excludes,
    policy,
    items: [{ source_id: 'src_a', name: '虚构库a', frozen_group: { plan_id: 'plan_original', member_count: 1 } }],
  });
  expect(JSON.parse(posts()[0][1].body)).toMatchObject({
    parent_plan_id: 'plan_original',
    excludes,
    policy,
    scopes: [{ selector: 'plan_group', id: 'src_a', plan_id: 'plan_original' }],
  });
});
it('active expansion notifies and refreshes once without replacing the draft scope', async () => {
  await start(false, true);
  const current = getScope();
  const beforeReads = reads();
  await finish('expanded');
  expect(getScope()).toBe(current);
  expect(shrink).not.toHaveBeenCalled();
  expect(Message.success).toHaveBeenCalledTimes(1);
  expect(reads()).toBe(beforeReads + 1);
});
it('active failure leaves the selection for an explicit successful retry', async () => {
  await start();
  const current = getScope();
  await finish('error');
  expect(getScope()).toBe(current);
  expect(Message.error).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog', { name: '更改本会话的资料范围' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '应用', exact: true }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  await finish('shrunk');
  expect(posts()).toHaveLength(2);
  expect(JSON.parse(posts()[0][1].body)).toEqual(JSON.parse(posts()[1][1].body));
  expect(shrink).toHaveBeenCalledTimes(1);
});

it.each(['shrunk', 'error'] as const)(
  'stale %s is not a successful apply that closes the current dialog',
  async (result) => {
    await start();
    enterProject(undefined);
    await finish(result);
    // Pinned Arco Modal retains its exiting portal for 400 ms; inspect after that exit can complete.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(screen.queryByRole('dialog', { name: '更改本会话的资料范围' })).not.toBeNull();
  }
);

for (const newScene of ['cancel', 'close-reopen-edit', 'local-edit'] as const) {
  for (const result of ['shrunk', 'expanded', 'error'] as const) {
    it(`${newScene}: late ${result} must not affect new dialog selection`, async () => {
      await start(false, result === 'expanded');
      const before = getScope();
      if (newScene !== 'local-edit') {
        fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }));
        await act(async () => {
          await new Promise((r) => setTimeout(r, 450));
        });
        expect(screen.queryByRole('dialog', { name: '更改本会话的资料范围' })).toBeNull();
        if (newScene === 'close-reopen-edit') {
          fireEvent.click(screen.getByRole('button', { name: '更改范围' }));
          await screen.findByText('虚构库b');
          await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === '/bridge/v1/scopes')).toHaveLength(2));
          // Initial a+b is restored, so the new choice is b rather than old pending a.
          fireEvent.click(screen.getByText('虚构库a'));
        }
      } else {
        // Controls remain editable. Toggle new relative to the pending selection (valid expansion adds new; contraction removes b).
        fireEvent.click(screen.getByText('虚构库new'));
      }
      expect(getScope()).toBe(before); // The real dialog keeps edits local until apply.
      const beforeReads = reads();
      await finish(result);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 450));
      });
      console.log(
        JSON.stringify({
          newScene,
          result,
          scopeChanged: getScope() !== before,
          carriedPlanId: getScope().carriedPlanId,
          navigation: shrink.mock.calls.length,
          success: vi.mocked(Message.success).mock.calls.length,
          error: vi.mocked(Message.error).mock.calls.length,
          extraReads: reads() - beforeReads,
          dialogOpen: !!screen.queryByRole('dialog', { name: '更改本会话的资料范围' }),
        })
      );
      expect({
        scope: getScope() === before,
        navigation: shrink.mock.calls.length,
        success: vi.mocked(Message.success).mock.calls.length,
        error: vi.mocked(Message.error).mock.calls.length,
        extraReads: reads() - beforeReads,
        dialogOpen: !!screen.queryByRole('dialog', { name: '更改本会话的资料范围' }),
      }).toEqual({
        scope: true,
        navigation: 0,
        success: 0,
        error: 0,
        extraReads: 0,
        dialogOpen: newScene !== 'cancel',
      });
    });
  }
}

async function openBasket() {
  const source = screen.getByText('虚构库a').closest('.mcw-scope-item') as HTMLElement;
  fireEvent.click(within(source).getByRole('button', { name: /^(重新选择文件|浏览全部 虚构库a)$/ }));
  return screen.findByRole('dialog', { name: '浏览 虚构库a' });
}
for (const edit of ['checkbox', 'page', 'clear'] as const) {
  for (const result of ['shrunk', 'expanded', 'error'] as const) {
    it(`unconfirmed basket ${edit}: late ${result} cannot affect the current selection`, async () => {
      await start(false, result === 'expanded', true);
      const browser = await openBasket();
      const first = await within(browser).findByRole('checkbox', { name: '虚构文件1.md' });
      expect(first).toBeChecked();
      if (edit === 'checkbox') fireEvent.click(within(browser).getByRole('checkbox', { name: '虚构文件2.md' }));
      if (edit === 'page') fireEvent.click(within(browser).getByRole('button', { name: '选择本页' }));
      if (edit === 'clear') fireEvent.click(within(browser).getByRole('button', { name: '清空已选' }));
      const scope = getScope();
      const beforeReads = reads();
      await finish(result);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450));
      });
      expect(getScope()).toBe(scope);
      expect(shrink).not.toHaveBeenCalled();
      expect(Message.success).not.toHaveBeenCalled();
      expect(Message.error).not.toHaveBeenCalled();
      expect(reads()).toBe(beforeReads);
      expect(screen.queryByRole('dialog', { name: '更改本会话的资料范围' })).not.toBeNull();
      expect(screen.queryByRole('dialog', { name: '浏览 虚构库a' })).not.toBeNull();
      expect((first as HTMLInputElement).checked).toBe(edit !== 'clear');
    });
  }
}
it.each([false, true])('search and read-only basket preview preserve active revision StrictMode=%s', async (strict) => {
  await start(strict);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索知识库、智能分组（含其标签）或已展开清单里的文件名' }), {
    target: { value: '虚构' },
  });
  const browser = await openBasket();
  fireEvent.click(await within(browser).findByRole('button', { name: '预览 虚构文件1.md' }));
  const preview = await screen.findByRole('dialog', { name: '虚构文件1.md' });
  await within(preview).findByText('虚构只读正文');
  fireEvent.click(within(preview).getByRole('button', { name: '返回选择' }));
  fireEvent.click(within(browser).getByRole('button', { name: '返回范围' }));
  await finish('shrunk');
  expect(shrink).toHaveBeenCalledTimes(1);
  expect(getScope().carriedPlanId).toBe('plan_next');
});
