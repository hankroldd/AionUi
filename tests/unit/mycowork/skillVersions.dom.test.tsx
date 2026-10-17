/**
 * [mycowork] ADR-0011: "技能版本" section of `/office/capabilities` (MyCowork P10, R059). Only fetch is mocked.
 * Covers: list shows current version + history with check status; roll back confirms first (keyboard reachable) and POSTs
 * version_id + expected_current_version_id; the "new conversations only" notice; failed-check versions have no action;
 * 409 re-reads; 403 says admin only.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeCapabilitiesSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const ver = (id: string, version: number, over: object = {}) => ({
  id,
  version,
  status: 'published',
  tests: 'passed',
  published_at: '2026-10-16T02:00:00.000Z',
  digest_prefix: `abcdef00000${version}`,
  is_current: false,
  ...over,
});
const entry = () => ({
  name: 'deck-qa',
  current_version_id: 'skv_2',
  current_version: 2,
  versions: [
    ver('skv_3', 3, { status: 'failed', tests: 'failed', published_at: null }),
    ver('skv_2', 2, { is_current: true }),
    ver('skv_1', 1),
  ],
});
let publishReply: () => unknown = () => reply(200, { ...entry(), current_version_id: 'skv_1', current_version: 1 });
const route = (url: string, init?: RequestInit) => {
  if (url.endsWith('/skills/deck-qa/publish') && init?.method === 'POST') return Promise.resolve(publishReply());
  if (url.endsWith('/skills')) return Promise.resolve(reply(200, { skills: [entry()] }));
  return Promise.resolve(reply(200, { capabilities: [] }));
};

describe('SkillVersions in OfficeCapabilitiesSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(route);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows current version, history with check status and the new-conversations-only notice', async () => {
    render(<OfficeCapabilitiesSlot />, { wrapper: MemoryRouter });
    const skill = await screen.findByTestId('skill-deck-qa');
    expect(screen.getByText(/新版本只对之后新开的对话生效，正在进行的对话不变/)).toBeInTheDocument();
    expect(within(skill).getByText('当前使用：版本 2')).toBeInTheDocument();
    expect(within(skill).getByText('未通过检查')).toBeInTheDocument();
    expect(within(screen.getByTestId('skill-version-skv_3')).queryByRole('button')).toBeNull(); // 未通过的不给操作
    expect(within(screen.getByTestId('skill-version-skv_2')).queryByRole('button')).toBeNull(); // 当前版本不给操作
  });

  it('rolls back only after confirming, sending the expected current version', async () => {
    render(<OfficeCapabilitiesSlot />, { wrapper: MemoryRouter });
    const row = await screen.findByTestId('skill-version-skv_1');
    const btn = within(row).getByRole('button', { name: '回退到此版本' });
    btn.focus();
    expect(btn).toHaveFocus(); // 键盘可达
    fireEvent.click(btn);
    expect(await screen.findByText('回退「deck-qa」到版本 1？')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getAllByRole('button', { name: '回退到此版本' }).at(-1)!);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
        version_id: 'skv_1',
        expected_current_version_id: 'skv_2',
      });
    });
    expect(await screen.findByText('当前使用：版本 1')).toBeInTheDocument();
  });

  it('403 says only the administrator can; 409 refreshes the list and warns', async () => {
    publishReply = () => reply(403, { error: { code: 'FORBIDDEN', message: 'x' } });
    render(<OfficeCapabilitiesSlot />, { wrapper: MemoryRouter });
    const click = async () => {
      fireEvent.click(
        within(await screen.findByTestId('skill-version-skv_1')).getByRole('button', { name: '回退到此版本' })
      );
      fireEvent.click((await screen.findAllByRole('button', { name: '回退到此版本' })).at(-1)!);
    };
    await click();
    expect(await screen.findByText('只有管理员可以发布或回退技能。')).toBeInTheDocument();
    publishReply = () => reply(409, { error: { code: 'REVISION_CONFLICT', message: 'x' } });
    const reads = () =>
      fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/skills') && !(i as RequestInit | undefined)?.method)
        .length;
    const before = reads();
    await click();
    expect(await screen.findByText('这个技能刚被改过，已刷新，请确认后再操作。')).toBeInTheDocument();
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });
});
