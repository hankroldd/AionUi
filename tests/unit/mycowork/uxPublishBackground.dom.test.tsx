/**
 * [mycowork] PR11 体验片 B-5：发布弹窗不锁人。只替换 Bridge HTTP；PublicationDialog、Arco 弹窗与轻提示是真的。
 * 覆盖：点“发布”后弹窗立即关闭（请求还挂着），同一条提示“正在发布到「库」…”→“已提交发布到「库」”；
 * 范围门禁（D109）/ 隐藏内容（D105）确认仍然出现——弹窗会重新打开问，不被绕过也不合并，请求身份不变；
 * 结果未知（断网）与 503 留在轻提示里，“重试（不会重复发布）”重发的是同一个 submission_id。
 */
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, configure } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import type { Publication, PublicationRequest } from '@mycowork/contracts';
import { PublicationDialog } from '@mycowork/ui/pages/versions/index.ts';

const sources = [
  { source_id: 'kb-1', name: '虚构知识库', counts: { total: 0, ready: 0, indexing: 0, failed: 0, unavailable: 0 } },
];
const accepted = vi.fn();
let requests: PublicationRequest[];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const error = (code: string, status = 409) => json({ error: { code } }, status);
const publication = (r: PublicationRequest): Publication => ({
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
const serve = (reply: (r: PublicationRequest, i: number) => Response | Promise<Response>) =>
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/bridge/v1/publications' && init?.method === 'POST') {
      const r = JSON.parse(String(init.body)) as PublicationRequest;
      requests.push(r);
      return reply(r, requests.length - 1);
    }
    throw new Error(`未安排的请求 ${url}`);
  });
function Harness() {
  const [open, setOpen] = useState(true);
  return open ? (
    <PublicationDialog
      resourceId='resource-1'
      revisionId='rev-1'
      headRevisionId='rev-1'
      versionLabel='v1'
      initialFileName='虚构成果.txt'
      sources={sources}
      secret={false}
      lang='zh-CN'
      onAccepted={(p) => {
        accepted(p);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  ) : (
    <p>已关闭</p>
  );
}
const dialogGone = () => waitFor(() => expect(document.querySelector('.arco-modal')).toBeNull());
async function publish() {
  fireEvent.click(screen.getByLabelText('选择知识库'));
  fireEvent.click(await screen.findByText('虚构知识库', { selector: '.arco-select-option' }));
  fireEvent.click(screen.getByRole('button', { name: '发布', exact: true }));
}

beforeEach(() => {
  requests = [];
  accepted.mockClear();
});
afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});

describe('发布弹窗不锁人', () => {
  it('点发布后弹窗立即关闭，同一条提示从“正在发布”变成“已提交发布”', async () => {
    let release!: (r: Response) => void;
    serve(() => new Promise<Response>((r) => (release = r)));
    render(<Harness />);
    await publish();
    await dialogGone();
    expect(await screen.findByText('正在发布到「虚构知识库」…')).toBeInTheDocument();
    expect(accepted).not.toHaveBeenCalled();
    await act(async () => release(json(publication(requests[0]!), 201)));
    expect(await screen.findByText(/已提交发布 v1 到「虚构知识库」/)).toBeInTheDocument();
    expect(screen.queryByText('正在发布到「虚构知识库」…')).toBeNull();
    expect(accepted).toHaveBeenCalledTimes(1);
  });

  it('范围门禁与隐藏内容确认仍然出现：弹窗重新打开询问，确认后再关，请求身份不变', async () => {
    serve((r, i) =>
      i === 0 ? error('DIFF_OUT_OF_SCOPE') : i === 1 ? error('HIDDEN_CONTENT_PRESENT') : json(publication(r), 201),
    );
    render(<Harness />);
    await publish();
    await screen.findByText(/这个版本是 AI 修改的结果/);
    expect(document.querySelector('.arco-modal')).not.toBeNull();
    await waitFor(() => expect(screen.queryByText('正在发布到「虚构知识库」…')).toBeNull());
    expect(requests).toHaveLength(1);
    expect(requests[0]?.confirm_out_of_scope).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '仍要发布' }));
    await screen.findByText(/这个版本含演讲者备注或批注/);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.confirm_hidden_content).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '仍要发布' }));
    expect(await screen.findByText(/已提交发布 v1 到「虚构知识库」/)).toBeInTheDocument();
    expect(new Set(requests.map((r) => r.submission_id)).size).toBe(1);
    expect(requests[2]).toMatchObject({ confirm_out_of_scope: true, confirm_hidden_content: true });
  });

  it('断网（结果未知）：弹窗不回来，提示里“重试（不会重复发布）”重发同一个 submission_id', async () => {
    serve((r, i) => {
      if (i === 0) throw new Error('断网');
      return json(publication(r), 201);
    });
    render(<Harness />);
    await publish();
    expect(await screen.findByText(/未收到发布结果/)).toBeInTheDocument();
    await dialogGone();
    fireEvent.click(await screen.findByRole('button', { name: '重试（不会重复发布）' }));
    expect(await screen.findByText(/已提交发布 v1 到「虚构知识库」/)).toBeInTheDocument();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(accepted).toHaveBeenCalledTimes(1);
  });

  it('发布前检查暂不可用（503）：提示里说明并可重试，同一请求身份', async () => {
    serve((r, i) => (i === 0 ? error('UPSTREAM_UNAVAILABLE', 503) : json(publication(r), 201)));
    render(<Harness />);
    await publish();
    expect(await screen.findByText(/发布前检查暂不可用/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '重试（不会重复发布）' }));
    await screen.findByText(/已提交发布 v1 到「虚构知识库」/);
    expect(requests[1]).toEqual(requests[0]);
  });
});
