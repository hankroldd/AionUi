/**
 * [mycowork] PR11 W4-4o。文件：tests/unit/mycowork/globalResourceFixture.ts
 * 职责：虚构Bridge边界响应与请求记录；组件、Arco、查询状态及Scope不替换。
 * 边界：按测试输入返回预定候选，不验证或复刻后端全集收集算法。
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

export const fetchMock = vi.fn();
export const item = (id: string, name: string, over = {}) => ({
  resource_id: id,
  file_name: name,
  source_id: 'src_a',
  origin: 'knowledge_base',
  state: 'ready',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-02T10:00:00Z',
  revision_count: 1,
  ...over,
});
export const FIRST = Array.from({ length: 50 }, (_, n) => item(`res_${n + 1}`, `第一页-${n + 1}.md`));
export const SECOND = Array.from({ length: 50 }, (_, n) => item(`res_${n + 51}`, `第二页-${n + 51}.md`));
export const TAIL = Array.from({ length: 50 }, (_, n) => item(`res_${n + 551}`, `尾页-${n + 551}.md`));
export const FAILED = item('res_failed_51', '首页外失败-51.pdf', { state: 'failed' });
export const OUTPUT = item('res_output_600', '首页外产物-600.pdf', {
  origin: 'outputs',
  source_id: null,
  state: 'stored',
});
export const IMPORT = item('res_import', '导入中的匹配.md', { origin: 'imports', source_id: null, state: 'stored' });
export const SECRET = item('res_secret', '虚构密件.md', { secret: true });
export const TAG = {
  tag_id: 'tag_case',
  name: '风险',
  parent_id: null,
  namespace: 'platform',
  aliases: [],
  revision: 1,
  updated_at: '2026-10-01T00:00:00Z',
};
export const VIEW = {
  view_id: 'view_case',
  name: '风险分组',
  filter: { tag_ids: ['tag_case'], source_ids: ['src_a'] },
  layout: 'list',
  revision: 1,
  missing_tag_ids: [],
};
export const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => structuredClone(body),
});
export const list = (items = FIRST, total = 600, page = 1, extra = {}) =>
  reply(200, { items, total, page, page_size: 50, ...extra });
export type Reply = ReturnType<typeof reply>;
export type Responder = (q: URLSearchParams) => Reply | Promise<Reply>;
export const reads = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).startsWith('/bridge/v1/resources?') && (!init?.method || init.method === 'GET')
  );
export const queries = () => reads().map(([url]) => new URLSearchParams(String(url).split('?')[1]));
export const lastQuery = () => queries().at(-1)!;
export const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
export function fixture(resources: Responder = standard) {
  let view = structuredClone(VIEW);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, 'http://fixture.invalid'),
      path = parsed.pathname;
    if (path === '/bridge/v1/scopes')
      return reply(200, {
        sources: ['a', 'b'].map((id) => ({
          source_id: `src_${id}`,
          name: id === 'a' ? '虚构甲库' : '虚构乙库',
          provider: 'weknora',
          counts: { total: 600, ready: 590, indexing: 4, failed: 3, unavailable: 3 },
        })),
        projects: [],
      });
    if (path === '/bridge/v1/tags') return reply(200, { tags: [TAG] });
    if (path === '/bridge/v1/saved-views')
      return init?.method === 'POST'
        ? reply(201, { ...JSON.parse(String(init.body)), view_id: 'view_new', revision: 1, missing_tag_ids: [] })
        : reply(200, { views: [view] });
    if (path === '/bridge/v1/collections')
      return reply(200, {
        collections: [
          { collection_id: 'col_case', name: '收藏', purpose: 'starred', resource_ids: ['res_1'], revision: 1 },
        ],
      });
    if (path === '/bridge/v1/resources') return resources(parsed.searchParams);
    if (path === '/bridge/v1/saved-views/view_case' && init?.method === 'PATCH') {
      view = { ...view, ...JSON.parse(String(init.body)), revision: view.revision + 1 };
      return reply(200, view);
    }
    throw new Error(`未定义的虚构HTTP请求 ${init?.method ?? 'GET'} ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}
export function standard(q: URLSearchParams): Reply {
  if (q.get('status_group') === 'unavailable') return list([FAILED], 1);
  if (q.get('origin_group') === 'ai_generated') return list([OUTPUT], 1);
  if (q.getAll('file_type').includes('pdf')) return list([FAILED, OUTPUT], 2);
  if (q.get('q'))
    return list(
      [
        item(
          'res_match',
          `${q.get('source_id') ? '库内' : q.get('origin') === 'imports' ? '导入' : '当前位置'}-匹配.md`
        ),
      ],
      1
    );
  if (q.get('origin') === 'imports') return list([IMPORT], 1);
  // A full page is 50 rows; re-rendering it several times per test is what made these files time out on a busy machine.
  // Only the pagination test needs a full first page (it asks for one itself); everything else gets 3 rows of 600.
  if (q.get('page') === '2') return list(SECOND.slice(0, 3), 600, 2);
  if (q.get('page') === '12') return list(TAIL.slice(-3), 600, 12);
  return list(FIRST.slice(0, 3));
}
export function reset() {
  fetchMock.mockReset();
  localStorage.clear();
  window.location.hash = '';
}
export const input = () => screen.getByRole('textbox', { name: '搜索文件名或标签' });
export const nav = (kind: string) => fireEvent.click(screen.getByTestId(`mycowork-nav-${kind}`));
export const selectFile = (name: string) =>
  fireEvent.click(screen.getByRole('checkbox', { name: `选择 ${name}`, exact: true }));
export async function choose(label: string, name: string) {
  fireEvent.click(screen.getByLabelText(label));
  const option = await screen.findByRole('option', { name, exact: true });
  fireEvent.click(within(option).getByText(name));
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Escape', code: 'Escape', keyCode: 27 });
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
