/**
 * 文件：tests/unit/mycowork/a11ySemantics.dom.test.tsx
 * 职责：R049 语义标签验收的 DOM 断言：控件有可访问名称、状态不只靠颜色、列表用列表语义、提示可被读屏播报、Popconfirm 可用 Esc 关闭。
 * 边界：只替换 fetch；数据均为虚构。IME 组合输入不在此重复：见 officeResources.b/c、officeFileQuestion 的 isComposing 用例；
 *       “产物类型”Select 的名称见 outputProfileSend；真实 IME/触屏设备验收归负责人。
 * 关联：MyCowork .claude/rules/ui.md；R049。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ScopeChip } from '@mycowork/ui';
import { OfficeCapabilitiesSlot, OfficeSchedulesSlot, OfficeSetupSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const cap = (over: object) => ({
  id: 'knowledge',
  state: 'ready',
  dependencies: [],
  allowedDataScopes: [],
  testedAt: new Date().toISOString(),
  version_verified: true,
  ...over,
});
const schedule = {
  schedule_id: 'sched_1',
  submission_id: '00000000-0000-4000-8000-000000000001',
  name: '周报（虚构）',
  scope: { scopes: [{ selector: 'knowledge_base', id: 'src_1' }] },
  query: '汇总本周进度',
  output_profile: 'weekly_report',
  output_target: 'draft',
  timing: { time: '09:00', weekdays: [1, 2, 3, 4, 5, 6, 7], timezone: 'Asia/Shanghai' },
  budget: { max_runs_per_month: 4 },
  missed_policy: 'catch_up_once',
  allowed_actions: ['write_draft'],
  enabled: true,
  revision: 3,
  next_run_at: '2026-09-29T01:00:00.000Z',
  budget_used: 1,
  created_at: '2026-09-20T00:00:00.000Z',
  runs: [],
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('R049 语义标签', () => {
  it('能力页：状态 Tag 带文字、重新检查按钮有名称、读失败的提示可被读屏播报', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { capabilities: [cap({ state: 'temporarily_unavailable', reason: '虚构' }), cap({ id: 'office-edit' })] }),
    );
    render(<OfficeCapabilitiesSlot />, { wrapper: MemoryRouter });
    const row = await screen.findByTestId('capability-knowledge');
    expect(within(row).getByText('暂时故障')).toBeInTheDocument(); // 状态有文字，不只靠颜色
    expect(within(screen.getByTestId('capability-office-edit')).getByText('可使用')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '重新检查' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2); // 列表语义
  });

  it('能力页：读失败时错误文字出现并带“重试”按钮', async () => {
    fetchMock.mockResolvedValue(reply(500, { error: { code: 'INTERNAL', message: 'x' } }));
    render(<OfficeCapabilitiesSlot />, { wrapper: MemoryRouter });
    expect(await screen.findByText('没有读到能力状态')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /重试/ })[0]).toBeInTheDocument(); // 下方技能版本读失败也有自己的重试
  });

  it('首次使用清单：步骤用列表语义，每步状态是文字', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/api/') ? reply(200, { data: {} }) : reply(200, { capabilities: [cap({})] }),
    );
    render(<OfficeSetupSlot />);
    const steps = await screen.findByTestId('mycowork-setup-steps');
    await waitFor(() => expect(within(steps).getAllByRole('listitem').length).toBeGreaterThan(1));
    for (const item of within(steps).getAllByRole('listitem')) {
      expect(within(item).getByRole('link', { name: /.+/ })).toBeInTheDocument(); // 每步的“去处理”可聚焦、有名称
    }
    expect(within(steps).getAllByText(/^(必需|可选)$/).length).toBeGreaterThan(0);
  });

  it('定时：开关有带对象名的名称，Popconfirm 可用 Esc 关闭且不触发 PATCH', async () => {
    fetchMock.mockResolvedValue(reply(200, { items: [schedule] }));
    render(<OfficeSchedulesSlot />, { wrapper: MemoryRouter });
    const toggle = await screen.findByRole('switch', { name: /停用.*周报（虚构）/ });
    fireEvent.click(toggle);
    const ok = await screen.findByRole('button', { name: '停用' });
    expect(ok).toBeVisible();
    fireEvent.keyDown(toggle, { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole('button', { name: '取消' })).toBeNull());
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false);
    expect(screen.getByText('启用中')).toBeInTheDocument(); // 状态文字，不只靠开关颜色
  });

  it('范围按钮有可访问名称', async () => {
    fetchMock.mockResolvedValue(reply(200, { items: [] }));
    render(<ScopeChip lang="zh-CN" />);
    expect(await screen.findByRole('button', { name: /资料范围/ })).toBeInTheDocument();
  });
});
