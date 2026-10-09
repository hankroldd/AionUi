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
import { clearEditReturn, requestEditReturn } from '@mycowork/ui/pages/office-editor/edit-return.ts';

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


/** 第一次开会话是 txe_1（基线 rev_a）；之后再开 = 本人没有活动会话时新建的 txe_2（基线 latest.base，内容 latest.content）。 */
function bridge(saves: Array<'lost' | 'conflict' | 'ok'>, latest: { base: string; content: string }, hold?: Promise<void>) {
  let n = 0;
  let opens = 0;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/text-edit-sessions')
      return ++opens > 1
        ? reply(201, session({ session_id: 'txe_2', base_revision_id: latest.base, content: latest.content }))
        : reply(201, session());
    if (url.endsWith('/save')) {
      await hold;
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
const saveUrls = () => calls('/save').map(([u]) => String(u));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.location.hash = '';
});
afterEach(() => {
  clearEditReturn();
  Message.clear();
  vi.unstubAllGlobals();
});

it('保存并返回 → 断网 → 继续输入 → 重试：发的是失败那次的内容，成功后不自动返回，新输入还在、标签仍是未保存', async () => {
  requestEditReturn({ kind: 'space', id: 'res_1' });
  bridge(['lost', 'ok'], { base: 'rev_b', content: '' });
  render(<OfficeTextEditSlot />);
  const editor = await edit('第一版');
  fireEvent.click(screen.getByRole('button', { name: '保存并返回' }));
  const retry = await screen.findByRole('button', { name: '重试' });
  fireEvent.change(editor, { target: { value: '第一版，又打了几个字' } });
  fireEvent.click(retry);
  await waitFor(() => expect(calls('/save')).toHaveLength(2));
  expect(JSON.parse(String(calls('/save')[1]?.[1]?.body)).content).toBe('第一版');
  await screen.findByText('已保存为新版本。');
  expect(window.location.hash).not.toBe('#/office/space');
  expect(editor.value).toBe('第一版，又打了几个字');
  expect(screen.getByText('有未保存的修改')).toBeInTheDocument();
});

it('冲突且内容相同（别处关了一个标签）：读到的新会话要接过来，下一次保存发给新会话', async () => {
  bridge(['conflict', 'ok'], { base: 'rev_z', content: '我的改动' });
  render(<OfficeTextEditSlot />);
  const editor = await edit('我的改动');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('已保存为新版本。');
  fireEvent.change(editor, { target: { value: '我的改动 + 续写' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls('/save')).toHaveLength(2));
  expect(saveUrls()[1]).toContain('/txe_2/save');
  expect(JSON.parse(String(calls('/save')[1]?.[1]?.body)).expected_base_revision_id).toBe('rev_z');
});

it('内容不同点“读取最新版本”后：保存发给新会话并成功', async () => {
  bridge(['conflict', 'ok'], { base: 'rev_z', content: '别处存的' });
  render(<OfficeTextEditSlot />);
  const editor = await edit('我的改动');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  fireEvent.click(await screen.findByRole('button', { name: '读取最新版本' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '丢弃并读取' }));
  await waitFor(() => expect(editor.value).toBe('别处存的'));
  fireEvent.change(editor, { target: { value: '别处存的 + 续写' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls('/save')).toHaveLength(2));
  expect(saveUrls()[1]).toContain('/txe_2/save');
});

it('保存在途时点关闭，冲突回来后读到的新会话立即关掉，不留会话', async () => {
  let release!: () => void;
  bridge(['conflict'], { base: 'rev_z', content: '别处存的' }, new Promise<void>((r) => (release = r)));
  render(<OfficeTextEditSlot />);
  await edit('我的改动');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(calls('/save')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /确定|OK/ }));
  release();
  await waitFor(() => expect(calls('/txe_2/close')).toHaveLength(1));
});
