/**
 * [mycowork] PR11 W4-9。文件：tests/unit/mycowork/importFlowFixture.ts
 * 职责：导入页（ImportsPage）DOM 用例共用的虚构 Bridge 边界：按文件名返回上传结果、记录批次请求、按需返回批次与同名候选。
 * 边界：只替换 fetch；ImportsPage、UploadFlow、Arco 全是真实的。
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';

export const fetchMock = vi.fn();
export const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
export const steps = (parse: string, index = parse) => ({ received: 'done', stored: 'done', parse, index });
export const row = (over: object) => ({
  seq: 0,
  upload_id: 'up_1',
  file_name: '周报.md',
  purpose: 'working',
  status: 'ready',
  resource_id: 'res_n',
  source_id: null,
  duplicate_of: null,
  steps: steps('skipped'),
  error: null,
  ...over,
});
export const batch = (items: object[], archives: object[] = [], revision = 1) => ({
  batch_id: 'bat_1',
  submission_id: 's',
  revision,
  tag_ids: [],
  items,
  archives,
  created_at: 't',
  updated_at: 't',
});
export const posts = (suffix: string) =>
  fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).endsWith(suffix));
export const bodyOf = (n = 0) => JSON.parse(String(posts('/import-batches')[n]?.[1]?.body));

export type Opts = {
  /** 文件名 → 上传结果的覆盖（默认 up_<序号>、无同内容） */
  upload?: (name: string, n: number) => object;
  created?: object;
  /** GET /resources?... 的回应（同名候选）；默认空 */
  resources?: (q: URLSearchParams) => object;
  /** GET /resources/{id}/revisions 的 total */
  revisionTotal?: number;
};
export function bridge(opts: Opts = {}) {
  let n = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'http://fixture.invalid');
    if (u.pathname === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (u.pathname === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (u.pathname === '/bridge/v1/uploads') {
      const name = decodeURIComponent(String((init?.headers as Record<string, string>)['x-file-name']));
      n += 1;
      return reply(201, { upload_id: `up_${n}`, file_name: name, size: 5, sha256: 'x', duplicate_of: [], ...opts.upload?.(name, n) });
    }
    if (u.pathname === '/bridge/v1/import-batches' && init?.method === 'POST') return reply(201, opts.created ?? batch([row({})]));
    if (u.pathname === '/bridge/v1/import-batches/bat_1') return reply(200, opts.created ?? batch([row({})]));
    if (u.pathname === '/bridge/v1/resources')
      return reply(200, opts.resources?.(u.searchParams) ?? { page: 1, page_size: 50, total: 0, items: [] });
    if (u.pathname.endsWith('/revisions'))
      return reply(200, { resource_id: 'x', current_revision_id: 'r', file_name: null, items: [], page: 1, page_size: 50, total: opts.revisionTotal ?? 2 });
    throw new Error(`未定义的虚构HTTP请求 ${init?.method ?? 'GET'} ${u.pathname}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}
/** 选 / 拖入若干文件（Arco Upload 的 file input）。 */
export async function addFiles(container: HTMLElement, ...files: File[]) {
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  await act(async () => fireEvent.change(input, { target: { files } }));
}
export const md = (name: string, text = 'hello') => new File([text], name, { type: 'text/markdown' });
export const zip = (name: string, modified = 1, body = 'PK') =>
  new File([body], name, { type: 'application/zip', lastModified: modified });
export const confirmButton = (lang = 'zh-CN') => screen.getByRole('button', { name: lang === 'en' ? 'Confirm import' : '确认导入' });
