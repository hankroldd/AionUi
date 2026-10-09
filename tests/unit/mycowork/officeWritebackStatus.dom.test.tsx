/**
 * [mycowork] PR07 A343。文件：tests/unit/mycowork/officeWritebackStatus.dom.test.tsx
 * 职责：会话视图 / 文本保存返回的 `workspace_writeback_status` 七个取值在三处界面的显示——页面级保存跟踪器、ONLYOFFICE 编辑页结果态、
 *       文本编辑页：pending（正在同步到 AI 的工作目录，不说已完成）/ written / conflict / failed（含无对象）/ skipped / not_applicable（不提 AI 工作目录）/
 *       none（没有改动 / 内容没变）；旧后端（没有该字段）退回按 workspace_writeback 有无判断。
 * 边界：只替换 fetch（Bridge）、react-router 参数与 DocsAPI；跟踪器用真实 800ms 节拍。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Message, Notification } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { trackSave } from '@mycowork/ui/pages/office-editor/save-tracker.tsx';
import { editorText } from '@mycowork/ui/pages/office-editor/messages.ts';
import { OfficeEditSlot, OfficeTextEditSlot } from '@/renderer/mycowork-slots';
import { settleTracker } from './saveTrackerTeardown';

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
const session = (state: string, over: object = {}) => ({
  session_id: 'eds_1',
  resource_id: 'res_1',
  base_revision_id: 'rev_a',
  state,
  saved_revision_id: null,
  document_server_url: 'http://127.0.0.1:28090',
  editor_config: state === 'closed' ? null : { document: { key: 'k1' }, editorConfig: { mode: 'edit' }, token: 't' },
  closing_at: null,
  reconcile: null,
  created_at: 't',
  updated_at: 't',
  ...over,
});
/** 七个取值各自的会话视图（state + 新字段）和界面应出现 / 不应出现的文字。 */
const CASES: { name: string; view: object; has: string[]; not: string[] }[] = [
  {
    name: 'pending',
    view: session('closing', {
      saved_revision_id: null,
      workspace_writeback_status: 'pending',
      workspace_writeback: null,
    }),
    has: [text.syncing],
    not: ['已保存为新版本', '正在保存…'],
  },
  {
    name: 'written',
    view: session('closed', {
      saved_revision_id: 'rev_b',
      workspace_writeback_status: 'written',
      workspace_writeback: wb('written'),
    }),
    has: ['已保存为新版本。', '已写回会话工作目录中的 方案.docx'],
    not: [],
  },
  {
    name: 'conflict',
    view: session('closed', {
      saved_revision_id: 'rev_b',
      workspace_writeback_status: 'conflict',
      workspace_writeback: wb('conflict', { saved_as: '方案.人工编辑-1.docx' }),
    }),
    has: ['另存为 方案.人工编辑-1.docx'],
    not: [],
  },
  {
    name: 'failed（有对象）',
    view: session('closed', {
      saved_revision_id: 'rev_b',
      workspace_writeback_status: 'failed',
      workspace_writeback: wb('failed'),
    }),
    has: ['没能写回会话工作目录中的 方案.docx'],
    not: [],
  },
  {
    name: 'failed（落记录前出错，没有对象）',
    view: session('closed', {
      saved_revision_id: 'rev_b',
      workspace_writeback_status: 'failed',
      workspace_writeback: null,
    }),
    has: [text.writeFailedAny],
    not: [],
  },
  {
    name: 'skipped',
    view: session('closed', {
      saved_revision_id: 'rev_b',
      workspace_writeback_status: 'skipped',
      workspace_writeback: wb('skipped', { reason: 'secret' }),
    }),
    has: ['因是 Secret，未写回 AI 工作目录'],
    not: [],
  },
  {
    name: 'not_applicable',
    view: session('closed', {
      saved_revision_id: 'rev_b',
      workspace_writeback_status: 'not_applicable',
      workspace_writeback: null,
    }),
    has: ['已保存为新版本。'],
    not: ['工作目录', '写回', '同步'],
  },
  {
    name: 'none（没有改动）',
    view: session('closed', { saved_revision_id: null, workspace_writeback_status: 'none', workspace_writeback: null }),
    has: ['没有改动'],
    not: ['已保存为新版本', '工作目录'],
  },
  {
    name: 'none（同字节保存）',
    view: session('closed', {
      saved_revision_id: 'rev_a',
      workspace_writeback_status: 'none',
      workspace_writeback: null,
    }),
    has: ['内容没有变化，未新增版本'],
    not: ['已保存为新版本', '工作目录'],
  },
  {
    name: '旧后端（没有新字段）：有对象照旧，无对象只说已保存',
    view: session('closed', { saved_revision_id: 'rev_b', workspace_writeback: wb('written') }),
    has: ['已写回会话工作目录中的 方案.docx'],
    not: [],
  },
  {
    name: '旧后端（没有新字段、没有对象）',
    view: session('closed', { saved_revision_id: 'rev_b' }),
    has: ['已保存为新版本。'],
    not: ['工作目录', '同步'],
  },
];
const serve = (view: object) =>
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
    url === '/bridge/v1/edit-sessions/eds_1' && !init?.method ? reply(200, view) : reply(404, {})
  );

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

