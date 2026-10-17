/**
 * [mycowork] adapted：空间行“存为模板候选”提名 UI（拆分c，原 officeTemplateNominate.dom.test.tsx，用例原样；a=菜单与对话框，b=结果，c=owner 审批）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { AssetDetail, AssetNomination, ResourceList } from '@mycowork/contracts';
import { ResourcesPage } from '@mycowork/ui';

type Item = ResourceList['items'][number];
type Finding = AssetNomination['findings'][number];
const file = (id: string, over: Partial<Item> = {}): Item => ({
  resource_id: id,
  file_name: `${id.slice(4).toUpperCase()}.pptx`,
  source_id: null,
  state: 'stored',
  origin: 'imports',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-03T00:00:00Z',
  revision_count: 1,
  ...over,
});
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (status: number, code: string, message = 'x') => reply(status, { error: { code, message } });
const fetchMock = vi.fn();
let items: Item[];
let findings: Finding[];
let approval: AssetDetail['approval'];
let transitions: AssetDetail['approval'][];
let nominateReply: (() => Response) | undefined;
let transitionReply: ((body: Record<string, unknown>) => Response) | undefined;
const posts = (suffix: string) =>
  fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith(suffix) && (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
const detailGets = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/assets/pattern.cand_1?version=1'));

const detail = (): AssetDetail =>
  ({
    asset_id: 'pattern.cand_1',
    version: 1,
    kind: 'page-pattern',
    title: '汇报页',
    approval,
    shared: approval === 'approved',
    scenes: [],
    formats: ['pptx'],
    aspect: '16:9',
    relations: ['cover'],
    structure: 's',
    preview: { state: 'none' },
    candidate: {
      nominated_by: 'u',
      derived_from: { resource_id: 'res_a', revision_id: 'r', content_sha256: 's', slide: 2 },
      findings: findings.length,
    },
    category: 'c',
    density: 'medium',
    slots: null,
    theme_id: null,
    fonts: [],
    missing_dependencies: [],
    touches_master: false,
    acceptance: { editable: 'unknown' },
    source: null,
    private_keys: [],
    findings,
    transitions,
  }) as unknown as AssetDetail;

function serve() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(String(url), 'http://fixture.invalid');
    const method = init?.method ?? 'GET';
    if (u.pathname === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (u.pathname === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (u.pathname === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (u.pathname === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (u.pathname === '/bridge/v1/resources')
      return reply(200, { items, page: 1, page_size: 50, total: items.length, failed_source_ids: [] });
    if (u.pathname === '/bridge/v1/template-candidates' && method === 'POST')
      return (
        nominateReply?.() ??
        reply(201, {
          asset_id: 'pattern.cand_1',
          version: 1,
          approval,
          title: '汇报页',
          derived_from: { resource_id: 'res_a', revision_id: 'r', content_sha256: 's', slide: 2 },
          findings,
          approvable: findings.length === 0,
        })
      );
    if (u.pathname === '/bridge/v1/assets/pattern.cand_1') return reply(200, detail());
    if (u.pathname === '/bridge/v1/assets/pattern.cand_1/preview') return new Response('<p>x</p>', { status: 200 });
    if (u.pathname === '/bridge/v1/assets/pattern.cand_1/transitions' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (transitionReply) return transitionReply(body);
      approval = body['to'] as typeof approval;
      transitions =
        approval === 'validating' ? ['previewable'] : approval === 'previewable' ? ['approved'] : ['deprecated'];
      return reply(200, {
        asset_id: 'pattern.cand_1',
        version: 1,
        kind: 'page-pattern',
        title: '汇报页',
        approval,
        shared: approval === 'approved',
      });
    }
    return reply(404, { error: { code: 'NOT_FOUND' } });
  });
}
const mount = (lang = 'zh-CN') => render(<ResourcesPage lang={lang} ownerKey='user-a' onAskScope={vi.fn()} />);
const moreButton = async (name: string) => {
  await screen.findByRole('button', { name, exact: true });
  return screen.getByRole('button', { name: `更多操作 ${name}` });
};
const openNominate = async (name = 'A.pptx') => {
  const more = await moreButton(name);
  more.focus();
  fireEvent.click(more);
  fireEvent.click(await screen.findByRole('menuitem', { name: '存为模板候选' }));
  return { more, dialog: await screen.findByRole('dialog', { name: /存为模板候选/ }) };
};
const fill = (dialog: HTMLElement, { page = '2', title = '汇报页' } = {}) => {
  fireEvent.change(within(dialog).getByLabelText('页码（从 1 起）'), { target: { value: page } });
  fireEvent.change(within(dialog).getByLabelText('候选标题'), { target: { value: title } });
  fireEvent.click(within(dialog).getByLabelText('封面'));
  fireEvent.click(within(dialog).getByLabelText('总结'));
};
const submit = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: '提交提名' }));

beforeEach(() => {
  items = [file('res_a')];
  findings = [];
  approval = 'draft';
  transitions = [];
  nominateReply = undefined;
  transitionReply = undefined;
  localStorage.clear();
  fetchMock.mockReset();
  serve();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});


describe('owner approval in the same dialog', () => {
  it('walks draft → validating → previewable → approved with the right requests, then says it is approved', async () => {
    transitions = ['validating'];
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    const step = async (label: string, to: string, expected: string) => {
      fireEvent.click(await within(dialog).findByRole('button', { name: label }));
      await waitFor(() =>
        expect(posts('/transitions').at(-1)).toEqual({ version: 1, expected_approval: expected, to })
      );
    };
    await step('开始校验', 'validating', 'draft');
    await step('标为可预览', 'previewable', 'validating');
    fireEvent.click(await within(dialog).findByRole('button', { name: '批准' }));
    expect(await screen.findByText('批准后所有人可见并进入模板推荐；之后你可以在这里弃用它。')).toBeInTheDocument();
    expect(posts('/transitions')).toHaveLength(2); // 点“批准”本身不发请求
    fireEvent.click(screen.getByRole('button', { name: '确认批准' }));
    await waitFor(() =>
      expect(posts('/transitions').at(-1)).toEqual({ version: 1, expected_approval: 'previewable', to: 'approved' })
    );
    expect(await within(dialog).findByText(/已批准，可在页面计划页的“浏览全部”里看到/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '批准' })).toBeNull();
    const zone = within(dialog).getByTestId('asset-transitions');
    expect(
      within(zone)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['弃用']); // 已批准后接口列 deprecated：owner 可弃用（A231）
  });

  it('cancelling the approval confirmation sends nothing', async () => {
    approval = 'previewable';
    transitions = ['approved', 'draft'];
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    fireEvent.click(await within(dialog).findByRole('button', { name: '批准' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消', hidden: false }));
    expect(posts('/transitions')).toHaveLength(0);
    expect(within(dialog).getByRole('button', { name: '批准' })).toBeEnabled();
  });

  it('every listed step gets a button (forward, return to draft, deprecate); unknown values give none', async () => {
    approval = 'validating';
    transitions = ['previewable', 'draft', 'deprecated'];
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    const zone = await within(dialog).findByTestId('asset-transitions');
    expect(
      within(zone)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['标为可预览', '退回草稿', '弃用']);
  });

  it('after a step succeeds, the buttons stay disabled until the re-read arrives (no second POST on a double click)', async () => {
    transitions = ['validating'];
    let release: (() => void) | undefined;
    let hold = false;
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://fixture.invalid');
      if (u.pathname.endsWith('/transitions') && init?.method === 'POST') hold = true;
      else if (hold && u.pathname === '/bridge/v1/assets/pattern.cand_1') await new Promise<void>((r) => (release = r));
      return base(url, init);
    });
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    const button = await within(dialog).findByRole('button', { name: '开始校验' });
    fireEvent.click(button);
    await waitFor(() => expect(posts('/transitions')).toHaveLength(1));
    await waitFor(() => expect(release).toBeDefined()); // POST 已返回，详情重读挂住
    const during = within(dialog).getByTestId('asset-transitions').querySelectorAll('button');
    expect([...during].every((b) => b.disabled)).toBe(true);
    fireEvent.click(during[0] as HTMLElement);
    expect(posts('/transitions')).toHaveLength(1);
    release?.();
    expect(await within(dialog).findByRole('button', { name: '标为可预览' })).toBeEnabled();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it.each([
    [fail(409, 'DEFACTUALIZATION_REQUIRED'), '还有需要清理的内容，不能批准', false],
    [fail(409, 'REVISION_CONFLICT'), '刚在别处被改过，已重新读取', true],
    [fail(403, 'FORBIDDEN'), '只有管理员能审核模板', false],
    [fail(400, 'INVALID_REQUEST'), '现在不能这样操作，已重新读取', true],
    [fail(503, 'UPSTREAM_UNAVAILABLE'), '资料服务暂不可用', false],
  ])('translates a refused transition: %#', async (res, text, rereads) => {
    transitions = ['validating'];
    transitionReply = () => res.clone();
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    const button = await within(dialog).findByRole('button', { name: '开始校验' });
    const before = detailGets().length;
    fireEvent.click(button);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
    if (rereads) await waitFor(() => expect(detailGets().length).toBeGreaterThan(before));
    else expect(detailGets().length).toBe(before);
    // 可重试：按钮仍在
    expect(within(dialog).getByRole('button', { name: '开始校验' })).toBeEnabled();
  });
});
