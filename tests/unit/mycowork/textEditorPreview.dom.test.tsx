/**
 * 文件：tests/unit/mycowork/textEditorPreview.dom.test.tsx
 * 职责：A63 文本编辑预览不自动读图片，代码保持源码，编辑保存保留原始引用。
 * 边界：通过真实 OfficeTextEditSlot 与 Markdown renderer；只替换 HTTP/IPC、CodeMirror、主题容器和图表运行时。
 * 关联：MyCowork PR07 plan §0.2；human-edit.md §3。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';

const boundary = vi.hoisted(() => ({
  remote: vi.fn(),
  local: vi.fn(),
  readContent: vi.fn(),
  mermaid: vi.fn(),
  wavedrom: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      fetchRemoteImage: { invoke: boundary.remote },
      getImageBase64: { invoke: boundary.local },
      readContent: { invoke: boundary.readContent },
    },
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'a63_fixture' }),
  useLocation: () => ({ pathname: '/' }),
}));
vi.mock('@/renderer/pages/conversation/Preview/components/editors', () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid='source-editor' value={value} onChange={(event) => onChange(event.target.value)} />
  ),
  CodeEditor: () => null,
}));
vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => null,
  usePreviewContext: () => ({ openPreview: vi.fn() }),
}));
vi.mock('@/renderer/hooks/ui/useTextSelection', () => ({
  useTextSelection: () => ({ selectedText: '', selectionPosition: null, clearSelection: vi.fn() }),
}));
vi.mock('@/renderer/pages/conversation/Preview/hooks/useScrollSyncHelpers', () => ({
  useContainerScroll: vi.fn(),
  useContainerScrollTarget: vi.fn(),
}));
vi.mock('@/renderer/components/Markdown/MermaidBlock', () => ({
  default: ({ code }: { code: string }) => {
    boundary.mermaid(code);
    return <div data-testid='active-mermaid'>{code}</div>;
  },
}));
vi.mock('@/renderer/components/Markdown/WavedromBlock', () => ({
  default: ({ code }: { code: string }) => {
    boundary.wavedrom(code);
    return <div data-testid='active-wavedrom'>{code}</div>;
  },
}));

import { OfficeTextEditSlot } from '@/renderer/mycowork-slots';

const fetchMock = vi.fn();
const response = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
function mount(content: string) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/text-edit-sessions')
      return response(201, {
        session_id: 'txe_a63',
        resource_id: 'a63_fixture',
        base_revision_id: 'rev_a',
        format: 'markdown',
        file_name: '虚构预览.md',
        content,
        state: 'editing',
      });
    if (url.endsWith('/save'))
      return response(200, {
        revision_id: 'rev_b',
        base_revision_id: 'rev_b',
        created: true,
        workspace_writeback: null,
      });
    return response(204, null);
  });
  render(<OfficeTextEditSlot />);
  return screen.findByTestId('text-editor-preview');
}
function expectNoImageReads() {
  expect(boundary.remote).not.toHaveBeenCalled();
  expect(boundary.local).not.toHaveBeenCalled();
  expect(boundary.readContent).not.toHaveBeenCalled();
}

describe('OfficeTextEditSlot preview privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    boundary.remote.mockResolvedValue('data:image/png;base64,AA==');
    boundary.local.mockResolvedValue('data:image/png;base64,AA==');
    window.location.hash = '';
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['HTTP', '![fixture](http://127.0.0.1:9/a63.png)'],
    ['HTTPS', '![fixture](https://a63.invalid/image.png)'],
    ['protocol relative', '![fixture](//a63.invalid/image.png)'],
    ['absolute path', '![fixture](/a63-fixture/image.png)'],
    ['relative path', '![fixture](./a63-fixture.png)'],
    ['parent path', '![fixture](../a63-fixture.png)'],
    ['file scheme', '![fixture](file:///a63-fixture/image.png)'],
    ['data scheme', '![fixture](data:image/png;base64,AA==)'],
    ['reference', '![fixture][asset]\n\n[asset]: https://a63.invalid/reference.png'],
  ])('%s image stays a placeholder without automatically reading bytes', async (_name, source) => {
    const preview = await mount(source);
    await waitFor(() => expect(preview).toHaveTextContent('fixture'));
    expectNoImageReads();
    expect(preview.querySelector('img')).toBeNull();
  });

  it('raw HTML does not become active image, script or frame elements', async () => {
    const preview = await mount(
      '<img src="https://a63.invalid/html.png"><iframe src="https://a63.invalid/"></iframe><script>alert(1)</script>'
    );
    expect(preview.querySelector('img, iframe, script')).toBeNull();
    expectNoImageReads();
  });

  it.each([
    ['mermaid', 'graph TD\nA@{ img: "https://a63.invalid/diagram.png", label: "fixture" }'],
    ['wavedrom', '{ "signal": [{ "name": "fixture", "wave": "01" }] }'],
    ['html', '<img src="https://a63.invalid/code.png">'],
    ['javascript', 'const fixture = "<iframe src="https://a63.invalid/">";'],
    ['latex', '\\frac{1}{2}'],
  ])('%s fence remains literal code without activating its renderer', async (language, source) => {
    const preview = await mount(`\`\`\`${language}\n${source}\n\`\`\``);
    const code = preview.querySelector(`pre > code.language-${language}`);
    expect(code?.textContent?.trimEnd()).toBe(source);
    expect(boundary.mermaid).not.toHaveBeenCalled();
    expect(boundary.wavedrom).not.toHaveBeenCalled();
    expect(preview.querySelector('img, iframe, svg')).toBeNull();
    expectNoImageReads();
  });

  it.each([
    ['fenced formula', '```math\n\\frac{1}{2}\n```'],
    ['remote formula image', '```math\n\\includegraphics{https://a63.invalid/fictional.png}\n```'],
    ['local formula image', '```math\n\\includegraphics{/a63-fixture/fictional.png}\n```'],
    [
      'untrusted formula HTML',
      '$\\href{https://a63.invalid/manual}{fixture}\\htmlStyle{background-image:url(https://a63.invalid/css.png)}{x}$',
    ],
  ])('%s only uses local formula layout without activating external content', async (name, source) => {
    const preview = await mount(source);
    if (name === 'fenced formula') {
      expect(preview.querySelector('.katex')).not.toBeNull();
      const changed = source + '\n本地公式原文保留（虚构）';
      fireEvent.change(screen.getByTestId('source-editor'), { target: { value: changed } });
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
      await screen.findByText('已保存为新版本。');
      const saved = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/save'));
      expect(JSON.parse(String(saved?.[1]?.body)).content).toBe(changed);
    }
    expect(preview.querySelector('img, iframe, script, a, button, [style*="background-image"]')).toBeNull();
    expectNoImageReads();
    expect(boundary.mermaid).not.toHaveBeenCalled();
    expect(boundary.wavedrom).not.toHaveBeenCalled();
  });

  it('keeps headings, emphasis, lists, tables and inline code readable', async () => {
    const preview = await mount(
      '# 虚构标题\n\n**重点** 与 `原文`\n\n- 条目\n\n| 名称 | 值 |\n| --- | --- |\n| 虚构 | 1 |'
    );
    expect(within(preview).getByRole('heading', { name: '虚构标题' })).toBeInTheDocument();
    expect(preview.querySelector('strong')).toHaveTextContent('重点');
    expect(preview.querySelector('li')).toHaveTextContent('条目');
    expect(preview.querySelector('table')).toHaveTextContent('虚构');
    expect(preview.querySelector('code')).toHaveTextContent('原文');
  });

  it('updates the preview and saves the complete source with its original image references', async () => {
    const source = '# 初稿\n\n![fixture](https://a63.invalid/original.png)\n';
    const preview = await mount(source);
    const changed = source + '\n**修改后的虚构正文**\n';
    fireEvent.change(screen.getByTestId('source-editor'), { target: { value: changed } });
    expect(preview.querySelector('strong')).toHaveTextContent('修改后的虚构正文');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await screen.findByText('已保存为新版本。');
    const saved = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/save'));
    expect(JSON.parse(String(saved?.[1]?.body))).toEqual({ expected_base_revision_id: 'rev_a', content: changed });
    expectNoImageReads();
  });
});
