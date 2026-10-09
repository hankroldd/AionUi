/**
 * [mycowork] ADR-0011: P09 candidate cards show the real template page (MyCowork PR05 slice i, A166, D210).
 * Only the Bridge boundary is mocked (fetch). Covers: the cover is an isolated iframe (sandbox exactly "allow-scripts",
 * no same-origin) holding the hardened HTML Bridge returned, labelled "not PowerPoint rendering"; loading, "no file to
 * preview" (422), failure with retry; the same asset version is fetched once however often the page re-renders.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
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
const decision = (ids: string[], pageNo = 1) => ({
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
      page_no: pageNo,
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

// 读请求的自动重试在用例里免等退避（产品默认 300/900 ms）
readRetry.delays = [0, 0];

describe('P09 candidate preview', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // 默认：卡片一出现就算进入视口（全局的 IntersectionObserver 桩永远不触发）；懒加载用例自行覆盖
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
        observe() {
          this.cb([{ isIntersecting: true }]);
        }
        disconnect() {}
      }
    );
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
    expect(screen.getByText('近似预览，与 PowerPoint 里的实际效果可能略有不同')).toBeInTheDocument();
    expect(screen.queryByText('预览待渲染')).toBeNull();
    expect(previewCalls('a1')).toBe(1);
  });

  it('says so when there is no file to preview (422) — no iframe, no placeholder picture', async () => {
    serve(['a2'], { a2: () => err(422, 'UNSUPPORTED_FORMAT') });
    render(<OfficeCompositionSlot />);
    expect(await screen.findByText('没有可预览的文件')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('.arco-skeleton-image')).toBeNull();
    expect(screen.queryByText('近似预览，与 PowerPoint 里的实际效果可能略有不同')).toBeNull();
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
    await waitFor(() => expect(previewCalls('a4')).toBe(1)); // 请求发出后 release 才有效（高负载下 effect 可能晚于文案）
    release(reply(200, '<html>x</html>'));
    await waitFor(() => expect(document.querySelector('iframe.mcw-tp-frame')).not.toBeNull());
  });

  it('gives a 404 / 409 a "preview unavailable" note and a 422 "no file" note — neither offers a retry', async () => {
    serve(['a7', 'a8', 'a9'], {
      a7: () => err(404, 'NOT_FOUND'),
      a8: () => err(409, 'ASSET_CHANGED'),
      a9: () => err(422, 'UNSUPPORTED_FORMAT'),
    });
    render(<OfficeCompositionSlot />);
    expect(await screen.findAllByText('预览暂不可用：模板文件已变化或读不到')).toHaveLength(2);
    expect(screen.getByText('没有可预览的文件')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });

  it('fetches a given asset version once while the page re-renders its cards (cards remount after choosing), not across page mounts', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return reply(201, { ...decision(['a5', 'a6'], 2), version: 2 }) // 页号变了 → 卡片整体重挂，只有缓存能避免再取;
      const m = /\/assets\/([^/]+)\/preview\?version=1$/.exec(url);
      return m ? reply(200, `<html>${m[1]}</html>`) : reply(200, decision(['a5', 'a6']));
    });
    const first = render(<OfficeCompositionSlot />);
    await waitFor(() => expect(document.querySelectorAll('iframe.mcw-tp-frame')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: '选这个结构' })[0] as HTMLElement);
    await screen.findByText('方案第 2 版');
    expect([previewCalls('a5'), previewCalls('a6')]).toEqual([1, 1]);
    first.unmount(); // 另一次页面（换账号必经）不复用上一页的缓存
    render(<OfficeCompositionSlot />);
    await waitFor(() => expect(previewCalls('a5')).toBe(2));
  });

  it('does not request a preview until its card scrolls into view', async () => {
    const observers: ((e: { isIntersecting: boolean }[]) => void)[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {}
      }
    );
    serve(['b1'], { b1: () => reply(200, '<html>b1</html>') });
    render(<OfficeCompositionSlot />);
    await screen.findByText('正在渲染预览…');
    await new Promise((r) => setTimeout(r, 50));
    expect(previewCalls('b1')).toBe(0);
    observers.forEach((cb) => cb([{ isIntersecting: true }]));
    await waitFor(() => expect(document.querySelector('iframe.mcw-tp-frame')).not.toBeNull());
    expect(previewCalls('b1')).toBe(1);
  });
});
