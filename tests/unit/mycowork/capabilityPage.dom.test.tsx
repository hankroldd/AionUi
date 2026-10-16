/**
 * [mycowork] ADR-0011: `/office/capabilities` (MyCowork P10 capability center, PR11 T12e1). Only fetch is mocked.
 * Covers: rows show the contract wording + "version not verified" badge + fixed reason; re-check POSTs `{}` and replaces
 * only that row (button busy meanwhile); a failed list read shows Result + retry that reads again.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeCapabilitiesSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const cap = (over: object) => ({
  id: 'knowledge',
  state: 'ready',
  dependencies: [],
  allowedDataScopes: [],
  testedAt: new Date().toISOString(),
  version_verified: true,
  ...over,
});
const LIST = [
  cap({ id: 'knowledge', state: 'temporarily_unavailable', reason: '服务端原样文案（虚构）' }),
  cap({ id: 'office-edit', version_verified: false }),
];

describe('OfficeCapabilitiesSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists states with contract wording, the unverified badge and the fixed reason', async () => {
    fetchMock.mockResolvedValue(reply(200, { capabilities: LIST }));
    render(<OfficeCapabilitiesSlot />);
    const row = await screen.findByTestId('capability-knowledge');
    expect(within(row).getByText('暂时故障')).toBeInTheDocument();
    expect(within(row).getByText('检查未通过，可重新检查')).toBeInTheDocument();
    expect(within(row).queryByText('服务端原样文案（虚构）')).toBeNull(); // 界面按状态取本地化文案，不直出服务端中文
    expect(within(row).queryByText('版本未验证')).toBeNull();
    const other = screen.getByTestId('capability-office-edit');
    expect(within(other).getByText('可使用')).toBeInTheDocument();
    expect(within(other).getByText('版本未验证')).toBeInTheDocument();
  });

  it('re-checks one item with an empty body and replaces only that row', async () => {
    let finish: (v: unknown) => void = () => {};
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise((resolve) => (finish = resolve))
        : Promise.resolve(reply(200, { capabilities: LIST })),
    );
    render(<OfficeCapabilitiesSlot />);
    const row = await screen.findByTestId('capability-knowledge');
    fireEvent.click(within(row).getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: /检查中/ })).toBeDisabled());
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(url).toBe('/bridge/v1/capabilities/knowledge/check');
    expect(JSON.parse(String(init.body))).toEqual({});
    finish(reply(200, cap({ id: 'knowledge', state: 'ready' })));
    await waitFor(() => expect(within(row).getByText('可使用')).toBeInTheDocument());
    expect(within(row).queryByText('暂时故障')).toBeNull();
    expect(within(row).getByRole('button', { name: '重新检查' })).toBeEnabled();
  });

  it('shows Result with retry when the list cannot be read, then recovers', async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: { code: 'INTERNAL', message: 'x' } }));
    fetchMock.mockResolvedValue(reply(200, { capabilities: LIST }));
    render(<OfficeCapabilitiesSlot />);
    expect(await screen.findByText('没有读到能力状态')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    expect(await screen.findByTestId('capability-knowledge')).toBeInTheDocument();
  });
});
