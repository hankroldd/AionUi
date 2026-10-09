/**
 * [mycowork] 体验片 C：上传弹窗“少点一步、失败有出路”（packages/ui/src/pages/imports/UploadFlow.tsx · DraftList.tsx · use-upload-flow.ts）。
 * 职责：某个文件上传失败 → 该行有“重试”只重传这一份；至少一行成功就能“确认导入”且只带成功的行，失败行留在队列、旁边一句话说明；
 *       取消弹窗时中止还在传的请求；批次受理后主按钮是“完成”，“再导入一批”次要。
 * 边界：真实 ResourcesPage、UploadFlow 与 Arco，只用虚构 Bridge 边界（fetch）。
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { fetchMock, fixture, reply, reset, standard } from './globalResourceFixture';

const row = (over: object) => ({
  seq: 0,
  upload_id: 'up_ok',
  file_name: '好的.md',
  purpose: 'working',
  status: 'ready',
  resource_id: 'res_n',
  source_id: null,
  duplicate_of: null,
  steps: { received: 'done', stored: 'done', parse: 'skipped', index: 'skipped' },
  error: null,
  ...over,
});
const batch = (items: object[]) => ({
  batch_id: 'bat_1',
  submission_id: 's',
  revision: 1,
  tag_ids: [],
  items,
  created_at: 't',
  updated_at: 't',
});
const calls = (method: string, suffix: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).endsWith(suffix));
const nameOf = (init?: RequestInit) => decodeURIComponent(String((init?.headers as Record<string, string>)['x-file-name']));

/** failFirst：这些文件名的第一次上传失败（Bridge 给人话），之后成功；hang：这些文件名的上传永不返回。 */
function bridge(opts: { failFirst?: string[]; hang?: string[]; hangBatch?: boolean } = {}) {
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
  const seen = new Map<string, number>();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/bridge/v1/uploads') {
      const name = nameOf(init);
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      if (opts.hang?.includes(name)) return new Promise(() => undefined);
      if (opts.failFirst?.includes(name) && n === 1) return reply(413, { error: { code: 'X', message: '单个文件不超过 50MB' } });
      return reply(201, { upload_id: `up_${name}`, file_name: name, size: 5, sha256: name, duplicate_of: [] });
    }
    if (url === '/bridge/v1/import-batches' && init?.method === 'POST') {
      if (opts.hangBatch) return new Promise(() => undefined);
      const sent = JSON.parse(String(init.body)).items as { upload_id: string }[];
      return reply(201, batch(sent.map((s, i) => row({ seq: i, upload_id: s.upload_id, file_name: s.upload_id.slice(3) }))));
    }
    if (url === '/bridge/v1/import-batches/bat_1') return reply(200, batch([row({})]));
    return base(url, init);
  });
}
async function openDialog() {
  render(<ResourcesPage lang="zh-CN" />);
  await screen.findByRole('button', { name: '第一页-1.md', exact: true });
  fireEvent.click(within(document.querySelector('header') as HTMLElement).getByRole('button', { name: '新建' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '上传文件' }));
  return screen.findByRole('dialog');
}
async function addFiles(dialog: HTMLElement, ...names: string[]) {
  const input = dialog.querySelector('input[type=file]') as HTMLInputElement;
  for (const name of names) await act(async () => fireEvent.change(input, { target: { files: [new File(['hello'], name)] } }));
  for (const name of names) await screen.findByText(name);
}

beforeEach(() => {
  reset();
  fixture(standard);
});
afterEach(() => vi.unstubAllGlobals());

