/**
 * [mycowork] 文件：officeTemplateNominate.dom.test.tsx
 * 职责：空间行“···→存为模板候选”（MyCowork PR05 切片 g1，A168、R034）：菜单项出现条件、提名请求体与幂等、无标记 / 有标记（含备注、批注、未能检查）
 *       两种结果的呈现、owner 在详情里推进审批与非 owner 的“等待 owner 审核”、各错误码提示、对话框语义与焦点归还。
 * 边界：真实资源页与 Arco，只替换 Bridge HTTP（fetch）；不 mock 菜单、对话框或审批逻辑。
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

describe('menu item', () => {
  it('shows for an imported pptx only: not for docx, outputs, Secret or knowledge-base originals', async () => {
    items = [
      file('res_a'),
      file('res_b', { file_name: 'B.docx' }),
      file('res_c', { origin: 'outputs' }),
      file('res_d', { secret: true }),
      file('res_e', { origin: 'knowledge_base', source_id: 'src_a', state: 'ready' }),
    ];
    const has = async (name: string) => {
      cleanup();
      mount();
      fireEvent.click(await moreButton(name));
      await screen.findByRole('menuitem', { name: '编辑标签' });
      return screen.queryByRole('menuitem', { name: '存为模板候选' }) !== null;
    };
    expect(await has('A.pptx')).toBe(true);
    expect(await has('B.docx')).toBe(false);
    expect(await has('C.pptx')).toBe(false);
    expect(await has('D.pptx')).toBe(false);
    expect(await has('E.pptx')).toBe(false);
  });
});

describe('nomination dialog', () => {
  it('is a labelled dialog; Esc closes it and focus returns to the ··· button', async () => {
    mount();
    const { more, dialog } = await openNominate();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement)); // 焦点进入对话框
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /存为模板候选/ })).toBeNull());
    await waitFor(() => expect(more).toHaveFocus());
  });

  it('sends exactly the entered page / title / relations / density; a double click makes one request', async () => {
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    const button = within(dialog).getByRole('button', { name: '提交提名' });
    fireEvent.click(button);
    fireEvent.click(button);
    await within(dialog).findByTestId('nominate-result');
    const body = posts('/template-candidates');
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      resource_id: 'res_a',
      slide: 2,
      title: '汇报页',
      relations: ['cover', 'summary'],
      density: 'medium',
    });
    expect(String(body[0]?.['submission_id'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an empty relation set and a bad page locally, without a request', async () => {
    mount();
    const { dialog } = await openNominate();
    fireEvent.change(within(dialog).getByLabelText('页码（从 1 起）'), { target: { value: '0' } });
    submit(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('页码须是 1 或更大的整数');
    fireEvent.change(within(dialog).getByLabelText('页码（从 1 起）'), { target: { value: '2' } });
    submit(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请至少选一个内容关系');
    expect(posts('/template-candidates')).toHaveLength(0);
  });

  it('retry after a failure reuses the idempotency key; editing a field issues a new one', async () => {
    nominateReply = () => fail(503, 'UPSTREAM_UNAVAILABLE');
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    await within(dialog).findByRole('alert');
    submit(dialog);
    await waitFor(() => expect(posts('/template-candidates')).toHaveLength(2));
    fireEvent.change(within(dialog).getByLabelText('候选标题'), { target: { value: '另一个标题' } });
    submit(dialog);
    await waitFor(() => expect(posts('/template-candidates')).toHaveLength(3));
    const [a, b, c] = posts('/template-candidates').map((x) => x['submission_id']);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it.each([
    [fail(404, 'NOT_FOUND'), '这份资料不可用'],
    [fail(400, 'INVALID_REQUEST', 'slide is not in the file'), '页码不在文件里'],
    [fail(400, 'INVALID_REQUEST', 'only 16:9 and 4:3 slides can become templates'), '画幅不是 16:9 / 4:3'],
    [fail(400, 'INVALID_REQUEST', 'secret resources cannot become template assets'), '已标为 Secret'],
    [fail(400, 'INVALID_REQUEST', 'something unexpected'), '请求无效'],
    [fail(409, 'SUBMISSION_CONFLICT'), '同一编号提交的内容不同'],
    [fail(503, 'UPSTREAM_UNAVAILABLE'), '资料服务暂不可用'],
  ])('translates a failed nomination: %#', async (res, text) => {
    nominateReply = () => res.clone();
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(alert.textContent).not.toMatch(/slide is not|16:9 and 4:3|secret resources|unexpected/); // 不拼后端英文原文
    expect(within(dialog).queryByTestId('nominate-result')).toBeNull();
  });

  it('title is fixed; the file name is the first body line; the title field is cut to 200 chars and trimmed on send', async () => {
    items = [file('res_a', { file_name: `${'长'.repeat(230)}.pptx` })];
    mount();
    fireEvent.click(await moreButton(items[0]?.file_name ?? ''));
    fireEvent.click(await screen.findByRole('menuitem', { name: '存为模板候选' }));
    const dialog = await screen.findByRole('dialog', { name: '存为模板候选' });
    expect(dialog).toHaveTextContent(`资料：${'长'.repeat(230)}.pptx`);
    const title = within(dialog).getByLabelText('候选标题') as HTMLInputElement;
    expect(title.value).toHaveLength(200);
    fireEvent.change(title, { target: { value: '  两侧有空格  ' } });
    fireEvent.change(within(dialog).getByLabelText('页码（从 1 起）'), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByLabelText('封面'));
    fireEvent.click(within(dialog).getByLabelText('高'));
    submit(dialog);
    await within(dialog).findByTestId('nominate-result');
    expect(posts('/template-candidates')[0]).toMatchObject({ title: '两侧有空格', slide: 3, density: 'high' });
  });

  it('a file name over 200 chars: the untouched default title that is sent is at most 200 chars', async () => {
    items = [file('res_a', { file_name: `${'长'.repeat(230)}.pptx` })];
    mount();
    fireEvent.click(await moreButton(items[0]?.file_name ?? ''));
    fireEvent.click(await screen.findByRole('menuitem', { name: '存为模板候选' }));
    const dialog = await screen.findByRole('dialog', { name: '存为模板候选' });
    fireEvent.change(within(dialog).getByLabelText('页码（从 1 起）'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByLabelText('封面'));
    submit(dialog);
    await within(dialog).findByTestId('nominate-result');
    expect(String(posts('/template-candidates')[0]?.['title']).length).toBeLessThanOrEqual(200);
  });

  it('an empty title is rejected locally without a request', async () => {
    mount();
    const { dialog } = await openNominate();
    fill(dialog, { title: '   ' });
    submit(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请填写候选标题');
    expect(posts('/template-candidates')).toHaveLength(0);
  });

  it('while the nomination is in flight: 取消 is disabled and Esc does not close; the result still arrives', async () => {
    let release: (() => void) | undefined;
    const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/template-candidates')) await new Promise<void>((r) => (release = r));
      return base(url, init);
    });
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    await waitFor(() => expect(posts('/template-candidates').length + (release ? 1 : 0)).toBeGreaterThan(0));
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape', keyCode: 27 });
    expect(screen.getByRole('dialog', { name: '存为模板候选' })).toBeInTheDocument();
    release?.();
    expect(await within(dialog).findByTestId('nominate-result')).toBeInTheDocument();
  });
});

describe('result', () => {
  it('points the nominee to 浏览全部 → 审批状态：待审核 so the candidate can be found after closing (A230)', async () => {
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    expect(await within(dialog).findByTestId('nominate-guide')).toHaveTextContent('浏览全部 → 审批状态：待审核');
  });

  it('no flags: says it can go to review, lists nothing, and a non-owner sees 等待 owner 审核 without buttons', async () => {
    mount();
    const { dialog } = await openNominate();
    fill(dialog);
    submit(dialog);
    const result = await within(dialog).findByTestId('nominate-result');
    expect(result).toHaveTextContent('可以提交审核 / 批准');
    expect(within(result).queryByRole('list', { name: '标记' })).toBeNull();
    expect(await within(result).findByText(/等待 owner 审核/)).toBeInTheDocument();
    expect(within(result).queryByRole('button', { name: /批准|校验|可预览/ })).toBeNull();
  });

  it('flags: lists every kind with its path and the contract text, says it cannot be approved, offers no approve button even to the owner', async () => {
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
    expect(result).toHaveTextContent('有标记不能批准');
    expect(result).toHaveTextContent('重新导入再提名');
    const list = within(result).getByRole('list', { name: '标记' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(findings.map((f) => f.kind));
    expect(rows[0]).toHaveTextContent('日期 · /slide[2]/shape[1] · “2026年3月”');
    expect(rows[5]).toHaveTextContent('演讲者备注 · /slide[2]/notes');
    expect(rows[5]).toHaveTextContent('（不显示内容）');
    expect(rows[6]).toHaveTextContent('批注 · /slide[2]/comment[1]');
    expect(rows[7]).toHaveTextContent('备注或批注未能检查');
    const zone = await within(result).findByTestId('asset-transitions'); // 审批区已加载
    expect(zone).toHaveTextContent('还有 8 条去事实化标记，不能批准');
    expect(
      within(zone)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['退回草稿']); // 只有接口列的退回
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
    expect(
      within(zone)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['退回草稿']); // 合同允许的退回（A231）仍给
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
    expect(await note()).toContain('等待 owner 审核'); // 非 owner、草稿
    approval = 'deprecated';
    expect(await note()).not.toContain('等待 owner 审核');
    approval = 'approved';
    const approved = await note();
    expect(approved).not.toContain('等待 owner 审核');
    expect(approved).toContain('已批准');
    approval = 'draft';
    transitions = ['validating'];
    expect(await note()).not.toContain('等待 owner 审核'); // owner 有按钮
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
const submit2 = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit nomination' }));

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
    [fail(409, 'DEFACTUALIZATION_REQUIRED'), '还有去事实化标记，不能批准', false],
    [fail(409, 'REVISION_CONFLICT'), '刚在别处被改过，已重新读取', true],
    [fail(403, 'FORBIDDEN'), '只有 owner 能审核模板', false],
    [fail(400, 'INVALID_REQUEST'), '这一步迁移不被允许，已重新读取', true],
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
