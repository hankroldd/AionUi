/**
 * [mycowork] adapted：模板管理（审批筛选/下架/审查跟进）（拆分b，原 officeTemplateManage.dom.test.tsx，用例原样）。
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
