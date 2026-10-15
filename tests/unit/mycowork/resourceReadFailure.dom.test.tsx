/**
 * [mycowork] 文件：tests/unit/mycowork/resourceReadFailure.dom.test.tsx
 * 职责：PR11 T12c3 真实资源页与导入批次详情的折叠诊断、显式重读及专属导航。
 * 边界：仅替换虚构 Bridge HTTP；不替换页面、读取 hook 或选择状态，不执行写请求。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ImportsPage, ResourcesPage } from '@mycowork/ui';
import { armSpaceRestore, resetSpaceSnapshot, saveSpaceSnapshot } from '@mycowork/ui/pages/resources/space-snapshot.ts';
import { batch, reply, row } from './importFlowFixture';

const fetchMock = vi.fn();
const filename = '虚构周报.md';
const resource = {
  resource_id: 'res_fixture',
  file_name: filename,
  source_id: 'src_fixture',
  origin: 'knowledge_base',
  state: 'ready',
  tag_ids: [],
  secret: false,
  updated_at: '2026-10-15T00:00:00Z',
  revision_count: 1,
};
const resourceList = (partial = false) => ({
  items: [resource],
  total: 75,
  page: 2,
  page_size: 50,
  failed_source_ids: partial ? ['src_other'] : [],
});
const batchDetail = () => ({
  ...batch([row({ file_name: filename, resource_id: resource.resource_id })]),
  batch_id: 'imp_fixture',
  secret: false,
});
const failed = (code = 'INTERNAL') =>
  reply(422, {
    error: { code, message: '/private/fixture.key', body: 'fixture_private_body' },
  });
type Page = 'resources' | 'batch';
let read: (url: URL) => ReturnType<typeof reply>;
const reads = (page: Page) =>
  fetchMock.mock.calls.filter(([url]) =>
    page === 'resources'
      ? String(url).startsWith('/bridge/v1/resources?')
      : String(url) === '/bridge/v1/import-batches/imp_fixture'
  );
const open = (page: Page, lang = 'zh-CN') => {
  window.location.hash = page === 'batch' ? '#/office/imports?batch=imp_fixture' : '#/office/space';
  return render(
    page === 'batch' ? <ImportsPage lang={lang} /> : <ResourcesPage lang={lang} ownerKey='fixture-account' />
  );
};

beforeEach(() => {
  resetSpaceSnapshot();
  localStorage.clear();
  fetchMock.mockReset();
  read = () => failed();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    expect(init?.method ?? 'GET').toBe('GET');
    const u = new URL(url, 'http://fixture.invalid');
    if (u.pathname === '/bridge/v1/resources' || u.pathname === '/bridge/v1/import-batches/imp_fixture') return read(u);
    if (u.pathname === '/bridge/v1/scopes')
      return reply(200, {
        sources: ['fixture', 'other'].map((id) => ({
          source_id: `src_${id}`,
          name: `虚构${id}库`,
          provider: 'weknora',
          counts: { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 },
        })),
        projects: [],
      });
    if (u.pathname === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (u.pathname === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (u.pathname === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (u.pathname === '/bridge/v1/import-batches') return reply(200, { items: [], total: 0, page: 1, page_size: 20 });
    throw new Error(`未定义的虚构读取 ${u.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSpaceSnapshot();
});

describe.each(['resources', 'batch'] as const)('真实入口 %s', (page) => {
  it.each(['zh-CN', 'en'])('人话与折叠详情，显式重试恢复实际文件：%s', async (lang) => {
    const en = lang === 'en';
    open(page, lang);
    const details = await screen.findByRole('button', { name: en ? 'Details' : '详情' });
    expect(details.tagName).toBe('BUTTON');
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('INTERNAL', { exact: true })).toBeNull();
    const before = reads(page).length;
    fireEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('INTERNAL', { exact: true })).toBeVisible();
    expect(reads(page)).toHaveLength(before);
    expect(document.body.textContent).not.toContain('/private/fixture.key');
    expect(document.body.textContent).not.toContain('fixture_private_body');
    if (page === 'batch')
      expect(screen.getByRole('link', { name: en ? 'Back to import history' : '回到导入记录' })).toHaveAttribute(
        'href',
        '#/office/imports'
      );
    read = () => reply(200, page === 'resources' ? resourceList() : batchDetail());
    fireEvent.click(screen.getByRole('button', { name: en ? 'Retry' : '重试' }));
    await screen.findByText(filename, { exact: true });
    expect(screen.getByTestId(page === 'resources' ? 'mycowork-resource-item' : 'import-item')).toHaveTextContent(
      filename
    );
    expect(reads(page)).toHaveLength(before + 1);
    expect(screen.queryByTestId('bridge-read-failure')).toBeNull();
  });

  it('下一次失败不继承已展开的诊断', async () => {
    open(page);
    fireEvent.click(await screen.findByRole('button', { name: '详情' }));
    expect(screen.getByText('INTERNAL', { exact: true })).toBeVisible();
    read = () => failed('UNSUPPORTED_FORMAT');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    const details = await screen.findByRole('button', { name: '详情' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('INTERNAL', { exact: true })).toBeNull();
    expect(screen.queryByText('UNSUPPORTED_FORMAT', { exact: true })).toBeNull();
    fireEvent.click(details);
    expect(screen.getByText('UNSUPPORTED_FORMAT', { exact: true })).toBeVisible();
    expect(reads(page)).toHaveLength(2);
  });

  it('重试仍失败且无合法诊断，继续显示错误与重试，不伪装业务成功', async () => {
    open(page);
    await screen.findByRole('button', { name: '详情' });
    read = () => failed('invalid-code /private/fixture.key');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(reads(page)).toHaveLength(2));
    expect(await screen.findByTestId('bridge-read-failure')).toBeVisible();
    expect(screen.queryByRole('button', { name: '详情' })).toBeNull();
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
    expect(screen.queryByTestId(page === 'resources' ? 'mycowork-resource-item' : 'import-item')).toBeNull();
    expect(document.body.textContent).not.toContain('/private/fixture.key');
  });

  it.each([
    [401, { error: { code: 'UNAUTHENTICATED' } }],
    [403, { error: { code: 'FORBIDDEN' } }],
    [403, {}],
  ])('%i不提供无效重试，批次仍可返回记录', async (status, body) => {
    read = () => reply(status as number, body);
    open(page);
    const failure = await screen.findByTestId('bridge-read-failure');
    expect(within(failure).queryByRole('button', { name: '重试' })).toBeNull();
    expect(failure).toHaveTextContent(status === 401 ? '登录已过期' : '你没有权限');
    if (page === 'batch') {
      const back = screen.getByRole('link', { name: '回到导入记录' });
      expect(back).toHaveAttribute('href', '#/office/imports');
      fireEvent.click(screen.getByRole('button', { name: '回到导入记录' }));
      expect(await screen.findByText('还没有导入记录')).toBeVisible();
    }
    expect(reads(page)).toHaveLength(1);
  });
});

it('资源source+NOT_FOUND仍用专属权限说明和回到最近', async () => {
  read = (url) =>
    url.searchParams.has('source_id') ? reply(404, { error: { code: 'NOT_FOUND' } }) : reply(200, resourceList());
  open('resources');
  await screen.findByTestId('mycowork-resource-item');
  fireEvent.click(screen.getByTestId('mycowork-nav-source-src_fixture'));
  expect(await screen.findByText('没有这个来源的权限')).toBeVisible();
  expect(screen.getByText('来源授权已撤销或不存在；需要时请管理员重新授权。')).toBeVisible();
  expect(screen.queryByTestId('bridge-read-failure')).toBeNull();
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '回到最近' }));
  expect(await screen.findByTestId('mycowork-resource-item')).toHaveTextContent(filename);
});

it('资源通用裸404保持不可见说明且不重试', async () => {
  read = () => reply(404, {});
  open('resources');
  const failure = await screen.findByTestId('bridge-read-failure');
  expect(failure).toHaveTextContent('资料已不可用，或你没有权限查看。');
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  expect(reads('resources')).toHaveLength(1);
});

it.each([{ error: { code: 'NOT_FOUND' } }, {}])('批次404保持原标题、提示与返回记录：%j', async (body) => {
  read = () => reply(404, body);
  open('batch');
  expect(await screen.findByText('没有找到这批导入，或它不属于当前账号')).toBeVisible();
  expect(screen.getByText('链接可能已过期，回到导入记录可以找到你自己导入的批次。')).toBeVisible();
  expect(screen.getByRole('link', { name: '回到导入记录' })).toHaveAttribute('href', '#/office/imports');
  expect(screen.queryByTestId('bridge-read-failure')).toBeNull();
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '回到导入记录' }));
  expect(await screen.findByText('还没有导入记录')).toBeVisible();
});

it('同查询重读失败再恢复，保留搜索/筛选/页码与明确选择ID，错误时不展示旧行', async () => {
  saveSpaceSnapshot({
    ownerKey: 'fixture-account',
    place: { kind: 'source', sourceId: 'src_fixture' },
    input: '周报',
    page: 2,
    filters: { tagIds: [], types: ['md'], origin: 'kb_native', state: 'citable', sort: 'name' },
    previewId: undefined,
    scrollTop: 0,
    at: Date.now(),
    forIds: ['res_fixture'],
  });
  armSpaceRestore('res_fixture');
  read = () => reply(200, resourceList(true));
  open('resources');
  fireEvent.click(await screen.findByRole('checkbox', { name: `选择 ${filename}`, exact: true }));
  expect(screen.getByRole('checkbox', { name: `选择 ${filename}`, exact: true })).toBeChecked();
  const originalUrl = reads('resources')[0]?.[0];
  const q = new URL(String(originalUrl), 'http://fixture.invalid').searchParams;
  expect(Object.fromEntries(q)).toMatchObject({
    source_id: 'src_fixture',
    q: '周报',
    page: '2',
    file_type: 'md',
    origin_group: 'kb_native',
    status_group: 'citable',
    sort: 'name',
  });
  read = () => failed();
  fireEvent.click(
    within(screen.getByText(/以下知识库暂时读不到/).closest('.arco-alert') as HTMLElement).getByRole('button', {
      name: '重试',
    })
  );
  await screen.findByTestId('bridge-read-failure');
  expect(screen.queryByTestId('mycowork-resource-item')).toBeNull();
  expect(screen.getByRole('textbox', { name: '搜索文件名或标签' })).toHaveValue('周报');
  read = () => reply(200, resourceList());
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('checkbox', { name: `选择 ${filename}`, exact: true })).toBeChecked();
  expect(screen.getByTestId('mycowork-resource-item')).toHaveTextContent(filename);
  expect(reads('resources').map(([url]) => url)).toEqual([originalUrl, originalUrl, originalUrl]);
  expect(screen.getByRole('textbox', { name: '搜索文件名或标签' })).toHaveValue('周报');
  expect(screen.queryByTestId('bridge-read-failure')).toBeNull();
});
