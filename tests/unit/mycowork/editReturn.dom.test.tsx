/**
 * [mycowork] PR11 W4-8。文件：tests/unit/mycowork/editReturn.dom.test.tsx
 * 职责：空间预览工具栏的“在线编辑”（资格、入口）与“保存完成后回到来时的页面”（文本编辑保存成功、ONLYOFFICE 会话保存完成）。
 * 边界：只替换 fetch（Bridge）、react-router 参数、CodeMirror 编辑器与 DocsAPI；hash 即路由，用它断言去向。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { clearEditReturn } from '@mycowork/ui/pages/office-editor/edit-return.ts';
import { OfficeEditSlot, OfficeTextEditSlot, OfficeVersionsSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: 'eds_1', resourceId: 'res_md' }),
  useLocation: () => ({ pathname: '/' }),
}));
vi.mock('@/renderer/pages/conversation/Preview/components/editors', () => {
  const box =
    (id: string) =>
    ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      <textarea data-testid={id} value={value} onChange={(e) => onChange(e.target.value)} />
    );
  return { MarkdownEditor: box('md-editor'), CodeEditor: box('code-editor') };
});
vi.mock('@/renderer/pages/conversation/Preview/components/viewers', () => ({
  MarkdownViewer: ({ content }: { content: string }) => <div>{content}</div>,
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const row = (id: string, file_name: string, over: object = {}) => ({
  resource_id: id,
  file_name,
  source_id: null,
  origin: 'imports',
  state: 'stored',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  revision_count: 2,
  updated_at: '2026-10-04T00:00:00Z',
  ...over,
});
const rows = [
  row('res_md', '周报.md'),
  row('res_docx', '方案.docx'),
  row('res_pdf', '合同.pdf'),
  row('res_other', '别人的.md', { can_mark_secret: false }),
  row('res_zero', '没有版本.md', { revision_count: 0 }),
  row('res_secret', '密件.md', { secret: true }),
];
const timeline = (id: string, file_name: string) => ({
  resource_id: id,
  current_revision_id: 'rev_head',
  file_name,
  items: [{ revision_id: 'rev_head', origin: 'original', current: true, created_at: '2026-10-04T00:00:00.000Z' }],
});
const textSession = {
  session_id: 'txe_1',
  resource_id: 'res_md',
  base_revision_id: 'rev_a',
  format: 'markdown',
  file_name: '周报.md',
  content: '# 周报\n',
  state: 'editing',
};
const officeSession = (state: string, over: object = {}) => ({
  session_id: 'eds_1',
  resource_id: 'res_docx',
  base_revision_id: 'rev_head',
  state,
  saved_revision_id: null,
  document_server_url: 'http://127.0.0.1:28090',
  editor_config: state === 'closed' ? null : { document: { key: 'k' }, editorConfig: {} },
  created_at: 't',
  updated_at: 't',
  ...over,
});
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));

function bridge(extra: (url: string, init?: RequestInit) => unknown = () => undefined) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const special = extra(url, init);
    if (special) return special;
    if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
    if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
    if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
    if (url.startsWith('/bridge/v1/resources?'))
      return reply(200, { items: rows, page: 1, page_size: 50, total: rows.length });
    const rev = /\/resources\/(res_\w+)\/revisions$/.exec(url);
    if (rev) return reply(200, timeline(rev[1] as string, rows.find((r) => r.resource_id === rev[1])?.file_name ?? ''));
    if (/\/(office\/html|preview)$/.test(url))
      return { status: 200, ok: true, text: async () => '<html><body>x</body></html>', json: async () => null };
    if (url === '/bridge/v1/text-edit-sessions') return reply(201, textSession);
    if (url === '/bridge/v1/edit-sessions' && init?.method === 'POST') return reply(201, officeSession('editing'));
    return reply(204, null);
  });
}
const openPreview = async (name: string) => {
  fireEvent.click(await screen.findByRole('button', { name }));
  return screen.findByRole('dialog', { name: '当前内容预览' });
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('DocsAPI', {
    DocEditor: vi.fn(function (this: object) {
      return { destroyEditor: vi.fn() };
    }),
  });
  window.location.hash = '#/office/space';
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  clearEditReturn();
  vi.unstubAllGlobals();
});

describe('空间预览的“在线编辑”', () => {
  it.each([
    ['周报.md', true],
    ['方案.docx', true],
    ['密件.md', true],
    ['合同.pdf', false],
    ['别人的.md', false],
    ['没有版本.md', false],
  ])('%s 的在线编辑按钮出现 = %s（owner、有版本、可编辑后缀才出；其余不去读版本）', async (name, shown) => {
    bridge();
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    const dialog = await openPreview(name);
    if (shown) expect(await within(dialog).findByRole('button', { name: '在线编辑' })).toBeInTheDocument();
    else {
      await waitFor(() => expect(within(dialog).getByRole('link', { name: '版本与变化' })).toBeInTheDocument());
      expect(within(dialog).queryByRole('button', { name: '在线编辑' })).toBeNull();
      expect(calls('GET', '/revisions')).toHaveLength(0);
    }
  });

  it('md：点击进文本编辑页；保存成功后关闭会话并回到空间', async () => {
    bridge((url) =>
      url.endsWith('/save') ? reply(200, { revision_id: 'rev_b', created: true, base_revision_id: 'rev_b' }) : undefined
    );
    const { unmount } = render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    const dialog = await openPreview('周报.md');
    fireEvent.click(await within(dialog).findByRole('button', { name: '在线编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit-text/res_md'));
    unmount();
    render(<OfficeTextEditSlot />);
    const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# 周报\n改了\n' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并返回' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/space'));
    expect(calls('POST', '/txe_1/close')).toHaveLength(1);
    await waitFor(() => expect(document.querySelector('.arco-message')).toHaveTextContent('已保存为新版本。')); // 跨页面提示
  });

  it('docx：点击按页面看到的当前版本开 ONLYOFFICE 会话；会话保存完成（登记出新版本）后回到空间', async () => {
    let gets = 0;
    bridge((url, init) => {
      if (url === '/bridge/v1/edit-sessions/eds_1' && !init?.method)
        return reply(
          200,
          ++gets === 1 ? officeSession('editing') : officeSession('closed', { saved_revision_id: 'rev_b' })
        );
      if (url.endsWith('/close')) return reply(202, officeSession('closing'));
      return undefined;
    });
    const { unmount } = render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    const dialog = await openPreview('方案.docx');
    fireEvent.click(await within(dialog).findByRole('button', { name: '在线编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit/eds_1'));
    expect(JSON.parse(String(calls('POST', '/bridge/v1/edit-sessions')[0]?.[1]?.body))).toEqual({
      resource_id: 'res_docx',
      base_revision_id: 'rev_head',
    });
    unmount();
    render(<OfficeEditSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '结束编辑并保存' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/space'), { timeout: 4000 });
    await waitFor(() => expect(document.querySelector('.arco-message')).toHaveTextContent('已保存为新版本。'));
  });
});

describe('保存后回到来时的页面', () => {
  it('从版本页进入文本编辑，保存成功后回到版本页', async () => {
    window.location.hash = '#/office/resources/res_md/versions';
    bridge((url) =>
      url.endsWith('/save') ? reply(200, { revision_id: 'rev_b', created: true, base_revision_id: 'rev_b' }) : undefined
    );
    const { unmount } = render(<OfficeVersionsSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '在线编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit-text/res_md'));
    unmount();
    render(<OfficeTextEditSlot />);
    const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '改了' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并返回' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/resources/res_md/versions'));
    await waitFor(() => expect(document.querySelector('.arco-message')).toHaveTextContent('已保存为新版本。'));
  });

  it('有返回意图时按钮是“保存并返回”；Ctrl+S 只保存、留在编辑页，之后点按钮才返回', async () => {
    window.location.hash = '#/office/resources/res_md/versions';
    bridge((url) =>
      url.endsWith('/save') ? reply(200, { revision_id: 'rev_b', created: true, base_revision_id: 'rev_b' }) : undefined
    );
    const { unmount } = render(<OfficeVersionsSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '在线编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit-text/res_md'));
    unmount();
    render(<OfficeTextEditSlot />);
    const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    fireEvent.change(editor, { target: { value: '第一次' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(await screen.findByText('已保存为新版本。')).toBeInTheDocument();
    await act(async () => undefined);
    expect(window.location.hash).toBe('#/office/edit-text/res_md');
    expect(document.querySelector('.arco-message')).toBeNull();
    fireEvent.change(editor, { target: { value: '第二次' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并返回' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/resources/res_md/versions'));
    expect(calls('POST', '/save')).toHaveLength(2);
  });

  it('保存失败（版本冲突）不跳转，输入保留', async () => {
    bridge((url) =>
      url.endsWith('/save') ? reply(409, { error: { code: 'REVISION_CONFLICT', message: 'x' } }) : undefined
    );
    const { unmount } = render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    const dialog = await openPreview('周报.md');
    fireEvent.click(await within(dialog).findByRole('button', { name: '在线编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit-text/res_md'));
    unmount();
    render(<OfficeTextEditSlot />);
    const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '我的改动' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并返回' }));
    expect(await screen.findByText(/已有更新的版本/)).toBeInTheDocument();
    await act(async () => undefined);
    expect(window.location.hash).toBe('#/office/edit-text/res_md');
    expect(editor.value).toBe('我的改动');
  });

  it('没有来源页（直接进入）保存后留在编辑页，行为同改动前', async () => {
    window.location.hash = '#/office/edit-text/res_md';
    bridge((url) =>
      url.endsWith('/save') ? reply(200, { revision_id: 'rev_b', created: true, base_revision_id: 'rev_b' }) : undefined
    );
    render(<OfficeTextEditSlot />);
    const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '改了' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('已保存为新版本。')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/office/edit-text/res_md');
  });
});
