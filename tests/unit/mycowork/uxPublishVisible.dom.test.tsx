/**
 * [mycowork] PR11 发布结果一定看得见（负责人 2026-10-09：“没看到右上角进度”）。只替换 Bridge HTTP；PublicationDialog、Arco 弹窗与轻提示是真的。
 * 覆盖：受理很快时不闪“正在发布”，直接给结果提示；结果提示带“查看版本与变化”并至少停留 4 秒；请求超过 600 毫秒才出现“正在发布”。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import type { PublicationRequest } from '@mycowork/contracts';
import { PublicationDialog } from '@mycowork/ui/pages/versions/index.ts';

const sources = [
  { source_id: 'kb-1', name: '虚构知识库', counts: { total: 0, ready: 0, indexing: 0, failed: 0, unavailable: 0 } },
];
const accepted = (r: PublicationRequest) =>
  new Response(
    JSON.stringify({
      publication_id: 'pub-1', resource_id: r.resource_id, revision_id: r.revision_id, target: r.target,
      status: 'queued', error: null, accepted_at: 't', published_at: null, created_at: 't',
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
const serve = (reply: (r: PublicationRequest) => Promise<Response> | Response) =>
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => reply(JSON.parse(String(init?.body))));
const dialog = () => (
  <PublicationDialog resourceId='resource-1' revisionId='rev-1' headRevisionId='rev-1' versionLabel='v34'
    initialFileName='虚构成果.txt' sources={sources} secret={false} lang='zh-CN' onAccepted={() => {}} onCancel={() => {}} />
);
async function publish() {
  fireEvent.click(screen.getByLabelText('选择知识库'));
  fireEvent.click(await screen.findByText('虚构知识库', { selector: '.arco-select-option' }));
  fireEvent.click(screen.getByRole('button', { name: '发布', exact: true }));
}

afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});

describe('发布结果提示一定看得见', () => {
  it('受理很快：不闪“正在发布”，直接显示带“查看版本与变化”的结果，并停留至少 4 秒', async () => {
    serve(accepted);
    render(dialog());
    await publish();
    expect(await screen.findByText(/已提交发布 v34 到「虚构知识库」，入库在后台进行/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看版本与变化' }).getAttribute('href')).toBe('#/office/resources/resource-1/versions');
    await act(() => new Promise((r) => setTimeout(r, 700))); // 越过“正在发布”的延迟：它不能冒出来盖住结果
    expect(screen.queryByText('正在发布到「虚构知识库」…')).toBeNull();
    await act(() => new Promise((r) => setTimeout(r, 3500)));
    expect(screen.getByText(/已提交发布 v34/)).toBeInTheDocument();
  }, 10_000);

  it('请求超过 600 毫秒才出现“正在发布”，结果到了换成同一条', async () => {
    let release!: (r: Response) => void;
    serve(() => new Promise<Response>((r) => (release = r)));
    render(dialog());
    await publish();
    await waitFor(() => expect(document.querySelector('.arco-modal')).toBeNull());
    expect(screen.queryByText('正在发布到「虚构知识库」…')).toBeNull();
    expect(await screen.findByText('正在发布到「虚构知识库」…', {}, { timeout: 1500 })).toBeInTheDocument();
    await act(async () => release(accepted({ resource_id: 'resource-1', revision_id: 'rev-1', target: { kind: 'knowledge_base', source_id: 'kb-1', file_name: 'a' } } as PublicationRequest)));
    expect(await screen.findByText(/已提交发布 v34/)).toBeInTheDocument();
    expect(screen.queryByText('正在发布到「虚构知识库」…')).toBeNull();
  });
});
