/**
 * [mycowork] 文件：officeTemplateManage.dom.test.tsx
 * 职责：找回与撤回模板候选（MyCowork PR05 切片 g1b，A230、A231、R034）：P09“浏览全部”抽屉的“审批状态”筛选（发出的参数、owner 审核队列 403 后退回默认列表、
 *       换筛选重置内容关系）；owner 在详情里对已批准候选“弃用”、对未批准候选“退回草稿”（二次确认、取消不发请求、各错误码）；
 *       非 owner / 接口没列迁移时没有按钮；弃用后详情与列表的状态。
 * 边界：真实 CompositionPage 与抽屉，只替换 Bridge HTTP（fetch，共用 templateBrowseFixture）。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeCompositionSlot } from '@/renderer/mycowork-slots';
import { calls, detail, err, fetchMock, item, reply, serve } from './templateBrowseFixture';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ decisionId: 'dec_1' }),
}));

const cand = {
  nominated_by: 'u',
  derived_from: { resource_id: 'r', revision_id: 'v', content_sha256: 's', slide: 2 },
  findings: 0,
};
let current: { approval: string; transitions: string[] };
let asCandidate = true; // false = owner 自己登记的内置资产（接口没有 candidate 字段）
let transitionReply: ((body: Record<string, unknown>) => unknown) | undefined;
const posts = () =>
  calls(/\/assets\/n2\/transitions/).map(
    ([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
  );
const queryOf = (i: number, re: RegExp) => new URL(String(calls(re)[i]?.[0]), 'http://x').searchParams;

/** n2 是一份候选：详情随 current 变化，迁移 POST 默认成功并按“前进 / 退回 / 弃用”换 transitions。 */
function serveCandidate(extra: Parameters<typeof serve>[0]['hook'] = () => undefined, picked = 'n2') {
  serve({
    pages: [{ no: 1, cands: ['a1'], picked }],
    items: [{ ...item('n2'), approval: current.approval }],
    hook: (u, init) => {
      const hooked = extra?.(u, init);
      if (hooked) return hooked;
      if (u.pathname === '/bridge/v1/assets/n2/transitions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, string>;
        if (transitionReply) return transitionReply(body);
        current = { approval: body['to'] as string, transitions: body['to'] === 'deprecated' ? [] : ['deprecated'] };
        return reply(200, {
          asset_id: 'n2',
          version: 1,
          kind: 'page-pattern',
          title: '资产 n2',
          approval: current.approval,
          shared: true,
        });
      }
      if (u.pathname === '/bridge/v1/assets')
        return reply(200, { page: 1, page_size: 50, total: 1, items: [{ ...item('n2'), approval: current.approval }] });
      if (u.pathname === '/bridge/v1/assets/n2')
        return reply(200, {
          ...detail('n2'),
          approval: current.approval,
          ...(asCandidate ? { candidate: cand, findings: [] } : {}),
          transitions: current.transitions,
        });
      return undefined;
    },
  });
}
const openDetail = async () => {
  render(<OfficeCompositionSlot />);
  const line = await screen.findByTestId('selected-outside');
  fireEvent.click(await within(line).findByRole('button', { name: '查看原模板' }));
  const dialog = await screen.findByRole('dialog');
  return { dialog, zone: await within(dialog).findByTestId('asset-transitions') };
};

