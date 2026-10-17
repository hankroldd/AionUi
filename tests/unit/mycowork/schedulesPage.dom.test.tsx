/**
 * [mycowork] ADR-0011: `/office/schedules` (MyCowork P14 office schedules, PR10 slice I, R060/D282). Only fetch is mocked.
 * Covers: rows show status, next time, time zone, missed policy, monthly budget and the last judgement (incl. voided);
 * the honest notice; turning off confirms first and PATCHes with expected_revision; 409 re-reads the list; empty state.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeSchedulesSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const sched = (over: object) => ({
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
  runs: [
    {
      slot: '2026-09-28',
      due_at: '2026-09-28T01:00:00.000Z',
      catch_up: false,
      missed_slots: [],
      outcome: 'queued',
      created_at: '2026-09-28T01:00:03.000Z',
    },
  ],
  ...over,
});
const LIST = [
  sched({}),
  sched({
    schedule_id: 'sched_2',
    name: '月报（虚构）',
    enabled: false,
    next_run_at: null,
    missed_policy: 'skip',
    runs: [{ ...sched({}).runs[0], outcome: 'skipped', void_reason: 'schedule_disabled' }],
  }),
];

describe('OfficeSchedulesSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists schedules with status, next time, policy, budget and last judgement, plus the honest notice', async () => {
    fetchMock.mockResolvedValue(reply(200, { items: LIST }));
    render(<OfficeSchedulesSlot />, { wrapper: MemoryRouter });
    const row = await screen.findByTestId('schedule-sched_1');
    expect(within(row).getByText('启用中')).toBeInTheDocument();
    expect(within(row).getByText(/^下次：/)).toBeInTheDocument();
    expect(within(row).getByText('本月已用 1/4 次')).toBeInTheDocument();
    expect(within(row).queryByText(/Asia\/Shanghai/)).toBeNull(); // R069：时区/错过策略收进“详细信息”
    fireEvent.click(within(row).getByRole('button', { name: /详细信息/ }));
    expect(within(row).getByText('时区 Asia/Shanghai · 错过时补跑一次')).toBeInTheDocument();
    expect(within(row).getByText(/最近一次：.*已排队，等待执行/)).toBeInTheDocument();
    const off = screen.getByTestId('schedule-sched_2');
    expect(within(off).getByText('已停用')).toBeInTheDocument();
    expect(within(off).getByText('已停用，不会按时运行')).toBeInTheDocument();
    expect(within(off).getByText(/停用时已作废/)).toBeInTheDocument();
    const notice = screen.getByTestId('mycowork-schedules-notice');
    expect(notice).toHaveTextContent('不会自动执行');
    expect(notice).toHaveTextContent('互相独立、不同步');
    expect(fetchMock.mock.calls[0]![0]).toBe('/bridge/v1/schedules');
  });

  it('turns a schedule off only after confirming, sending expected_revision', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'PATCH'
          ? reply(200, sched({ enabled: false, revision: 4, next_run_at: null }))
          : reply(200, { items: LIST })
      )
    );
    render(<OfficeSchedulesSlot />, { wrapper: MemoryRouter });
    const row = await screen.findByTestId('schedule-sched_1');
    fireEvent.click(within(row).getByRole('switch'));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false);
    expect(await screen.findByText('停用这个定时？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    await waitFor(() => expect(within(row).getByText('已停用')).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(url).toBe('/bridge/v1/schedules/sched_1');
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false, expected_revision: 3 });
  });

  it('re-reads the list and asks to retry when the revision changed (409)', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'PATCH'
          ? reply(409, { error: { code: 'REVISION_CONFLICT', message: 'x' } })
          : reply(200, { items: LIST })
      )
    );
    render(<OfficeSchedulesSlot />, { wrapper: MemoryRouter });
    const row = await screen.findByTestId('schedule-sched_1');
    fireEvent.click(within(row).getByRole('switch'));
    fireEvent.click(await screen.findByRole('button', { name: '停用' }));
    expect(await screen.findByText('这个定时刚在别处改过，已刷新，请再操作一次。')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => i?.method === undefined)).toHaveLength(2));
    expect(within(screen.getByTestId('schedule-sched_1')).getByText('启用中')).toBeInTheDocument();
  });

  it('shows an empty state with a refresh action', async () => {
    fetchMock.mockResolvedValue(reply(200, { items: [] }));
    render(<OfficeSchedulesSlot />, { wrapper: MemoryRouter });
    expect(await screen.findByText('还没有办公定时')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
