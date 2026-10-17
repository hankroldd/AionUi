/**
 * [mycowork] adapted：空间行“存为模板候选”提名 UI（拆分b，原 officeTemplateNominate.dom.test.tsx，用例原样；a=菜单与对话框，b=结果，c=owner 审批）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const submit2 = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit nomination' }));

describe('result', () => {
  it('points the nominee to 浏览全部 → 审批状态：待审核 so the candidate can be found after closing (A230)', async () => {
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    expect(await within(dialog).findByTestId('nominate-guide')).toHaveTextContent('浏览全部 → 审批状态：待审核');
  });

  it('no flags: says it can go to review, lists nothing, and a non-owner sees 等待管理员审核 without buttons', async () => {
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    const result = await within(dialog).findByTestId('nominate-result');
    expect(result).toHaveTextContent('可以提交审核');
    expect(within(result).queryByRole('list', { name: '需清理的内容' })).toBeNull();
    expect(await within(result).findByText(/等待管理员审核/)).toBeInTheDocument();
    expect(within(result).queryByRole('button', { name: /批准|校验|可预览/ })).toBeNull();
  });

  it('flags: lists every kind with its page (full path only in title) and the contract text, says it cannot be approved, offers no approve button even to the owner', async () => {
    findings = [
      { kind: 'date', path: '/slide[2]/shape[1]', text: '2026年3月' },
      { kind: 'number', path: '/slide[2]/shape[2]', text: '12%' },
      { kind: 'name', path: '/slide[2]/shape[3]', text: '某某集团' },
      { kind: 'image', path: '/slide[2]/picture[1]', text: '' },
      { kind: 'unscanned', path: '/slide[2]/table[1]', text: '' },
      { kind: 'notes', path: '/slide[2]/notes', text: '' },
      { kind: 'comments', path: '/slide[2]/comment[1]', text: '' },
      { kind: 'notes_unchecked', path: '/slide[2]', text: '' },
    ];
    // 后端对带标记的可预览候选只列退回草稿，不列 approved（registry.ts nextApprovals）
    approval = 'previewable';
    transitions = ['draft'];
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    const result = await within(dialog).findByTestId('nominate-result');
    expect(result).toHaveTextContent('发现 8 条需要清理的内容');
    expect(result).toHaveTextContent('有需清理的内容就不能批准');
    expect(result).toHaveTextContent('重新导入再提名');
    const list = within(result).getByRole('list', { name: '需清理的内容' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(findings.map((f) => f.kind));
    expect(rows[0]).toHaveTextContent('日期 · 第 2 页 · “2026年3月”');
    expect(rows[0]).toHaveAttribute('title', '/slide[2]/shape[1]');
    expect(rows[5]).toHaveTextContent('演讲者备注 · 第 2 页');
    expect(rows[5]).toHaveTextContent('（不显示内容）');
    expect(rows[6]).toHaveTextContent('批注 · 第 2 页');
    expect(rows[7]).toHaveTextContent('备注或批注未能检查');
    const zone = await within(result).findByTestId('asset-transitions'); // 审批区已加载
    expect(zone).toHaveTextContent('还有 8 条需要清理的内容，不能批准');
    expect(within(zone).queryByRole('button')).toBeNull(); // 带标记永远批准不了，退回草稿也清不掉标记：一个按钮都不给
    expect(within(result).queryByRole('button', { name: '批准' })).toBeNull();
  });

  it('even if the interface lists approved for a flagged candidate, no 批准 is rendered (UI backstop)', async () => {
    findings = [{ kind: 'date', path: '/slide[2]/shape[1]', text: '2026年3月' }];
    approval = 'previewable';
    transitions = ['approved', 'draft'];
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    const zone = await within(dialog).findByTestId('asset-transitions');
    expect(zone).toHaveTextContent('不能批准');
    expect(within(zone).queryByRole('button', { name: '批准' })).toBeNull();
    expect(within(zone).queryByRole('button')).toBeNull(); // 带标记永远批准不了，退回草稿也清不掉标记：一个按钮都不给
  });

  it('waiting note is only for a non-owner on a candidate that is neither approved nor deprecated; an owner with buttons does not see it', async () => {
    const note = async () => {
      mount();
      const { dialog } = await openNominate();
      fill(dialog);
      submit(dialog);
      const zone = await within(dialog).findByTestId('nominate-result');
      await within(zone).findByText(/资料|版本/); // 详情已读到
      const text = zone.textContent ?? '';
      cleanup();
      return text;
    };
    transitions = [];
    expect(await note()).toContain('等待管理员审核'); // 非 owner、草稿
    approval = 'deprecated';
    expect(await note()).not.toContain('等待管理员审核');
    approval = 'approved';
    const approved = await note();
    expect(approved).not.toContain('等待管理员审核');
    expect(approved).toContain('已批准');
    approval = 'draft';
    transitions = ['validating'];
    expect(await note()).not.toContain('等待管理员审核'); // owner 有按钮
  });

  it('English labels for the notes / comments / notes_unchecked flags', async () => {
    findings = [
      { kind: 'notes', path: '/slide[2]/notes', text: '' },
      { kind: 'comments', path: '/slide[2]/comment[1]', text: '' },
      { kind: 'notes_unchecked', path: '/slide[2]', text: '' },
    ];
    mount('en-US');
    await screen.findByRole('button', { name: 'A.pptx', exact: true });
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save as template candidate' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Page number (from 1)'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByLabelText('Cover'));
    submit2(dialog);
    const result = await within(dialog).findByTestId('nominate-result');
    const rows = within(result).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Speaker notes');
    expect(rows[1]).toHaveTextContent('Comments');
    expect(rows[2]).toHaveTextContent('Notes or comments could not be checked');
  });
});
