/**
 * [mycowork] PR03 A68: unchanged groups keep frozen members, exclusions and policy through reselect/send.
 * Bridge HTTP is the only mocked boundary; actual dialogs, store and session preparation run together.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ScopeStrip, ScopeChip, prepareScopedSession, getScope } from '@mycowork/ui';
import { enterProject } from '@mycowork/ui/scope-picker/scope-store';

const counts = { total: 700, ready: 700, indexing: 0, failed: 0, unavailable: 0 };
const EXCLUDES = [
  { kind: 'resource', id: 'r_excluded' },
  { kind: 'source', id: 'src_hidden' },
];
const POLICY = { strict: true, web: 'allowed' };
const sources = ['a', 'b', 'c'].map((id) => ({ source_id: `src_${id}`, name: `虚构库${id}`, counts }));
const token = {
  token: 'fictional',
  expires_at: '2099-01-01',
  mcp: {},
  workspace: '/fictional/workspace',
  session_mcp_server: {
    id: 'mycowork_bridge',
    name: 'mycowork_bridge',
    transport: { type: 'streamable_http', url: '/bridge/mcp', headers: {} },
  },
};
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
  text: async () => String(body),
});
const fetchMock = vi.fn();
let context: Record<string, unknown>;
let succession: 'expanded' | 'shrunk';
let tokenFails: boolean;
const shrink = vi.fn();
const plans = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === '/bridge/v1/context-plans' && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init.body)));
const resourceReads = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/bridge/v1/resources?'));

beforeEach(() => {
  enterProject(undefined);
  succession = 'expanded';
  tokenFails = false;
  shrink.mockReset();
  context = {
    plan_id: 'plan_original',
    version: 1,
    status: 'OK',
    used: [],
    withheld: 0,
    superseded: false,
    brief: {
      groups: [
        {
          source_id: 'src_a',
          source_name: '虚构库a',
          mode: 'subset',
          member_count: 2,
          counts: { ...counts, total: 2, ready: 2 },
        },
        { source_id: 'src_b', source_name: '虚构库b', mode: 'whole', member_count: 700, counts },
      ],
      excluded: 2,
      unauthorized: 0,
      refs: {},
      excludes: EXCLUDES,
      policy: POLICY,
    },
  };
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/context')) return reply(200, context);
    if (url === '/bridge/v1/scopes') return reply(200, { sources, projects: [] });
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url === '/bridge/v1/context-plans')
      return reply(201, { plan_id: 'plan_next', version: 2, status: 'OK', succession, ready: 1, indexing: 0 });
    if (url.endsWith('/tokens')) {
      if (tokenFails) {
        tokenFails = false;
        return reply(503, { error: { code: 'UPSTREAM_UNAVAILABLE' } });
      }
      return reply(201, token);
    }
    if (url.startsWith('/bridge/v1/resources?'))
      return reply(200, {
        total: 1,
        page: 1,
        page_size: 50,
        items: [
          {
            resource_id: 'r_new',
            file_name: '虚构文件.md',
            origin: 'kb',
            tag_ids: [],
            state: 'ready',
            updated_at: '2026-10-12',
          },
        ],
      });
    if (url === '/bridge/v1/resources/r_new/preview') return reply(200, '虚构预览内容');
    throw new Error(`Unexpected request: ${url} ${init?.method ?? 'GET'}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  enterProject(undefined);
  vi.unstubAllGlobals();
});

async function openStrip() {
  const mounted = render(<ScopeStrip lang='zh-CN' conversationId='conv' onStrictShrink={shrink} />);
  fireEvent.click(await screen.findByRole('button', { name: '更改范围' }));
  await screen.findByText('虚构库c');
  return mounted;
}
async function apply() {
  fireEvent.click(screen.getByRole('button', { name: '应用', exact: true }));
  await waitFor(() => expect(plans()).toHaveLength(1));
}

for (const selector of ['collection', 'saved_view', 'knowledge_base', 'project', 'legacy']) {
  it(`preserves ${selector} subset by plan_group without listing or recomputing it`, async () => {
    const brief = context.brief as Record<string, unknown>;
    if (selector !== 'legacy')
      brief.scopes = [
        selector === 'knowledge_base'
          ? { selector, id: 'src_a', resource_ids: ['r_original1', 'r_original2'] }
          : { selector, id: 'old_dynamic_selection' },
      ];
    await openStrip();
    expect(screen.getByText('保留原子集 2 份')).toBeInTheDocument();
    await apply();
    expect(plans()[0]).toEqual({
      parent_plan_id: 'plan_original',
      use_project_defaults: false,
      scopes: [
        { selector: 'plan_group', id: 'src_a', plan_id: 'plan_original' },
        { selector: 'knowledge_base', id: 'src_b' },
      ],
      excludes: EXCLUDES,
      policy: POLICY,
    });
    expect(resourceReads()).toHaveLength(0);
  });
}
for (const member_count of [0, 601]) {
  it(`keeps frozen ${member_count} members without a 500-item list or whole fallback`, async () => {
    const brief = context.brief as { groups: { mode: string; member_count: number; counts: typeof counts }[] };
    brief.groups[0].member_count = member_count;
    brief.groups[0].mode = member_count === 0 ? 'empty' : 'subset';
    brief.groups[0].counts = { ...counts, total: member_count, ready: member_count };
    await openStrip();
    expect(screen.getByText(`保留原子集 ${member_count} 份`)).toBeInTheDocument();
    await apply();
    expect(plans()[0].scopes[0]).toEqual({ selector: 'plan_group', id: 'src_a', plan_id: 'plan_original' });
    expect(resourceReads()).toHaveLength(0);
  });
}
it('adding a library retains original subset, exclusions and policy', async () => {
  await openStrip();
  fireEvent.click(screen.getByText('虚构库c'));
  await apply();
  expect(plans()[0].scopes).toContainEqual({ selector: 'plan_group', id: 'src_a', plan_id: 'plan_original' });
  expect(plans()[0].scopes).toContainEqual({ selector: 'knowledge_base', id: 'src_c' });
  expect(plans()[0]).toMatchObject({ excludes: EXCLUDES, policy: POLICY });
});
it('unchecking and rechecking retains the subset instead of silently choosing the whole library', async () => {
  await openStrip();
  fireEvent.click(screen.getByText('虚构库a'));
  fireEvent.click(screen.getByText('虚构库a'));
  expect(screen.getByText('保留原子集 2 份')).toBeInTheDocument();
  await apply();
  expect(plans()[0].scopes[0].selector).toBe('plan_group');
});
it('whole-library replacement keeps exclusions unless explicitly cleared', async () => {
  await openStrip();
  fireEvent.click(screen.getByRole('button', { name: '明确改用整库' }));
  await apply();
  expect(plans()[0]).toMatchObject({
    scopes: [
      { selector: 'knowledge_base', id: 'src_a' },
      { selector: 'knowledge_base', id: 'src_b' },
    ],
    excludes: EXCLUDES,
    policy: POLICY,
  });
});
it('explicit clearing changes exclusions without widening the frozen subset', async () => {
  await openStrip();
  fireEvent.click(screen.getByRole('button', { name: '清除排除规则' }));
  await apply();
  expect(plans()[0]).toMatchObject({ excludes: [], policy: POLICY });
  expect(plans()[0].scopes[0].selector).toBe('plan_group');
});
it('cancelling whole/clear changes leaves the applied scope and next opening intact', async () => {
  await openStrip();
  fireEvent.click(screen.getByRole('button', { name: '明确改用整库' }));
  fireEvent.click(screen.getByRole('button', { name: '清除排除规则' }));
  fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }));
  expect(plans()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '更改范围' }));
  await screen.findByText('保留原子集 2 份');
  await apply();
  expect(plans()[0]).toMatchObject({ excludes: EXCLUDES, policy: POLICY });
  expect(plans()[0].scopes[0].selector).toBe('plan_group');
});
it('preview and cancelling reselect preserve the frozen group', async () => {
  await openStrip();
  fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }));
  await screen.findByText('虚构文件.md');
  fireEvent.click(screen.getByRole('button', { name: '预览 虚构文件.md' }));
  await screen.findByText('虚构预览内容');
  fireEvent.click(screen.getByRole('button', { name: '返回选择' }));
  fireEvent.click(screen.getByRole('button', { name: '返回范围' }));
  await apply();
  expect(plans()[0].scopes[0].selector).toBe('plan_group');
});
it('confirming reselected files replaces only that group, retaining exclusions and policy', async () => {
  await openStrip();
  fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }));
  const browser = await screen.findByRole('dialog', { name: '浏览 虚构库a' });
  fireEvent.click(await within(browser).findByRole('checkbox', { name: '虚构文件.md' }));
  fireEvent.click(within(browser).getByRole('button', { name: '使用已选文件' }));
  await apply();
  expect(plans()[0].scopes[0]).toEqual({ selector: 'knowledge_base', id: 'src_a', resource_ids: ['r_new'] });
  expect(plans()[0]).toMatchObject({ excludes: EXCLUDES, policy: POLICY });
});
it('strict shrink → draft reselect → send keeps frozen group, exclusions, policy and working project', async () => {
  succession = 'shrunk';
  context.working_project_id = 'project_fictional';
  const strip = await openStrip();
  fireEvent.click(screen.getByText('虚构库b'));
  await apply();
  await waitFor(() => expect(shrink).toHaveBeenCalledOnce());
  strip.unmount();
  expect(getScope()).toMatchObject({
    carriedPlanId: 'plan_next',
    projectId: 'project_fictional',
    excludes: EXCLUDES,
    policy: POLICY,
  });
  render(<ScopeChip lang='zh-CN' />);
  fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
  await screen.findByText('虚构库c');
  fireEvent.click(screen.getByText('虚构库c'));
  fireEvent.click(screen.getByRole('button', { name: '应用到本轮' }));
  await waitFor(() => expect(getScope().carriedPlanId).toBeUndefined());
  await prepareScopedSession('zh-CN');
  expect(plans()).toHaveLength(2);
  expect(plans()[1]).toMatchObject({
    working_project_id: 'project_fictional',
    excludes: EXCLUDES,
    policy: POLICY,
    scopes: [
      { selector: 'plan_group', id: 'src_a', plan_id: 'plan_original' },
      { selector: 'knowledge_base', id: 'src_c' },
    ],
  });
});
it('token failure preserves carried plan; success clears only that handle and later send retains rules', async () => {
  succession = 'shrunk';
  const strip = await openStrip();
  fireEvent.click(screen.getByText('虚构库b'));
  await apply();
  await waitFor(() => expect(shrink).toHaveBeenCalledOnce());
  strip.unmount();
  tokenFails = true;
  await expect(prepareScopedSession('zh-CN')).rejects.toThrow();
  expect(getScope().carriedPlanId).toBe('plan_next');
  await prepareScopedSession('zh-CN');
  expect(getScope().carriedPlanId).toBeUndefined();
  expect(getScope()).toMatchObject({ excludes: EXCLUDES, policy: POLICY });
  await prepareScopedSession('zh-CN');
  expect(plans()).toHaveLength(2);
  expect(plans()[1]).toMatchObject({ excludes: EXCLUDES, policy: POLICY });
});
