/**
 * [mycowork] ADR-0011 / ADR-0022 决策 3：`/office/imports`（P07，PR11 W4-5 起与空间上传弹窗是同一套 UploadFlow，只是整页）。
 * Only the Bridge boundary is mocked (fetch). Covers: a dropped file is uploaded as octet-stream (nothing written until
 * "confirm"), no purpose picker exists, no knowledge base → purpose=working without source_id, a chosen knowledge base →
 * purpose=reference + source_id, confirm creates one idempotent batch, the page polls until ready and links the original;
 * a failed item offers "retry failed only" with expected_revision; duplicate content offers reference/register;
 * an over-limit upload shows the Bridge message.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
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
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
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
  fireEvent.click(screen.getByLabelText('放进哪个知识库'));
  fireEvent.click(await screen.findByText('青禾库'));
}

// 读请求的自动重试在用例里免等退避（产品默认 300/900 ms）
readRetry.delays = []; // 轮询用例按定时器数请求次数，关掉单次请求内的自动重试

describe('OfficeImportsSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads on drop, has no purpose picker, confirms one batch as reference for a chosen base, polls to ready and links the original', async () => {
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
    expect(screen.queryByText('参考材料')).toBeNull();
    expect(screen.queryByText('可编辑工作文件')).toBeNull();
    const confirm = () => screen.getByRole('button', { name: '确认导入' });
    await waitFor(() => expect(confirm()).toBeEnabled()); // knowledge base is optional
    await chooseTarget();
    fireEvent.click(confirm());
    expect(await screen.findByText('原件已保存，AI 尚未读完')).toBeInTheDocument();
    const [[, create]] = calls('POST', '/import-batches');
    const sent = JSON.parse(String(create?.body));
    expect(sent).toMatchObject({
      source_id: 'src_q',
      project_id: 'proj-1',
      items: [{ upload_id: 'up_1', purpose: 'reference', duplicate_action: 'reference_existing' }],
    });
    expect(sent.secret).toBeUndefined();
    expect(await screen.findByText('AI 可引用', {}, { timeout: 5000 })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: '只重试失败项' }).className).toContain('arco-btn-primary');
    expect(screen.getByRole('button', { name: '再导入一批' }).className).not.toContain('arco-btn-primary'); // 整页只有一个主按钮
    fireEvent.click(screen.getByRole('button', { name: '只重试失败项' }));
    await waitFor(() => expect(calls('POST', '/retry')).toHaveLength(1));
    expect(JSON.parse(String(calls('POST', '/retry')[0]?.[1]?.body))).toEqual({ expected_revision: 1 });
  });

  it('offers reference/register for duplicate content; no knowledge base sends working without a target', async () => {
    bridge({ upload: { duplicate_of: ['res_old'] }, afterCreate: [item({ purpose: 'working', source_id: null })] });
    render(<OfficeImportsSlot />);
    await drop();
    expect(await screen.findByText('与你已导入的 1 个资源内容相同')).toBeInTheDocument();
    expect(screen.getByText('不选知识库（仅存档）')).toBeInTheDocument();
    fireEvent.click(screen.getByText('另登记为独立来源'));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认导入' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(1));
    const body = JSON.parse(String(calls('POST', '/import-batches')[0]?.[1]?.body));
    expect(body.items[0]).toMatchObject({ purpose: 'working', duplicate_action: 'register_separately' });
    expect(body.source_id).toBeUndefined();
    expect(await screen.findByText('仅存档')).toBeInTheDocument();
  });

  it('shows the Bridge limit when an upload is too large, and cannot confirm', async () => {
    bridge({ uploadStatus: 413, afterCreate: [] });
    render(<OfficeImportsSlot />);
    await drop();
    expect(await screen.findByText(/上传失败：单个文件不超过 50MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认导入' })).toBeDisabled();
  });

  it('Secret: disables the knowledge base choice, hides the duplicate choice, sends secret=true as working', async () => {
    bridge({ upload: { duplicate_of: ['res_old'] }, afterCreate: [item({ purpose: 'working', source_id: null })] });
    render(<OfficeImportsSlot />);
    await drop();
    await screen.findByText('与你已导入的 1 个资源内容相同');
    await chooseTarget(); // 先选了库，再勾 Secret：库选择不生效
    fireEvent.click(
      screen.getByRole('checkbox', { name: '设为 Secret：只存本机，不进知识库和存档库，AI 读不到' })
    );
    expect(screen.queryByText('另登记为独立来源')).toBeNull();
    expect(document.querySelector('.arco-select-disabled')).not.toBeNull(); // 知识库选择被禁用
    expect(screen.getAllByText('不进知识库和存档库').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(1));
    const body = JSON.parse(String(calls('POST', '/import-batches')[0]?.[1]?.body));
    expect(body).toMatchObject({ secret: true, items: [{ purpose: 'working', duplicate_action: 'register_separately' }] });
    expect(body.source_id).toBeUndefined();
    expect(await screen.findByText('Secret（只存本机）')).toBeInTheDocument();
  });
  describe('progress polling survives failed reads', () => {
    afterEach(() => vi.useRealTimers());
    const reads = () => calls('GET', '/import-batches/bat_1');
    // 受理后一直“处理中”；读取按 failUntil 前失败、之后返回 done
    async function startPending(failFirst: number) {
      const pendingBatch = batch([item({})]);
      const doneBatch = batch([item({ status: 'ready', steps: steps('done') })]);
      let n = 0;
      bridge({ afterCreate: [item({})] });
      const base = fetchMock.getMockImplementation() as (u: string, i?: RequestInit) => Promise<unknown>;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/bridge/v1/import-batches/bat_1') {
          n++;
          if (n <= failFirst) throw new TypeError('network');
          return reply(200, doneBatch);
        }
        if (url === '/bridge/v1/import-batches' && init?.method === 'POST') return reply(201, pendingBatch);
        return base(url, init);
      });
      const view = render(<OfficeImportsSlot />);
      await drop();
      await screen.findByText('周报.md');
      await chooseTarget();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      return view;
    }
    const tick = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    it('one failed read, then success: shows the hint, keeps polling and completes', async () => {
      await startPending(1);
      await tick(2000); // 第一次读取失败
      expect(screen.getByText('读取进度失败，正在重试')).toBeInTheDocument();
      expect(reads()).toHaveLength(1);
      await tick(4000); // 退避后再读，成功
      expect(reads()).toHaveLength(2);
      expect(screen.queryByText('读取进度失败，正在重试')).toBeNull();
      expect(screen.getByText('AI 可引用')).toBeInTheDocument();
      await tick(60_000);
      expect(reads()).toHaveLength(2); // 完成后不再读
    });

    it('repeated failures: backoff is capped, hint stays, manual retry reads at once', async () => {
      await startPending(5);
      for (const ms of [2000, 4000, 8000, 16_000, 30_000]) await tick(ms); // 每步让 React 提交后再排下一次
      expect(reads()).toHaveLength(5);
      expect(screen.getByText('读取进度失败，正在重试')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '只重试失败项' })).toBeNull();
      await tick(10); // 手动前的状态：未再读
      fireEvent.click(screen.getByRole('button', { name: '立即重试' }));
      await tick(0);
      expect(reads()).toHaveLength(6);
      expect(screen.getByText('AI 可引用')).toBeInTheDocument();
    });

    it('unmount stops polling', async () => {
      const view = await startPending(99);
      await tick(2000);
      expect(reads()).toHaveLength(1);
      view.unmount();
      await tick(120_000);
      expect(reads()).toHaveLength(1);
    });
  });
});
