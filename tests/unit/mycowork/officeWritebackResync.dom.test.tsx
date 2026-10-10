/**
 * [mycowork] PR07 A373、A375。文件：tests/unit/mycowork/officeWritebackResync.dom.test.tsx
 * 职责：写回会话工作目录 failed 之后的“重新同步”入口在四处界面的行为——保存跟踪器的常驻通知、ONLYOFFICE 编辑页结果态、文本编辑页、
 *       版本页顶部提示条：failed 才有按钮；处理中禁用；成功后提示换成已同步（版本页提示条消失）；冲突换成冲突提示且不再有按钮；
 *       仍失败 / 出错保留按钮可再试；已同步（409）当作成功；conflict / written 等非 failed 的提示没有按钮；英文文案。
 * 边界：只替换 fetch（Bridge）、react-router 参数与 DocsAPI；版本页用 versionsFixture 的 Bridge 替身。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message, Notification } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { trackSave } from '@mycowork/ui/pages/office-editor/save-tracker.tsx';
import { editorText } from '@mycowork/ui/pages/office-editor/messages.ts';
import { VersionsPage } from '@mycowork/ui/pages/versions/index.ts';
import { OfficeEditSlot, OfficeTextEditSlot } from '@/renderer/mycowork-slots';
import { settleTracker } from './saveTrackerTeardown';
import { installBridge, json, RES } from './versionsFixture';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: 'eds_1', resourceId: 'res_1' }),
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
const text = editorText('zh-CN');
const body = () => document.body;
const wb = (outcome: string, over: object = {}) => ({
  relative_path: '方案.docx',
  outcome,
  saved_as: null,
  reason: null,
  ...over,
});
const closed = (status: string, writeback: object | null) => ({
  session_id: 'eds_1',
  resource_id: 'res_1',
  base_revision_id: 'rev_a',
  state: 'closed',
  saved_revision_id: 'rev_b',
  document_server_url: 'http://127.0.0.1:28090',
  editor_config: null,
  closing_at: null,
  reconcile: null,
  created_at: 't',
  updated_at: 't',
  workspace_writeback_status: status,
  workspace_writeback: writeback,
});
const failedView = closed('failed', wb('failed'));
const resyncBtn = () => screen.queryByTestId('writeback-resync') as HTMLButtonElement | null;
/** 会话读口固定 + 重新同步按顺序回答（最后一个答案重复）。 */
function serve(view: object, answers: (() => ReturnType<typeof reply> | Promise<ReturnType<typeof reply>>)[]) {
  let i = 0;
  const calls: string[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/bridge/v1/edit-sessions/eds_1' && !init?.method) return reply(200, view);
    if (url === '/bridge/v1/resources/res_1/workspace-writeback' && init?.method === 'POST') {
      calls.push(String(init.body));
      return answers[Math.min(i++, answers.length - 1)]!();
    }
    return reply(404, {});
  });
  return calls;
}
const written = () => reply(200, { revision_id: 'rev_b', workspace_writeback_status: 'written', workspace_writeback: wb('written') });
const stillFailed = () => reply(200, { revision_id: 'rev_b', workspace_writeback_status: 'failed', workspace_writeback: wb('failed') });
const conflicted = () =>
  reply(200, {
    revision_id: 'rev_b',
    workspace_writeback_status: 'conflict',
    workspace_writeback: wb('conflict', { saved_as: '方案.人工编辑-1.docx' }),
  });
const alreadySynced = () => reply(409, { error: { code: 'EDIT_STATE_CONFLICT', reason: 'already_synced' } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('DocsAPI', { DocEditor: vi.fn() });
  window.location.hash = '#/office/edit/eds_1';
  Message.clear();
  Notification.clear();
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await settleTracker();
});

