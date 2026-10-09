/**
 * [mycowork] 体验片 C：读失败有出路、全部采用有进度。
 * 职责：页面计划读失败 → Result + “重试”；“全部采用首选”显示“已采用 n / N”，中途失败停在失败页并给“继续”，已成功的页不重做；
 *       空间预览读不到当前版本 → 置灰的“在线编辑”+ Tooltip 说明并可点击重试；删库第一步读不到资料数 → “重试”。
 * 边界：真实组件与 Arco，只用虚构 Bridge 边界（fetch）。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
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

// ---- 页面计划：3 页，每页一个候选；服务端按提交记录已选页 ----
const candidate = (id: string) => ({
  asset_id: id,
  version: 1,
  title: `版式-${id}`,
  structure: '左图右文',
  reasons: [],
  limits: [],
  preview: { state: 'pending', render_profile: null },
});
let selected: number[];
const decision = (version: number) => ({
  decision_id: `dec_${version}`,
  version,
  mode: 'confirm',
  status: selected.length === 3 ? 'selected' : 'awaiting_confirmation',
  output_format: 'pptx',
  aspect: '16:9',
  constraints: { native_editable: true, keep_master: true, allow_split: true },
  theme: { asset_id: 'theme.a', version: 1, title: '蓝色简洁（虚构）' },
  theme_excluded: [],
  fallbacks: [],
  message: null,
  created_at: 't',
  pages: [1, 2, 3].map((n) => ({
    page_no: n,
    intent: `第${n}页意图`,
    relation: 'comparison',
    facts: [],
    facts_sha256: `f${n}`,
    status: selected.includes(n) ? 'selected' : 'awaiting_confirmation',
    selected: selected.includes(n) ? { asset_id: `pat.${n}`, version: 1 } : null,
    candidates: [candidate(`pat.${n}`)],
    excluded: [],
    fallbacks: [],
    message: null,
  })),
});
const choices = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('页面计划', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    selected = [];
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('读失败：显示错误页和“重试”，点后重新读取并显示页面计划', async () => {
    let ok = false;
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/preview') ? reply(200, '<html></html>') : ok ? reply(200, decision(1)) : reply(500, { error: { code: 'X' } })
    );
    render(<OfficeCompositionSlot />);
    const retry = await screen.findByRole('button', { name: '重试' });
    expect(screen.getByText('读不到页面计划')).toBeInTheDocument();
    ok = true;
    fireEvent.click(retry);
    expect(await screen.findByText('第1页意图')).toBeInTheDocument();
  });

  it('全部采用首选：显示已采用 n / N；第 2 页失败后停下，按钮变“继续”，继续只提交第 2、3 页', async () => {
    let failPage2 = true;
    let gate: (() => void) | undefined;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/preview')) return reply(200, '<html></html>');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { page_no: number };
        if (body.page_no === 2 && failPage2) {
          await new Promise<void>((r) => (gate = r)); // 停在第 2 页，让界面显示“已采用 1 / 3”
          failPage2 = false;
          return reply(500, { error: { code: 'X', message: 'boom' } });
        }
        selected.push(body.page_no);
        return reply(201, decision(selected.length + 1));
      }
      return reply(200, decision(selected.length + 1));
    });
    render(<OfficeCompositionSlot />);
    await screen.findByText('第1页意图');
    fireEvent.click(screen.getByRole('button', { name: '全部采用首选' }));
    await screen.findByRole('button', { name: '已采用 1 / 3' });
    await act(async () => gate?.());
    const cont = await screen.findByRole('button', { name: '继续（从第 2 页）' });
    expect(choices().map(([, i]) => JSON.parse(String(i?.body)).page_no)).toEqual([1, 2]);
    fireEvent.click(cont);
    await waitFor(() => expect(choices()).toHaveLength(4));
    expect(choices().map(([, i]) => JSON.parse(String(i?.body)).page_no)).toEqual([1, 2, 2, 3]); // 第 1 页没有重做
    await waitFor(() => expect(screen.queryByRole('button', { name: /继续（从第/ })).toBeNull());
  });
});

// ---- 空间预览 / 删库：读失败的出路 ----
const rows = [
  {
    resource_id: 'res_md',
    file_name: '周报.md',
    source_id: null,
    origin: 'imports',
    state: 'stored',
    tag_ids: [],
    secret: false,
    can_mark_secret: true,
    revision_count: 2,
    updated_at: '2026-10-04T00:00:00Z',
  },
];
const timeline = {
  resource_id: 'res_md',
  current_revision_id: 'rev_head',
  file_name: '周报.md',
  items: [{ revision_id: 'rev_head', origin: 'original', current: true, created_at: '2026-10-04T00:00:00.000Z' }],
};

describe('空间预览：在线编辑读不到当前版本', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = '#/office/space';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('读不到版本：按钮可点（不是 aria-disabled），名字写明“读取失败，点击重试”；重读时保留按钮并显示加载，读到后变回在线编辑', async () => {
    let timelineOk = false;
    let gate: (() => void) | undefined;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
      if (url === '/bridge/v1/saved-views') return reply(200, { views: [] });
      if (url === '/bridge/v1/collections') return reply(200, { collections: [] });
      if (url.startsWith('/bridge/v1/resources?')) return reply(200, { items: rows, page: 1, page_size: 50, total: 1 });
      if (url.endsWith('/revisions')) {
        if (!timelineOk) return reply(500, { error: { code: 'X' } });
        await new Promise<void>((r) => (gate = r));
        return reply(200, timeline);
      }
      if (/\/(office\/html|preview)$/.test(url))
        return { status: 200, ok: true, text: async () => '<html><body>x</body></html>', json: async () => null };
      return reply(204, null);
    });
    render(<ResourcesPage lang="zh-CN" ownerKey="fixture_a" />);
    fireEvent.click(await screen.findByRole('button', { name: '周报.md' }));
    const dialog = await screen.findByRole('dialog', { name: '当前内容预览' });
    const edit = await within(dialog).findByRole('button', { name: '在线编辑（读取失败，点击重试）' });
    expect(edit).not.toHaveAttribute('aria-disabled');
    expect(edit).toBeEnabled();
    timelineOk = true;
    fireEvent.click(edit);
    const loading = await within(dialog).findByRole('button', { name: /在线编辑/ });
    await waitFor(() => expect(loading.className).toContain('arco-btn-loading')); // 重读中按钮还在
    await act(async () => gate?.());
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '在线编辑' })).toBeInTheDocument());
  });
});
