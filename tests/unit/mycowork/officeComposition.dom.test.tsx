/**
 * [mycowork] ADR-0011: `/office/compositions/:decisionId` (MyCowork P09 page plan, PR05 slice e).
 * Only the Bridge boundary is mocked (fetch). Covers: pages with intent, candidates (rule reasons/limits; the cover renders the
 * real template page, see officeTemplatePreview), read-only excluded templates and fallbacks, no scores; choosing a structure posts an idempotent
 * choice and follows the new decision version; a no-longer-eligible choice (409) reloads and says so; the page sits in the
 * shared skeleton with a back action, a Steps bar and a header action that turns into "back to chat" once every page is chosen.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeCompositionSlot } from '@/renderer/mycowork-slots';

const navigateMock = vi.fn();
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => navigateMock,
  useParams: () => ({ decisionId: 'dec_1' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const candidate = (id: string, title: string) => ({
  asset_id: id,
  version: 1,
  title,
  structure: '左图右文',
  reasons: [{ code: 'relation_match', text: '适合“对比”关系' }],
  limits: [{ code: 'preview_pending', text: '还没有真实预览' }],
  preview: { state: 'pending', render_profile: null },
});
const decision = (version: number, selected: string | null) => ({
  decision_id: `dec_${version}`,
  version,
  mode: 'confirm',
  status: selected ? 'selected' : 'awaiting_confirmation',
  output_format: 'pptx',
  aspect: '16:9',
  constraints: { native_editable: true, keep_master: true, allow_split: true },
  theme: { asset_id: 'theme.a', version: 1, title: '蓝色简洁（虚构）' },
  theme_excluded: [],
  fallbacks: [],
  message: null,
  created_at: 't',
  pages: [
    {
      page_no: 4,
      intent: '对比两个方案的成本',
      relation: 'comparison',
      facts: [],
      facts_sha256: 'f4',
      status: selected ? 'selected' : 'awaiting_confirmation',
      selected: selected ? { asset_id: selected, version: 1 } : null,
      candidates: [candidate('pat.a', '双栏对比'), candidate('pat.b', '表格对比')],
      excluded: [
        { asset_id: 'pat.x', version: 1, title: '整页海报', reasons: [{ code: 'aspect', text: '画幅是 4:3' }] },
      ],
      fallbacks: ['split_page'],
      message: null,
    },
  ],
});
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('OfficeCompositionSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    navigateMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows intent, candidates with rule reasons, excluded and fallbacks, no scores', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      reply(200, url.includes('/preview') ? '<html><body>p</body></html>' : decision(1, null))
    );
    render(<OfficeCompositionSlot />);
    expect(await screen.findByText('对比两个方案的成本')).toBeInTheDocument();
    expect(screen.getByText('对比')).toBeInTheDocument(); // 页关系显示中文，不直出 comparison
    expect(screen.queryByText('comparison')).toBeNull();
    expect(screen.getAllByText('适合“对比”关系')).toHaveLength(2);
    expect(screen.queryByText('预览待渲染')).toBeNull(); // 规则里的 preview_pending 限制不再当标签显示
    expect(screen.getByText('整页海报：画幅是 4:3')).toBeInTheDocument();
    expect(screen.getByText(/拆成两页/)).toBeInTheDocument();
    expect(screen.getByText('整套主题：蓝色简洁（虚构）')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/score|分数|\d+\.\d+/);
    // 主布局：返回、步骤条、待选页数
    expect(screen.getByRole('button', { name: '返回对话' })).toBeInTheDocument();
    expect(screen.getByText('选版式')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '还有 1 页待选' })).toBeInTheDocument();
    // Steps 从 1 起：还有页待选时高亮第 2 步“选版式”，第 1 步已完成
    const steps = document.querySelectorAll('.arco-steps-item');
    expect(steps[0]?.className).toContain('arco-steps-item-finish');
    expect(steps[1]?.className).toContain('arco-steps-item-process');
    expect(steps[2]?.className).toContain('arco-steps-item-wait');
  });

  it('choosing a structure posts an idempotent choice and follows the new decision version', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? reply(201, decision(2, 'pat.b'))
        : reply(200, url.includes('/preview') ? '<html></html>' : decision(1, null))
    );
    render(<OfficeCompositionSlot />);
    await screen.findByText('表格对比');
    fireEvent.click(screen.getAllByRole('button', { name: '选这个结构' })[1] as HTMLElement);
    await screen.findByText('方案第 2 版');
    const body = JSON.parse(String(posts()[0]?.[1]?.body));
    expect(posts()[0]?.[0]).toBe('/bridge/v1/template-decisions/dec_1/choices');
    expect(body).toMatchObject({ page_no: 4, asset_id: 'pat.b' });
    expect(body.submission_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(navigateMock).toHaveBeenCalledWith('/office/compositions/dec_2', { replace: true });
    expect(screen.getByRole('button', { name: '已选中' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '回到对话，批准生成' })).toBeInTheDocument();
    // 全部选定：第 3 步“生成”高亮
    expect(document.querySelectorAll('.arco-steps-item')[2]?.className).toContain('arco-steps-item-process');
  });

  it('a choice that is no longer eligible (409) reloads and says so', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? reply(409, { error: { code: 'TEMPLATE_NOT_ELIGIBLE', message: 'x' } })
        : reply(200, _url.includes('/preview') ? '<html></html>' : decision(1, null))
    );
    render(<OfficeCompositionSlot />);
    await screen.findByText('双栏对比');
    fireEvent.click(screen.getAllByRole('button', { name: '选这个结构' })[0] as HTMLElement);
    expect(await screen.findByText('这个候选在推荐之后变得不合格，已重新读取')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([u, i]) => !i?.method && !String(u).includes('/preview')).length
      ).toBeGreaterThanOrEqual(2)
    );
  });
});