beforeEach(() => {
  fetchMock.mockReset();
  transitionReply = undefined;
  asCandidate = true;
  current = { approval: 'approved', transitions: ['deprecated'] };
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('A230 approval filter in 浏览全部', () => {
  const open = async () => {
    render(<OfficeCompositionSlot />);
    fireEvent.click((await screen.findAllByRole('button', { name: '浏览全部' }))[0] as HTMLElement);
    return await screen.findByRole('dialog');
  };
  const pick = async (dialog: HTMLElement, label: string) => {
    fireEvent.click(within(dialog).getByRole('combobox', { name: '审批状态' }));
    fireEvent.click(await screen.findByRole('option', { name: label }));
  };

  it('默认“全部”不带 approval / review；选“待审核”发 approval=draft,validating,previewable 与 review=true，并放开内容关系', async () => {
    serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('n1')] });
    const dialog = await open();
    await within(dialog).findByText('资产 n1');
    const first = queryOf(0, /\/assets\?/);
    expect([first.get('approval'), first.get('review'), first.get('relation')]).toEqual([null, null, 'parallel']);
    await pick(dialog, '待审核');
    await waitFor(() => expect(calls(/\/assets\?/).length).toBe(2));
    const q = queryOf(1, /\/assets\?/);
    expect([q.get('approval'), q.get('review'), q.get('relation'), q.get('page')]).toEqual([
      'draft,validating,previewable',
      'true',
      null,
      '1',
    ]);
  });

  it('owner 审核队列返回 403（不是 owner）就退回默认列表，仍按待审核状态筛，列表照常显示', async () => {
    serve({
      pages: [{ no: 1, cands: ['a1'] }],
      items: [{ ...item('c1'), approval: 'draft' }],
      hook: (u) =>
        u.pathname === '/bridge/v1/assets' && u.searchParams.get('review') ? err(403, 'FORBIDDEN') : undefined,
    });
    const dialog = await open();
    await pick(dialog, '待审核');
    expect(await within(dialog).findByText('资产 c1')).toBeInTheDocument();
    const urls = calls(/\/assets\?/).map(([u]) => new URL(String(u), 'http://x').searchParams);
    const last = urls.at(-1);
    expect([last?.get('approval'), last?.get('review')]).toEqual(['draft,validating,previewable', null]);
    expect(urls.some((p) => p.get('review') === 'true')).toBe(true);
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('其它失败（不是 403）照实报错并可重试，不悄悄退回', async () => {
    serve({
      pages: [{ no: 1, cands: ['a1'] }],
      items: [item('n1')],
      hook: (u) => (u.searchParams.get('review') ? err(500, 'INTERNAL') : undefined),
    });
    const dialog = await open();
    await pick(dialog, '待审核');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('读取失败');
    expect(calls(/\/assets\?/).filter(([u]) => !String(u).includes('review=true')).length).toBe(1); // 只有最初的“全部”
  });

  it('“已弃用”发 approval=deprecated 且不带 review；回到“全部”不再带 approval，页码回到 1', async () => {
    serve({ pages: [{ no: 1, cands: ['a1'] }], items: [{ ...item('d1'), approval: 'deprecated' }] });
    const dialog = await open();
    await pick(dialog, '已弃用');
    expect(await within(dialog).findByText('已弃用', { selector: '.arco-tag *, .arco-tag' })).toBeInTheDocument();
    const q = queryOf(1, /\/assets\?/);
    expect([q.get('approval'), q.get('review')]).toEqual(['deprecated', null]);
    await pick(dialog, '全部');
    await waitFor(() => expect(calls(/\/assets\?/).length).toBe(3));
    expect(queryOf(2, /\/assets\?/).get('approval')).toBeNull();
  });
});

describe('A231 deprecate / return to draft in the detail drawer', () => {
  it('owner 对已批准候选点“弃用”：先确认并写明后果，取消不发请求；确认后发 approved→deprecated，详情显示已弃用且按钮消失', async () => {
    serveCandidate();
    const { dialog, zone } = await openDetail();
    fireEvent.click(within(zone).getByRole('button', { name: '弃用' }));
    const msg = await screen.findByText(/弃用后不再进入模板推荐/);
    expect(msg).toHaveTextContent('已选用它的页面计划保留原选择');
    expect(msg).toHaveTextContent('不能撤销');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(zone).getByRole('button', { name: '弃用' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认弃用' }));
    await waitFor(() => expect(posts()).toEqual([{ version: 1, expected_approval: 'approved', to: 'deprecated' }]));
    const after = await within(dialog).findByText(/已弃用：不再进入模板推荐/);
    expect(after).toBeInTheDocument();
    expect(within(dialog).getByTestId('asset-detail')).toHaveTextContent('已弃用');
    expect(within(within(dialog).getByTestId('asset-transitions')).queryByRole('button')).toBeNull();
  });

  it('确认按钮挂在抽屉内（不被抽屉盖住）', async () => {
    serveCandidate();
    const { dialog, zone } = await openDetail();
    fireEvent.click(within(zone).getByRole('button', { name: '弃用' }));
    const ok = await screen.findByRole('button', { name: '确认弃用' });
    expect(dialog.contains(ok)).toBe(true);
  });

  it('连点确认只发一次请求，处理期间按钮禁用', async () => {
    serveCandidate();
    const { zone } = await openDetail();
    fireEvent.click(within(zone).getByRole('button', { name: '弃用' }));
    const ok = await screen.findByRole('button', { name: '确认弃用' });
    fireEvent.click(ok);
    fireEvent.click(ok);
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it('非 owner（接口 transitions 为空）和接口没列 deprecated 时没有弃用按钮', async () => {
    current = { approval: 'approved', transitions: [] };
    serveCandidate();
    const { zone } = await openDetail();
    expect(within(zone).queryByRole('button')).toBeNull();
    expect(zone).toHaveTextContent('已批准');
  });

  it.each([
    ['FORBIDDEN', 403, '只有管理员能审核模板'],
    ['REVISION_CONFLICT', 409, '状态刚在别处被改过'],
    ['NOT_FOUND', 404, '已不可用'],
    ['INVALID_REQUEST', 400, '现在不能这样操作'],
  ])('弃用失败 %s：role=alert 如实说明；409 / 400 会重读详情', async (code, status, text) => {
    transitionReply = () => err(status, code);
    serveCandidate();
    const { dialog, zone } = await openDetail();
    const reads = () => calls(/\/assets\/n2\?version=1/).length;
    const before = reads();
    fireEvent.click(within(zone).getByRole('button', { name: '弃用' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认弃用' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(text);
    if (code === 'REVISION_CONFLICT' || code === 'INVALID_REQUEST')
      await waitFor(() => expect(reads()).toBe(before + 1));
    else expect(reads()).toBe(before);
    if (code === 'FORBIDDEN') expect(within(zone).getByRole('button', { name: '弃用' })).toBeEnabled(); // 失败后可再点
  });

  it('未批准的候选：接口列了 draft 就给“退回草稿”（确认后发 previewable→draft），不列就不给', async () => {
    current = { approval: 'previewable', transitions: ['approved', 'draft'] };
    serveCandidate();
    const { dialog, zone } = await openDetail();
    expect(within(zone).queryByRole('button', { name: '弃用' })).toBeNull();
    fireEvent.click(within(zone).getByRole('button', { name: '退回草稿' }));
    expect(await screen.findByText(/退回草稿后要重新校验/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: '确认退回' }));
    await waitFor(() => expect(posts()).toEqual([{ version: 1, expected_approval: 'previewable', to: 'draft' }]));
    await waitFor(() => expect(within(dialog).getByTestId('asset-detail')).toHaveTextContent('草稿'));
  });
});

describe('g1b 审查跟进', () => {
  const inList = async () => {
    // 本页已选的是别的模板：n2 在列表里才有“用于第 1 页”可看
    render(<OfficeCompositionSlot />);
    fireEvent.click((await screen.findAllByRole('button', { name: '浏览全部' }))[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    const row = await within(dialog).findByTestId('asset-item');
    return { dialog, row };
  };

  const openPlain = async () => {
    render(<OfficeCompositionSlot />);
    const line = await screen.findByTestId('selected-outside');
    fireEvent.click(await within(line).findByRole('button', { name: '查看原模板' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByTestId('asset-detail');
    return dialog;
  };

  it('M1 内置资产（没有 candidate 字段）已批准、接口列了 deprecated：没有弃用按钮，审批区不渲染', async () => {
    asCandidate = false;
    current = { approval: 'approved', transitions: ['deprecated'] };
    serveCandidate();
    const dialog = await openPlain();
    expect(within(dialog).queryByRole('button', { name: '弃用' })).toBeNull();
    expect(within(dialog).queryByTestId('asset-transitions')).toBeNull();
  });

  it('M1 内置资产的前进步骤照旧，退回草稿与弃用不出', async () => {
    asCandidate = false;
    current = { approval: 'validating', transitions: ['previewable', 'draft', 'deprecated'] };
    serveCandidate();
    const dialog = await openPlain();
    const zone = await within(dialog).findByTestId('asset-transitions');
    expect(
      within(zone)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['标为可预览']);
  });

  it('M3 在详情里弃用后点“返回列表”：列表重读，该行标已弃用，“用于第 1 页”置灰并说明原因', async () => {
    serveCandidate(undefined, 'other');
    const { dialog, row } = await inList();
    expect(within(row).getByRole('button', { name: '用于第 1 页' })).toBeEnabled();
    const listReads = () => calls(/\/assets\?/).length;
    const before = listReads();
    fireEvent.click(within(row).getByRole('button', { name: '查看原模板' }));
    const zone = await within(dialog).findByTestId('asset-transitions');
    fireEvent.click(within(zone).getByRole('button', { name: '弃用' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认弃用' }));
    await within(dialog).findByText(/已弃用：不再进入模板推荐/);
    fireEvent.click(within(dialog).getByRole('button', { name: '返回列表' }));
    await waitFor(() => expect(listReads()).toBeGreaterThan(before));
    const again = await within(dialog).findByTestId('asset-item');
    await waitFor(() => expect(again).toHaveTextContent('已弃用'));
    expect(within(again).getByRole('button', { name: '用于第 1 页' })).toBeDisabled();
    expect(again).toHaveTextContent('已弃用，不能选用');
  });

  it('待审核 / 草稿的项“用于第 N 页”置灰并说明原因，已批准的可点', async () => {
    current = { approval: 'draft', transitions: [] };
    serveCandidate(undefined, 'other');
    const { row } = await inList();
    expect(within(row).getByRole('button', { name: '用于第 1 页' })).toBeDisabled();
    expect(row).toHaveTextContent('还在审核中，不能选用');
  });

  it('确认气泡开着按 Esc 只关气泡，抽屉还在，也没有发请求', async () => {
    serveCandidate();
    const { dialog, zone } = await openDetail();
    fireEvent.click(within(zone).getByRole('button', { name: '弃用' }));
    const ok = await screen.findByRole('button', { name: '确认弃用' });
    fireEvent.keyDown(ok, { key: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认弃用' })).toBeNull());
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(posts()).toHaveLength(0);
  });

  it('批准的确认气泡同样：Esc 只关气泡', async () => {
    current = { approval: 'previewable', transitions: ['approved'] };
    serveCandidate();
    const { dialog, zone } = await openDetail();
    fireEvent.click(within(zone).getByRole('button', { name: '批准' }));
    const ok = await screen.findByRole('button', { name: '确认批准' });
    fireEvent.keyDown(ok, { key: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认批准' })).toBeNull());
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('带去事实化标记的候选不给“退回草稿”（标记不随退回清除）', async () => {
    current = { approval: 'previewable', transitions: ['draft'] };
    serve({
      pages: [{ no: 1, cands: ['a1'], picked: 'n2' }],
      hook: (u) =>
        u.pathname === '/bridge/v1/assets/n2'
          ? reply(200, {
              ...detail('n2'),
              approval: 'previewable',
              candidate: cand,
              findings: [{ kind: 'date', path: '/slide[2]/shape[1]', text: '2026年3月' }],
              transitions: ['draft'],
            })
          : undefined,
    });
    const { zone } = await openDetail();
    expect(within(zone).queryByRole('button')).toBeNull();
  });

  it('弃用失败后可再点：第二次点确认真的发出第二次请求', async () => {
    let n = 0;
    transitionReply = () =>
      ++n === 1
        ? err(500, 'INTERNAL')
        : reply(200, {
            asset_id: 'n2',
            version: 1,
            kind: 'page-pattern',
            title: 't',
            approval: 'deprecated',
            shared: true,
          });
    serveCandidate();
    const { dialog, zone } = await openDetail();
    for (let i = 0; i < 2; i++) {
      fireEvent.click(within(zone).getByRole('button', { name: '弃用' }));
      fireEvent.click(await screen.findByRole('button', { name: '确认弃用' }));
      if (i === 0) await within(dialog).findByRole('alert');
    }
    await waitFor(() => expect(posts()).toHaveLength(2));
  });

  it('换审批状态回第 1 页（从第 2 页起）', async () => {
    serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('n1')], total: 60 });
    render(<OfficeCompositionSlot />);
    fireEvent.click((await screen.findAllByRole('button', { name: '浏览全部' }))[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: '下一页' }));
    await within(dialog).findByText('2 / 2');
    expect(queryOf(1, /\/assets\?/).get('page')).toBe('2');
    fireEvent.click(within(dialog).getByRole('combobox', { name: '审批状态' }));
    fireEvent.click(await screen.findByRole('option', { name: '已弃用' }));
    await waitFor(() => expect(calls(/\/assets\?/).length).toBe(3));
    expect(queryOf(2, /\/assets\?/).get('page')).toBe('1');
  });

  it('非 owner：审核队列 403 只吃一次，之后翻页 / 搜索直接走默认列表', async () => {
    serve({
      pages: [{ no: 1, cands: ['a1'] }],
      items: [{ ...item('c1'), approval: 'draft' }],
      total: 60,
      hook: (u) =>
        u.pathname === '/bridge/v1/assets' && u.searchParams.get('review') ? err(403, 'FORBIDDEN') : undefined,
    });
    render(<OfficeCompositionSlot />);
    fireEvent.click((await screen.findAllByRole('button', { name: '浏览全部' }))[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('combobox', { name: '审批状态' }));
    fireEvent.click(await screen.findByRole('option', { name: '待审核' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: '下一页' }));
    await within(dialog).findByText('2 / 2');
    const reviewCalls = calls(/review=true/).length;
    expect(reviewCalls).toBe(1);
    const last = queryOf(calls(/\/assets\?/).length - 1, /\/assets\?/);
    expect([last.get('page'), last.get('review'), last.get('approval')]).toEqual([
      '2',
      null,
      'draft,validating,previewable',
    ]);
  });
});
