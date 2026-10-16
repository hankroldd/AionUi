/**
 * 文件：officeVersionsSelectionAsk.dom.test.tsx
 * 职责：版本页预览点选对象 → Bridge冻结 → 询问前重检 → 经范围导航去新任务页；漂移要求重选、不在知识库不开放。
 * 边界：只替换Bridge HTTP与路由；iframe内点选脚本由真实浏览器E2E覆盖，这里按合同直接发父窗消息。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeVersionsSlot } from '@/renderer/mycowork-slots';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/mycowork-branches', () => ({ useBranchAdapter: () => undefined }));
vi.mock('@/renderer/mycowork-reviews', () => ({ useReviewAdapter: () => undefined }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'fixture-account' }, status: 'authenticated' }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ resourceId: 'res_1' }),
  useLocation: () => ({ pathname: '/', key: 'k1', state: null }),
  useNavigate: () => navigate,
}));

const SHA = 'a'.repeat(64);
const CLIENT = 'officecli-html@1.0.152';
const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
type Opts = { inKb?: boolean; check?: unknown };
function bridge({ inKb = true, check }: Opts = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/revisions'))
      return reply(200, {
        resource_id: 'res_1',
        current_revision_id: 'rev_b',
        file_name: '备忘（虚构）.docx',
        knowledge_bases: inKb
          ? [{ source_id: 'kb_1', via: 'fingerprint', revision_id: 'rev_b', is_current: true }]
          : [],
        items: [
          {
            revision_id: 'rev_b',
            parent_id: null,
            content_sha256: SHA,
            size: 1,
            created_at: '2026-10-12T01:00:00Z',
            origin: 'edit',
            current: true,
          },
        ],
        page: 1,
        page_size: 50,
        total: 1,
      });
    if (url.endsWith('/office/html'))
      return {
        ...reply(200, null),
        text: async () => '<html><body><p data-path="/body/p[1]">正文（虚构）</p></body></html>',
        headers: new Headers({ 'x-mycowork-content-sha256': SHA, 'x-mycowork-preview-client': CLIENT }),
      };
    if (url === '/bridge/v1/office/selections') {
      const body = JSON.parse(String(init?.body));
      return reply(201, {
        selection_id: 'sel_fixture',
        resource_id: 'res_1',
        content_sha256: body.expected_content_sha256,
        locator: body.locator,
        locator_kind: 'ordinal',
        node_type: 'paragraph',
        fingerprint: 'c'.repeat(64),
        child_count: 1,
        preview_client: body.preview_client,
        editability: 'native',
        frozen_at: '2026-10-12T06:00:00Z',
      });
    }
    if (url.endsWith('/check'))
      return reply(200, check ?? { selection_id: 'sel_fixture', status: 'ok', current_content_sha256: SHA });
    if (url.endsWith('/metadata'))
      return reply(200, { resource_id: 'res_1', metadata_revision: 1, tag_ids: [], secret: false });
    if (url === '/bridge/v1/scopes')
      return reply(200, {
        sources: [
          {
            source_id: 'kb_1',
            name: '制度库（虚构）',
            counts: { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 },
          },
        ],
        projects: [],
      });
    if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
    if (url.startsWith('/bridge/v1/publications?')) return reply(200, { items: [], page: 1, page_size: 50, total: 0 });
    return reply(404, {});
  });
}
const calls = (path: string) => fetchMock.mock.calls.filter(([u]) => String(u).endsWith(path));
async function pickParagraph() {
  // 知识库目录读回后预览才进入选择模式（换成带选择脚本的新 iframe）
  const frame = await waitFor(() => {
    const f = screen.getByTitle('备忘（虚构）.docx 的只读预览') as HTMLIFrameElement;
    expect(f.srcdoc).toContain('mycowork.office.selection');
    return f;
  });
  await act(async () => {}); // 等父窗消息监听挂上（effect），再模拟 iframe 点选
  const generation = JSON.parse(/const generation = ("[^"]+");/.exec(frame.srcdoc)![1]);
  fireEvent(
    window,
    new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'null',
      data: { type: 'mycowork.office.selection', generation, locator: '/body/p[1]' },
    })
  );
  expect(await screen.findByText('可直接修改', undefined, { timeout: 5000 })).toBeTruthy();
}

describe('版本页预览对象选择交给提问（R040）', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    navigate.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('点选后按同次预览版本冻结，询问前重检，再带单文件范围与选区引用去新任务页', async () => {
    bridge();
    render(<OfficeVersionsSlot />);
    await pickParagraph();
    expect(JSON.parse(String(calls('/office/selections')[0][1].body))).toEqual({
      resource_id: 'res_1',
      locator: '/body/p[1]',
      expected_content_sha256: SHA,
      preview_client: CLIENT,
    });
    fireEvent.click(screen.getByRole('button', { name: '询问所选内容' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(calls('/office/selections/sel_fixture/check')).toHaveLength(1);
    const [route, { state }] = navigate.mock.calls[0];
    expect(route).toBe('/guid');
    expect(state.mycoworkScopeDraft).toEqual({
      ownerKey: 'u1',
      selection: {
        items: [{ source_id: 'kb_1', name: '制度库（虚构）', resource_ids: ['res_1'] }],
        views: [],
        requiredResourceIds: ['res_1'],
      },
    });
    expect(state.prefillPrompt).toContain('sel_fixture');
    expect(state.prefillPrompt).toContain('/body/p[1]');
  });

  it('询问前重检发现漂移：提示刷新后重新选择，不去提问、不猜位置', async () => {
    bridge({
      check: {
        selection_id: 'sel_fixture',
        status: 'drifted',
        reason: 'fingerprint_mismatch',
        current_content_sha256: 'b'.repeat(64),
      },
    });
    render(<OfficeVersionsSlot />);
    await pickParagraph();
    fireEvent.click(screen.getByRole('button', { name: '询问所选内容' }));
    expect(await screen.findByText('预览或所选内容已更新，请刷新后重新选择。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新预览并重选' })).toBeTruthy();
    expect(screen.queryByText('可直接修改')).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('资源不在本人可见的知识库里：保持普通只读预览，不出现选择入口', async () => {
    bridge({ inKb: false });
    render(<OfficeVersionsSlot />);
    await waitFor(() => expect(calls('/bridge/v1/scopes')).toHaveLength(1));
    await act(async () => {});
    const frame = (await screen.findByTitle('备忘（虚构）.docx 的只读预览')) as HTMLIFrameElement;
    expect(frame.srcdoc).not.toContain('mycowork.office.selection');
    expect(screen.queryByRole('region', { name: '所选内容' })).toBeNull();
  });
});
