/**
 * 文件：officeSelection.fixture.tsx
 * 职责：对象选择DOM用例的虚构HTTP边界与真实组件挂载。
 * 边界：不替换业务控制器；iframe脚本另用真实浏览器执行。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { PreviewBody, versionsText } from '@mycowork/ui';
import type { OfficeNode, OfficeSelection } from '@mycowork/contracts';
export const SHA = 'a'.repeat(64),
  NEW_SHA = 'b'.repeat(64);
export const CLIENT = 'officecli-html@1.0.152';
export const BODY = '<html><body><p data-path="/body/p[1]">正文（虚构）</p></body></html>';
export const fetchMock = vi.fn(),
  changed = vi.fn(),
  ask = vi.fn();
export const response = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
export const html = (sha = SHA) => ({
  ...response(200, null),
  text: async () => BODY,
  headers: new Headers({
    'x-mycowork-content-sha256': sha,
    'x-mycowork-preview-client': CLIENT,
  }),
});
export const selected = (locator = '/body/p[1]', editability: OfficeSelection['editability'] = 'native') => ({
  selection_id: 'sel_fixture',
  resource_id: 'res_fixture',
  content_sha256: SHA,
  locator,
  locator_kind: 'ordinal',
  node_type: 'paragraph',
  fingerprint: 'c'.repeat(64),
  child_count: 1,
  preview_client: CLIENT,
  editability,
  frozen_at: '2026-10-12T06:00:00Z',
});
const node = (path: string, type: OfficeNode['type'], children: OfficeNode[] = [], text?: string) => ({
  path,
  type,
  ...(text === undefined ? {} : { text }),
  child_count: children.length,
  fingerprint: 'd'.repeat(64),
  children,
});
export const structure = (path: string, sha = SHA, tool = '1.0.152') => ({
  resource_id: 'res_fixture',
  content_sha256: sha,
  format: 'docx',
  tool_version: tool,
  truncated: false,
  root:
    path === '/'
      ? node('/', 'document', [node('/body', 'body', [node('/body/p[1]', 'paragraph')])])
      : path === '/body'
        ? node('/body', 'body', [node('/body/p[1]', 'paragraph', [node('/body/p[1]/r[1]', 'run')])])
        : node('/body/p[@paraId=00100000]', 'paragraph', [
            node('/body/p[@paraId=00100000]/r[1]', 'run', [], '子内容（虚构）'),
          ]),
});
export function pending<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export function fixture() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/office/html')) return html();
    if (url === '/bridge/v1/office/selections') return response(201, selected(JSON.parse(String(init?.body)).locator));
    if (url.endsWith('/check'))
      return response(200, { selection_id: 'sel_fixture', status: 'ok', current_content_sha256: SHA });
    if (url.endsWith('/metadata')) return response(200, { secret: false });
    if (url.includes('/office/structure?'))
      return response(200, structure(new URL(url, 'http://fixture').searchParams.get('path') ?? '/'));
    return response(404, { error: { code: 'NOT_FOUND' } });
  });
}
export function props(ownerKey = 'u1') {
  return {
    text: versionsText('zh'),
    resourceId: 'res_fixture',
    fileName: '备忘（虚构）.docx',
    selection: { ownerKey, onChange: changed, onAsk: ask },
  };
}
export async function opened(options = props()) {
  const view = render(<PreviewBody {...options} />);
  const frame = (await screen.findByTitle('备忘（虚构）.docx 的只读预览')) as HTMLIFrameElement;
  await act(async () => {});
  return { ...view, frame };
}
export function generation(frame: HTMLIFrameElement) {
  const match = /const generation = ("[^"]+");/.exec(frame.srcdoc);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]);
}
export function pick(frame: HTMLIFrameElement, locator: string | null, nonce = generation(frame)) {
  fireEvent(
    window,
    new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'null',
      data: { type: 'mycowork.office.selection', generation: nonce, locator },
    })
  );
}
export const writes = () => fetchMock.mock.calls.filter(([url]) => url === '/bridge/v1/office/selections');
export const previews = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/office/html'));
beforeEach(() => {
  fetchMock.mockReset();
  changed.mockReset();
  ask.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', fetchMock);
  fixture();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
