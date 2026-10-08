/**
 * [mycowork] PR11 W4-9 ①：ZIP 导入的界面入口（packages/ui/src/pages/imports，R021、A240）。
 * 职责：选 / 拖入 .zip 与普通文件一样上传；确认后在批次结果里如实呈现每个 ZIP 的展开数、跳过清单（路径 + 原因）、整包拒绝的原因文案；
 *       来自 ZIP 的项显示包内路径，inert_instruction_file 标注“只当普通资料保存”；被整包拒绝的项不出“只重试失败项”，其它失败项仍可重试；
 *       同一个 ZIP 在队列里不重复加入并提示；中英文文案。
 * 边界：真实 ImportsPage、UploadFlow 与 Arco，只替换 fetch（importFlowFixture）。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ImportsPage } from '@mycowork/ui';
import { addFiles, batch, bodyOf, bridge, confirmButton, fetchMock, md, posts, row, steps, zip } from './importFlowFixture';

const inFlow = () => screen.getByTestId('mycowork-upload-flow');
const archiveItem = (path: string, over: object = {}) =>
  row({
    seq: 0,
    upload_id: 'up_x',
    file_name: path.split('/').at(-1),
    archive: { upload_id: 'up_1', path, notice: null },
    ...over,
  });
const expanded = {
  upload_id: 'up_1',
  file_name: '资料包.zip',
  outcome: 'expanded',
  reject_reason: null,
  extracted: 3,
  skipped: [{ path: 'tools/run.sh', reason: 'type_unsupported' }],
};
const rejected = (reason: string) => ({
  upload_id: 'up_1',
  file_name: '坏包.zip',
  outcome: 'rejected',
  reject_reason: reason,
  extracted: 0,
  skipped: [],
});
const rejectedItem = row({
  upload_id: 'up_1',
  file_name: '坏包.zip',
  status: 'failed',
  resource_id: null,
  steps: { received: 'done', stored: 'failed', parse: 'skipped', index: 'skipped' },
  error: 'archive_rejected',
});

beforeEach(() => {
  fetchMock.mockReset();
  window.location.hash = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('ZIP 导入入口', () => {
  it('选 .zip 与普通文件同样上传并进入待确认队列', async () => {
    bridge();
    render(<ImportsPage lang='zh-CN' />);
    await addFiles(inFlow(), zip('资料包.zip'));
    expect(await screen.findByText('资料包.zip')).toBeInTheDocument();
    await screen.findByText('已上传，待确认');
    fireEvent.click(confirmButton());
    await waitFor(() => expect(posts('/import-batches')).toHaveLength(1));
    expect(bodyOf().items).toHaveLength(1);
  });

  it('展开：报告写展开几项与跳过清单（路径 + 原因）；ZIP 项显示包内路径；SKILL.md 标注只当普通资料', async () => {
    bridge({
      created: batch(
        [
          archiveItem('docs/a.md'),
          archiveItem('docs/b.md', { seq: 1 }),
          archiveItem('SKILL.md', { seq: 2, archive: { upload_id: 'up_1', path: 'SKILL.md', notice: 'inert_instruction_file' } }),
        ],
        [expanded],
      ),
    });
    render(<ImportsPage lang='zh-CN' />);
    await addFiles(inFlow(), zip('资料包.zip'));
    await screen.findByText('已上传，待确认');
    fireEvent.click(confirmButton());
    const report = await screen.findByTestId('import-archive');
    expect(within(report).getByText('已展开 3 项')).toBeInTheDocument();
    expect(within(report).getByText('跳过 1 项（其余照常导入）')).toBeInTheDocument();
    expect(within(report).getByText('tools/run.sh')).toBeInTheDocument();
    expect(within(report).getByText(/文件类型暂不支持导入/)).toBeInTheDocument();
    expect(screen.getByText('来自 资料包.zip：docs/a.md')).toBeInTheDocument();
    const inert = screen.getAllByText('只当普通资料保存，不会被当作指令或能力');
    expect(inert).toHaveLength(1);
    expect(inert[0]?.closest('[data-testid=import-item]')?.textContent).toContain('SKILL.md');
    expect(screen.queryByRole('button', { name: '只重试失败项' })).toBeNull();
  });

  it('整包拒绝：错误提示写人话原因；被拒的 ZIP 项不提供“只重试失败项”', async () => {
    bridge({ created: batch([rejectedItem], [rejected('unsafe_path')]) });
    render(<ImportsPage lang='zh-CN' />);
    await addFiles(inFlow(), zip('坏包.zip'));
    await screen.findByText('已上传，待确认');
    fireEvent.click(confirmButton());
    const report = await screen.findByTestId('import-archive');
    expect(within(report).getByRole('alert')).toHaveTextContent('包里有指向包外的路径，已整包拒绝');
    expect(within(report).getByText('整包拒绝，没有展开任何文件')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '只重试失败项' })).toBeNull();
    expect(screen.getByRole('button', { name: '再导入一批' })).toBeInTheDocument();
  });

  it('同批里另有可重试的失败项时，仍提供“只重试失败项”', async () => {
    const other = row({ seq: 1, upload_id: 'up_2', file_name: '乙.md', status: 'failed', error: 'upstream_failed', steps: steps('failed', 'pending') });
    bridge({ created: batch([rejectedItem, other], [rejected('encrypted')]) });
    render(<ImportsPage lang='zh-CN' />);
    await addFiles(inFlow(), zip('坏包.zip'), md('乙.md'));
    await waitFor(() => expect(screen.getAllByText('已上传，待确认')).toHaveLength(2));
    fireEvent.click(confirmButton());
    expect(await screen.findByRole('button', { name: '只重试失败项' })).toBeInTheDocument();
    expect(within(await screen.findByTestId('import-archive')).getByRole('alert')).toHaveTextContent('先解密后重新上传');
  });

  it('同一个 ZIP 重复选入：队列里只有一份并提示；改名或不同大小 / 时间的不算重复', async () => {
    bridge();
    render(<ImportsPage lang='zh-CN' />);
    await addFiles(inFlow(), zip('资料包.zip'));
    await screen.findByText('已上传，待确认');
    await addFiles(inFlow(), zip('资料包.zip'));
    expect(await screen.findByRole('alert')).toHaveTextContent('资料包.zip 已在待确认队列里，不重复加入');
    expect(screen.getAllByTestId('import-draft')).toHaveLength(1);
    expect(posts('/uploads')).toHaveLength(1);
    await addFiles(inFlow(), zip('资料包.zip', 2));
    await waitFor(() => expect(screen.getAllByTestId('import-draft')).toHaveLength(2));
  });

  it('移除后可以再次加入同一个 ZIP', async () => {
    bridge();
    render(<ImportsPage lang='zh-CN' />);
    await addFiles(inFlow(), zip('资料包.zip'));
    await screen.findByText('已上传，待确认');
    fireEvent.click(screen.getByRole('button', { name: '移除 资料包.zip' }));
    await addFiles(inFlow(), zip('资料包.zip'));
    await waitFor(() => expect(screen.getAllByTestId('import-draft')).toHaveLength(1));
    expect(posts('/uploads')).toHaveLength(2);
  });

  it('英文界面：报告与整包拒绝原因', async () => {
    bridge({ created: batch([rejectedItem], [rejected('compression_ratio')]) });
    render(<ImportsPage lang='en' />);
    await addFiles(inFlow(), zip('坏包.zip'));
    await screen.findByText('Uploaded, awaiting confirmation');
    fireEvent.click(confirmButton('en'));
    expect(within(await screen.findByTestId('import-archive')).getByRole('alert')).toHaveTextContent('abnormal compression ratio');
    expect(screen.getByText('Rejected as a whole; nothing was extracted')).toBeInTheDocument();
  });
});
