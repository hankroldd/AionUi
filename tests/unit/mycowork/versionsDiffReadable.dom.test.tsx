/**
 * [mycowork] PR11 W4-8。文件：tests/unit/mycowork/versionsDiffReadable.dom.test.tsx
 * 职责：版本与变化页差异区的“普通用户看得懂”：每处变化一句人话、改前/改后文字标签、没有变化时明确说内容相同、长文本折叠可展开。
 * 边界：只替换 Bridge fetch；不改差异计算——Bridge 返回的结构原样使用。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeVersionsSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const rev = (id: string, over: object = {}) => ({
  revision_id: id,
  origin: 'edit',
  current: false,
  created_at: '2026-10-04T08:00:00.000Z',
  ...over,
});
const diff = (over: object) => ({
  resource_id: 'res_1',
  from_revision_id: 'rev_a',
  to_revision_id: 'rev_b',
  format: 'pptx',
  compared_root: '/',
  status: 'complete',
  coverage: { nodes_from: 3, nodes_to: 3, truncated: false, lists_truncated: false },
  changes: [],
  unknown_parts: [],
  ...over,
});
// 响应回显请求里的版本对（界面只渲染与当前选择一致的结果，C06）
const pairOf = (url: string) => {
  const q = new URL(url, 'http://x').searchParams;
  return { from_revision_id: q.get('from'), to_revision_id: q.get('to') };
};
function bridge(d: object) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/revisions'))
      return reply(200, {
        resource_id: 'res_1',
        current_revision_id: 'rev_b',
        items: [rev('rev_b', { current: true, parent_id: 'rev_a' }), rev('rev_a', { origin: 'original' })],
        page: 1,
        page_size: 50,
        total: 2,
      });
    if (url.includes('/changes?')) return reply(200, { ...d, ...pairOf(url) });
    if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [] });
    if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (url.endsWith('/office/html'))
      return { ...reply(200, null), text: async () => '<html><head></head><body></body></html>' };
    if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
    return reply(404, {});
  });
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const change = (over: object) => ({
  kind: 'modified',
  node_type: 'shape',
  to_path: '/slide[3]/shape[@id=1]',
  ...over,
});

describe('差异说明', () => {
  it('每处变化先一句人话：哪一页、什么对象、新增 / 删除 / 修改 / 移动与改了哪些方面', async () => {
    bridge(
      diff({
        changes: [
          change({ aspects: ['text', 'geometry'], text_before: '旧', text_after: '新' }),
          change({ kind: 'added', to_path: '/slide[4]/shape[@id=2]' }),
          change({ kind: 'deleted', node_type: 'p', to_path: null, from_path: '/body/p[2]' }),
          change({ kind: 'moved', node_type: 'picture', to_path: '/slide[1]/picture[1]' }),
        ],
      })
    );
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('第 3 页的形状被修改（改了文字、位置与大小）')).toBeInTheDocument();
    expect(screen.getByText('第 4 页新增了形状')).toBeInTheDocument();
    expect(screen.getByText('正文删除了段落')).toBeInTheDocument();
    expect(screen.getByText('第 1 页的图片被移动了位置')).toBeInTheDocument();
  });

  it('改前 / 改后用文字标注，不只靠颜色', async () => {
    bridge(
      diff({
        changes: [
          change({ text_before: '旧', text_after: '新', fragment: { offset: 0, removed: '旧', inserted: '新' } }),
        ],
      })
    );
    render(<OfficeVersionsSlot />);
    const card = (await screen.findByTestId('version-change')) as HTMLElement;
    expect(within(card).getByText('改前')).toBeInTheDocument();
    expect(within(card).getByText('改后')).toBeInTheDocument();
    expect(card.querySelector('del')).toHaveTextContent('旧');
    expect(card.querySelector('ins')).toHaveTextContent('新');
  });

  it('没有变化时明确说内容相同；只比了正文时说“正文相同”并保留比较范围', async () => {
    bridge(diff({}));
    const { unmount } = render(<OfficeVersionsSlot />);
    expect(await screen.findByText('两个版本内容相同')).toBeInTheDocument();
    unmount();
    bridge(diff({ format: 'docx', compared_root: '/body' }));
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText(/两个版本的正文相同/)).toBeInTheDocument();
    expect(screen.getByText(/比较范围：正文/)).toBeInTheDocument();
  });

  it('长文本默认只留改动前后的上下文，可展开全文再收起', async () => {
    const head = 'A'.repeat(300);
    const tail = 'B'.repeat(300);
    bridge(
      diff({
        changes: [
          change({
            text_before: `${head}旧${tail}`,
            text_after: `${head}新${tail}`,
            fragment: { offset: 300, removed: '旧', inserted: '新' },
          }),
        ],
      })
    );
    render(<OfficeVersionsSlot />);
    const card = (await screen.findByTestId('version-change')) as HTMLElement;
    const del = card.querySelector('del') as HTMLElement;
    expect(del.textContent?.length).toBeLessThan(200);
    expect(del.textContent?.startsWith('…')).toBe(true);
    expect(del.textContent).toContain('旧');
    fireEvent.click(within(card).getByRole('button', { name: '展开全文' }));
    expect(del.textContent).toBe(`${head}旧${tail}`);
    fireEvent.click(within(card).getByRole('button', { name: '收起' }));
    expect(del.textContent?.length).toBeLessThan(200);
  });

  it('短文本不出现展开按钮', async () => {
    bridge(diff({ changes: [change({ text_before: '旧', text_after: '新' })] }));
    render(<OfficeVersionsSlot />);
    await screen.findByTestId('version-change');
    expect(screen.queryByRole('button', { name: '展开全文' })).toBeNull();
  });
});
