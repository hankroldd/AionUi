/**
 * [mycowork] PR03 R013：选择现场预览不确认选择，管理新标签保留原现场。
 * 只替换 Bridge HTTP 边界；正文、复选框、焦点与取消读取使用真实组件。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ScopeChip, getScope, setScopeSelection } from '@mycowork/ui';

const request = vi.fn();
const FILE = '虚构周报.md';
const SEARCH = '搜索知识库、智能分组（含其标签）或已展开清单里的文件名';
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
  text: async () => String(body),
});
let previewStatus: number;
let pending: boolean;
let signal: AbortSignal | undefined;

async function openFiles() {
  fireEvent.click(screen.getByRole('button', { name: /资料范围/ }));
  fireEvent.click(await screen.findByText('虚构知识库'));
  fireEvent.click(await screen.findByRole('button', { name: '挑选文件' }));
  await screen.findByText(FILE);
}

describe('R013 scope preview and management', () => {
  beforeEach(() => {
    previewStatus = 200;
    pending = false;
    signal = undefined;
    setScopeSelection([]);
    request.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/bridge/v1/scopes')
        return reply(200, {
          sources: [
            {
              source_id: 'src_a',
              name: '虚构知识库',
              counts: { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 },
            },
          ],
          projects: [],
        });
      if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
      if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
      if (url.startsWith('/bridge/v1/resources?'))
        return reply(200, {
          total: 1,
          items: [{ resource_id: 'res_a', file_name: FILE, tag_ids: [], state: 'ready' }],
        });
      if (url === '/bridge/v1/resources/res_a/preview') {
        signal = init.signal as AbortSignal;
        if (pending)
          return new Promise((_resolve, reject) =>
            signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
          );
        return reply(
          previewStatus,
          previewStatus === 200 ? '仅供查看的虚构正文' : { error: { code: 'UPSTREAM_UNAVAILABLE' } }
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('previews an unchecked file without changing selection or search; closes back to its trigger', async () => {
    render(<ScopeChip lang='zh-CN' />);
    await openFiles();
    fireEvent.click(screen.getByRole('checkbox', { name: FILE }));
    fireEvent.change(screen.getByRole('textbox', { name: SEARCH }), { target: { value: '虚构' } });
    const button = screen.getByRole('button', { name: `预览 ${FILE}` });
    fireEvent.click(button);
    await screen.findByText('仅供查看的虚构正文');
    const preview = screen.getByRole('dialog', { name: FILE });
    expect(within(preview).getByRole('link', { name: '版本与编辑（新标签页）' })).toHaveAttribute(
      'href',
      '#/office/resources/res_a/versions'
    );
    fireEvent.click(within(preview).getByRole('button', { name: '返回选择' }));
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(screen.getByRole('checkbox', { name: FILE })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: SEARCH })).toHaveValue('虚构');
    expect(getScope().items).toEqual([]);
    expect(screen.queryByTestId('preview-body')).not.toBeInTheDocument();
  });

  it('opens management as an isolated internal link; cancelling leaves the applied scope unchanged', async () => {
    render(<ScopeChip lang='zh-CN' />);
    await openFiles();
    const link = screen.getByRole('link', { name: '完整管理（新标签页）' });
    expect(link).toHaveAttribute('href', '#/office/resources');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(getScope().items).toEqual([]);
  });

  it('retries failed preview without applying the basket', async () => {
    previewStatus = 503;
    render(<ScopeChip lang='zh-CN' />);
    await openFiles();
    fireEvent.click(screen.getByRole('button', { name: `预览 ${FILE}` }));
    const preview = screen.getByRole('dialog', { name: FILE });
    const retry = await within(preview).findByRole('button', { name: '重试' });
    previewStatus = 200;
    fireEvent.click(retry);
    await within(preview).findByText('仅供查看的虚构正文');
    expect(getScope().items).toEqual([]);
  });

  it('aborts preview when its task page unmounts', async () => {
    pending = true;
    const page = render(<ScopeChip lang='zh-CN' />);
    await openFiles();
    fireEvent.click(screen.getByRole('button', { name: `预览 ${FILE}` }));
    await waitFor(() => expect(signal).toBeDefined());
    page.unmount();
    expect(signal!.aborted).toBe(true);
  });
});
