/**
 * [mycowork] ADR-0011: `/office/memory` (MyCowork P11 memory page, PR09 slice b).
 * Only the Bridge boundary is mocked (fetch). Covers: candidates grouped by scope with source links; accept/reject carry
 * the read revision; editing sends `modify` with the new text; switching to "active" lists active items with "disable";
 * a 409 reloads and says so; the pause switch PUTs settings. Candidates are submitted from the conversation entry
 * (R057: always with a source), so the page has no free-text input.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeMemorySlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ state: null, pathname: '/' }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const mem = (over: object) => ({
  memory_id: 'mem_1',
  kind: 'fact',
  scope: { type: 'project', id: 'p1' },
  text: '二期验收定在十月（虚构）',
  sources: { resource_ids: ['res_a'], conversation_id: 'c1' },
  status: 'candidate',
  revision: 2,
  exportable: false,
  created_at: 't',
  updated_at: 't',
  ...over,
});
const calls = (method: string, part: string) =>
  fetchMock.mock.calls.filter(([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(part));
const bodyOf = (method: string, part: string) => JSON.parse(String(calls(method, part)[0]?.[1]?.body));

function bridge(opts: { actStatus?: number } = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.startsWith('/bridge/v1/memory-items?')) {
      const items = url.includes('status=active')
        ? [
            mem({
              memory_id: 'mem_2',
              kind: 'preference',
              scope: { type: 'personal' },
              text: '图表用蓝色',
              status: 'active',
              sources: { resource_ids: [] },
            }),
          ]
        : [
            mem({}),
            mem({
              memory_id: 'mem_3',
              kind: 'preference',
              scope: { type: 'personal' },
              text: '先写结论',
              sources: { resource_ids: [] },
            }),
          ];
      return reply(200, { items, page: 1, page_size: 50, total: items.length });
    }
    if (url.endsWith('/actions'))
      return opts.actStatus
        ? reply(opts.actStatus, { error: { code: 'MEMORY_STATE_CONFLICT', message: 'x' } })
        : reply(200, {});
    if (url === '/bridge/v1/memory-settings') return reply(200, { paused: method === 'PUT' });
    return reply(404, {});
  });
}

describe('OfficeMemorySlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('groups candidates by scope with source links, and accept/reject send the read revision', async () => {
    bridge();
    render(<OfficeMemorySlot />);
    expect(await screen.findByText('二期验收定在十月（虚构）')).toBeInTheDocument();
    expect(screen.getByText('项目')).toBeInTheDocument();
    expect(screen.getByText('个人')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '来源 1' })).toHaveAttribute('href', '/bridge/v1/resources/res_a/preview');
    expect(screen.getByRole('link', { name: '所在会话' })).toHaveAttribute('href', '#/conversation/c1');
    // 分组顺序：个人（mem_3）在前、项目（mem_1）在后
    fireEvent.click(screen.getAllByRole('button', { name: '接受' })[1] as HTMLElement);
    await waitFor(() => expect(calls('POST', '/memory-items/mem_1/actions')).toHaveLength(1));
    expect(bodyOf('POST', '/memory-items/mem_1/actions')).toEqual({ action: 'accept', expected_revision: 2 });
    fireEvent.click(screen.getAllByRole('button', { name: '拒绝' })[0] as HTMLElement);
    await waitFor(() => expect(calls('POST', '/memory-items/mem_3/actions')).toHaveLength(1));
    expect(bodyOf('POST', '/memory-items/mem_3/actions')).toEqual({ action: 'reject', expected_revision: 2 });
  });

  it('edits with modify and the new text; active items offer disable', async () => {
    bridge();
    render(<OfficeMemorySlot />);
    await screen.findByText('先写结论');
    fireEvent.click(screen.getAllByRole('button', { name: '修改' })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText('修改 先写结论'), { target: { value: '先写结论再写过程' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(calls('POST', '/memory-items/mem_3/actions')).toHaveLength(1));
    expect(bodyOf('POST', '/memory-items/mem_3/actions')).toEqual({
      action: 'modify',
      expected_revision: 2,
      text: '先写结论再写过程',
    });
    fireEvent.click(screen.getByRole('tab', { name: '已生效' }));
    expect(await screen.findByText('图表用蓝色')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    await waitFor(() => expect(calls('POST', '/memory-items/mem_2/actions')).toHaveLength(1));
    expect(bodyOf('POST', '/memory-items/mem_2/actions').action).toBe('disable');
  });

  it('a 409 on an action reloads and says so', async () => {
    bridge({ actStatus: 409 });
    render(<OfficeMemorySlot />);
    await screen.findByText('先写结论');
    const before = calls('GET', '/memory-items?').length;
    fireEvent.click(screen.getAllByRole('button', { name: '接受' })[0] as HTMLElement);
    expect(await screen.findByText('条目已被更新，已重新读取；请再操作一次。')).toBeInTheDocument();
    expect(calls('GET', '/memory-items?').length).toBeGreaterThan(before);
  });

  it('the pause switch PUTs the whole settings object', async () => {
    bridge();
    render(<OfficeMemorySlot />);
    await screen.findByText('先写结论');
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: '暂停自动沉淀' })));
    await waitFor(() => expect(calls('PUT', '/bridge/v1/memory-settings')).toHaveLength(1));
    expect(bodyOf('PUT', '/bridge/v1/memory-settings')).toEqual({ paused: true });
  });
});
