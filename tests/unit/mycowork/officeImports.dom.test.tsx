/**
 * [mycowork] ADR-0011: `/office/imports` (MyCowork P07 import queue, PR04 slice f).
 * Only the Bridge boundary is mocked (fetch). Covers: a dropped file is uploaded as octet-stream (nothing written
 * until "confirm"), a reference item needs a target knowledge base, confirm creates one idempotent batch, the page
 * polls until ready and links the original; a failed item offers "retry failed only" with expected_revision;
 * duplicate content offers reference/register; an over-limit upload shows the Bridge message.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeImportsSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: { mycoworkProjectId: 'proj-1' }, pathname: '/' }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const SCOPES = { sources: [{ source_id: 'src_q', name: '青禾库', provider: 'weknora', counts }], projects: [] };
const steps = (parse: string, index = parse) => ({ received: 'done', stored: 'done', parse, index });
const item = (over: object) => ({
  seq: 1,
  upload_id: 'up_1',
  file_name: '周报.md',
  purpose: 'reference',
  status: 'stored',
  resource_id: 'res_1',
  source_id: 'src_q',
  duplicate_of: null,
  steps: steps('pending'),
  error: null,
  ...over,
});
const batch = (items: object[], revision = 1) => ({
  batch_id: 'bat_1',
  submission_id: 's',
  revision,
  tag_ids: [],
  items,
  created_at: 't',
  updated_at: 't',
});
const calls = (method: string, suffix: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).endsWith(suffix));

function bridge(opts: { upload?: object; uploadStatus?: number; afterCreate: object[]; later?: object[] }) {
  let polls = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/bridge/v1/scopes') return reply(200, SCOPES);
    if (url === '/bridge/v1/uploads')
      return opts.uploadStatus
        ? reply(opts.uploadStatus, { error: { code: 'PAYLOAD_TOO_LARGE', message: '单个文件不超过 50MB' } })
        : reply(201, {
            upload_id: 'up_1',
            file_name: '周报.md',
            size: 5,
            sha256: 'x',
            duplicate_of: [],
            ...opts.upload,
          });
    if (url === '/bridge/v1/import-batches' && method === 'POST') return reply(201, batch(opts.afterCreate));
    if (url.endsWith('/retry')) return reply(200, batch(opts.later ?? opts.afterCreate, 2));
    if (url === '/bridge/v1/import-batches/bat_1')
      return reply(200, batch(polls++ > 0 && opts.later ? opts.later : opts.afterCreate));
    return reply(404, {});
  });
}

async function drop(name = '周报.md') {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  await act(async () => fireEvent.change(input, { target: { files: [new File(['hello'], name)] } }));
}

async function chooseTarget() {
  fireEvent.click(screen.getAllByText('有参考材料或模板时须选择目标知识库')[0] as HTMLElement);
  fireEvent.click(await screen.findByText('青禾库'));
}

describe('OfficeImportsSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads on drop, requires a target for references, confirms one batch, polls to ready and links the original', async () => {
    bridge({ afterCreate: [item({})], later: [item({ status: 'ready', steps: steps('done') })] });
    render(<OfficeImportsSlot />);
    await drop();
    await screen.findByText('周报.md');
    const [[, up]] = calls('POST', '/uploads');
    expect(up?.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      'x-file-name': '%E5%91%A8%E6%8A%A5.md',
    });
    expect(calls('POST', '/import-batches')).toHaveLength(0); // nothing written before confirm
    const confirm = () => screen.getByRole('button', { name: '确认导入' });
    await waitFor(() => expect(confirm()).toBeDisabled()); // reference needs a target knowledge base
    await chooseTarget();
    await waitFor(() => expect(confirm()).toBeEnabled());
    fireEvent.click(confirm());
    expect(await screen.findByText('原件已保存，AI 尚未读完')).toBeInTheDocument();
    const [[, create]] = calls('POST', '/import-batches');
    expect(JSON.parse(String(create?.body))).toMatchObject({
      source_id: 'src_q',
      project_id: 'proj-1',
      items: [{ upload_id: 'up_1', purpose: 'reference', duplicate_action: 'reference_existing' }],
    });
    expect(await screen.findByText('就绪', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看原件' })).toHaveAttribute(
      'href',
      '/bridge/v1/resources/res_1/preview'
    );
  });

  it('a failed item shows its reason and retries failed items only with expected_revision', async () => {
    const failed = item({ status: 'failed', steps: steps('failed', 'pending'), error: 'parse_failed' });
    bridge({ afterCreate: [failed], later: [item({ status: 'ready', steps: steps('done') })] });
    render(<OfficeImportsSlot />);
    await drop();
    await screen.findByText('周报.md');
    await chooseTarget();
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
    expect(await screen.findByText('知识库解析失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '只重试失败项' }));
    await waitFor(() => expect(calls('POST', '/retry')).toHaveLength(1));
    expect(JSON.parse(String(calls('POST', '/retry')[0]?.[1]?.body))).toEqual({ expected_revision: 1 });
  });

  it('offers reference/register for duplicate content, and working files need no target', async () => {
    bridge({ upload: { duplicate_of: ['res_old'] }, afterCreate: [item({ purpose: 'working', source_id: null })] });
    render(<OfficeImportsSlot />);
    await drop();
    expect(await screen.findByText('与你已导入的 1 个资源内容相同')).toBeInTheDocument();
    fireEvent.click(screen.getByText('另登记为独立来源'));
    fireEvent.click(screen.getByText('参考材料'));
    fireEvent.click(await screen.findByText('可编辑工作文件'));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认导入' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(1));
    const body = JSON.parse(String(calls('POST', '/import-batches')[0]?.[1]?.body));
    expect(body.items[0]).toMatchObject({ purpose: 'working', duplicate_action: 'register_separately' });
    expect(body.source_id).toBeUndefined();
  });

  it('shows the Bridge limit when an upload is too large, and cannot confirm', async () => {
    bridge({ uploadStatus: 413, afterCreate: [] });
    render(<OfficeImportsSlot />);
    await drop();
    expect(await screen.findByText(/上传失败：单个文件不超过 50MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认导入' })).toBeDisabled();
  });
});
