/**
 * [mycowork] PR11 体验片 D 第二阶段：二、三级页面与弹窗向空间页设计语言对齐（负责人 2026-10-09）。只替换 Bridge HTTP（fetch），页面与 Arco 组件是真的。
 * 覆盖：导入记录页头只有一个主按钮（mcw-pill-primary），“查看”是 mcw-pill-light；上传弹窗带 mcw-dialog；
 *       回收站“恢复”是 mcw-pill-light、“永久删除”仍是危险语义；永久删除确认框带 mcw-dialog 且确认按钮仍是危险色（不被近黑主按钮规则盖掉）；
 *       空间“移入回收站”确认（Modal.confirm）带 mcw-dialog。样式本身（圆角、颜色）由回归栈上的 secondary-shots.ts 量。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ImportsPage } from '@mycowork/ui';
import { TrashPage } from '@mycowork/ui/pages/trash/index.ts';
import { fetchMock, reply } from './importFlowFixture';

configure({ asyncUtilTimeout: 4000 });
beforeEach(() => {
  fetchMock.mockReset();
  window.location.hash = '#/office/imports';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const batchSummary = {
  batch_id: 'imp_1',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  item_count: 1,
  counts: { active: 0, done: 1, failed: 0 },
  destination: { kind: 'archive', name: null },
  secret: false,
  preview_names: ['周报.md'],
};

describe('导入记录页', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url, 'http://fixture.invalid');
      if (u.pathname === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (u.pathname === '/bridge/v1/tags') return reply(200, { tags: [] });
      return reply(200, { items: [batchSummary], page: 1, page_size: 20, total: 1 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('页头只有一个主按钮且是近黑胶囊类；“查看”是轻按钮胶囊', async () => {
    const { container } = render(<ImportsPage lang='zh-CN' />);
    const rows = await screen.findAllByTestId('import-record');
    // 通用规则下任何非危险的 type=primary 都是近黑，所以数 arco-btn-primary，而不只数 mcw-pill-primary
    const primaries = container.querySelectorAll('.arco-btn-primary:not(.arco-btn-status-danger)');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveClass('mcw-pill-primary');
    expect(primaries[0]).toHaveTextContent('导入资料');
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: '查看' })).toHaveClass('mcw-pill-light');
  });

  it('打开上传弹窗：弹窗带 mcw-modal 与 mcw-dialog', async () => {
    render(<ImportsPage lang='zh-CN' />);
    await screen.findAllByTestId('import-record');
    fireEvent.click(screen.getByRole('button', { name: '导入资料' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.closest('.arco-modal') ?? dialog).toHaveClass('mcw-modal', 'mcw-dialog');
  });
});

describe('回收站', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/bridge/v1/trash?'))
        return reply(200, {
          items: [
            {
              resource_id: 'res_1',
              file_name: '虚构资料1.md',
              trashed_at: '2026-10-02T00:00:00Z',
              metadata_revision: 3,
              impact: { publications: 0, memory_items: 0, collections: 0, plans: 0 },
            },
          ],
          page: 1,
          page_size: 50,
          total: 1,
        });
      return reply(404, { error: { code: 'NOT_FOUND' } });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('“恢复”是轻按钮胶囊，“永久删除”仍是危险语义', async () => {
    render(<TrashPage lang='zh-CN' onBack={vi.fn()} />);
    await screen.findByText('虚构资料1.md');
    expect(screen.getByRole('button', { name: /^恢复/ })).toHaveClass('mcw-pill-light');
    expect(screen.getByRole('button', { name: /^永久删除/ })).toHaveClass('arco-btn-status-danger');
  });

  it('回收站里没有近黑主按钮（页头由空间壳持有，这里只有次要 / 危险操作）', async () => {
    const { container } = render(<TrashPage lang='zh-CN' onBack={vi.fn()} />);
    await screen.findByText('虚构资料1.md');
    expect(container.querySelectorAll('.arco-btn-primary:not(.arco-btn-status-danger)')).toHaveLength(0);
    expect(container.querySelector('.mcw-trash')).not.toBeNull(); // page-controls.css 靠这个类把通用规则套到空间壳内的回收站
  });

  it('永久删除确认框带 mcw-dialog，确认按钮保持危险色', async () => {
    render(<TrashPage lang='zh-CN' onBack={vi.fn()} />);
    await screen.findByText('虚构资料1.md');
    fireEvent.click(screen.getByRole('button', { name: /^永久删除/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.closest('.arco-modal') ?? dialog).toHaveClass('mcw-modal', 'mcw-dialog'));
    expect(within(dialog).getByRole('button', { name: '确认永久删除' })).toHaveClass('arco-btn-status-danger');
  });
});