describe('上传弹窗：失败有出路', () => {
  it('失败行有“重试”，只重传这一份；重试成功后可确认', async () => {
    bridge({ failFirst: ['坏的.md'] });
    const dialog = await openDialog();
    await addFiles(dialog, '坏的.md');
    await within(dialog).findByText(/上传失败：单个文件不超过 50MB/);
    expect(within(dialog).getByRole('button', { name: '确认导入' })).toBeDisabled(); // 没有任何一行成功
    fireEvent.click(within(dialog).getByRole('button', { name: '重试 坏的.md' }));
    await within(dialog).findByText('已上传，待确认');
    expect(calls('POST', '/uploads')).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: /^重试/ })).toBeNull();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '确认导入' })).toBeEnabled());
  });

  it('部分成功：失败行不挡“确认导入”，只确认成功的行，旁边说明；失败行留到下一批可重试', async () => {
    bridge({ failFirst: ['坏的.md'] });
    const dialog = await openDialog();
    await addFiles(dialog, '好的.md', '坏的.md');
    await within(dialog).findByText(/上传失败/);
    expect(within(dialog).getByText('有 1 个文件没传上去，可重试或移除；现在确认只导入已上传的文件')).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: '确认导入' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await within(dialog).findByText('原件已保存，AI 尚未读完').catch(() => undefined);
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(1));
    const sent = JSON.parse(String(calls('POST', '/import-batches')[0]?.[1]?.body)).items as { upload_id: string }[];
    expect(sent.map((s) => s.upload_id)).toEqual(['up_好的.md']);
    await within(dialog).findByText(/没传上去，没包含在这一批里/);
    fireEvent.click(within(dialog).getByRole('button', { name: '再导入一批' }));
    expect(await within(dialog).findByText('坏的.md')).toBeInTheDocument(); // 失败行还在
    expect(within(dialog).queryByText('好的.md')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '重试 坏的.md' }));
    await within(dialog).findByText('已上传，待确认');
  });

  it('取消弹窗时中止还在进行的上传请求', async () => {
    bridge({ hang: ['大的.md'] });
    const dialog = await openDialog();
    const input = dialog.querySelector('input[type=file]') as HTMLInputElement;
    await act(async () => fireEvent.change(input, { target: { files: [new File(['hello'], '大的.md')] } }));
    await waitFor(() => expect(calls('POST', '/uploads')).toHaveLength(1));
    const signal = calls('POST', '/uploads')[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(signal.aborted).toBe(true));
  });

  it('批次受理后：主按钮“完成”（关闭弹窗），“再导入一批”是次要', async () => {
    bridge();
    const dialog = await openDialog();
    await addFiles(dialog, '好的.md');
    const confirm = within(dialog).getByRole('button', { name: '确认导入' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    const done = await within(dialog).findByRole('button', { name: '完成' });
    expect(done.className).toContain('arco-btn-primary');
    expect(within(dialog).getByRole('button', { name: '再导入一批' }).className).not.toContain('arco-btn-primary');
    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByText('上传文件', { selector: '.arco-modal-title' })).toBeNull());
  });

  it('带着失败行进入下一批：Secret、标签、知识库选择都沿用，重试后确认的请求体里仍是 Secret', async () => {
    bridge({ failFirst: ['坏的.md'] });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /设为 Secret/ }));
    await addFiles(dialog, '好的.md', '坏的.md');
    await within(dialog).findByText(/上传失败/);
    const confirm = within(dialog).getByRole('button', { name: '确认导入' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    fireEvent.click(await within(dialog).findByRole('button', { name: '再导入一批' }));
    await within(dialog).findByText('坏的.md');
    expect(within(dialog).getByRole('checkbox', { name: /设为 Secret/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: '重试 坏的.md' }));
    await within(dialog).findByText('已上传，待确认');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(2));
    const second = JSON.parse(String(calls('POST', '/import-batches')[1]?.[1]?.body));
    expect(second.secret).toBe(true);
    expect(second.items.map((x: { upload_id: string }) => x.upload_id)).toEqual(['up_坏的.md']);
  });

  it('确认进行中：失败行的“重试”和“移除”不可点', async () => {
    bridge({ failFirst: ['坏的.md'], hangBatch: true });
    const dialog = await openDialog();
    await addFiles(dialog, '好的.md', '坏的.md');
    await within(dialog).findByText(/上传失败/);
    const confirm = within(dialog).getByRole('button', { name: '确认导入' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(calls('POST', '/import-batches')).toHaveLength(1));
    expect(within(dialog).getByRole('button', { name: '重试 坏的.md' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '移除 坏的.md' })).toBeDisabled();
  });
});
