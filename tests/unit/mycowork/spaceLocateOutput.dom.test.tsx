/**
 * [mycowork] PR11 W4-6：空间页收到“在空间中查看”意图（requestLocate 记下的一次性意图）。
 * 切到“产物”、按文件名查（服务端查询，不在浏览器过滤），该资源行带 is-located 并滚动到位；意图只放页面内存、只消费一次（地址栏里的旧查询串不读）；
 * 列表里没有该资源（已删/回收站/被撤权）→ 一句提示，页面照常；没有意图 → 行为不变。
 * 替身：Bridge HTTP（globalResourceFixture）；Arco、查询状态、空间页都是真实的。
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';
import { requestLocate } from '@mycowork/ui/pages/resources/locate-intent.ts';
import { fixture, item, lastQuery, list, queries, reset } from './globalResourceFixture';

const OUT = item('res_out', '季度报告.docx', { origin: 'outputs', source_id: null, state: 'stored' });
const OTHER = item('res_other', '季度报告-旧.docx', { origin: 'outputs', source_id: null, state: 'stored' });
const scrollIntoView = vi.fn();
const locate = (id: string, name: string) => {
  requestLocate(id, name);
  window.location.hash = '#/office/space';
};

beforeEach(() => {
  reset();
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('space locate-output intent', () => {
  it('opens Outputs searched by file name, marks and scrolls to the resource, and consumes the intent once (a remount does not re-apply it)', async () => {
    fixture((q) => (q.get('origin') === 'outputs' && q.get('q') === '季度报告.docx' ? list([OTHER, OUT], 2) : list([], 0)));
    locate('res_out', '季度报告.docx');
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    await waitFor(() => expect(document.querySelectorAll('[data-resource-id]').length).toBe(2));
    const row = document.querySelector('[data-resource-id="res_out"]')!;
    expect(row.className).toContain('is-located');
    expect(document.querySelector('[data-resource-id="res_other"]')!.className).not.toContain('is-located');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(lastQuery().get('origin')).toBe('outputs');
    cleanup();
    fixture((q) => (q.get('origin') === 'outputs' ? list([OUT], 1) : list([], 0)));
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    await waitFor(() => expect(queries().length).toBeGreaterThan(1));
    expect(queries().at(-1)!.get('origin')).not.toBe('outputs'); // second mount: no intent left
    expect(document.querySelector('.is-located')).toBeNull();
  });

  it('resource no longer listed (deleted / in Trash / revoked): one plain sentence, no error page', async () => {
    fixture(() => list([], 0));
    locate('res_gone', '已删.docx');
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    expect(await screen.findByText(/在“产物”里没找到“已删.docx”/)).toBeInTheDocument();
    expect(document.querySelector('.is-located')).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('no intent (a stale address-bar query is ignored): the first query is the default one, nothing is marked', async () => {
    fixture();
    window.location.hash = '#/office/space?resource=res_x';
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    await waitFor(() => expect(queries().length).toBeGreaterThan(0));
    expect(queries()[0]!.get('origin')).not.toBe('outputs');
    expect(queries()[0]!.get('q') ?? '').toBe('');
    expect(document.querySelector('.is-located')).toBeNull();
  });
});

describe('space locate-output edge cases', () => {
  it('file name with leading/trailing spaces: still marked (no comparison against the trimmed query)', async () => {
    const spaced = item('res_sp', ' 带空格 .docx', { origin: 'outputs', source_id: null, state: 'stored' });
    fixture((q) => (q.get('origin') === 'outputs' ? list([spaced], 1) : list([], 0)));
    locate('res_sp', ' 带空格 .docx');
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    await waitFor(() => expect(document.querySelector('[data-resource-id="res_sp"]')!.className).toContain('is-located'));
    expect(screen.queryByText(/没找到/)).toBeNull();
  });

  it('target not on the first page (total > items): says so instead of "deleted"', async () => {
    fixture((q) => (q.get('origin') === 'outputs' ? list([OTHER], 120) : list([], 0)));
    locate('res_far', '季度报告.docx');
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    expect(await screen.findByText('同名结果较多，请缩小范围后查找。')).toBeInTheDocument();
    expect(screen.queryByText(/没找到/)).toBeNull();
  });

  it('a name over 200 chars is cut to 200 for the query (the list API rejects longer q)', async () => {
    fixture(() => list([], 0));
    locate('res_long', '长'.repeat(260));
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    await waitFor(() => expect(queries().some((q) => q.get('origin') === 'outputs' && q.get('q') === '长'.repeat(200))).toBe(true));
    expect(queries().every((q) => (q.get('q') ?? '').length <= 200)).toBe(true);
  });

  it.each([
    [14_000, true],
    [16_000, false],
  ])('intent age %i ms: applied=%s (15 s freshness, fake Date)', async (age, applied) => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_000_000 });
    try {
      fixture((q) => (q.get('origin') === 'outputs' ? list([OUT], 1) : list([], 0)));
      locate('res_out', '季度报告.docx');
      vi.setSystemTime(1_000_000 + age);
      render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
      await waitFor(() => expect(queries().length).toBeGreaterThan(0));
      expect(queries()[0]!.get('origin') === 'outputs').toBe(applied);
    } finally {
      vi.useRealTimers();
    }
  });

  it('card layout also marks the located resource', async () => {
    localStorage.setItem('mycowork.resources.layout', 'card');
    fixture((q) => (q.get('origin') === 'outputs' ? list([OUT], 1) : list([], 0)));
    locate('res_out', '季度报告.docx');
    render(<ResourcesPage lang='zh-CN' ownerKey='fixture_a' />);
    await waitFor(() => expect(document.querySelector('.mcw-rc-card[data-resource-id="res_out"]')!.className).toContain('is-located'));
  });
});
