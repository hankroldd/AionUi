/**
 * [mycowork] PR11 体验片 B-4：文本编辑页不把人锁住。只替换 Bridge 边界（fetch）、剪贴板与 AionUi 的编辑器组件。
 * 覆盖：点“关闭”立即跳转（关闭请求交给离开时的 keepalive 请求，不等响应，只发一次）；保存遇网络不可达不自动重放、
 * 页内“还没保存上，你的内容还在这里”+重试；响应丢失后重试得到版本冲突，读最新版本发现内容相同 → 按已保存处理；
 * 内容不同的真冲突给“复制我的内容 / 读取最新版本”两个按钮，读取前二次确认会丢弃未保存内容。
 */
import { fireEvent, render, screen, waitFor, within, configure } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import { OfficeTextEditSlot } from '@/renderer/mycowork-slots';

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

configure({ asyncUtilTimeout: 4000 }); // 整机高负载时默认 1 秒的 findBy 会误报
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
const SAVED = { revision_id: 'rev_b', created: true, base_revision_id: 'rev_b', workspace_writeback: null };
const writeText = vi.fn(async () => {});

/** saves：按次序给保存请求的回应；'lost' = 请求发出去了但响应丢了（断线）。opens：再次 join 会话时读到的最新版本。 */
function bridge(saves: Array<'lost' | 'conflict' | 'ok'>, latest?: { base: string; content: string }) {
  let n = 0;
  let opens = 0;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/text-edit-sessions')
      return ++opens > 1 && latest
        ? reply(200, session({ base_revision_id: latest.base, content: latest.content }))
        : reply(201, session());
    if (url.endsWith('/save')) {
      const how = saves[n++] ?? 'ok';
      if (how === 'lost') throw new TypeError('Failed to fetch');
      return how === 'conflict' ? reply(409, { error: { code: 'REVISION_CONFLICT', message: 'x' } }) : reply(200, SAVED);
    }
    return reply(204, null);
  });
}
const edit = async (value: string) => {
  const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
  fireEvent.change(editor, { target: { value } });
  return editor;
};

beforeEach(() => {
  fetchMock.mockReset();
  writeText.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  window.location.hash = '';
});
afterEach(() => {
  Message.clear();
  vi.unstubAllGlobals();
});

describe('关闭立即跳转', () => {
  it('点“关闭”不等关闭请求：请求挂着也已经跳到版本页，关闭请求只发一次', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/text-edit-sessions') return reply(201, session());
      if (url.endsWith('/close')) return new Promise(() => {}); // 永远不回
      return reply(204, null);
    });
    const { unmount } = render(<OfficeTextEditSlot />);
    await screen.findByTestId('md-editor');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(window.location.hash).toBe('#/office/resources/res_1/versions');
    expect(calls('/txe_1/close')).toHaveLength(1);
    expect(calls('/txe_1/close')[0]?.[1]?.keepalive).toBe(true);
    unmount();
    expect(calls('/txe_1/close')).toHaveLength(1);
  });
});

describe('保存遇到网络不可达', () => {
  it('不自动重放；页内一行“还没保存上，你的内容还在这里”+重试，不出现整句“连不上服务”', async () => {
    bridge(['lost']);
    render(<OfficeTextEditSlot />);
    const editor = await edit('我的改动');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/还没保存上，你的内容还在这里/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/连不上 MyCowork 服务/);
    expect(editor.value).toBe('我的改动');
    await new Promise((r) => setTimeout(r, 100));
    expect(calls('/save')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('已保存为新版本。')).toBeInTheDocument();
    expect(calls('/save')).toHaveLength(2);
  });

  it('响应丢了其实已存上：重试得到版本冲突，读最新版本内容相同 → 按已保存处理', async () => {
    bridge(['lost', 'conflict'], { base: 'rev_b', content: '我的改动' });
    render(<OfficeTextEditSlot />);
    await edit('我的改动');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.click(await screen.findByRole('button', { name: '重试' }));
    expect(await screen.findByText('已保存为新版本。')).toBeInTheDocument();
    expect(screen.queryByText(/已有更新的版本/)).toBeNull();
    expect(screen.getByText('已是最新保存')).toBeInTheDocument();
    expect(calls('/save')).toHaveLength(2);
  });
});

describe('版本冲突', () => {
  it('内容不同的真冲突：两个按钮；复制我的内容写入剪贴板并提示', async () => {
    bridge(['conflict'], { base: 'rev_z', content: '别处存的' });
    render(<OfficeTextEditSlot />);
    await edit('我的改动');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/已有更新的版本/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制我的内容' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('我的改动'));
    expect(await screen.findByText('已复制')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '读取最新版本' })).toBeInTheDocument();
  });

  it('读取最新版本要二次确认会丢弃未保存内容；确认后换成最新内容并以新基线保存', async () => {
    bridge(['conflict', 'ok'], { base: 'rev_z', content: '别处存的' });
    render(<OfficeTextEditSlot />);
    const editor = await edit('我的改动');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    fireEvent.click(await screen.findByRole('button', { name: '读取最新版本' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('丢弃');
    expect(editor.value).toBe('我的改动'); // 还没确认，什么都没变
    fireEvent.click(within(dialog).getByRole('button', { name: '丢弃并读取' }));
    await waitFor(() => expect(editor.value).toBe('别处存的'));
    expect(screen.getByText('已是最新保存')).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: '别处存的 + 续写' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('/save')).toHaveLength(2));
    expect(JSON.parse(String(calls('/save')[1]?.[1]?.body)).expected_base_revision_id).toBe('rev_z');
  });
});
