/**
 * [mycowork] 版本页正确性 C08 / A281：回到来处。空间页离开时记下入口、搜索词、筛选、页码、打开的预览与滚动位置；版本页“返回”与编辑页
 * “保存并返回”回空间前武装一次，空间页挂载时恢复；没武装（侧栏点“空间”）、换账号、退出登录后都是默认入口；预览的资源不在列表里只恢复入口与筛选。
 */
import React from 'react';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage, resetAccountScopedState } from '@mycowork/ui';
import { VersionsPage } from '@mycowork/ui/pages/versions/index.ts';
import { goEditReturn } from '@mycowork/ui/pages/office-editor/edit-return.ts';
import { installBridge } from './versionsFixture';

configure({ asyncUtilTimeout: 4000 });
const response = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
  text: async () => '',
});
const mk = (i: number, file_name: string) => ({
  resource_id: `res_${i}`,
  file_name,
  source_id: null,
  origin: 'imports',
  state: 'stored',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  revision_count: 2,
  updated_at: '2026-10-04T00:00:00Z',
});
let all: ReturnType<typeof mk>[];
const lists: string[] = [];
function spaceBridge() {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/bridge/v1/scopes') return response(200, { sources: [], projects: [] });
    if (url === '/bridge/v1/tags') return response(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return response(200, { views: [] });
    if (url === '/bridge/v1/collections') return response(200, { collections: [] });
    if (url.startsWith('/bridge/v1/resources?')) {
      lists.push(url);
      const q = new URLSearchParams(url.split('?')[1]).get('q') ?? '';
      const items = all.filter((r) => r.file_name.includes(q));
      return response(200, { items, page: 1, page_size: 50, total: items.length });
    }
    if (/\/res_\d+\/(office\/html|preview)$/.test(url))
      return { ...response(200, null), text: async () => '<html><body>虚构</body></html>' };
    return response(404, { error: { code: 'NOT_FOUND' } });
  });
}
const space = (ownerKey = 'fixture_a') => render(<ResourcesPage lang='zh-CN' ownerKey={ownerKey} />);
const search = () => screen.getByRole('textbox', { name: '搜索文件名或标签' });
const scroller = () => document.querySelector<HTMLElement>('.mcw-rc-main')!;

/** 在空间里搜“备忘”、打开 res_1 的预览、滚到 120；然后离开空间并在版本页点“返回”。 */
async function leaveSpaceAndGoBackFromVersions() {
  const first = space();
  fireEvent.change(search(), { target: { value: '备忘' } });
  fireEvent.click(await screen.findByRole('button', { name: '虚构备忘.txt' }));
  await screen.findByRole('dialog', { name: '当前内容预览' });
  scroller().scrollTop = 120;
  fireEvent.scroll(scroller());
  first.unmount();
  installBridge({ total: 2 });
  const versions = render(<VersionsPage resourceId='res_1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
  fireEvent.click(await screen.findByRole('button', { name: '返回空间' }));
  versions.unmount();
  spaceBridge();
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/office/resources/res_1/versions';
  all = [mk(0, '虚构汇报.pptx'), mk(1, '虚构备忘.txt')];
  lists.length = 0;
  resetAccountScopedState();
  spaceBridge();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('从版本页返回空间', () => {
  it('恢复搜索词、打开的预览和滚动位置', async () => {
    await leaveSpaceAndGoBackFromVersions();
    expect(window.location.hash).toBe('#/office/space');
    space();
    await waitFor(() => expect(search()).toHaveValue('备忘'));
    await screen.findByRole('dialog', { name: '当前内容预览' });
    await waitFor(() => expect(scroller().scrollTop).toBe(120));
    expect(lists.every((u) => u.includes('q=%E5%A4%87%E5%BF%98'))).toBe(true); // 第一次读列表就用恢复的搜索词，不先读一遍默认
  });

  it('没经“返回”（侧栏点空间等）不恢复：仍是默认入口', async () => {
    const first = space();
    fireEvent.change(search(), { target: { value: '备忘' } });
    await screen.findByRole('button', { name: '虚构备忘.txt' });
    first.unmount();
    space();
    await screen.findByRole('button', { name: '虚构汇报.pptx' });
    expect(search()).toHaveValue('');
  });

  it('预览的资源已不在列表里：只恢复入口与筛选，不开预览', async () => {
    await leaveSpaceAndGoBackFromVersions();
    all = [mk(0, '虚构备忘汇报.pptx')]; // 打开过预览的 res_1 已不在列表里
    space();
    await waitFor(() => expect(search()).toHaveValue('备忘'));
    await screen.findByRole('button', { name: '虚构备忘汇报.pptx' });
    expect(screen.queryByRole('dialog', { name: '当前内容预览' })).toBeNull();
  });

  it('换了账号不恢复上一个账号的快照', async () => {
    await leaveSpaceAndGoBackFromVersions();
    space('fixture_b');
    await screen.findByRole('button', { name: '虚构汇报.pptx' });
    expect(search()).toHaveValue('');
  });

  it('退出登录清掉快照', async () => {
    await leaveSpaceAndGoBackFromVersions();
    resetAccountScopedState();
    space();
    await screen.findByRole('button', { name: '虚构汇报.pptx' });
    expect(search()).toHaveValue('');
  });

  it('恢复是一次性的：恢复过后再进空间是默认入口', async () => {
    await leaveSpaceAndGoBackFromVersions();
    const again = space();
    await waitFor(() => expect(search()).toHaveValue('备忘'));
    fireEvent.click(await screen.findByRole('button', { name: '关闭预览' }));
    again.unmount();
    space();
    await screen.findByRole('button', { name: '虚构汇报.pptx' });
    expect(search()).toHaveValue('');
  });
});

describe('编辑页“保存并返回”回空间', () => {
  it('同样恢复来时的搜索词（goEditReturn 武装一次）', async () => {
    const first = space();
    fireEvent.change(search(), { target: { value: '备忘' } });
    await screen.findByRole('button', { name: '虚构备忘.txt' });
    first.unmount();
    goEditReturn({ kind: 'space' });
    expect(window.location.hash).toBe('#/office/space');
    space();
    await waitFor(() => expect(search()).toHaveValue('备忘'));
  });
});