describe('保存跟踪器的常驻通知', () => {
  it('failed 才有按钮；点了发空体 POST，处理中禁用，成功后同一条通知换成已同步且按钮消失', async () => {
    let release!: () => void;
    const calls = serve(failedView, [() => new Promise((r) => (release = () => r(written())))]);
    trackSave(text, 'eds_1');
    await waitFor(() => expect(body()).toHaveTextContent(text.writeFailed('方案.docx')));
    expect(resyncBtn()).toHaveTextContent(text.resync);
    fireEvent.click(resyncBtn()!);
    await waitFor(() => expect(resyncBtn()).toBeDisabled());
    expect(resyncBtn()).toHaveTextContent(text.resyncing);
    fireEvent.click(resyncBtn()!); // 处理中再点无效
    expect(calls).toEqual(['{}']);
    await act(async () => release());
    await waitFor(() => expect(body()).toHaveTextContent('已写回会话工作目录中的 方案.docx'));
    expect(resyncBtn()).toBeNull();
    expect(body()).not.toHaveTextContent(text.writeFailed('方案.docx'));
  });

  it('仍失败：通知保留、按钮恢复可再试；再点成功', async () => {
    serve(failedView, [stillFailed, written]);
    trackSave(text, 'eds_1');
    await waitFor(() => expect(resyncBtn()).not.toBeNull());
    fireEvent.click(resyncBtn()!);
    await waitFor(() => expect(body()).toHaveTextContent(text.resyncFailed));
    await waitFor(() => expect(resyncBtn()).toBeEnabled());
    expect(body()).toHaveTextContent(text.writeFailed('方案.docx'));
    fireEvent.click(resyncBtn()!);
    await waitFor(() => expect(body()).toHaveTextContent('已写回会话工作目录中的 方案.docx'));
  });

  it('请求出错（500）：保留按钮可再试；已同步（409）当作成功', async () => {
    serve(failedView, [() => reply(500, { error: { code: 'INTERNAL' } }), alreadySynced]);
    trackSave(text, 'eds_1');
    await waitFor(() => expect(resyncBtn()).not.toBeNull());
    fireEvent.click(resyncBtn()!);
    await waitFor(() => expect(body()).toHaveTextContent(text.failed('INTERNAL')));
    await waitFor(() => expect(resyncBtn()).toBeEnabled());
    fireEvent.click(resyncBtn()!);
    await waitFor(() => expect(body()).toHaveTextContent(text.resyncNoNeed));
    expect(resyncBtn()).toBeNull();
  });

  it('重新同步时文件被别人改过：换成冲突提示（另存名），不再有按钮', async () => {
    serve(failedView, [conflicted]);
    trackSave(text, 'eds_1');
    await waitFor(() => expect(resyncBtn()).not.toBeNull());
    fireEvent.click(resyncBtn()!);
    await waitFor(() => expect(body()).toHaveTextContent('另存为 方案.人工编辑-1.docx'));
    expect(resyncBtn()).toBeNull();
  });

  it.each([
    ['conflict', wb('conflict', { saved_as: '方案.人工编辑-1.docx' })],
    ['written', wb('written')],
    ['skipped', wb('skipped', { reason: 'secret' })],
  ])('%s 的提示没有重新同步按钮', async (status, writeback) => {
    serve(closed(status, writeback), [written]);
    trackSave(text, 'eds_1');
    await waitFor(() => expect(body()).toHaveTextContent(text.saved.replace('。', '')));
    await new Promise((r) => setTimeout(r, 100));
    expect(resyncBtn()).toBeNull();
  });

  it('英文文案', async () => {
    const en = editorText('en');
    serve(failedView, [written]);
    trackSave(en, 'eds_1');
    await waitFor(() => expect(resyncBtn()).toHaveTextContent('Sync again'));
  });
});

describe('ONLYOFFICE 编辑页结果态', () => {
  it('failed：结果页提示带按钮，点后换成已同步；没有对象的 failed 同样有', async () => {
    serve(closed('failed', null), [written]);
    render(<OfficeEditSlot />);
    await waitFor(() => expect(body()).toHaveTextContent(text.writeFailedAny));
    fireEvent.click(resyncBtn()!);
    await waitFor(() => expect(body()).toHaveTextContent('已写回会话工作目录中的 方案.docx'));
    expect(resyncBtn()).toBeNull();
    expect(body()).not.toHaveTextContent(text.writeFailedAny);
  });

  it('written 的结果页没有按钮', async () => {
    serve(closed('written', wb('written')), [written]);
    render(<OfficeEditSlot />);
    await waitFor(() => expect(body()).toHaveTextContent('已写回会话工作目录中的 方案.docx'));
    expect(resyncBtn()).toBeNull();
  });
});

