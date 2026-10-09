/**
 * [mycowork] PR11 W4-5：空间“新建 ▾ → 上传文件”弹窗（packages/ui/src/pages/imports/UploadDialog.tsx）。
 * 职责：弹窗只问知识库（可不选）+ 标签 + 可设 Secret，不出现用途；在知识库视图里默认选该库、否则默认不选；映射 purpose；
 *       勾 Secret 禁用知识库选择并整批 secret=true；同内容二选一、四步进度、只重试失败项、每项失败原因（D145 文案）都在弹窗内可用；
 *       取消不建批次；导入受理后空间列表重读；英文界面文案。
 * 边界：真实 ResourcesPage、UploadFlow 与 Arco，只用虚构 Bridge 边界（fetch）。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { fetchMock, fixture, list, FIRST, nav, reads, reply, reset, standard } from './globalResourceFixture';

const steps = (parse: string, index = parse) => ({ received: 'done', stored: 'done', parse, index });
const row = (over: object) => ({
  seq: 0,
  upload_id: 'up_1',
  file_name: '周报.md',
  purpose: 'working',
  status: 'ready',
  resource_id: 'res_n',
  source_id: null,
  duplicate_of: null,
  steps: steps('skipped'),
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
const bodyOf = (n = 0) => JSON.parse(String(calls('POST', '/import-batches')[n]?.[1]?.body));

/** 在空间 fixture 之外补上传与导入批次；duplicate 控制上传返回的同内容。 */
function bridge(opts: { duplicate?: string[]; created?: object[]; retried?: object[] } = {}) {
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/bridge/v1/uploads')
      return reply(201, { upload_id: 'up_1', file_name: '周报.md', size: 5, sha256: 'x', duplicate_of: opts.duplicate ?? [] });
    if (url === '/bridge/v1/import-batches' && init?.method === 'POST') return reply(201, batch(opts.created ?? [row({})]));
    if (url.endsWith('/retry')) return reply(200, batch(opts.retried ?? [row({})], 2));
    if (url === '/bridge/v1/import-batches/bat_1') return reply(200, batch(opts.created ?? [row({})]));
    return base(url, init);
  });
}
async function openDialog(lang = 'zh-CN') {
  render(<ResourcesPage lang={lang} />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  fireEvent.click(within(document.querySelector('header') as HTMLElement).getByRole('button', { name: lang === 'en' ? 'Create' : '新建' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: lang === 'en' ? 'Import files' : '导入资料' }));
  return screen.findByRole('dialog');
}
async function addFile(dialog: HTMLElement, name = '周报.md') {
  const input = dialog.querySelector('input[type=file]') as HTMLInputElement;
  await act(async () => fireEvent.change(input, { target: { files: [new File(['hello'], name)] } }));
  await screen.findByText(name);
}
const kb = () => screen.getByLabelText('放进哪个知识库');
const selectedKb = (dialog: HTMLElement) => dialog.querySelector('.arco-select-view-value')?.textContent;

beforeEach(() => {
  reset();
  fixture(standard);
});
afterEach(() => vi.unstubAllGlobals());

const flush = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
/** 批次受理后一直“处理中”；读取按 getReads 的返回（抛错 = 读取失败）。confirm 之前用真实计时器，之后切假计时器。 */
async function pendingBatch(getReads: (n: number) => object) {
  const pending = [row({ status: 'stored', steps: steps('pending') })];
  bridge({ created: pending, retried: pending });
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
  let n = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/bridge/v1/import-batches/bat_1') return reply(200, getReads(++n));
    return base(url, init);
  });
  const dialog = await openDialog();
  await addFile(dialog);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
  await flush(0);
  return dialog;
}
const batchReads = () => calls('GET', '/import-batches/bat_1');
const failRead = (): object => {
  throw new TypeError('network');
};

// 读请求的自动重试在用例里免等退避（产品默认 300/900 ms）
readRetry.delays = []; // 轮询用例按定时器数请求次数，关掉单次请求内的自动重试

