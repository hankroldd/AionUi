/**
 * [mycowork] D124: `/office/edit-text/:resourceId` (MyCowork md/txt online editing with a write lease).
 * Mocked boundaries: fetch (Bridge) and AionUi's CodeMirror editors / MarkdownViewer (replaced by a textarea / div so
 * typing is possible in jsdom; the slot must still pick MarkdownEditor for markdown and CodeEditor for text).
 * Covers: open → edit → save with the base revision → new base + writeback conflict notice; a stale base
 * (REVISION_CONFLICT) keeps the typed text; AI_EDITING shows "please wait" and retries by itself at editable_at;
 * a text file has no preview pane and "close" releases the lease and returns to the versions page; the page uses the shared
 * skeleton (fills the content area, own scroller, canvas mode) with the file name as title; on the versions page
 * "edit online" for a .md file goes to the text editor page instead of opening an ONLYOFFICE session.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeTextEditSlot, OfficeVersionsSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
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
  MarkdownViewer: ({ content }: { content: string }) => <div data-testid='md-preview'>{content}</div>,
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const session = (over: object = {}) => ({
  session_id: 'txe_1',
  resource_id: 'res_1',
  base_revision_id: 'rev_a',
  format: 'markdown',
  file_name: 'notes.md',
  content: '# 周报\n',
  state: 'editing',
  ...over,
});
const calls = (part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url).includes(part));
const body = (part: string, i = 0) => JSON.parse(String(calls(part)[i]?.[1]?.body));

describe('OfficeTextEditSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves the whole text against the base revision and reports the writeback conflict', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/text-edit-sessions') return reply(201, session());
      if (url.endsWith('/txe_1/save'))
        return reply(200, {
          revision_id: 'rev_b',
          created: true,
          base_revision_id: 'rev_b',
          workspace_writeback: { relative_path: 'notes.md', outcome: 'conflict', saved_as: 'notes.人工编辑-1.md' },
        });
      return reply(204, null);
    });
    render(<OfficeTextEditSlot />);
    const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
    expect(editor.value).toBe('# 周报\n');
    expect(body('/text-edit-sessions')).toEqual({ resource_id: 'res_1' });
    fireEvent.change(editor, { target: { value: '# 周报\n插入的一句话\n' } });
    expect(screen.getByTestId('md-preview').textContent).toContain('插入的一句话');
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('已保存为新版本。')).toBeInTheDocument();
    expect(body('/save')).toEqual({ expected_base_revision_id: 'rev_a', content: '# 周报\n插入的一句话\n' });
    expect(
      screen.getByText('该文件在你编辑期间被改过，未覆盖；你的版本另存为 notes.人工编辑-1.md。')
    ).toBeInTheDocument();
    // the next save goes against the new base
    fireEvent.change(editor, { target: { value: '# 周报\n再改一次\n' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(calls('/save')).toHaveLength(2));
    expect(body('/save', 1).expected_base_revision_id).toBe('rev_b');
  });

  it('keeps the typed text when the base is no longer current (REVISION_CONFLICT)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/text-edit-sessions') return reply(201, session());
      if (url.endsWith('/save')) return reply(409, { error: { code: 'REVISION_CONFLICT', message: 'x' } });
      return reply(204, null);
    });
    render(<OfficeTextEditSlot />);
    const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '我的改动' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/已有更新的版本/)).toBeInTheDocument();
    expect(editor.value).toBe('我的改动');
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument();
  });

  it('waits while the AI is modifying the file and opens by itself at editable_at', async () => {
    let opens = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/text-edit-sessions' && ++opens === 1)
        return reply(409, {
          error: {
            code: 'AI_EDITING',
            message: 'x',
            last_ai_write_at: new Date(Date.now() - 10_000).toISOString(),
            editable_at: new Date(Date.now() + 200).toISOString(),
          },
        });
      if (url === '/bridge/v1/text-edit-sessions') return reply(201, session());
      return reply(204, null);
    });
    render(<OfficeTextEditSlot />);
    expect((await screen.findByTestId('ai-wait')).textContent).toContain('AI 正在修改这个文件，请稍候');
    expect(await screen.findByTestId('md-editor', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(opens).toBe(2);
    expect(screen.queryByTestId('ai-wait')).toBeNull();
  });

  it('a text file has no preview pane; close releases the lease and returns to versions', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/text-edit-sessions')
        return reply(201, session({ format: 'text', file_name: 'a.txt', content: 'hi' }));
      return reply(204, null);
    });
    const { unmount } = render(<OfficeTextEditSlot />);
    expect(await screen.findByTestId('code-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('md-preview')).toBeNull();
    // 页面骨架（.claude/rules/ui.md）：占满内容区、正文自带滚动容器、画布模式不限 1024 宽；标题是文件名
    const root = screen.getByTestId('mycowork-text-editor');
    expect(root.style.overflow).toBe('hidden');
    expect(root.style.minHeight).toBe('0px');
    const scroller = within(root).getByTestId('mycowork-page-scroll');
    expect(scroller.style.overflowY).toBe('auto');
    expect((scroller.firstElementChild as HTMLElement).style.maxWidth).toBe('none');
    expect(screen.getByRole('heading', { name: 'a.txt' })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '关闭' })));
    await waitFor(() => expect(window.location.hash).toBe('#/office/resources/res_1/versions'));
    expect(calls('/txe_1/close')).toHaveLength(1);
    unmount(); // already closed: leaving does not close again
    expect(calls('/txe_1/close')).toHaveLength(1);
  });

  it('the versions page "edit online" of a .md file goes to the text editor page (no ONLYOFFICE session)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/revisions'))
        return reply(200, {
          resource_id: 'res_1',
          current_revision_id: 'rev_head',
          file_name: 'notes.md',
          items: [{ revision_id: 'rev_head', origin: 'output', current: true, created_at: '2026-09-28T00:00:00.000Z' }],
        });
      if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [] });
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      return reply(404, {});
    });
    render(<OfficeVersionsSlot />);
    fireEvent.click(await screen.findByRole('button', { name: '在线编辑' }));
    await waitFor(() => expect(window.location.hash).toBe('#/office/edit-text/res_1'));
    expect(calls('/edit-sessions')).toHaveLength(0);
  });
});
