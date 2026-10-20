/**
 * [mycowork] R014 切片 3（D279，MyCowork navigation-intent §10）：从对话打开 AI 当时读到的那一版。
 * 只 mock Bridge 边界（fetch）与路由位置。覆盖：read 结果带 revision_id 的步骤行出现“查看当时的版本”并跳内部地址；
 * 不带 / 截断 / 别的工具 / 格式不合法的 id 不出现；版本页带 ?revision= 时下方显示该版原件内容与“不是最新版”，
 * 对比区先比“该版 → 当前版”；该版就是当前版时如实说；不属于本人或该资源的版本（Bridge 404）不拿当前内容冒充；
 * 不合法的参数当作没有。数据均为虚构。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { IMessageToolCall } from '@/common/chat/chatLib';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import { OfficeVersionsSlot } from '@/renderer/mycowork-slots';
import { citedRevisionOf, parseCitedRevision } from '@mycowork/ui';

const loc = vi.hoisted(() => ({ search: '' }));
vi.mock('@/renderer/mycowork-branches', () => ({ useBranchAdapter: () => undefined }));
vi.mock('@/renderer/mycowork-reviews', () => ({ useReviewAdapter: () => undefined }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/office/resources/res_1/versions', search: loc.search, state: null, key: 'k' }),
  useNavigate: () => vi.fn(),
}));

const readResult = (extra: Record<string, unknown>) =>
  JSON.stringify({ kind: 'text', resource_id: 'res_1', file_name: '纪要（虚构）.txt', text: '第一版正文', ...extra });
const toolCall = (name: string, output: string): IMessageToolCall => ({
  id: 'm1',
  conversation_id: 'conv_1',
  type: 'tool_call',
  content: { call_id: 'c1', name, args: {}, status: 'completed', output },
});

describe('cited revision intent (pure)', () => {
  it('takes ids only from a whole JSON line of a read result with valid res_/rev_ ids', () => {
    const out = readResult({ revision_id: 'rev_a' });
    expect(citedRevisionOf('mcp__mycowork_bridge__read', out)).toEqual({ resourceId: 'res_1', revisionId: 'rev_a' });
    expect(citedRevisionOf('mcp__mycowork_bridge_read', `${out}\n提醒：还没读完`)).toEqual({
      resourceId: 'res_1',
      revisionId: 'rev_a',
    });
    expect(citedRevisionOf('read', readResult({}))).toBeUndefined(); // WeKnora 原件没有 Bridge 版本
    expect(citedRevisionOf('mcp__mycowork_bridge__search', out)).toBeUndefined();
    expect(citedRevisionOf('Read', out)).toBeUndefined();
    expect(citedRevisionOf('read', out.slice(0, -5))).toBeUndefined(); // 截断
    expect(citedRevisionOf('read', readResult({ revision_id: '../rev_a' }))).toBeUndefined();
    expect(
      citedRevisionOf('read', readResult({ revision_id: 'rev_a', resource_id: 'https://x.test/a' }))
    ).toBeUndefined();
    expect(citedRevisionOf('read', readResult({ revision_id: 'rev_a', kind: 'binary' }))).toBeUndefined();
  });

  it('parses only a valid revision parameter', () => {
    expect(parseCitedRevision('?revision=rev_a')).toBe('rev_a');
    for (const bad of ['', '?revision=', '?revision=../x', '?revision=res_1', '?revision=rev_a%2F..'])
      expect(parseCitedRevision(bad)).toBeUndefined();
  });
});

describe('read tool step → "查看当时的版本"', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('shows the action on a read step with revision_id and navigates to that revision', () => {
    render(
      <MessageToolGroupSummary
        messages={[toolCall('mcp__mycowork_bridge__read', readResult({ revision_id: 'rev_a' }))]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'messages.toolActivity.label · 1', expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: '查看当时的版本' }));
    expect(window.location.hash).toBe('#/office/resources/res_1/versions?revision=rev_a');
  });

  it('shows nothing without revision_id or for an invalid id', () => {
    render(
      <MessageToolGroupSummary
        messages={[
          toolCall('mcp__mycowork_bridge__read', readResult({})),
          { ...toolCall('read', readResult({ revision_id: 'rev_a/../../x' })), id: 'm2' },
        ].map((m, i) => ({ ...m, content: { ...m.content, call_id: `c${i}` } }))}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'messages.toolActivity.label · 2', expanded: false }));
    expect(screen.queryByText('查看当时的版本')).toBeNull();
  });
});

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const page = (body: string) => ({ ...reply(200, null), text: async () => body });
const rev = (id: string, parent: string | null) => ({
  revision_id: id,
  parent_id: parent,
  content_sha256: id,
  size: 1,
  created_at: '2025-03-02T01:00:00.000Z',
  origin: 'edit',
  current: id === 'rev_b',
});
function bridge() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.endsWith('/revisions'))
      return reply(200, {
        resource_id: 'res_1',
        current_revision_id: 'rev_b',
        file_name: '纪要（虚构）.txt',
        items: [rev('rev_b', 'rev_a'), rev('rev_a', null)],
        page: 1,
        page_size: 50,
        total: 2,
      });
    if (url.endsWith('/revisions/rev_a/content')) return page('第一版正文（AI 读的）');
    if (url.endsWith('/revisions/rev_b/content')) return page('第二版正文（当前）');
    if (url.endsWith('/preview')) return page('第二版正文（当前）');
    if (url.includes('/changes?')) {
      const q = new URL(url, 'http://x').searchParams;
      return reply(200, {
        resource_id: 'res_1',
        from_revision_id: q.get('from'),
        to_revision_id: q.get('to'),
        format: 'docx',
        compared_root: '/',
        status: 'complete',
        coverage: { nodes_from: 1, nodes_to: 1, truncated: false, lists_truncated: false },
        changes: [],
        unknown_parts: [],
      });
    }
    if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
    if (url.endsWith('/metadata'))
      return reply(200, { resource_id: 'res_1', metadata_revision: 1, tag_ids: [], secret: false });
    if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
    if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [], page: 1, page_size: 50, total: 0 });
    return reply(404, { code: 'NOT_FOUND' });
  });
}
const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

describe('versions page opened at the revision the AI read', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    bridge();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows that revision read-only, says it is not the latest, and compares it with the current one', async () => {
    loc.search = '?revision=rev_a';
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('第一版正文（AI 读的）')).toBeTruthy();
    expect(screen.getByTestId('versions-cited-note').textContent).toContain('这是 AI 当时读到的版本（不是最新版）');
    expect(screen.getByText('AI 当时读到的版本 · v1')).toBeTruthy();
    expect(screen.queryByText('第二版正文（当前）')).toBeNull();
    await waitFor(() => expect(urls().some((u) => u.includes('/changes?from=rev_a&to=rev_b'))).toBe(true));
    expect(urls().some((u) => u.endsWith('/preview'))).toBe(false); // 不读当前内容冒充
  });

  it('says so when the revision the AI read is still the current one', async () => {
    loc.search = '?revision=rev_b';
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText('第二版正文（当前）')).toBeTruthy();
    expect(screen.getByTestId('versions-cited-note').textContent).toContain('也就是当前版本');
  });

  it('a revision Bridge does not serve (other user / other resource) shows a read failure, never the current content', async () => {
    loc.search = '?revision=rev_zzz';
    render(<OfficeVersionsSlot />);
    await waitFor(() => expect(urls().some((u) => u.endsWith('/revisions/rev_zzz/content'))).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeTruthy());
    expect(screen.queryByText('第二版正文（当前）')).toBeNull();
    expect(screen.getByTestId('versions-cited-note')).toBeTruthy();
  });

  it('an invalid revision parameter is ignored: the normal current preview opens', async () => {
    loc.search = '?revision=../../etc';
    render(<OfficeVersionsSlot />);
    expect(await screen.findByText(/^当前内容预览 · v2/)).toBeTruthy();
    expect(screen.queryByTestId('versions-cited-note')).toBeNull();
    expect(urls().some((u) => u.includes('/content'))).toBe(false);
  });
});
