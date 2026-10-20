/**
 * 文件：tests/unit/mycowork/conversationFileLink.dom.test.tsx
 * 职责：验证 Markdown 工作区链接复用项目预览、危险路径拒绝及跨项目竞态。
 * 边界：只替换预览承载上下文及 IPC/HTTP；路径识别、Markdown 和 Explorer payload 走真实实现。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/renderer/components/Markdown';
import { createPortal } from 'react-dom';
import { ConversationFileLink, conversationFilePath } from '@mycowork/ui';
import {
  resetCurrentProjectForTest,
  setCurrentProject,
} from '@/renderer/pages/conversation/explorer/currentProjectStore';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';

const h = vi.hoisted(() => ({
  project: vi.fn(),
  metadata: vi.fn(),
  read: vi.fn(),
  open: vi.fn(),
  browser: vi.fn(),
  external: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    project: { get: { invoke: h.project } },
    fs: { getContentMetadata: { invoke: h.metadata }, readContent: { invoke: h.read } },
  },
}));
vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  default: ({ children }: { children: React.ReactNode }) => <code>{children}</code>,
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => ({ openPreview: h.open, openBrowserTab: h.browser }),
}));
vi.mock('@/renderer/pages/conversation/explorer/monitorTransport', () => ({ initExplorerRuntime: () => ({}) }));
vi.mock('@/renderer/utils/platform', async (original) => ({ ...(await original()), openExternalUrl: h.external }));
vi.mock('@/renderer/services/clientBusinessSettings', () => ({ getClientBusinessSetting: async () => 1 }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }));

beforeEach(() => {
  resetCurrentProjectForTest();
  resetCurrentConversationForTest();
  setCurrentProject('p1');
  setCurrentConversation('c1');
  h.project.mockReset().mockResolvedValue({ project_id: 'p1', explorer: { workspace_pe_id: 'pe-current' } });
  h.metadata.mockReset().mockResolvedValue({ size: 500, lastModified: 12 });
  h.read.mockReset().mockResolvedValue('# 已生成');
  h.open.mockReset();
  h.browser.mockReset();
  h.external.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('安全相对文件链接', () => {
  it.each([
    'javascript:alert(1)',
    '/deck/c1/x.pptx',
    'file://deck/c1/x.pptx',
    'C:/deck/c1/x.pptx',
    '../deck/c1/x.pptx',
    'deck/../x.pptx',
    'deck/c1/../../x.pptx',
    'deck/c1/%2e%2e/x.pptx',
    'deck/c1/%252e%252e/x.pptx',
    'deck\\c1\\x.pptx',
    'deck/c1/x.pptx?download=1',
    'deck/c1/x.pptx#script',
    'deck//x.pptx',
    'deck/c1/',
    'deck/c1/%00x.pptx',
    'https://outside.test/deck/c1/x.pptx',
    'deck/c1/%zz.pptx',
    'deck',
    'deck/c1',
  ])('不把危险或不明确的路径当工作区文件：%s', (href) => {
    expect(conversationFilePath(href)).toBeNull();
  });

  it.each(['deck/c1/x.pptx', './deck/c1/最终稿.pptx', 'deck/c1/final%20deck.pptx'])(
    '接受明确的相对工作区文件：%s',
    (href) => {
      expect(conversationFilePath(href)).toBe(decodeURIComponent(href).replace(/^\.\//, ''));
    }
  );

  it('PPT 链接直接打开当前项目同一个 fileRef 的已有预览，不进入浏览器', async () => {
    render(<MarkdownView>{'[最终稿.pptx](deck/c1/最终稿.pptx)'}</MarkdownView>);
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '最终稿.pptx' }));
    await waitFor(() =>
      expect(h.open).toHaveBeenCalledWith(
        '',
        'ppt',
        expect.objectContaining({
          fileRef: { kind: 'project', pe_id: 'pe-current', relative_path: 'deck/c1/最终稿.pptx' },
          file_name: '最终稿.pptx',
        })
      )
    );
    expect(h.metadata).toHaveBeenCalledWith({
      file: { kind: 'project', pe_id: 'pe-current', relative_path: 'deck/c1/最终稿.pptx' },
    });
    expect(h.read).not.toHaveBeenCalled();
    expect(h.browser).not.toHaveBeenCalled();
    expect(h.external).not.toHaveBeenCalled();
  });

  it('过程 Markdown 链接沿同一 size/read gate 打开可编辑预览', async () => {
    render(<MarkdownView>{'[过程.md](deck/c1/process.md)'}</MarkdownView>);
    fireEvent.click(screen.getByRole('button', { name: '过程.md' }));
    await waitFor(() =>
      expect(h.open).toHaveBeenCalledWith(
        '# 已生成',
        'markdown',
        expect.objectContaining({ editable: true, lastModified: 12 })
      )
    );
    expect(h.read).toHaveBeenCalledWith({
      file: { kind: 'project', pe_id: 'pe-current', relative_path: 'deck/c1/process.md' },
      encoding: 'utf8',
    });
  });

  it('项目查询晚到时不在切换后的项目读取或打开旧文件', async () => {
    let resolve!: (value: unknown) => void;
    h.project.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<MarkdownView>{'[文件](deck/c1/x.pptx)'}</MarkdownView>);
    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    await act(async () => setCurrentProject('p2'));
    await act(async () => resolve({ project_id: 'p1', explorer: { workspace_pe_id: 'pe-old' } }));
    expect(h.metadata).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
  });

  it('预览读取晚到且会话已切换时不打开旧文件', async () => {
    let resolve!: (value: unknown) => void;
    h.metadata.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    render(<MarkdownView>{'[文件](deck/c1/x.pptx)'}</MarkdownView>);
    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    await waitFor(() => expect(h.metadata).toHaveBeenCalled());
    await act(async () => setCurrentConversation('c2'));
    await act(async () => resolve({ size: 500, lastModified: 12 }));
    expect(h.open).not.toHaveBeenCalled();
  });

  it('离开对话或查询返回别的项目时不打开预览', async () => {
    h.project.mockResolvedValue({ project_id: 'other', explorer: { workspace_pe_id: 'foreign' } });
    render(<MarkdownView>{'[文件](deck/c1/x.pptx)'}</MarkdownView>);
    fireEvent.click(screen.getByRole('button', { name: '文件' }));
    await act(async () => {});
    expect(h.metadata).not.toHaveBeenCalled();
    await act(async () => setCurrentConversation(null));
    expect(screen.getByRole('button', { name: '文件' })).toBeDisabled();
  });

  it('危险相对链接和脚本链接点击不打开文件或浏览器', async () => {
    render(
      <MarkdownView>
        {'[遍历](deck/c1/../x.pptx) [脚本](javascript:alert%281%29) [file](file://deck/c1/x.pptx)'}
      </MarkdownView>
    );
    fireEvent.click(screen.getByText('遍历'));
    fireEvent.click(screen.getByText('脚本'));
    fireEvent.click(screen.getByText('file'));
    await act(async () => {});
    expect(h.project).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
    expect(h.browser).not.toHaveBeenCalled();
    expect(h.external).not.toHaveBeenCalled();
  });

  it('普通 HTTPS 链接保留原浏览器入口', () => {
    render(<MarkdownView>{'[文档](https://example.test/docs)'}</MarkdownView>);
    fireEvent.click(screen.getByRole('link', { name: '文档' }));
    expect(h.browser).toHaveBeenCalledWith('https://example.test/docs');
    expect(h.project).not.toHaveBeenCalled();
  });
});

// Markdown 正文位于 Shadow DOM：文件入口必须自带样式，不能依赖外层 Arco CSS。
it('在消息 Shadow DOM 中呈现文件类型、预览说明及受控按钮', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const open = vi.fn();
  const mount = (disabled: boolean) =>
    createPortal(
      <ConversationFileLink disabled={disabled} onOpen={open} fileName='最终稿.pptx' lang='zh-CN'>
        最终稿.pptx
      </ConversationFileLink>,
      shadow
    );
  const { rerender, unmount } = render(mount(false));
  const card = within(shadow as unknown as HTMLElement).getByRole('button', { name: '最终稿.pptx' });
  expect(card).toHaveAttribute('type', 'button');
  expect(card).toHaveTextContent('PPTX · 点击预览');
  expect(shadow.querySelector('style')?.textContent).toContain('.mcw-conversation-file-card.arco-btn');
  fireEvent.click(card);
  expect(open).toHaveBeenCalledTimes(1);
  rerender(mount(true));
  fireEvent.click(card);
  expect(card).toBeDisabled();
  expect(open).toHaveBeenCalledTimes(1);
  unmount();
  host.remove();
});
