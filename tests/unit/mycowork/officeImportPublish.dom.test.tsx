/**
 * [mycowork] 体验片 C：导入的文件在空间里“发布到知识库”走原地弹窗（resources/ItemParts.tsx → ResourcePublication → PublishDialog），不再跳版本页。
 * 职责：菜单叫“发布到知识库”；点后原地弹窗（hash 不变）；只有一个可选知识库时预选它。
 * 边界：真实 ResourcesPage 与 Arco，只用虚构 Bridge 边界（fetch）。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { fetchMock, fixture, IMPORT, list, reply, reset } from './globalResourceFixture';

const timeline = {
  current_revision_id: 'rev-1',
  total: 1,
  page: 1,
  page_size: 50,
  file_name: IMPORT.file_name,
  items: [{ revision_id: 'rev-1', origin: 'original', current: true, created_at: '2026-10-03T07:00:00Z', restored_from: null }],
};
const counts = { total: 6, ready: 6, indexing: 0, failed: 0, unavailable: 0 };

/** sourceIds：scopes 里给出的知识库。 */
function serve(sourceIds: string[]) {
  fixture(() => list([IMPORT], 1));
  const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/bridge/v1/scopes')
      return reply(200, {
        sources: sourceIds.map((id) => ({ source_id: id, name: `虚构库-${id}`, provider: 'weknora', counts })),
        projects: [],
      });
    if (url.endsWith('/revisions')) return reply(200, timeline);
    return base(url, init);
  });
}
async function openPublish() {
  render(<ResourcesPage lang="zh-CN" />);
  await screen.findByRole('button', { name: IMPORT.file_name, exact: true });
  fireEvent.click(screen.getByRole('button', { name: `更多操作 ${IMPORT.file_name}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '发布到知识库' }));
  await screen.findByLabelText('库里的文件名'); // 先读认可版本，读到才出表单
  return screen.getByRole('dialog');
}

beforeEach(reset);
afterEach(() => vi.unstubAllGlobals());

describe('导入的文件：发布到知识库', () => {
  it('菜单是“发布到知识库”，点后原地弹窗，不跳版本页', async () => {
    serve(['src_a', 'src_b']);
    const dialog = await openPublish();
    expect(within(dialog).getByText('发布到知识库', { selector: '.arco-modal-title' })).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(screen.queryByRole('menuitem', { name: /去版本页/ })).toBeNull();
  });

  it('只有一个可选知识库时预选它', async () => {
    serve(['src_a']);
    const dialog = await openPublish();
    await waitFor(() => expect(within(dialog).getByText('虚构库-src_a', { selector: '.arco-select-view-value' })).toBeInTheDocument());
  });

  it('两个可选知识库：不预选', async () => {
    serve(['src_a', 'src_b']);
    const dialog = await openPublish();
    expect(dialog.querySelector('.arco-select-view-value')?.textContent).toBe('选择知识库'); // 占位符，没有预选
  });
});
