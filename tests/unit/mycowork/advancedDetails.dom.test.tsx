/**
 * [mycowork] R069: 日常页面把纯工程字段收进“详细信息”。设置页“运行位置”（主机/数据目录/部署/服务版本）与办公定时（时区/错过策略）
 * 默认不显示、点开或键盘 Enter/Space 展开后显示；预算、停用状态、下次时间、“运行位置”标题与说明始终可见。只 mock fetch，数据虚构。
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeSchedulesSlot, OfficeSetupSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (body: unknown) => ({
  status: 200,
  ok: true,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const schedule = {
  schedule_id: 'sched_1',
  submission_id: '00000000-0000-4000-8000-000000000001',
  name: '周报（虚构）',
  scope: { scopes: [{ selector: 'knowledge_base', id: 'src_1' }] },
  query: '汇总本周进度',
  output_profile: 'weekly_report',
  output_target: 'draft',
  timing: { time: '09:00', weekdays: [1], timezone: 'Asia/Shanghai' },
  budget: { max_runs_per_month: 4 },
  missed_policy: 'catch_up_once',
  allowed_actions: ['write_draft'],
  enabled: true,
  revision: 1,
  next_run_at: '2026-09-29T01:00:00.000Z',
  budget_used: 1,
  created_at: '2026-09-20T00:00:00.000Z',
  runs: [],
};

describe('R069 高级项折叠', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    // Arco Descriptions 需要 matchMedia，jsdom 没有
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('设置页：运行位置的工程字段默认收起，Enter 展开；标题与说明始终可见', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/instance')
        ? reply({
            host: 'host-fixture',
            data_dir_label: 'data-fixture',
            deployment: 'dev-fixture',
            build: { commit: 'a'.repeat(40) },
          })
        : url.includes('/capabilities')
          ? reply({ capabilities: [] })
          : reply({ data: {} })
    );
    render(<OfficeSetupSlot />);
    const where = await screen.findByTestId('mycowork-setup-where');
    expect(within(where).getByText('运行位置')).toBeInTheDocument();
    expect(within(where).getByText(/不同的数据目录/)).toBeInTheDocument();
    expect(within(where).queryByText('host-fixture')).toBeNull();
    expect(within(where).queryByText('aaaaaaaa')).toBeNull();
    const toggle = within(where).getByRole('button', { name: /详细信息/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(where).getByText('host-fixture')).toBeInTheDocument();
    expect(within(where).getByText('data-fixture')).toBeInTheDocument();
    expect(within(where).getByText('aaaaaaaa')).toBeInTheDocument();
    await userEvent.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(where).queryByText('host-fixture')).toBeNull();
  });

  it('办公定时：时区/错过策略默认收起，Space 展开；预算、状态、下次时间不折叠', async () => {
    fetchMock.mockResolvedValue(reply({ items: [schedule] }));
    render(<OfficeSchedulesSlot />, { wrapper: MemoryRouter });
    const row = await screen.findByTestId('schedule-sched_1');
    expect(within(row).getByText('启用中')).toBeInTheDocument();
    expect(within(row).getByText(/^下次：/)).toBeInTheDocument();
    expect(within(row).getByText('本月已用 1/4 次')).toBeInTheDocument();
    expect(within(row).queryByText(/Asia\/Shanghai/)).toBeNull();
    const toggle = within(row).getByRole('button', { name: /详细信息/ });
    toggle.focus();
    await userEvent.keyboard(' ');
    expect(within(row).getByText('时区 Asia/Shanghai · 错过时补跑一次')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(row).queryByText(/Asia\/Shanghai/)).toBeNull();
  });
});