describe('文本编辑页', () => {
  const run = async (status: string, writeback: object | null) => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/bridge/v1/text-edit-sessions')
        return reply(201, {
          session_id: 'txe_1',
          resource_id: 'res_1',
          base_revision_id: 'rev_a',
          format: 'markdown',
          file_name: 'notes.md',
          content: '# 周报\n',
          state: 'editing',
        });
      if (url.endsWith('/save'))
        return reply(200, {
          revision_id: 'rev_b',
          created: true,
          base_revision_id: 'rev_b',
          workspace_writeback_status: status,
          workspace_writeback: writeback,
        });
      if (url === '/bridge/v1/resources/res_1/workspace-writeback' && init?.method === 'POST')
        return reply(200, { revision_id: 'rev_b', workspace_writeback_status: 'written', workspace_writeback: wb('written', { relative_path: 'notes.md' }) });
      return reply(204, null);
    });
    render(<OfficeTextEditSlot />);
    const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# 周报\n改了\n' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
  };
  it('failed：写回提示带按钮，点后同一条换成已同步（“已保存为新版本”那条不动）', async () => {
    await run('failed', wb('failed', { relative_path: 'notes.md' }));
    await waitFor(() => expect(body()).toHaveTextContent('没能写回会话工作目录中的 notes.md'));
    fireEvent.click(resyncBtn()!);
    await waitFor(() => expect(body()).toHaveTextContent('已写回会话工作目录中的 notes.md'));
    expect(body()).toHaveTextContent('已保存为新版本。');
    expect(resyncBtn()).toBeNull();
  });
  it('conflict 的写回提示没有按钮', async () => {
    await run('conflict', wb('conflict', { relative_path: 'notes.md', saved_as: 'notes.人工编辑-1.md' }));
    await waitFor(() => expect(body()).toHaveTextContent('另存为 notes.人工编辑-1.md'));
    expect(resyncBtn()).toBeNull();
  });
});

describe('版本页顶部提示条（刷新后也有）', () => {
  const mount = () => render(<VersionsPage resourceId={RES} lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
  it('时间线 workspace_writeback_failed=true 才出现；点后 POST，重读时间线后提示条消失并提示结果', async () => {
    let failed = true;
    const b = installBridge({ total: 3, writebackFailed: () => failed, resync: () => ((failed = false), json({ revision_id: 'rev-3', workspace_writeback_status: 'written', workspace_writeback: wb('written', { relative_path: 'a.docx' }) })) });
    mount();
    const banner = await screen.findByTestId('writeback-resync-banner');
    expect(within(banner).getByText(text.resyncBanner)).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole('button', { name: text.resync }));
    await waitFor(() => expect(screen.queryByTestId('writeback-resync-banner')).toBeNull());
    expect(b.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/workspace-writeback'))).toHaveLength(1);
    await waitFor(() => expect(body()).toHaveTextContent('已写回会话工作目录中的 a.docx'));
  });
  it('workspace_writeback_failed=false 或旧后端没有该字段：没有提示条', async () => {
    installBridge({ total: 3 });
    mount();
    await screen.findByTestId('versions-preview');
    expect(screen.queryByTestId('writeback-resync-banner')).toBeNull();
  });
  it('仍失败：提示条保留，可再试', async () => {
    installBridge({ total: 3, writebackFailed: () => true, resync: () => json({ revision_id: 'rev-3', workspace_writeback_status: 'failed', workspace_writeback: wb('failed') }) });
    mount();
    const banner = await screen.findByTestId('writeback-resync-banner');
    fireEvent.click(within(banner).getByRole('button', { name: text.resync }));
    await waitFor(() => expect(body()).toHaveTextContent(text.resyncFailed));
    expect(screen.getByTestId('writeback-resync-banner')).toBeInTheDocument();
    expect(within(screen.getByTestId('writeback-resync-banner')).getByRole('button', { name: text.resync })).toBeEnabled();
  });
});
