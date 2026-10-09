/**
 * [mycowork] PR11 W4-4o。文件：tests/unit/mycowork/publicationFlow.dom.test.tsx
 * 职责：发布弹窗（空间与版本页共用）：受理后才通知父页关闭、点发布后弹窗收起并由轻提示说进度与失败、409 两次确认沿用同一 submission_id、重试按原 publication_id。
 * 边界：只替换 Bridge HTTP；React 状态与 Arco 控件为真实实现。
 */
import React, { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import type { Publication, PublicationRequest } from '@mycowork/contracts';
import { PublicationDialog, VersionsPage, retryPublication } from '@mycowork/ui/pages/versions/index.ts';

const sources = [
  { source_id: 'kb-1', name: '虚构知识库', counts: { total: 0, ready: 0, indexing: 0, failed: 0, unavailable: 0 } },
];
const defaults = {
  resourceId: 'resource-1',
  revisionId: 'rev-1',
  headRevisionId: 'rev-1',
  versionLabel: 'v1',
  initialFileName: '虚构成果.txt',
  sources,
  secret: false,
  lang: 'zh-CN',
};
const accepted = vi.fn();
const cancelled = vi.fn();
let requests: PublicationRequest[];
let paths: string[];
let timeline = {
  current_revision_id: 'rev-2',
  total: 2,
  page: 1,
  page_size: 50,
  file_name: '虚构成果.txt',
  items: [
    { revision_id: 'rev-2', origin: 'output', current: true, created_at: '2026-10-03T08:00:00Z', restored_from: null },
    {
      revision_id: 'rev-1',
      origin: 'original',
      current: false,
      created_at: '2026-10-03T07:00:00Z',
      restored_from: null,
    },
  ],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const error = (code: string, status = 409) => json({ error: { code } }, status);
const publication = (request: PublicationRequest): Publication => ({
  publication_id: 'pub-1',
  resource_id: request.resource_id,
  revision_id: request.revision_id,
  target: request.target,
  status: request.target.kind === 'archive' ? 'published' : 'queued',
  error: null,
  accepted_at: '2026-10-03T09:00:00Z',
  published_at: null,
  created_at: '2026-10-03T09:00:00Z',
});
function serve(
  reply: (request: PublicationRequest, index: number) => Response | Promise<Response>,
  pubs: Publication[] = []
) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    paths.push(String(url));
    if (url === '/bridge/v1/publications' && init?.method === 'POST') {
      const request = JSON.parse(String(init.body)) as PublicationRequest;
      requests.push(request);
      return reply(request, requests.length - 1);
    }
    if (url.endsWith('/revisions')) return json(timeline);
    if (url.includes('/publications?')) return json({ items: pubs, total: pubs.length, page: 1, page_size: 50 });
    if (url.includes('/publications/') && url.endsWith('/retry')) return json({});
    if (url.endsWith('/scopes')) return json({ sources, projects: [] });
    if (url.endsWith('/metadata')) return json({ secret: false });
    if (url.endsWith('/edit-sessions')) return json({ items: [] });
    if (url.endsWith('/preview')) return new Response('虚构正文');
    if (url.includes('/changes?')) return error('UPSTREAM_UNAVAILABLE', 503);
    throw new Error(`未安排的请求 ${url}`);
  });
}
function Harness({ overrides = {} }: { overrides?: Partial<ComponentProps<typeof PublicationDialog>> }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <PublicationDialog
      {...defaults}
      {...overrides}
      onAccepted={(p) => {
        accepted(p);
        setOpen(false);
      }}
      onCancel={() => {
        cancelled();
        setOpen(false);
      }}
    />
  ) : (
    <p>已关闭</p>
  );
}
async function chooseTarget() {
  fireEvent.click(screen.getByLabelText('选择知识库'));
  fireEvent.click(await screen.findByText('虚构知识库', { selector: '.arco-select-option' }));
  expect(screen.getByRole('button', { name: '发布', exact: true })).toBeEnabled();
}
async function publish() {
  await chooseTarget();
  fireEvent.click(screen.getByRole('button', { name: '发布', exact: true }));
}