describe('保存跟踪器', () => {
  it.each(CASES)('$name', async ({ view, has, not }) => {
    serve(view);
    trackSave(text, 'eds_1');
    for (const t of has) await waitFor(() => expect(body()).toHaveTextContent(t), { timeout: 3000 });
    for (const t of not) expect(body()).not.toHaveTextContent(t);
  });
});

describe('ONLYOFFICE 编辑页结果态', () => {
  it.each(CASES)('$name', async ({ view, has, not }) => {
    serve(view);
    render(<OfficeEditSlot />);
    for (const t of has) await waitFor(() => expect(body()).toHaveTextContent(t), { timeout: 3000 });
    for (const t of not) expect(body()).not.toHaveTextContent(t);
  });
});

describe('文本编辑页（保存返回）', () => {
  const save = (over: object) => {
    fetchMock.mockImplementation(async (url: string) => {
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
        return reply(200, { revision_id: 'rev_b', created: true, base_revision_id: 'rev_b', ...over });
      return reply(204, null);
    });
  };
  const run = async () => {
    render(<OfficeTextEditSlot />);
    const editor = (await screen.findByTestId('md-editor')) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# 周报\n改了\n' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
  };
  it.each([
    [
      'written',
      wb('written', { relative_path: 'notes.md' }),
      ['已保存为新版本。', '已写回会话工作目录中的 notes.md'],
      [],
    ],
    [
      'conflict',
      wb('conflict', { relative_path: 'notes.md', saved_as: 'notes.人工编辑-1.md' }),
      ['另存为 notes.人工编辑-1.md'],
      [],
    ],
    ['failed', wb('failed', { relative_path: 'notes.md' }), ['没能写回会话工作目录中的 notes.md'], []],
    ['failed', null, [text.writeFailedAny], []],
    ['skipped', wb('skipped', { reason: 'secret' }), ['因是 Secret，未写回 AI 工作目录'], []],
    ['not_applicable', null, ['已保存为新版本。'], ['工作目录', '写回']],
  ])('%s', async (status, writeback, has, not) => {
    save({ workspace_writeback_status: status, workspace_writeback: writeback });
    await run();
    for (const t of has as string[]) await waitFor(() => expect(body()).toHaveTextContent(t));
    for (const t of not as string[]) expect(body()).not.toHaveTextContent(t);
  });
  it('none：内容没变，只说没有变化；旧后端无字段无对象：只说已保存', async () => {
    save({ created: false, workspace_writeback_status: 'none', workspace_writeback: null });
    await run();
    await waitFor(() => expect(body()).toHaveTextContent('内容没有变化，未新增版本。'));
    expect(body()).not.toHaveTextContent('工作目录');
    cleanup();
    save({ workspace_writeback: null });
    await run();
    await waitFor(() => expect(body()).toHaveTextContent('已保存为新版本。'));
    expect(body()).not.toHaveTextContent('工作目录');
  });
});