describe('上传弹窗', () => {
  afterEach(() => vi.useRealTimers());

  it('新建 → 上传文件打开弹窗而不是跳页；只问知识库、标签、Secret，没有用途选择；默认不选知识库', async () => {
    bridge();
    const dialog = await openDialog();
    expect(window.location.hash).not.toContain('imports');
    expect(within(dialog).getByText('导入资料')).toBeInTheDocument();
    expect(selectedKb(dialog)).toBe('不选知识库（仅存档）');
    expect(within(dialog).getByLabelText('标签（可选）')).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /设为 Secret：只存本机，不进知识库和存档库，AI 读不到/ })).toBeInTheDocument();
    for (const purpose of ['参考材料', '可编辑工作文件', '模板或优秀样例', '图示素材', '临时分析'])
      expect(within(dialog).queryByText(purpose)).toBeNull();
  });

  it('在某个知识库视图里打开：默认选该库；选了库 → purpose=reference + source_id，标签进 tag_ids', async () => {
    bridge({ created: [row({ purpose: 'reference', source_id: 'src_a', status: 'stored', steps: steps('pending') })] });
    render(<ResourcesPage lang='zh-CN' />);
    await screen.findByRole('button', { name: '第一页-1.md', exact: true });
    nav('source-src_a');
    fireEvent.click(within(document.querySelector('header') as HTMLElement).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '导入资料' }));
    const dialog = await screen.findByRole('dialog');
    expect(selectedKb(dialog)).toBe('虚构甲库');
    await addFile(dialog);
    fireEvent.click(screen.getByLabelText('标签（可选）'));
    fireEvent.click(await screen.findByText('风险', { selector: '.arco-select-popup *' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(1));
    expect(bodyOf()).toMatchObject({
      source_id: 'src_a',
      tag_ids: ['tag_case'],
      items: [{ upload_id: 'up_1', purpose: 'reference', duplicate_action: 'reference_existing' }],
    });
  });

  it('不选知识库 → purpose=working、不带 source_id；受理后空间列表重读', async () => {
    bridge();
    const dialog = await openDialog();
    await addFile(dialog);
    const before = reads().length;
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(1));
    expect(bodyOf()).toMatchObject({ items: [{ purpose: 'working' }] });
    expect(bodyOf().source_id).toBeUndefined();
    expect(bodyOf().secret).toBeUndefined();
    expect(bodyOf().tag_ids).toBeUndefined();
    expect(await within(dialog).findByText('仅存档')).toBeInTheDocument();
    await waitFor(() => expect(reads().length).toBeGreaterThan(before));
  });

  it('勾 Secret：知识库选择禁用、同内容选择隐藏，整批 secret=true、purpose=working、独立登记，不带 source_id', async () => {
    bridge({ duplicate: ['res_old'] });
    render(<ResourcesPage lang='zh-CN' />);
    await screen.findByRole('button', { name: '第一页-1.md', exact: true });
    nav('source-src_a'); // 在知识库视图里默认选了库，勾 Secret 后不生效
    fireEvent.click(within(document.querySelector('header') as HTMLElement).getByRole('button', { name: '新建' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '导入资料' }));
    const dialog = await screen.findByRole('dialog');
    await addFile(dialog);
    expect(within(dialog).getByText('另登记为独立来源')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /设为 Secret/ }));
    expect(kb().closest('.arco-select')).toHaveClass('arco-select-disabled');
    expect(selectedKb(dialog)).toBe('不进知识库和存档库');
    expect(within(dialog).queryByText('另登记为独立来源')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(1));
    expect(bodyOf()).toMatchObject({ secret: true, items: [{ purpose: 'working', duplicate_action: 'register_separately' }] });
    expect(bodyOf().source_id).toBeUndefined();
    expect(await within(dialog).findByText('Secret（只存本机）')).toBeInTheDocument();
  });

  it('同内容二选一：默认引用已有，改选独立登记后发 register_separately', async () => {
    bridge({ duplicate: ['res_old'] });
    const dialog = await openDialog();
    await addFile(dialog);
    expect(within(dialog).getByText('与你已导入的 1 个资源内容相同')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('另登记为独立来源'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(1));
    expect(bodyOf().items[0].duplicate_action).toBe('register_separately');
  });

  it('四步进度、失败原因按 D145 文案，只重试失败项带 expected_revision', async () => {
    const failed = row({ purpose: 'reference', source_id: 'src_a', status: 'failed', steps: steps('failed', 'pending'), error: 'upstream_failed' });
    bridge({ created: [failed], retried: [row({ purpose: 'reference', source_id: 'src_a', steps: steps('done') })] });
    const dialog = await openDialog();
    await addFile(dialog);
    fireEvent.click(kb());
    fireEvent.click(await screen.findByText('虚构甲库', { selector: '.arco-select-popup *' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    for (const step of ['已接收', '已保存原件', '解析', '索引']) expect(await within(dialog).findByText(step)).toBeInTheDocument();
    expect(within(dialog).getByText('知识库暂不可用')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: '只重试失败项' }));
    await waitFor(() => expect(calls('POST', '/retry')).toHaveLength(1));
    expect(JSON.parse(String(calls('POST', '/retry')[0]?.[1]?.body))).toEqual({ expected_revision: 1 });
    expect(await within(dialog).findByText('AI 可引用')).toBeInTheDocument();
  });

  it('读取失败后手动“立即重试”读到完成：空间列表也重读', async () => {
    const dialog = await pendingBatch((n) => (n === 1 ? failRead() : batch([row({ steps: steps('done') })])));
    await flush(2000);
    expect(within(dialog).getByText('读取进度失败，正在重试')).toBeInTheDocument();
    const before = reads().length;
    fireEvent.click(within(dialog).getByRole('button', { name: '立即重试' }));
    await flush(0);
    expect(within(dialog).getByText('已完成')).toBeInTheDocument();
    expect(reads().length).toBeGreaterThan(before);
  });

  it('上一批读取失败过：再导入一批后，新批次的首次轮询回到 2 秒而不是沿用退避', async () => {
    const dialog = await pendingBatch((n) => (n === 1 ? failRead() : batch([row({ status: 'stored', steps: steps('pending') })])));
    await flush(2000);
    expect(batchReads()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '再导入一批' }));
    vi.useRealTimers();
    await addFile(dialog);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    await flush(0);
    await flush(2000);
    expect(batchReads()).toHaveLength(2);
  });

  it('上一批读取失败过：只重试失败项成功后，下一次轮询回到 2 秒', async () => {
    const failedAndStored = [
      row({ seq: 0, status: 'failed', steps: steps('failed', 'pending'), error: 'upstream_failed' }),
      row({ seq: 1, file_name: '乙.md', status: 'stored', steps: steps('pending') }),
    ];
    bridge({ created: failedAndStored, retried: failedAndStored });
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    let n = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/bridge/v1/import-batches/bat_1') {
        if (++n === 1) throw new TypeError('network');
        return reply(200, batch(failedAndStored));
      }
      return base(url, init);
    });
    const dialog = await openDialog();
    await addFile(dialog);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    await flush(0);
    await flush(2000);
    expect(batchReads()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '只重试失败项' }));
    await flush(0);
    await flush(2000);
    expect(batchReads()).toHaveLength(2);
  });

  it('取消：上传了文件但没确认时不建批次，弹窗关闭', async () => {
    bridge();
    const dialog = await openDialog();
    await addFile(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByText('导入资料', { selector: '.arco-modal-title' })).toBeNull());
    expect(calls('POST', '/import-batches')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET' && init.method !== undefined)
      .map(([url]) => String(url)).filter((u) => u !== '/bridge/v1/uploads')).toEqual([]);
  });

  it('英文界面：弹窗文案与知识库选项', async () => {
    bridge();
    const dialog = await openDialog('en');
    expect(within(dialog).getByText('Import files')).toBeInTheDocument();
    expect(dialog.querySelector('.arco-select-view-value')?.textContent).toBe('No knowledge base (archive only)');
    expect(within(dialog).getByRole('checkbox', { name: /Mark as Secret: kept on this machine only/ })).toBeInTheDocument();
  });

  it('空间为空时的“导入资料”也打开弹窗', async () => {
    fixture(() => list([], 0));
    bridge();
    render(<ResourcesPage lang='zh-CN' />);
    await screen.findByText('空间里还没有资料', {}, { timeout: 5000 }); // 负载高时首屏慢
    fireEvent.click(screen.getByRole('button', { name: /导入资料/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(window.location.hash).not.toContain('imports');
  });
});
void FIRST;
