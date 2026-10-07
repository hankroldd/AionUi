/**
 * [mycowork] ADR-0011: P09 candidate cards show the real template page (MyCowork PR05 slice i, A166, D210).
 * Only the Bridge boundary is mocked (fetch). Covers: the cover is an isolated iframe (sandbox exactly "allow-scripts",
 * no same-origin) holding the hardened HTML Bridge returned, labelled "not PowerPoint rendering"; loading, "no file to
 * preview" (422), failure with retry; the same asset version is fetched once however often the page re-renders.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeCompositionSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ decisionId: 'dec_1' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const err = (status: number, code: string) => reply(status, { error: { code, message: 'x' } });
const candidate = (id: string) => ({
  asset_id: id,
  version: 1,
  title: `模板 ${id}`,
  structure: id,
  reasons: [{ code: 'relation_match', text: '适合“并列要点”' }],
  limits: [{ code: 'preview_pending', text: '预览待渲染' }],
  preview: { state: 'pending', render_profile: null },
});
const decision = (ids: string[]) => ({
  decision_id: 'dec_1',
  version: 1,
  mode: 'confirm',
  status: 'awaiting_confirmation',
  output_format: 'pptx',
  aspect: '16:9',
  constraints: { native_editable: true, keep_master: true, allow_split: true },
  theme: null,
  theme_excluded: [],
  fallbacks: [],
  message: null,
  created_at: 't',
  pages: [
    {
      page_no: 1,
      intent: '三项成果',
      relation: 'parallel',
      facts: [],
      facts_sha256: 'f1',
      status: 'awaiting_confirmation',
      selected: null,
      candidates: ids.map(candidate),
      excluded: [],
      fallbacks: [],
      message: null,
    },
  ],
});
/** 路由：决策读取 + 各资产的预览应答。 */
const serve = (ids: string[], previews: Record<string, () => unknown>) =>
  fetchMock.mockImplementation(async (url: string) => {
    const m = /\/assets\/([^/]+)\/preview\?version=1$/.exec(url);
    return m ? previews[decodeURIComponent(m[1] as string)]?.() : reply(200, decision(ids));
  });
const previewCalls = (id: string) =>
  fetchMock.mock.calls.filter(([u]) => String(u) === `/bridge/v1/assets/${id}/preview?version=1`).length;

describe('P09 candidate preview', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the returned page in an isolated iframe (allow-scripts only), labelled not PowerPoint', async () => {
    serve(['a1'], { a1: () => reply(200, '<html><body>三项成果（虚构）</body></html>') });
    render(<OfficeCompositionSlot />);
    const frame = await waitFor(() => {
      const f = document.querySelector('iframe.mcw-tp-frame');
      expect(f).not.toBeNull();
      return f as HTMLIFrameElement;
    });
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts'); // 无 allow-same-origin：脚本读不到宿主 cookie 与页面
    expect(frame.getAttribute('srcdoc')).toContain('三项成果（虚构）');
    expect(frame.getAttribute('src')).toBeNull();
    expect(screen.getByText('OfficeCLI 近似渲染，非 PowerPoint 渲染')).toBeInTheDocument();
    expect(screen.queryByText('预览待渲染')).toBeNull();
    expect(previewCalls('a1')).toBe(1);
  });

  it('says so when there is no file to preview (422) — no iframe, no placeholder picture', async () => {
    serve(['a2'], { a2: () => err(422, 'UNSUPPORTED_FORMAT') });
    render(<OfficeCompositionSlot />);
    expect(await screen.findByText('没有可预览的文件')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('.arco-skeleton-image')).toBeNull();
    expect(screen.queryByText('OfficeCLI 近似渲染，非 PowerPoint 渲染')).toBeNull();
  });

  it('shows loading, then a failure with retry that fetches again and recovers', async () => {
    let calls = 0;
    serve(['a3'], { a3: () => (++calls === 1 ? err(503, 'UPSTREAM_UNAVAILABLE') : reply(200, '<html>ok</html>')) });
    render(<OfficeCompositionSlot />);
    expect(await screen.findByText('预览加载失败')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(document.querySelector('iframe.mcw-tp-frame')).not.toBeNull());
    expect(previewCalls('a3')).toBe(2);
  });

  it('shows a loading note while the preview is rendering', async () => {
    let release: (v: unknown) => void = () => {};
    serve(['a4'], { a4: () => new Promise((r) => (release = r)) });
    render(<OfficeCompositionSlot />);
    expect(await screen.findByText('正在渲染预览…')).toBeInTheDocument();
    release(reply(200, '<html>x</html>'));
    await waitFor(() => expect(document.querySelector('iframe.mcw-tp-frame')).not.toBeNull());
  });

  it('fetches a given asset version once, however often the cards re-render', async () => {
    serve(['a5', 'a6'], { a5: () => reply(200, '<html>5</html>'), a6: () => reply(200, '<html>6</html>') });
    const { rerender } = render(<OfficeCompositionSlot />);
    await waitFor(() => expect(document.querySelectorAll('iframe.mcw-tp-frame')).toHaveLength(2));
    rerender(<OfficeCompositionSlot />);
    expect([previewCalls('a5'), previewCalls('a6')]).toEqual([1, 1]);
  });
});
