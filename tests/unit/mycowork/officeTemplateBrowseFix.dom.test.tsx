/**
 * [mycowork] ADR-0011: review / real-UI fixes for the P09 browse drawer and adopt-all (MyCowork PR05 slices j, k; A167, A169, A189).
 * Pins: selected-outside-candidates line (F1), rejection stays in the drawer (F2), focus return + dialog semantics (F3),
 * stale reads, search box, Arco filters, list retry, exact version / encoded ids, adopt-all busy / notes, reread failures.
 * Only the Bridge boundary is mocked (fetch).
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeCompositionSlot } from '@/renderer/mycowork-slots';
import { calls, decisionOf, err, fetchMock, item, reply, serve } from './templateBrowseFixture';

const nav = vi.hoisted(() => ({ navigate: vi.fn(), id: 'dec_1' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => nav.navigate,
  useParams: () => ({ decisionId: nav.id }),
}));

const NOT_ELIGIBLE = '这个模板不符合本页或整套主题的要求，不能用于第 1 页';
const post = (u: URL, init?: RequestInit) => init?.method === 'POST' && u.pathname.endsWith('/choices');

describe('P09 browse drawer: review fixes', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    nav.navigate.mockReset();
    nav.id = 'dec_1';
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
        observe() {
          this.cb([{ isIntersecting: true }]);
        }
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = async () => {
    render(<OfficeCompositionSlot />);
    const trigger = (await screen.findAllByRole('button', { name: '浏览全部' }))[0] as HTMLElement;
    trigger.focus();
    fireEvent.click(trigger);
    return { dialog: await screen.findByRole('dialog'), trigger };
  };

  describe('F1 selected outside the candidates', () => {
    it('shows name, version and "view original" for a selected non-candidate; none when the selection is a candidate', async () => {
      serve({
        pages: [
          { no: 1, cands: ['a1'], picked: 'n2' },
          { no: 2, cands: ['b1'], picked: 'b1' },
        ],
      });
      render(<OfficeCompositionSlot />);
      const line = await screen.findByTestId('selected-outside');
      expect(await within(line).findByText('资产 n2')).toBeInTheDocument();
      expect(line.textContent).toContain('已选：');
      expect(line.textContent).toContain('v1');
      expect(screen.getAllByTestId('selected-outside')).toHaveLength(1); // 第 2 页选的是候选，不重复显示
      fireEvent.click(within(line).getByRole('button', { name: '查看原模板' }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('fixtures / qualified-16x9.pptx#/slide[2]')).toBeInTheDocument();
      expect(calls(/\/assets\/n2\?version=1$/).length).toBeGreaterThan(0);
    });

    it('falls back to the asset id when the detail cannot be read', async () => {
      serve({
        pages: [{ no: 1, cands: ['a1'], picked: 'n2' }],
        hook: (u) => (u.pathname.endsWith('/assets/n2') ? err(500, 'INTERNAL') : undefined),
      });
      render(<OfficeCompositionSlot />);
      const line = await screen.findByTestId('selected-outside');
      expect(within(line).getByText('n2')).toBeInTheDocument();
    });
  });

  describe('F2 rejection stays in the drawer', () => {
    it('keeps the drawer, filter page and list; shows the reason on the item, greys it out; another item still works', async () => {
      const posts = serve({
        pages: [{ no: 1, cands: ['a1'] }],
        items: [item('bad'), item('ok')],
        total: 60,
        hook: (u, init) =>
          post(u, init) && JSON.parse(String(init?.body)).asset_id === 'bad'
            ? err(409, 'TEMPLATE_NOT_ELIGIBLE')
            : undefined,
      });
      const { dialog } = await open();
      fireEvent.click(await within(dialog).findByRole('button', { name: '下一页' }));
      await within(dialog).findByText('2 / 2');
      const listCalls = calls(/\/assets\?/).length;
      const bad = (await within(dialog).findByText('资产 bad')).closest('li') as HTMLElement;
      fireEvent.click(within(bad).getByRole('button', { name: '用于第 1 页' }));
      const alert = await within(bad).findByRole('alert');
      expect(alert.textContent).toBe(NOT_ELIGIBLE);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(within(dialog).getByText('2 / 2')).toBeInTheDocument();
      expect(calls(/\/assets\?/)).toHaveLength(listCalls); // 没有重新取列表
      expect(within(bad).getByRole('button', { name: '用于第 1 页' })).toBeDisabled();
      expect(nav.navigate).not.toHaveBeenCalled();
      const ok = (await within(dialog).findByText('资产 ok')).closest('li') as HTMLElement;
      fireEvent.click(within(ok).getByRole('button', { name: '用于第 1 页' }));
      await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('/office/compositions/dec_2', { replace: true }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); // 成功才关
      expect(posts.map((p) => p.body.asset_id)).toEqual(['ok']); // 被拒的那次由 hook 接走，没有进 posts
      expect(calls(/choices$/)).toHaveLength(2);
    });

    it('a rejection is only remembered during one opening', async () => {
      serve({
        pages: [{ no: 1, cands: ['a1'] }],
        items: [item('bad')],
        hook: (u, init) => (post(u, init) ? err(409, 'TEMPLATE_NOT_ELIGIBLE') : undefined),
      });
      const { dialog } = await open();
      fireEvent.click(await within(dialog).findByRole('button', { name: '用于第 1 页' }));
      await within(dialog).findByRole('alert');
      fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      fireEvent.click((await screen.findAllByRole('button', { name: '浏览全部' }))[0] as HTMLElement);
      const again = await screen.findByRole('dialog');
      expect(await within(again).findByRole('button', { name: '用于第 1 页' })).toBeEnabled();
      expect(within(again).queryByRole('alert')).toBeNull();
    });

    it('a network failure shows a generic alert, stays clickable, and the retry reuses the same submission_id', async () => {
      let fail = true;
      const posts = serve({
        pages: [{ no: 1, cands: ['a1'] }],
        items: [item('n1')],
        hook: (u, init) => {
          if (post(u, init) && fail) {
            fail = false;
            throw new TypeError('network down');
          }
        },
      });
      const { dialog } = await open();
      fireEvent.click(await within(dialog).findByRole('button', { name: '用于第 1 页' }));
      const alert = await within(dialog).findByRole('alert');
      expect(alert.textContent).not.toContain('硬约束');
      const again = within(dialog).getByRole('button', { name: '用于第 1 页' });
      expect(again).toBeEnabled();
      fireEvent.click(again);
      await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('/office/compositions/dec_2', { replace: true }));
      expect(posts).toHaveLength(1);
      const ids = fetchMock.mock.calls
        .filter(([u, i]) => /choices/.test(String(u)) && i?.method === 'POST')
        .map(([, i]) => JSON.parse(String(i.body)).submission_id);
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(ids[1]);
    });

    it('a 5xx is a generic failure and the item can be clicked again', async () => {
      serve({
        pages: [{ no: 1, cands: ['a1'] }],
        items: [item('n1')],
        hook: (u, init) => (post(u, init) ? err(500, 'INTERNAL') : undefined),
      });
      const { dialog } = await open();
      fireEvent.click(await within(dialog).findByRole('button', { name: '用于第 1 页' }));
      expect((await within(dialog).findByRole('alert')).textContent).not.toBe(NOT_ELIGIBLE);
      expect(within(dialog).getByRole('button', { name: '用于第 1 页' })).toBeEnabled();
    });

    it('on the candidate card the same 409 still rereads, with the "became ineligible" wording, and the reread result is shown', async () => {
      let rejected = false;
      const s = {
        pages: [{ no: 1, cands: ['a1', 'a2'] }] as { no: number; cands: string[]; picked?: string }[],
        hook: (u: URL, init?: RequestInit) => {
          if (post(u, init)) {
            rejected = true;
            s.pages = [{ no: 1, cands: ['a1', 'a2'], picked: 'a1' }]; // 重读时看到别处已改的结果
            return err(409, 'TEMPLATE_NOT_ELIGIBLE');
          }
        },
      };
      serve(s);
      render(<OfficeCompositionSlot />);
      fireEvent.click((await screen.findAllByRole('button', { name: '选这个结构' }))[1] as HTMLElement);
      expect(await screen.findByText('这个候选在推荐之后变得不合格，已重新读取')).toBeInTheDocument();
      expect(rejected).toBe(true);
      expect(await screen.findByRole('button', { name: '已选中' })).toBeDisabled(); // 显示的是重读结果
    });

    it('keeps the earlier hint when the reread itself fails', async () => {
      serve({
        pages: [{ no: 1, cands: ['a1'] }],
        hook: (u, init) => {
          if (post(u, init)) return err(409, 'TEMPLATE_NOT_ELIGIBLE');
          if (u.pathname.endsWith('/template-decisions/dec_1') && calls(/template-decisions\/dec_1$/).length > 1)
            return err(500, 'INTERNAL');
        },
      });
      render(<OfficeCompositionSlot />);
      fireEvent.click(await screen.findByRole('button', { name: '选这个结构' }));
      expect(await screen.findByText('这个候选在推荐之后变得不合格，已重新读取')).toBeInTheDocument();
      await waitFor(() => expect(calls(/template-decisions\/dec_1$/).length).toBeGreaterThan(1));
      expect(screen.getByText('这个候选在推荐之后变得不合格，已重新读取')).toBeInTheDocument();
    });
  });

  describe('F3 dialog semantics and focus', () => {
    it('puts the title and the close control inside the dialog; Esc and the close button remove it and give the focus back', async () => {
      serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('n1')] });
      const { dialog, trigger } = await open();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute('aria-label', '浏览全部 · 第 1 页');
      const close = within(dialog).getByRole('button', { name: '关闭' });
      expect(close.tagName).toBe('BUTTON');
      fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 27 });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByText(/第 0 页/)).toBeNull(); // 关闭动画期间标题不闪成“第 0 页”
      await waitFor(() => expect(trigger).toHaveFocus());

      trigger.blur();
      fireEvent.click(trigger);
      const second = await screen.findByRole('dialog');
      fireEvent.click(within(second).getByRole('button', { name: '关闭' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it('"view original" from the card also returns the focus to that button', async () => {
      serve({ pages: [{ no: 1, cands: ['a1'] }] });
      render(<OfficeCompositionSlot />);
      const btn = (await screen.findAllByRole('button', { name: '查看原模板' }))[0] as HTMLElement;
      btn.focus();
      fireEvent.click(btn);
      const dialog = await screen.findByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 27 });
      await waitFor(() => expect(btn).toHaveFocus());
    });
  });

  describe('list behaviour', () => {
    it('search: the typed term is sent, clearing it queries again without the term, input is capped at 100', async () => {
      serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('n1')] });
      const { dialog } = await open();
      const box = (await within(dialog)
        .findByRole('searchbox', { name: '按标题搜索' })
        .catch(() => within(dialog).findByPlaceholderText('按标题搜索'))) as HTMLInputElement;
      expect(box.maxLength).toBe(100);
      fireEvent.change(box, { target: { value: '流程' } });
      fireEvent.keyDown(box, { key: 'Enter', keyCode: 13 });
      await waitFor(() => expect(calls(/\/assets\?.*q=%E6%B5%81%E7%A8%8B/)).toHaveLength(1));
      const before = calls(/\/assets\?/).length;
      fireEvent.change(box, { target: { value: '' } });
      await waitFor(() => expect(calls(/\/assets\?/).length).toBe(before + 1));
      expect(String(calls(/\/assets\?/).at(-1)?.[0])).not.toContain('q=');
    });

    it('changing a filter returns to page 1 (Arco Select)', async () => {
      serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('n1')], total: 60 });
      const { dialog } = await open();
      fireEvent.click(await within(dialog).findByRole('button', { name: '下一页' }));
      await within(dialog).findByText('2 / 2');
      const selects = dialog.querySelectorAll('.arco-select-view');
      expect(selects).toHaveLength(3); // 类型、内容关系、审批状态（g1b）
      fireEvent.click(selects[1] as HTMLElement);
      fireEvent.click(await screen.findByText('流程', { selector: '.arco-select-option *, .arco-select-option' }));
      await waitFor(() => {
        const q = new URL(String(calls(/\/assets\?/).at(-1)?.[0]), 'http://x').searchParams;
        expect([q.get('relation'), q.get('page')]).toEqual(['process', '1']);
      });
      await within(dialog).findByText('1 / 2');
    });

    it('a failed list shows the failure and "重试" fetches it again', async () => {
      let n = 0;
      serve({
        pages: [{ no: 1, cands: ['a1'] }],
        items: [item('n1')],
        hook: (u) => (u.pathname === '/bridge/v1/assets' && n++ === 0 ? err(500, 'INTERNAL') : undefined),
      });
      const { dialog } = await open();
      const alert = await within(dialog).findByRole('alert');
      fireEvent.click(within(alert).getByRole('button', { name: '重试' }));
      expect(await within(dialog).findByText('资产 n1')).toBeInTheDocument();
      expect(n).toBe(2);
    });

    it('detail uses the list item version, and an id with "/" or "?" is encoded', async () => {
      serve({ pages: [{ no: 1, cands: ['a1'] }], items: [item('a/b?c', 'page-pattern', 3)] });
      const { dialog } = await open();
      fireEvent.click(await within(dialog).findByRole('button', { name: '查看原模板' }));
      await waitFor(() => expect(calls(/\/assets\/a%2Fb%3Fc\?version=3$/)).toHaveLength(1));
    });
  });

  describe('reads', () => {
    it('a slow older read cannot overwrite the page after the address moved on', async () => {
      let release: (v: unknown) => void = () => undefined;
      const slow = new Promise((r) => (release = r));
      serve({
        pages: [{ no: 1, cands: ['a1'] }],
        hook: (u) => (u.pathname.endsWith('/dec_1') ? slow : undefined),
      });
      const { rerender } = render(<OfficeCompositionSlot />);
      nav.id = 'dec_9';
      rerender(<OfficeCompositionSlot />);
      expect(await screen.findByText('方案第 1 版')).toBeInTheDocument();
      const shown = calls(/dec_9$/).length;
      release(reply(200, decisionOf(7, [{ no: 1, cands: ['a1'] }])));
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByText('方案第 7 版')).toBeNull();
      expect(calls(/dec_9$/)).toHaveLength(shown);
    });

    it('no extra GET when the address switches to the decision the page just created', async () => {
      serve({ pages: [{ no: 1, cands: ['a1', 'a2'] }] });
      nav.navigate.mockImplementation((p: string) => void (nav.id = p.split('/').pop() as string));
      const { rerender } = render(<OfficeCompositionSlot />);
      fireEvent.click((await screen.findAllByRole('button', { name: '选这个结构' }))[1] as HTMLElement);
      await waitFor(() => expect(nav.navigate).toHaveBeenCalled());
      rerender(<OfficeCompositionSlot />);
      expect(await screen.findByText('方案第 2 版')).toBeInTheDocument();
      expect(calls(/template-decisions\/dec_2$/)).toHaveLength(0);
    });
  });

  describe('adopt all first choices', () => {
    it('while it runs the pick buttons are disabled and repeated clicks run a single round', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      const posts = serve({
        pages: [
          { no: 1, cands: ['a1'] },
          { no: 2, cands: ['b1'] },
        ],
        hook: async (u, init) => {
          if (post(u, init)) await gate;
        },
      });
      render(<OfficeCompositionSlot />);
      const all = await screen.findByRole('button', { name: '全部采用首选' });
      fireEvent.click(all);
      fireEvent.click(all);
      await waitFor(() => expect(all).toBeDisabled());
      screen.getAllByRole('button', { name: '选这个结构' }).forEach((b) => expect(b).toBeDisabled());
      release();
      await screen.findByText('方案第 3 版');
      expect(posts.map((p) => p.body.asset_id)).toEqual(['a1', 'b1']);
    });

    it('is not offered when only pages without candidates are pending', async () => {
      serve({
        pages: [
          { no: 1, cands: [] },
          { no: 2, cands: ['b1'], picked: 'b1' },
        ],
      });
      render(<OfficeCompositionSlot />);
      await screen.findByText('意图1');
      expect(screen.queryByRole('button', { name: '全部采用首选' })).toBeNull();
    });

    it('tells how many adopted first choices carry limits and how many pages have no candidate', async () => {
      serve({
        pages: [
          { no: 1, cands: ['a1'], limited: ['a1'] },
          { no: 2, cands: ['b1'] },
          { no: 3, cands: [] },
        ],
      });
      render(<OfficeCompositionSlot />);
      fireEvent.click(await screen.findByRole('button', { name: '全部采用首选' }));
      expect(
        await screen.findByText('已采用 2 页，其中 1 页的首选带限制，请核对；有 1 页没有候选，需手选或重新推荐')
      ).toBeInTheDocument();
    });

    it('says nothing extra when every adopted first choice is clean and no page lacks a candidate', async () => {
      serve({ pages: [{ no: 1, cands: ['a1'] }] });
      render(<OfficeCompositionSlot />);
      fireEvent.click(await screen.findByRole('button', { name: '全部采用首选' }));
      await screen.findByText('方案第 2 版');
      expect(screen.queryByText(/请核对|没有候选，需手选/)).toBeNull();
    });
  });
});
