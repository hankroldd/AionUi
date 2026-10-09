/**
 * [mycowork] PR11 体验片 B 审查修正（发布）：弹窗已卸载时服务端要求确认 → 进度提示换成不自动消失的“需要你确认”，不是悄悄消失；
 * 结果未知后文件出了新版本，再点发布得到的是新版本的新弹窗（新 submission_id），不是复用冻结在旧版本上的草稿；成功提示带版本号。
 */
import React from 'react';
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import type { Publication, PublicationRequest } from '@mycowork/contracts';
import { PublicationDialog, VersionsPage } from '@mycowork/ui/pages/versions/index.ts';

configure({ asyncUtilTimeout: 4000 });
const sources = [
  { source_id: 'kb-1', name: '虚构知识库', counts: { total: 0, ready: 0, indexing: 0, failed: 0, unavailable: 0 } },
];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rev = (id: string, current: boolean) => ({
  revision_id: id,
  origin: 'output',
  current,
  created_at: '2026-10-09T08:00:00Z',
  restored_from: null,
});
let head: 'rev-2' | 'rev-3';
const timeline = () =>
  head === 'rev-2'
    ? { current_revision_id: 'rev-2', total: 2, page: 1, page_size: 50, file_name: '虚构成果.txt', items: [rev('rev-2', true), rev('rev-1', false)] }
    : { current_revision_id: 'rev-3', total: 3, page: 1, page_size: 50, file_name: '虚构成果.txt', items: [rev('rev-3', true), rev('rev-2', false), rev('rev-1', false)] };
const pub = (r: PublicationRequest): Publication => ({
  publication_id: 'pub-1',
  resource_id: r.resource_id,
  revision_id: r.revision_id,
  target: r.target,
  status: 'queued',
  error: null,
  accepted_at: '2026-10-09T09:00:00Z',
  published_at: null,
  created_at: '2026-10-09T09:00:00Z',
});
let requests: PublicationRequest[];
let reply: (r: PublicationRequest, i: number) => Response | Promise<Response>;
beforeEach(() => {
  requests = [];
  head = 'rev-2';
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/bridge/v1/publications' && init?.method === 'POST') {
      const r = JSON.parse(String(init.body)) as PublicationRequest;
      requests.push(r);
      return reply(r, requests.length - 1);
    }
    if (url.endsWith('/revisions')) return json(timeline());
    if (url.includes('/publications?')) return json({ items: [], total: 0, page: 1, page_size: 50 });
    if (url.endsWith('/scopes')) return json({ sources, projects: [] });
    if (url.endsWith('/metadata')) return json({ secret: false });
    if (url.endsWith('/edit-sessions')) return json({ items: [] });
    if (url.endsWith('/preview')) return new Response('虚构正文');
    if (url.includes('/changes?')) return json({ error: { code: 'UPSTREAM_UNAVAILABLE' } }, 503);
    throw new Error(`未安排的请求 ${url}`);
  });
});
afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});
async function choosePublish() {
  await waitFor(() => expect(screen.getAllByLabelText('选择知识库')).toHaveLength(1)); // 旧弹窗的关闭动画结束后只剩一个
  fireEvent.click(screen.getByLabelText('选择知识库'));
  fireEvent.click(await screen.findByText('虚构知识库', { selector: '.arco-select-option' }));
  fireEvent.click(screen.getByRole('button', { name: '发布', exact: true }));
}

it('弹窗已卸载后收到“需要确认”：进度提示换成不自动消失的说明，不是悄悄消失', async () => {
  let release!: (r: Response) => void;
  reply = () => new Promise<Response>((r) => (release = r));
  const view = render(
    <PublicationDialog
      resourceId='resource-1'
      revisionId='rev-1'
      headRevisionId='rev-1'
      versionLabel='v1'
      initialFileName='虚构成果.txt'
      sources={sources}
      secret={false}
      lang='zh-CN'
      onAccepted={() => {}}
      onCancel={() => {}}
    />,
  );
  await choosePublish();
  await screen.findByText('正在发布到「虚构知识库」…');
  view.unmount();
  await act(async () => release(json({ error: { code: 'DIFF_OUT_OF_SCOPE' } }, 409)));
  expect(await screen.findByText(/需要你确认后才能进行，还没有发出/)).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('正在发布到「虚构知识库」…')).toBeNull());
  expect(screen.queryByRole('button', { name: '重试（不会重复发布）' })).toBeNull();
});

it('v2 结果未知 → 文件出了 v3 → 再点发布：发出的是 v3 和新的 submission_id；成功提示带版本号', async () => {
  reply = (r, i) => {
    if (i === 0) throw new Error('断网');
    return json(pub(r), 201);
  };
  render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
  fireEvent.click(await screen.findByRole('button', { name: '发布到知识库' }));
  await choosePublish();
  await screen.findByText(/未收到发布结果/);
  head = 'rev-3';
  fireEvent.click(await screen.findByRole('button', { name: '发布到知识库' }));
  await choosePublish();
  expect(await screen.findByText(/已提交发布 v3 到「虚构知识库」/)).toBeInTheDocument();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toMatchObject({ revision_id: 'rev-2' });
  expect(requests[1]).toMatchObject({ revision_id: 'rev-3', expected_head_revision_id: 'rev-3' });
  expect(requests[1]?.submission_id).not.toBe(requests[0]?.submission_id);
});
