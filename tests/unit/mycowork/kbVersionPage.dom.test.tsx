/**
 * [mycowork] PR08 S4（C12）。文件：tests/unit/mycowork/kbVersionPage.dom.test.tsx
 * 职责：版本页顶部汇总“知识库「库名」里是 vK，不是当前版本”：时间线里带 knowledge_bases 才出现，点“重新发布”打开发布弹窗并预选该库
 *       （有两个库时也不用再选）；库里是最新时只写一句、没有按钮。
 * 边界：只替换 Bridge 边界（fetch）；其余同 officeVersions.dom.test.tsx。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleTracker } from './saveTrackerTeardown';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeVersionsSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => {
  const res = { status, ok: status < 300, json: async () => body, clone: () => res };
  return res;
};
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const rev = (id: string, no: number, over: object = {}) => ({
  revision_id: id,
  parent_id: no > 1 ? `rev_${no - 1}` : null,
  content_sha256: `x-${id}`,
  size: 1,
  created_at: `2026-10-0${no}T01:00:00.000Z`,
  origin: 'original',
  current: false,
  ...over,
});
function bridge(knowledgeBases: unknown[]) {
  fetchMock.mockImplementation(async (url: string) => {
    if (/\/resources\/res_1\/revisions(\?|$)/.test(url))
      return reply(200, {
        resource_id: 'res_1',
        current_revision_id: 'rev_5',
        file_name: '虚构.md',
        items: [5, 4, 3, 2, 1].map((n) => rev(`rev_${n}`, n, n === 5 ? { current: true } : {})),
        page: 1,
        page_size: 50,
        total: 5,
        knowledge_bases: knowledgeBases,
      });
    if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [], page: 1, page_size: 50, total: 0 });
    if (url === '/bridge/v1/scopes')
      return reply(200, {
        sources: [
          { source_id: 'src_a', name: '库甲', provider: 'weknora', counts },
          { source_id: 'src_b', name: '库乙', provider: 'weknora', counts },
        ],
        projects: [],
      });
    if (url.endsWith('/metadata'))
      return reply(200, { resource_id: 'res_1', metadata_revision: 1, current_revision_id: 'rev_5', tag_ids: [], secret: false });
    if (url.endsWith('/office/html')) return { ...reply(200, null), text: async () => '<html><body></body></html>' };
    if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
    return reply(404, {});
  });
}
readRetry.delays = [0, 0];

describe('版本页：知识库里是哪一版', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await settleTracker();
  });
  it('落后：顶部写“里是 v3，不是当前版本 v5”，点“重新发布”弹出发布框并预选库乙', async () => {
    bridge([{ source_id: 'src_b', via: 'publication', revision_id: 'rev_3', revision_no: 3, is_current: false }]);
    render(<OfficeVersionsSlot />);
    expect(await screen.findByTestId('mycowork-versions-kb')).toHaveTextContent('知识库「库乙」里是 v3，不是当前版本 v5');
    fireEvent.click(screen.getByRole('button', { name: '重新发布' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('库乙')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '发布' })).not.toBeDisabled();
  });
  it('最新只写一句、没有按钮；没有 knowledge_bases 时不出现这一行', async () => {
    bridge([{ source_id: 'src_a', via: 'publication', revision_id: 'rev_5', revision_no: 5, is_current: true }]);
    const { unmount } = render(<OfficeVersionsSlot />);
    expect(await screen.findByTestId('mycowork-versions-kb')).toHaveTextContent('知识库「库甲」里是 v5（最新）');
    expect(screen.queryByRole('button', { name: '重新发布' })).toBeNull();
    unmount();
    bridge([]);
    render(<OfficeVersionsSlot />);
    await screen.findByText('v5');
    expect(screen.queryByTestId('mycowork-versions-kb')).toBeNull();
  });
});
