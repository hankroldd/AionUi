/**
 * 文件/职责：测试 /office/research 研究记录页（只读）：查询/来源状态/条目，外链安全打开，失败来源与空状态。
 * [mycowork] ADR-0011: `/office/research` (MyCowork P13 research log, read-only, R050). Only fetch is mocked.
 * Covers: entry shows query/time/source status/items; external links open in a new window with noopener noreferrer;
 * a failed source is shown as text with its reason; empty state; "load older" follows next_cursor; arXiv-off hint links to connections.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeResearchSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
const log = (over: object) => ({
  log_id: 'rlog_1',
  submission_id: '00000000-0000-4000-8000-000000000001',
  query: '图神经网络 照明控制（虚构）',
  run_at: '2026-10-17T08:00:00.000Z',
  sources: [{ source: 'arxiv', status: 'ok' }],
  items: [
    {
      source: 'arxiv',
      title: '虚构论文：一种示例方法',
      url: 'https://example.test/abs/0000.00001',
      first_published_at: '2026-09-01T00:00:00Z',
      revised_at: '2026-09-20T00:00:00Z',
      discovered_at: '2026-10-17T08:00:00Z',
      version: 'v2',
      fulltext_status: 'abstract_only',
    },
    {
      source: 'arxiv',
      title: '虚构论文二',
      first_published_at: null,
      discovered_at: '2026-10-17T08:00:00Z',
      fulltext_status: 'pending_confirmation',
    },
  ],
  created_at: '2026-10-17T08:00:01.000Z',
  ...over,
});
const caps = (state: string) => reply(200, { capabilities: [{ id: 'research.arxiv', state, version_verified: true }] });
const route = (logs: (url: string) => unknown, state = 'ready') =>
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/capabilities') ? caps(state) : logs(String(url))
  );

describe('OfficeResearchSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows query, source status and items; links open in a new window safely; unknown publish time is stated', async () => {
    route(() => reply(200, { items: [log({})] }));
    render(<OfficeResearchSlot />, { wrapper: MemoryRouter });
    const row = await screen.findByTestId('research-rlog_1');
    expect(within(row).getByText('图神经网络 照明控制（虚构）')).toBeInTheDocument();
    expect(within(row).getByText(/arxiv 成功/)).toBeInTheDocument();
    const a = within(row).getByRole('link', { name: /虚构论文：一种示例方法/ });
    expect(a).toHaveAttribute('href', 'https://example.test/abs/0000.00001');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(row).getByText(/首次发表 2026-09-01 · 修订 2026-09-20 · 版本 v2 · 只有摘要/)).toBeInTheDocument();
    expect(within(row).getByText(/首次发表时间来源未给出/)).toBeInTheDocument();
    expect(screen.queryByTestId('mycowork-research-arxiv-off')).toBeNull();
  });

  it('a failed source is plain text with its reason (no items)', async () => {
    route(() =>
      reply(200, {
        items: [log({ sources: [{ source: 'arxiv', status: 'rate_limited', reason: '被限流' }], items: [] })],
      })
    );
    render(<OfficeResearchSlot />, { wrapper: MemoryRouter });
    expect(await screen.findByRole('alert')).toHaveTextContent('arxiv：这次检索失败（被限流）');
  });

  it('empty state; arXiv not configured shows a link to connections', async () => {
    route(() => reply(200, { items: [] }), 'not_configured');
    render(<OfficeResearchSlot />, { wrapper: MemoryRouter });
    expect(await screen.findByText('还没有研究记录')).toBeInTheDocument();
    const hint = await screen.findByTestId('mycowork-research-arxiv-off');
    expect(hint).toHaveTextContent('部署负责人');
    expect(within(hint).getByRole('link', { name: '查看配置说明' })).toHaveAttribute('href', '#/office/connections');
  });

  it('"load older" follows next_cursor and appends', async () => {
    route((url) =>
      url.includes('cursor=rlog_1')
        ? reply(200, { items: [log({ log_id: 'rlog_0', query: '更早的查询' })] })
        : reply(200, { items: [log({})], next_cursor: 'rlog_1' })
    );
    render(<OfficeResearchSlot />, { wrapper: MemoryRouter });
    fireEvent.click(await screen.findByRole('button', { name: '加载更早的记录' }));
    expect(await screen.findByTestId('research-rlog_0')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: '加载更早的记录' })).toBeNull());
    expect(screen.getByTestId('research-rlog_1')).toBeInTheDocument();
  });

  it('read failure shows an error with retry', async () => {
    route(() => reply(500, { error: { code: 'INTERNAL' } }));
    render(<OfficeResearchSlot />, { wrapper: MemoryRouter });
    expect(await screen.findByText('研究记录读取失败')).toBeInTheDocument();
  });

  it('shows authors (first 3 + "等 N 人"), arXiv link built from the id, idea note; old items still render; ideas-only filter', async () => {
    const withIdea = {
      source: 'arxiv',
      title: '带想法的论文',
      authors: ['甲', '乙', '丙', '丁'],
      arxiv_id: '2610.00001v2',
      idea: '可借鉴其采样思路',
      first_published_at: null,
      discovered_at: '2026-10-17T08:00:00Z',
      fulltext_status: 'abstract_only',
    };
    const badId = { ...withIdea, title: '坏编号', authors: ['戊'], arxiv_id: 'javascript:alert(1)', idea: undefined };
    route(() => reply(200, { items: [log({ items: [withIdea, badId] }), log({ log_id: 'rlog_2', query: '旧记录' })] }));
    render(<OfficeResearchSlot />, { wrapper: MemoryRouter });
    const row = await screen.findByTestId('research-rlog_1');
    expect(within(row).getByText(/甲、乙、丙 等 4 人/)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'arXiv:2610.00001v2' })).toHaveAttribute(
      'href',
      'https://arxiv.org/abs/2610.00001v2'
    );
    expect(within(row).queryByRole('link', { name: /javascript/ })).toBeNull();
    expect(within(row).getByTestId('research-idea')).toHaveTextContent('想法：可借鉴其采样思路');
    expect(screen.getByTestId('research-rlog_2')).toHaveTextContent('虚构论文：一种示例方法');
    fireEvent.click(screen.getByRole('checkbox', { name: '只看有想法的条目' }));
    expect(screen.queryByTestId('research-rlog_2')).toBeNull();
    expect(within(screen.getByTestId('research-rlog_1')).queryByText('坏编号')).toBeNull();
    expect(within(screen.getByTestId('research-rlog_1')).getByText('带想法的论文')).toBeInTheDocument();
  });
});
