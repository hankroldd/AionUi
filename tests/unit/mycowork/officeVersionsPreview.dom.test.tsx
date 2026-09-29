/**
 * [mycowork] D138: the versions page (MyCowork P12) shows a read-only preview of the current version under the comparison.
 * Only the Bridge boundary is mocked (fetch). Covers: the preview is there as soon as the page opens (Office → Bridge-rendered
 * HTML in an iframe that may run scripts but is not same-origin); the right side is an Arco vertical split (comparison on top,
 * preview below) that the narrow-screen CSS stacks instead; failures say why (retry when it can help, "download original" when the
 * format cannot be previewed); md goes through the renderer passed by the slot and never the preview MarkdownViewer (whose
 * selection toolbar offers "add to chat"), txt is shown as-is, other formats are explained without a request; an open online-edit
 * session shows "editing"; a new current version re-renders the preview; a Secret resource is previewed only through the
 * signed-in Bridge read routes — nothing goes to MCP, AionUi APIs or the conversation. Review fixes: markdown images are never
 * loaded (placeholder instead: a remote image would reveal the reader, a path would be read from this machine) and refresh is
 * disabled while a preview is loading.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeVersionsSlot } from '@/renderer/mycowork-slots';

const markdownViewer = vi.hoisted(() => vi.fn(() => null));
vi.mock('@/renderer/pages/conversation/Preview/components/viewers', async (orig) => ({
  ...(await orig<object>()),
  MarkdownViewer: markdownViewer,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const page = (body: string) => ({ ...reply(200, null), text: async () => body });
const rev = (id: string, current = false) => ({
  revision_id: id,
  parent_id: null,
  content_sha256: 'x',
  size: 1,
  created_at: '2025-03-02T01:00:00.000Z',
  origin: 'edit',
  current,
});
type Opts = {
  fileName?: string;
  secret?: boolean;
  editing?: boolean;
  preview?: () => unknown; // office/html 或 preview 的回复
};
const heads = ['rev_b']; // 每次读时间线取第一个作当前版本；刷新测试会压入新版本
function bridge(opts: Opts = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/revisions')) {
      const head = heads[0] ?? 'rev_b';
      return reply(200, {
        resource_id: 'res_1',
        current_revision_id: head,
        file_name: opts.fileName ?? '汇报（虚构）.pptx',
        items: [rev(head, true), rev('rev_a')],
        page: 1,
        page_size: 50,
        total: 2,
      });
    }
    if (url.endsWith('/office/html') || url.endsWith('/preview'))
      return opts.preview?.() ?? page('<html><head></head><body><p>第一页（虚构）</p></body></html>');
    if (url === '/bridge/v1/edit-sessions')
      return reply(200, {
        items: opts.editing ? [{ session_id: 'eds_1', resource_id: 'res_1', state: 'editing' }] : [],
        next_page: null,
      });
    if (url.endsWith('/metadata'))
      return reply(200, { resource_id: 'res_1', metadata_revision: 1, tag_ids: [], secret: opts.secret === true });
    if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [], page: 1, page_size: 50, total: 0 });
    return reply(404, {});
  });
}
// AionUi 的 MarkdownView 渲染在 Shadow DOM 里：连同各 shadowRoot 一起取文字
const deepText = (el: Element): string =>
  [el.shadowRoot ? deepText(el.shadowRoot as unknown as Element) : '', ...Array.from(el.children).map(deepText)].join(
    ' '
  ) + (el.children.length === 0 ? (el.textContent ?? '') : '');
const deepAll = (el: Element | ShadowRoot, sel: string): Element[] => [
  ...Array.from(el.querySelectorAll(sel)),
  ...Array.from(el.querySelectorAll('*')).flatMap((c) => (c.shadowRoot ? deepAll(c.shadowRoot, sel) : [])),
];
const deepHeadings = (el: Element | ShadowRoot): string[] => [
  ...Array.from(el.querySelectorAll('h1')).map((h) => h.textContent ?? ''),
  ...Array.from(el.querySelectorAll('*')).flatMap((c) => (c.shadowRoot ? deepHeadings(c.shadowRoot) : [])),
];
const urls = () => fetchMock.mock.calls.map(([url]) => String(url));
// 时间线读到之前右下是同一 testid 的骨架占位；等到带标题的预览本体
const preview = async () =>
  (await screen.findByText(/^当前版本预览 · v\d$/)).closest('[data-testid="versions-preview"]') as HTMLElement;

describe('OfficeVersionsSlot — current version preview (D138)', () => {
  beforeEach(() => {
    heads.splice(0, heads.length, 'rev_b');
    fetchMock.mockReset();
    markdownViewer.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens with the current version previewed read-only: Bridge-rendered HTML in a script-only sandboxed iframe', async () => {
    bridge();
    render(<OfficeVersionsSlot />);
    const box = await preview();
    const frame = await waitFor(() => {
      const f = box.querySelector('iframe');
      expect(f).not.toBeNull();
      return f as HTMLIFrameElement;
    });
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts'); // 不带 allow-same-origin：碰不到 AionUi 的 cookie 与页面
    expect(frame.getAttribute('srcdoc')).toContain('第一页（虚构）');
    expect(within(box).getByText('当前版本预览 · v2')).toBeInTheDocument();
    expect(within(box).getByText('只读')).toBeInTheDocument();
    expect(urls()).toContain('/bridge/v1/resources/res_1/office/html');
  });

  it('splits the right side top/bottom: comparison above, preview below, draggable; narrow screens stack them', async () => {
    bridge();
    const { container } = render(<OfficeVersionsSlot />);
    await preview();
    const split = container.querySelector('.arco-resizebox-split-vertical') as HTMLElement;
    expect(split).not.toBeNull();
    expect(split.querySelector('.first-pane [data-testid="versions-compare"]')).not.toBeNull();
    expect(split.querySelector('.second-pane [data-testid="versions-preview"]')).not.toBeNull();
    expect(split.querySelector('.arco-resizebox-split-trigger')).not.toBeNull();
    // jsdom 不算媒体查询：核对样式表里 <768 的规则确实让两块按内容高度堆叠、隐藏拖动条（真实布局见 390 宽截图）
    const css = readFileSync(join(process.env.MYCOWORK_UI_DIR ?? '', 'pages/versions/versions.css'), 'utf8');
    const narrow = css.slice(css.indexOf('@media (max-width: 767px)'));
    expect(narrow).toMatch(/\.mcw-ver-split > \.arco-resizebox-split-pane \{[^}]*flex-basis: auto !important/);
    expect(narrow).toMatch(/\.mcw-ver-split > \.arco-resizebox-split-trigger \{\s*display: none;/);
  });

  it('says why a preview failed: retry when it can help, "download original" when the format cannot be previewed', async () => {
    let status = 503;
    bridge({ preview: () => reply(status, { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } }) });
    const { unmount } = render(<OfficeVersionsSlot />);
    const box = await preview();
    expect(
      await within(box).findByText('预览工具未配置或暂不可用，请稍后重试；文件本身不受影响。')
    ).toBeInTheDocument();
    status = 200;
    bridge();
    fireEvent.click(within(box).getByRole('button', { name: '重试' }));
    await waitFor(() => expect(box.querySelector('iframe')).not.toBeNull());
    unmount();
    bridge({
      preview: () => reply(422, { error: { code: 'UNSUPPORTED_FORMAT', message: 'preflight: legacy_format' } }),
    });
    render(<OfficeVersionsSlot />);
    const again = await preview();
    expect(await within(again).findByText(/旧版格式/)).toBeInTheDocument();
    expect(within(again).queryByRole('button', { name: '重试' })).toBeNull();
    expect(within(again).getByText('下载原件').closest('a')?.getAttribute('href')).toBe(
      '/bridge/v1/resources/res_1/preview'
    );
  });

  it('md uses the renderer passed by the slot (never the preview MarkdownViewer), txt is shown as-is, pdf is explained', async () => {
    bridge({ fileName: '周报（虚构）.md', preview: () => page('# 周报标题（虚构）\n\n正文') });
    const { unmount } = render(<OfficeVersionsSlot />);
    const box = await preview();
    await waitFor(() => expect(deepHeadings(box)).toContain('周报标题（虚构）')); // 按 Markdown 渲染成标题
    expect(markdownViewer).not.toHaveBeenCalled(); // 它的选区工具条有“添加到会话”
    expect(urls()).toContain('/bridge/v1/resources/res_1/preview');
    expect(urls()).not.toContain('/bridge/v1/resources/res_1/office/html');
    unmount();
    bridge({ fileName: '说明（虚构）.txt', preview: () => page('# 不是标题\n第二行') });
    const r2 = render(<OfficeVersionsSlot />);
    expect((await within(await preview()).findByText(/# 不是标题/)).tagName).toBe('PRE');
    r2.unmount();
    fetchMock.mockClear();
    bridge({ fileName: '合同（虚构）.pdf' });
    render(<OfficeVersionsSlot />);
    expect(await within(await preview()).findByText(/暂不支持预览 \.pdf 文件/)).toBeInTheDocument();
    expect(urls().filter((u) => u.includes('/office/html') || u.endsWith('/preview'))).toEqual([]);
  });

  it('md images are never loaded: remote, local-path and inline ones all show a placeholder (review F3)', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    bridge({
      fileName: '配图（虚构）.md',
      preview: () =>
        page(
          `# 配图（虚构）\n\n![外链图](https://example.invalid/t.png)\n\n![本机图](/etc/x.png)\n\n![相对图](img/a.png)\n\n![内嵌图](${png})`
        ),
    });
    render(<OfficeVersionsSlot />);
    const box = await preview();
    await waitFor(() => expect(deepHeadings(box)).toContain('配图（虚构）'));
    expect(deepAll(box, 'img')).toEqual([]); // 外链不请求；路径不交给 LocalImageView 读本机文件（data: 已被 urlTransform 去掉）
    for (const alt of ['外链图', '本机图', '相对图', '内嵌图'])
      expect(deepText(box)).toContain(`［图片：${alt}——预览不加载图片］`);
  });

  it('refresh is disabled while the preview is loading (review F4)', async () => {
    let finish: ((v: unknown) => void) | undefined;
    bridge({ preview: () => new Promise((r) => (finish = r)) });
    render(<OfficeVersionsSlot />);
    const box = await preview();
    const refresh = await within(box).findByRole('button', { name: '刷新预览' });
    await waitFor(() => expect(refresh).toBeDisabled());
    finish?.(page('<html><head></head><body>第一页（虚构）</body></html>'));
    await waitFor(() => expect(box.querySelector('iframe')).not.toBeNull());
    expect(within(box).getByRole('button', { name: '刷新预览' })).toBeEnabled();
  });

  it('marks an open online-edit session as "editing" and re-renders the preview when the current version changes', async () => {
    bridge({ editing: true });
    render(<OfficeVersionsSlot />);
    const box = await preview();
    expect(await within(box).findByText('编辑中')).toBeInTheDocument();
    expect(within(box).getByText(/这里显示最近一次保存的版本/)).toBeInTheDocument();
    await waitFor(() => expect(box.querySelector('iframe')).not.toBeNull());
    heads.unshift('rev_c'); // 在线编辑保存登记了新版本
    bridge({ preview: () => page('<html><head></head><body>第二版（虚构）</body></html>') });
    fireEvent.click(within(box).getByRole('button', { name: '刷新预览' }));
    expect(await within(box).findByText('当前版本预览 · v2')).toBeInTheDocument(); // 新时间线仍两条：新 head 为 v2
    await waitFor(() => expect(box.querySelector('iframe')?.getAttribute('srcdoc')).toContain('第二版（虚构）'));
    expect(within(box).queryByText('编辑中')).toBeNull();
  });

  it('previews a Secret resource for its owner only through signed-in Bridge read routes, never an AI channel (D119)', async () => {
    bridge({ secret: true, fileName: '机密（虚构）.md', preview: () => page('机密正文（虚构）') });
    render(<OfficeVersionsSlot />);
    const box = await preview();
    await waitFor(() => expect(deepText(box)).toContain('机密正文（虚构）'));
    expect(markdownViewer).not.toHaveBeenCalled();
    const sent = urls();
    expect(sent.filter((u) => /\/bridge\/mcp|\/api\/|\/conversations\/|\/context-plans/.test(u))).toEqual([]);
    expect(sent.every((u) => u.startsWith('/bridge/v1/'))).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET')).toEqual([]); // 预览不写
  });
});