beforeEach(() => {
  requests = [];
  paths = [];
  accepted.mockClear();
  cancelled.mockClear();
});
afterEach(() => {
  cleanup();
  Message.clear(); // 发布提示是全局的，不清掉会被后一个用例当成自己的
  vi.unstubAllGlobals();
});

describe('真实 React/Arco 共用发布弹窗', () => {
  it('成功受理后才关闭，queued 文案不冒充完成', async () => {
    serve((r) => json(publication(r), 201));
    render(<Harness />);
    await publish();
    await screen.findByText('已关闭');
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(accepted.mock.calls[0]?.[0].status).toBe('queued');
    expect(requests[0]).toMatchObject({
      revision_id: 'rev-1',
      expected_head_revision_id: 'rev-1',
      target: { source_id: 'kb-1', file_name: '虚构成果.txt' },
    });
  });

  it('同步 404：失败留在轻提示里，重试沿用同一身份', async () => {
    serve((r, i) => (i === 0 ? error('NOT_FOUND', 404) : json(publication(r), 201)));
    render(<Harness />);
    await publish();
    await screen.findByText('找不到这个资源或版本，或你没有权限查看。');
    expect(accepted).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '重试（不会重复发布）' }));
    await screen.findByText('已关闭');
    expect(requests[1]).toEqual(requests[0]);
  });

  it('点发布后弹窗收起，请求挂着时再点（含入口重复点击）也只发一个请求', async () => {
    let resolve!: (response: Response) => void;
    serve(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        })
    );
    render(<Harness />);
    await publish();
    await waitFor(() => expect(document.querySelector('.arco-modal')).toBeNull());
    expect(requests).toHaveLength(1);
    expect(cancelled).not.toHaveBeenCalled();
    await act(async () => resolve(json(publication(requests[0]!), 201)));
    await screen.findByText('已关闭');
    expect(requests).toHaveLength(1);
  });

  it('scope→hidden 两次确认保留 revision、head、目标和 submission_id', async () => {
    serve((r, i) =>
      i === 0 ? error('DIFF_OUT_OF_SCOPE') : i === 1 ? error('HIDDEN_CONTENT_PRESENT') : json(publication(r), 201)
    );
    render(<Harness />);
    await publish();
    await screen.findByText(/这个版本是 AI 修改的结果/);
    expect(screen.getByLabelText('库里的文件名')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '仍要发布' }));
    await screen.findByText(/这个版本含演讲者备注或批注/);
    fireEvent.click(screen.getByRole('button', { name: '仍要发布' }));
    await screen.findByText('已关闭');
    expect(new Set(requests.map((r) => r.submission_id)).size).toBe(1);
    expect(requests[1]).toMatchObject({ confirm_out_of_scope: true });
    expect(requests[2]).toMatchObject({ confirm_out_of_scope: true, confirm_hidden_content: true });
    requests.forEach((r) =>
      expect(r).toMatchObject({ revision_id: 'rev-1', expected_head_revision_id: 'rev-1', target: requests[0]?.target })
    );
  });

  it('确认后的 503 留在轻提示里，重试仍调用检查且不关闭', async () => {
    serve((_r, i) => (i === 0 ? error('HIDDEN_CONTENT_PRESENT') : error('UPSTREAM_UNAVAILABLE', 503)));
    render(<Harness />);
    await publish();
    fireEvent.click(await screen.findByRole('button', { name: '仍要发布' }));
    await screen.findByText(/确认也不能跳过检查/);
    expect(accepted).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: '重试（不会重复发布）' }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2]).toEqual(requests[1]);
    expect(requests[2]?.confirm_hidden_content).toBe(true);
    expect(accepted).not.toHaveBeenCalled();
  });

  it('409 重读之后保持旧认可版本，只有再次确认才更新 head 与身份', async () => {
    const reloaded = vi.fn();
    serve((r, i) => (i === 0 ? error('REVISION_CONFLICT') : json(publication(r), 201)));
    render(<Harness overrides={{ onReload: reloaded }} />);
    await publish();
    await screen.findByText(/仍可发布你选的这一版/);
    expect(reloaded).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(screen.getByText(/将发布 v1/)).toBeVisible();
    expect(screen.getByLabelText('库里的文件名')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '仍发布所选版本' }));
    await screen.findByText('已关闭');
    expect(requests[1]).toMatchObject({
      revision_id: 'rev-1',
      expected_head_revision_id: 'rev-2',
      target: requests[0]?.target,
    });
    expect(requests[1]?.submission_id).not.toBe(requests[0]?.submission_id);
  });

  it('网络丢失后保留请求身份，父组件更新 props 不替换可见认可版本', async () => {
    serve((r, i) => {
      if (i === 0) throw new Error('断网');
      return json(publication(r), 201);
    });
    const mounted = render(<Harness />);
    await publish();
    await screen.findByText(/未收到发布结果/);
    mounted.rerender(<Harness overrides={{ revisionId: 'rev-2', headRevisionId: 'rev-2', versionLabel: 'v2' }} />);
    fireEvent.click(await screen.findByRole('button', { name: '重试（不会重复发布）' }));
    await screen.findByText('已关闭');
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1]?.revision_id).toBe('rev-1');
  });

  it('Secret、无授权知识库与空文件名无发布请求', async () => {
    serve((r) => json(publication(r), 201));
    const mounted = render(<Harness overrides={{ secret: true }} />);
    expect(screen.getByRole('button', { name: '发布', exact: true })).toBeDisabled();
    expect(screen.getByText(/这个资源已标为 Secret/)).toBeVisible();
    mounted.unmount();
    const empty = render(<Harness overrides={{ sources: [] }} />);
    expect(screen.getByText(/没有可发布的知识库/)).toBeVisible();
    expect(screen.getByRole('button', { name: '发布', exact: true })).toBeDisabled();
    empty.unmount();
    render(<Harness overrides={{ initialFileName: '' }} />);
    fireEvent.click(screen.getByLabelText('选择知识库'));
    fireEvent.click(await screen.findByText('虚构知识库', { selector: '.arco-select-option' }));
    expect(screen.getByRole('button', { name: '发布', exact: true })).toBeDisabled();
    expect(requests).toHaveLength(0);
  });

  it('版本页旧版本接受归档仍先确认，scope 确认沿用相同请求身份', async () => {
    serve((r, i) => (i === 0 ? error('DIFF_OUT_OF_SCOPE') : json(publication(r), 201)));
    render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
    fireEvent.click(await screen.findByRole('button', { name: '更多操作 v1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '接受并归档' }));
    await screen.findByText(/接受 v1 并归档？/);
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '接受并归档' }));
    await screen.findByText(/这个版本是 AI 修改的结果/);
    fireEvent.click(screen.getByRole('button', { name: '仍要发布' }));
    await waitFor(() => expect(document.querySelector('.arco-modal')).toBeNull());
    expect(requests[0]).toMatchObject({
      revision_id: 'rev-1',
      expected_head_revision_id: 'rev-2',
      target: { kind: 'archive' },
    });
    expect(requests[1]?.submission_id).toBe(requests[0]?.submission_id);
    expect(requests[1]?.confirm_out_of_scope).toBe(true);
    expect(requests[1]?.confirm_hidden_content).toBeUndefined();
  });

  it('版本页失败发布按原 publication_id 重试，不创建新发布', async () => {
    const failed = {
      ...publication({
        submission_id: 'test',
        resource_id: 'resource-1',
        revision_id: 'rev-1',
        expected_head_revision_id: 'rev-2',
        target: { kind: 'knowledge_base', source_id: 'kb-1', file_name: '虚构成果.txt' },
      }),
      publication_id: 'pub-original',
      status: 'failed',
      error: 'upstream_failed',
    } as Publication;
    serve((r) => json(publication(r), 201), [failed]);
    render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
    const history = await screen.findByTestId('version-timeline');
    fireEvent.click(await within(history).findByRole('button', { name: '重试', exact: true }));
    await waitFor(() => expect(paths).toContain('/bridge/v1/publications/pub-original/retry'));
    expect(requests).toHaveLength(0);
    expect(screen.getByText('发布到「虚构知识库」 · 失败')).toBeVisible();
    await retryPublication('pub-original');
    expect(paths.filter((p) => p === '/bridge/v1/publications/pub-original/retry')).toHaveLength(2);
  });
});
