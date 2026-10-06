/**
 * [mycowork] PR11 W4-4o。文件：tests/unit/mycowork/publicationUnknownResult.dom.test.tsx
 * 职责：发布请求结果未知（断网）时锁定目标与文件名，重试沿用同一请求身份；只有显式开始新操作才换 submission_id。
 * 边界：只替换 Bridge HTTP；React 状态与 Arco 控件为真实实现。
 */
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { Publication, PublicationRequest } from '@mycowork/contracts';
import { PublicationDialog } from '@mycowork/ui/pages/versions/index.ts';
import { usePublication } from '@mycowork/ui/pages/versions/use-publication.ts';
import { versionsText } from '@mycowork/ui/pages/versions/messages.ts';

const counts = { total: 0, ready: 0, indexing: 0, failed: 0, unavailable: 0 };
const sources = [
  { source_id: 'kb-original', name: '虚构原目标库', counts },
  { source_id: 'kb-other', name: '虚构新目标库', counts },
];
const initial = {
  resourceId: 'fixture-resource',
  revisionId: 'fixture-revision',
  headRevisionId: 'fixture-revision',
  versionLabel: 'v1',
  initialFileName: '虚构原文件名.txt',
  sources,
  secret: false,
  lang: 'zh-CN',
};
const originalTarget = { kind: 'knowledge_base', source_id: 'kb-original', file_name: '虚构原文件名.txt' } as const;
const changedTarget = { kind: 'knowledge_base', source_id: 'kb-other', file_name: '误传的新文件名.txt' } as const;
const thirdTarget = { kind: 'archive' } as const;
const accepted = vi.fn();
let requests: PublicationRequest[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const publication = (request: PublicationRequest): Publication => ({
  publication_id: 'fixture-publication',
  resource_id: request.resource_id,
  revision_id: request.revision_id,
  target: request.target,
  status: 'queued',
  error: null,
  accepted_at: '2026-10-03T09:00:00Z',
  published_at: null,
  created_at: '2026-10-03T09:00:00Z',
});
function serve(reply: (request: PublicationRequest, index: number) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url !== '/bridge/v1/publications' || init?.method !== 'POST') throw new Error(`未安排的请求 ${url}`);
    const request = JSON.parse(String(init.body)) as PublicationRequest;
    requests.push(request);
    return reply(request, requests.length - 1);
  });
}
function Harness() {
  const [open, setOpen] = useState(true);
  return open ? (
    <PublicationDialog
      {...initial}
      onAccepted={(p) => {
        accepted(p);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  ) : (
    <button onClick={() => setOpen(true)}>开始新的发布操作</button>
  );
}
async function choose(name: string) {
  fireEvent.click(screen.getByLabelText('选择知识库'));
  fireEvent.click(await screen.findByText(name, { selector: '.arco-select-option' }));
}
async function firstPublish() {
  await choose('虚构原目标库');
  fireEvent.click(screen.getByRole('button', { name: '发布', exact: true }));
  await screen.findByText(/未收到发布结果/);
}
function hookOptions() {
  return {
    snapshot: {
      resource_id: initial.resourceId,
      revision_id: initial.revisionId,
      expected_head_revision_id: initial.headRevisionId,
    },
    text: versionsText('zh-CN'),
    onAccepted: accepted,
  };
}

beforeEach(() => {
  requests = [];
  accepted.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('发布结果未知时冻结完整请求身份', () => {
  it('fetch reject 后库和文件名仍锁定，同窗重复提交body及nonce完全相同', async () => {
    serve((r, i) => {
      if (i === 0) throw new Error('fixture网络中断，是否受理未知');
      return json(publication(r), 201);
    });
    render(<Harness />);
    await firstPublish();
    expect(accepted).not.toHaveBeenCalled();
    const fileName = screen.getByLabelText('库里的文件名');
    const source = screen.getByLabelText('选择知识库').closest('.arco-select');
    expect(fileName).toHaveValue(originalTarget.file_name);
    expect(fileName).toBeDisabled();
    expect(source).toHaveClass('arco-select-disabled');
    fireEvent.click(screen.getByRole('button', { name: '发布', exact: true }));
    await waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });

  it('真实hook在结果未知后误传不同target/name仍沿用最初完整body及nonce', async () => {
    serve((r, i) => {
      if (i === 0) throw new Error('fixture结果未知');
      return json(publication(r), 201);
    });
    const hook = renderHook(() => usePublication(hookOptions()));
    await act(async () => hook.result.current.submit(originalTarget));
    expect(hook.result.current.error).toMatch(/未收到发布结果/);
    await act(async () => hook.result.current.submit(changedTarget));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(accepted).toHaveBeenCalledTimes(1);
  });

  it('真实hook的scope和hidden确认即使误传新目标仍保留原identity和累积flags', async () => {
    serve((r, i) =>
      i === 0
        ? json({ error: { code: 'DIFF_OUT_OF_SCOPE' } }, 409)
        : i === 1
          ? json({ error: { code: 'HIDDEN_CONTENT_PRESENT' } }, 409)
          : json(publication(r), 201)
    );
    const hook = renderHook(() => usePublication(hookOptions()));
    await act(async () => hook.result.current.submit(originalTarget));
    expect(hook.result.current.why).toBe('scope');
    await act(async () => hook.result.current.submit(changedTarget));
    expect(hook.result.current.why).toBe('hidden');
    await act(async () => hook.result.current.submit(thirdTarget));
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.submission_id).toBe(requests[0]?.submission_id);
      expect(request.target).toEqual(originalTarget);
      expect(request.revision_id).toBe(initial.revisionId);
      expect(request.expected_head_revision_id).toBe(initial.headRevisionId);
    }
    expect(requests[1]).toMatchObject({ confirm_out_of_scope: true });
    expect(requests[2]).toMatchObject({ confirm_out_of_scope: true, confirm_hidden_content: true });
  });

  it('关闭旧弹窗后显式开始新操作允许新库和文件名，并使用新nonce', async () => {
    serve((r, i) => {
      if (i === 0) throw new Error('fixture结果未知');
      return json(publication(r), 201);
    });
    render(<Harness />);
    await firstPublish();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(await screen.findByRole('button', { name: '开始新的发布操作' }));
    await choose('虚构新目标库');
    fireEvent.change(screen.getByLabelText('库里的文件名'), { target: { value: '用户明确新选择.txt' } });
    fireEvent.click(screen.getByRole('button', { name: '发布', exact: true }));
    await waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(2);
    expect(requests[1]?.target).toEqual({
      kind: 'knowledge_base',
      source_id: 'kb-other',
      file_name: '用户明确新选择.txt',
    });
    expect(requests[1]?.submission_id).not.toBe(requests[0]?.submission_id);
  });
});
