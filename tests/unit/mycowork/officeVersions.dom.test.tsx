/**
 * [mycowork] ADR-0011: `/office/resources/:resourceId/versions` (MyCowork P12 versions, PR08 slice 6; UI polish PR11).
 * Only the Bridge boundary is mocked (fetch). Covers: the timeline grouped by local day (今天 / 昨天 / cross-year date) with local
 * clock times instead of ISO strings, vN, current/origin/restored-from and publication badges; the page opens on the
 * "previous → current" comparison by itself (D130, one OfficeCLI call) and any other pair only when asked;
 * comparing two versions shows the partial notice "已保存 vN" (02 §7) with "看原件", change counts, grouped changes with localized
 * aspects, and folded uncovered items with localized reasons; clicking a version compares it with the one before it; the earliest
 * version has nothing to compare; a docx body-only comparison is "正文完整对比", never "完整对比"; a failed comparison says why and
 * can be retried; a failed timeline load offers reload; restoring asks first and sends the read current revision; restoring while the
 * file is edited online says so; accept-and-archive and publish-to-KB send the head revision; publishing a version with speaker
 * notes/comments or an out-of-scope AI edit asks first and resends with the matching confirm flag (R066/D105, R041/D109).
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeVersionsSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => {
  const res = { status, ok: status < 300, json: async () => body, clone: () => res }; // clone：Bridge 的错误体决定 5xx 要不要自动重试
  return res;
};
const counts = { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 };
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 13).toISOString();
const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 9, 5).toISOString();
const rev = (id: string, over: object = {}) => ({
  revision_id: id,
  parent_id: null,
  content_sha256: 'x',
  size: 1,
  created_at: '2025-03-02T01:00:00.000Z',
  origin: 'original',
  current: false,
  ...over,
});
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));
const bodyOf = (method: string, part: string, i = 0) => JSON.parse(String(calls(method, part)[i]?.[1]?.body));

const partialDiff = {
  resource_id: 'res_1',
  from_revision_id: 'rev_bbbbbbbb',
  to_revision_id: 'rev_cccccccc',
  format: 'pptx',
  compared_root: '/',
  status: 'partial',
  coverage: { nodes_from: 3, nodes_to: 4, truncated: false, lists_truncated: false },
  changes: [
    {
      kind: 'modified',
      node_type: 'shape',
      to_path: '/slide[1]/shape[@id=1]',
      aspects: ['text', 'geometry'],
      text_before: '旧',
      text_after: '新',
      fragment: { offset: 0, removed: '旧', inserted: '新' },
      fields: [{ name: 'x', before: '1cm', after: '2cm' }],
    },
  ],
  unknown_parts: [{ reason: 'content_not_compared', node_type: 'chart', to_path: '/slide[1]/chart[1]' }],
};
const bodyDiff = { ...partialDiff, format: 'docx', compared_root: '/body', status: 'complete', unknown_parts: [] };

type Opts = {
  restoreStatus?: number;
  diff?: object;
  diffStatus?: number;
  publishCodes?: string[];
  timelineStatus?: number;
};
function bridge(opts: Opts = {}) {
  const codes = [...(opts.publishCodes ?? [])];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.endsWith('/revisions'))
      return opts.timelineStatus
        ? reply(opts.timelineStatus, { error: { code: 'INTERNAL', message: 'x' } })
        : reply(200, {
            resource_id: 'res_1',
            current_revision_id: 'rev_cccccccc',
            items: [
              rev('rev_cccccccc', {
                current: true,
                origin: 'restore',
                restored_from: 'rev_aaaaaaaa',
                created_at: today,
              }),
              rev('rev_bbbbbbbb', { origin: 'edit', created_at: yesterday }),
              rev('rev_aaaaaaaa'),
            ],
            page: 1,
            page_size: 50,
            total: 3,
          });
    if (url.startsWith('/bridge/v1/publications?'))
      return reply(200, {
        items: [
          {
            publication_id: 'pub_1',
            resource_id: 'res_1',
            revision_id: 'rev_bbbbbbbb',
            target: { kind: 'archive' },
            status: 'published',
            error: null,
            accepted_at: 't',
            published_at: 't',
            created_at: 't',
          },
        ],
        page: 1,
        page_size: 50,
        total: 1,
      });
    if (url === '/bridge/v1/scopes')
      return reply(200, {
        sources: [{ source_id: 'src_q', name: '青禾库', provider: 'weknora', counts }],
        projects: [],
      });
    if (url.endsWith('/metadata'))
      return reply(200, {
        resource_id: 'res_1',
        metadata_revision: 1,
        current_revision_id: 'rev_cccccccc',
        tag_ids: [],
        secret: opts.secret === true,
      });
    if (url.includes('/changes?'))
      return opts.diffStatus ? reply(opts.diffStatus, { error: { code: 'UPSTREAM_TIMEOUT', message: 'x' } }) : reply(200, opts.diff ?? partialDiff);
    if (url.endsWith('/restore'))
      return opts.restoreStatus
        ? reply(opts.restoreStatus, { error: { code: 'EDIT_LEASE_HELD', message: 'x' } })
        : reply(201, {});
    if (url === '/bridge/v1/publications' && method === 'POST') {
      const code = codes.shift();
      if (code) return reply(409, { error: { code, message: 'x' } });
      // 受理成功按合同回 Publication（versions-client 核对 publication_id 与 status）
      const request = JSON.parse(String(init?.body));
      return reply(201, {
        publication_id: 'fixture-publication',
        resource_id: request.resource_id,
        revision_id: request.revision_id,
        target: request.target,
        status: request.target.kind === 'archive' ? 'published' : 'queued',
        error: null,
        accepted_at: '2026-10-03T09:00:00.000Z',
        published_at: request.target.kind === 'archive' ? '2026-10-03T09:00:00.000Z' : null,
        created_at: '2026-10-03T09:00:00.000Z',
      });
    }
    // 右下当前版本预览（D138，另见 officeVersionsPreview.dom.test.tsx）：给一页成功的渲染，本文件的按钮与文案不受它干扰
    if (url.endsWith('/office/html'))
      return { ...reply(200, null), text: async () => '<html><head></head><body></body></html>' };
    if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
    return reply(404, {});
  });
}
const loaded = async () => screen.findByText('v3');
const openMenu = (v: string) => fireEvent.click(screen.getByRole('button', { name: `更多操作 ${v}` }));
const publishToKb = async () => {
  fireEvent.click(screen.getByRole('button', { name: '发布到知识库' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByLabelText('选择知识库'));
  fireEvent.click(await screen.findByText('青禾库'));
  fireEvent.change(within(dialog).getByLabelText('库里的文件名'), { target: { value: '汇报（虚构）.pptx' } });
  // 影响预览：以什么名字进哪个库、谁能看到（Google Drive 式）
  expect(await within(dialog).findByText(/将以文件名“汇报（虚构）.pptx”进入知识库“青禾库”/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: '发布' }));
};

// 读请求的自动重试在用例里免等退避（产品默认 300/900 ms）
readRetry.delays = [0, 0];

describe('OfficeVersionsSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('groups the timeline by local day with local clock times, badges and no ISO strings', async () => {
    bridge();
    const { container } = render(<OfficeVersionsSlot />);
    await loaded();
    expect(screen.getByText('今天')).toBeInTheDocument();
    expect(screen.getByText('昨天')).toBeInTheDocument();
    expect(screen.getByText('2025年3月2日')).toBeInTheDocument();
    expect(screen.getByText('10:13')).toBeInTheDocument();
    expect(screen.getByText('09:05')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(screen.getByText('当前版本')).toBeInTheDocument();
    expect(screen.getByText('恢复自 v1')).toBeInTheDocument();
    expect(screen.getByText('AI 修改')).toBeInTheDocument();
    expect(screen.getByText('导入')).toBeInTheDocument();
    expect(screen.getByText('已归档 · 已完成')).toBeInTheDocument();
    expect(screen.getByText(/^共 3 个版本，全部保留。/)).toBeInTheDocument();
    // 打开页面自动跑一次“上一版 → 当前版”（D130），不再是空白的“请在左侧选一个版本”
    await waitFor(() => expect(calls('GET', '/changes?')).toHaveLength(1));
    expect(calls('GET', '/changes?')[0]?.[0]).toContain('from=rev_bbbbbbbb&to=rev_cccccccc');
    expect(await screen.findByText('修改 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回空间' }));
    expect(window.location.hash).toBe('#/office/space');
  });

  it('compares the default pair: partial notice, view original, counts, grouped changes, folded uncovered items', async () => {
    bridge();
    render(<OfficeVersionsSlot />);
    await loaded();
    expect(await screen.findByText('Diff 覆盖不足：已保存 v3；部分对象无法比较')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '对比这两个版本' })); // 同一对再比一次也是真实调用
    await waitFor(() => expect(calls('GET', '/changes?')).toHaveLength(2));
    expect(calls('GET', '/changes?')[1]?.[0]).toContain('from=rev_bbbbbbbb&to=rev_cccccccc');
    expect(await screen.findByText('新')).toBeInTheDocument(); // 重新对比的结果渲染出来再往下断言
    expect(screen.getByText('修改 1')).toBeInTheDocument();
    expect(screen.getByText('未覆盖 1')).toBeInTheDocument();
    expect(screen.getByText('第 1 页 · 1')).toBeInTheDocument();
    expect(screen.getByText('形状')).toBeInTheDocument();
    expect(screen.getByText('文字、位置与大小')).toBeInTheDocument();
    expect(screen.getByText('比较范围：整份文件（/）')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '看原件' })).toHaveAttribute('href', '/bridge/v1/resources/res_1/preview');
    expect(screen.queryByTestId('version-diff-unknown')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看未覆盖项（1）' }));
    expect(screen.getByText('未覆盖项')).toBeInTheDocument();
    expect(screen.getByText('内部内容未比较（如图表数值、图片）')).toBeInTheDocument();
    expect(screen.queryByText('content_not_compared')).toBeNull();
  });

  it('clicking a version compares it with the one before it; the earliest version has nothing before it', async () => {
    bridge();
    render(<OfficeVersionsSlot />);
    await loaded();
    await waitFor(() => expect(calls('GET', '/changes?')).toHaveLength(1)); // 自动对比
    fireEvent.click(screen.getByText('v2'));
    await waitFor(() => expect(calls('GET', '/changes?')).toHaveLength(2));
    expect(calls('GET', '/changes?')[1]?.[0]).toContain('from=rev_aaaaaaaa&to=rev_bbbbbbbb');
    fireEvent.click(screen.getByText('v1'));
    expect(await screen.findByText('这是最早的版本，没有上一版可对比。')).toBeInTheDocument();
    expect(calls('GET', '/changes?')).toHaveLength(2);
  });

  it('a comparison the user picks while the automatic one is still running is the one shown (request sequencing)', async () => {
    let release: (() => void) | undefined;
    const first = new Promise<void>((r) => (release = r));
    let n = 0;
    bridge();
    const base = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/changes?') && ++n === 1) await first; // 自动对比挂住
      return base(url, init);
    });
    render(<OfficeVersionsSlot />);
    await loaded();
    fireEvent.click(screen.getByText('v2')); // 用户选了别的对比对
    await waitFor(() => expect(calls('GET', '/changes?')).toHaveLength(2));
    release?.();
    expect(await screen.findByText('修改 1')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50)); // 让迟到的自动对比结果有机会到达
    // 显示的仍是用户选的 v1→v2，没被迟到的自动对比（v2→v3）覆盖
    expect(screen.getByRole('combobox', { name: '对比终点' }).textContent).toContain('v2');
    expect(screen.getByRole('combobox', { name: '对比起点' }).textContent).toContain('v1');
  });

  it('a docx body-only comparison is labelled "正文完整对比" with the uncompared parts, never "完整对比"', async () => {
    bridge({ diff: bodyDiff });
    render(<OfficeVersionsSlot />);
    await loaded();
    expect(await screen.findByText('正文完整对比')).toBeInTheDocument();
    expect(screen.queryByText('完整对比')).toBeNull();
    expect(screen.getByText('比较范围：正文（/body）；未比较：样式表、编号、页眉页脚')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /查看未覆盖项/ })).toBeNull();
  });

  it('a comparison that times out says why and can be retried; a failed timeline load offers reload', async () => {
    bridge({ diffStatus: 504 });
    const { unmount } = render(<OfficeVersionsSlot />);
    await loaded();
    expect(await screen.findByText('对比超时（文件可能太大）；已保存的版本不受影响。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(calls('GET', '/changes?')).toHaveLength(2));
    unmount();
    fetchMock.mockReset();
    bridge({ timelineStatus: 500 });
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('版本列表没有读取成功')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(calls('GET', '/revisions')).toHaveLength(2));
  });

  it('restoring asks first and sends the read current revision; online editing is reported', async () => {
    bridge();
    const { unmount } = render(<OfficeVersionsSlot />);
    await loaded();
    openMenu('v1');
    fireEvent.click(await screen.findByRole('menuitem', { name: '恢复为新版本' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('把 v1 恢复为新版本？')).toBeInTheDocument();
    expect(calls('POST', '/restore')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    await waitFor(() => expect(calls('POST', '/revisions/rev_aaaaaaaa/restore')).toHaveLength(1));
    expect(bodyOf('POST', '/restore').expected_current_revision_id).toBe('rev_cccccccc');
    unmount();
    fetchMock.mockReset();
    bridge({ restoreStatus: 409 });
    render(<OfficeVersionsSlot />);
    await loaded();
    openMenu('v2');
    fireEvent.click(await screen.findByRole('menuitem', { name: '恢复为新版本' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '恢复为新版本' }));
    expect(await screen.findByText('文件正在在线编辑，编辑中不能恢复覆盖。结束编辑并保存后再试。')).toBeInTheDocument();
  });

  it('accept-and-archive asks first (archive ≠ publish), then it and publish-to-KB send the head revision', async () => {
    bridge();
    render(<OfficeVersionsSlot />);
    await loaded();
    openMenu('v3');
    fireEvent.click(await screen.findByRole('menuitem', { name: '接受并归档' }));
    const ask = await screen.findByRole('dialog');
    expect(within(ask).getByText('接受 v3 并归档？')).toBeInTheDocument();
    expect(within(ask).getByText(/只记录在本地，不会发到任何知识库/)).toBeInTheDocument();
    expect(calls('POST', '/bridge/v1/publications')).toHaveLength(0);
    fireEvent.click(within(ask).getByRole('button', { name: '接受并归档' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/publications')).toHaveLength(1));
    expect(bodyOf('POST', '/bridge/v1/publications')).toMatchObject({
      revision_id: 'rev_cccccccc',
      expected_head_revision_id: 'rev_cccccccc',
      target: { kind: 'archive' },
    });
    await publishToKb();
    await waitFor(() => expect(calls('POST', '/bridge/v1/publications')).toHaveLength(2));
    expect(bodyOf('POST', '/bridge/v1/publications', 1).target).toEqual({
      kind: 'knowledge_base',
      source_id: 'src_q',
      file_name: '汇报（虚构）.pptx',
    });
  });

  it('a Secret resource cannot be published: the dialog says so and offers no publish (D116)', async () => {
    bridge({ secret: true });
    render(<OfficeVersionsSlot />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '发布到知识库' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/已标为 Secret，不能发布到知识库/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '发布' })).toBeDisabled();
    expect(within(dialog).queryByText(/将以文件名/)).toBeNull();
  });

  it('speaker notes/comments and out-of-scope AI edits ask first, then resend with both confirm flags', async () => {
    bridge({ publishCodes: ['DIFF_OUT_OF_SCOPE', 'HIDDEN_CONTENT_PRESENT'] });
    render(<OfficeVersionsSlot />);
    await loaded();
    await publishToKb();
    expect(await screen.findByText(/除了所改的对象还有别的变化/)).toBeInTheDocument();
    expect(bodyOf('POST', '/bridge/v1/publications').confirm_out_of_scope).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '仍要发布' }));
    // “这个版本”起头只匹配确认框：发布弹窗的影响说明里也有“含演讲者备注或批注”，退场动画期间还在 DOM 里
    expect(await screen.findByText(/这个版本含演讲者备注或批注/)).toBeInTheDocument();
    expect(bodyOf('POST', '/bridge/v1/publications', 1).confirm_out_of_scope).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '仍要发布' }));
    await waitFor(() => expect(calls('POST', '/bridge/v1/publications')).toHaveLength(3));
    expect(bodyOf('POST', '/bridge/v1/publications', 2)).toMatchObject({
      confirm_out_of_scope: true,
      confirm_hidden_content: true,
    });
    await waitFor(() => expect(screen.queryByText(/这个版本含演讲者备注或批注/)).toBeNull());
  });
});
