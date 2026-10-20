/**
 * 文件：tests/unit/mycowork/usedSourcePreview.dom.test.tsx
 * 职责：已用资料直接核对当前原件，保留对话、范围与关闭焦点。
 * 边界：只替换 Bridge HTTP，使用真实 ScopeStrip、ScopeFilePreview 和 PreviewBody。
 * 关联：scope-resolution.md §5b；PR11 T16、R013。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { getScope, ScopeStrip, setScopeSelection } from '@mycowork/ui';

const request = vi.fn();
const shrink = vi.fn();
const FILE = '虚构周报.txt';
const BODY = '<img src="https://fixture.invalid/track" onerror="alert(1)">虚构当前原件';
const NOTE = '这里展示当前原件，不代表 AI 当时读取的历史版本。';
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
  text: async () => String(body),
});
const CONTEXT = {
  plan_id: 'plan_1',
  version: 1,
  status: 'OK',
  superseded: false,
  brief: {
    groups: [
      {
        source_id: 'src_a',
        source_name: '虚构资料',
        mode: 'subset',
        member_count: 1,
        counts: { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 },
      },
    ],
    excluded: 0,
    unauthorized: 0,
    refs: {},
    policy: { strict: true, web: 'off' },
  },
  used: [{ resource_id: 'res_a', source_id: 'src_a', file_name: FILE, reads: 2, last_read_at: '2026-10-20T00:00:00Z' }],
  withheld: 1,
};
let fileName: string;
let previewStatus: number;
let pending: boolean;
let revoked: boolean;
let signal: AbortSignal | undefined;
let complete: ((value: ReturnType<typeof reply>) => void) | undefined;

async function openPreview() {
  fireEvent.click(await screen.findByRole('button', { name: '查看本轮使用资料（1）' }));
  const trigger = screen.getByRole('button', { name: fileName });
  fireEvent.click(trigger);
  return trigger;
}

describe('used-source current original preview', () => {
  beforeEach(() => {
    fileName = FILE;
    previewStatus = 200;
    pending = false;
    revoked = false;
    signal = undefined;
    complete = undefined;
    shrink.mockReset();
    setScopeSelection([{ source_id: 'src_unchanged', name: '不改此范围' }]);
    request.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes('/memory-items')) return reply(200, { items: [], total: 0 });
      if (url.endsWith('/context'))
        return reply(
          200,
          url.includes('/conv_2/') || revoked
            ? { ...CONTEXT, used: [], withheld: 0 }
            : {
                ...CONTEXT,
                used: [{ ...CONTEXT.used[0], file_name: fileName }],
              }
        );
      if (url === '/bridge/v1/resources/res_a/preview' || url === '/bridge/v1/resources/res_a/office/html') {
        signal = init.signal as AbortSignal;
        if (pending)
          return new Promise((resolve) => {
            complete = resolve;
          });
        return reply(
          previewStatus,
          previewStatus === 200
            ? BODY
            : { error: { code: previewStatus === 403 ? 'FORBIDDEN' : 'UPSTREAM_UNAVAILABLE' } }
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => {
    expect(request.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    expect(shrink).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('opens safe current text without changing scope, then returns to the expanded list and its trigger', async () => {
    const scope = getScope();
    render(<ScopeStrip lang='zh-CN' conversationId='conv_1' onStrictShrink={shrink} />);
    const trigger = await openPreview();
    const preview = await screen.findByRole('dialog', { name: FILE });
    expect(within(preview).getByText(NOTE)).toBeInTheDocument();
    expect(await within(preview).findByText(BODY)).toBeInTheDocument();
    expect(screen.getByTestId('preview-body').querySelector('img,script,iframe')).toBeNull();
    expect(within(preview).getByRole('link', { name: '版本与编辑（新标签页）' })).toHaveAttribute(
      'href',
      '#/office/resources/res_a/versions'
    );
    fireEvent.click(within(preview).getByRole('button', { name: '返回对话' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByText('另有 1 项因授权撤销不再列出')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-body')).toBeNull();
    expect(getScope()).toBe(scope);
    expect(request.mock.calls.some(([url]) => url === '/bridge/v1/resources/res_a/preview')).toBe(true);
  });

  it('uses the existing sandboxed Office preview', async () => {
    fileName = '虚构方案.pptx';
    render(<ScopeStrip lang='zh-CN' conversationId='conv_1' onStrictShrink={shrink} />);
    await openPreview();
    await waitFor(() => expect(document.querySelector('iframe')).toHaveAttribute('srcdoc', BODY));
    expect(document.querySelector('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
    expect(request.mock.calls.some(([url]) => url === '/bridge/v1/resources/res_a/office/html')).toBe(true);
  });

  it.each([
    [403, /FORBIDDEN/],
    [503, '预览工具未配置或暂不可用，请稍后重试；文件本身不受影响。'],
  ])('shows HTTP %s as a failed read, never as source content', async (status, message) => {
    previewStatus = status as number;
    render(<ScopeStrip lang='zh-CN' conversationId='conv_1' onStrictShrink={shrink} />);
    await openPreview();
    const preview = screen.getByRole('dialog', { name: FILE });
    await within(preview).findByText(message as string | RegExp);
    expect(screen.queryByText(BODY)).toBeNull();
    expect(screen.getByTestId('preview-body').querySelector('pre,iframe')).toBeNull();
    fireEvent.click(within(preview).getByRole('button', { name: '返回对话' }));
    expect(screen.queryByTestId('preview-body')).toBeNull();
  });

  it('closing aborts the pending original read', async () => {
    pending = true;
    render(<ScopeStrip lang='zh-CN' conversationId='conv_1' onStrictShrink={shrink} />);
    const trigger = await openPreview();
    await waitFor(() => expect(signal).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await act(async () => complete?.(reply(200, '迟到的原件')));
    expect(screen.queryByText('迟到的原件')).toBeNull();
  });

  it('closes the preview when a context refresh withholds the resource after access is revoked', async () => {
    const view = render(<ScopeStrip lang='zh-CN' conversationId='conv_1' onStrictShrink={shrink} />);
    await openPreview();
    await screen.findByText(BODY);
    revoked = true;
    view.rerender(<ScopeStrip lang='zh-CN' conversationId='conv_1' refreshKey={1} onStrictShrink={shrink} />);
    await screen.findByText('本轮尚未读取资料');
    expect(screen.queryByTestId('preview-body')).toBeNull();
    expect(screen.queryByText(BODY)).toBeNull();
  });

  it('switching conversations closes and aborts the old preview, including a late response', async () => {
    pending = true;
    const view = render(<ScopeStrip lang='zh-CN' conversationId='conv_1' onStrictShrink={shrink} />);
    await openPreview();
    await waitFor(() => expect(signal).toBeDefined());
    view.rerender(<ScopeStrip lang='zh-CN' conversationId='conv_2' onStrictShrink={shrink} />);
    expect(screen.queryByTestId('preview-body')).toBeNull();
    expect(signal?.aborted).toBe(true);
    await screen.findByText('本轮尚未读取资料');
    await act(async () => complete?.(reply(200, '旧会话的迟到原件')));
    expect(screen.queryByText('旧会话的迟到原件')).toBeNull();
    expect(screen.queryByRole('button', { name: FILE })).toBeNull();
  });
});
