/**
 * [mycowork] PR11 T12c1：三个真实读失败入口的折叠诊断与重试。
 * 边界：真实组件/Arco，仅虚构HTTP边界；不替代真实浏览器或L3验收。
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ImportsPage, MemoryPage } from '@mycowork/ui';
import { ResourceBrowser } from '@mycowork/ui/resource-browser/index.ts';
import { BridgeError, BridgeReadFailure, bridgeFailureText } from '@mycowork/ui/scope-picker/index.ts';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
let failed: boolean;
beforeEach(() => {
  failed = true;
  window.location.hash = '#/office/imports';
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/memory-settings')) return reply(200, { paused: false });
    return failed
      ? reply(422, { error: { code: 'INTERNAL', message: '/private/fixture.key must not be shown' } })
      : reply(200, { items: [], total: 0, page: 1, page_size: 50 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('详情输入与现场', () => {
  it.each(['INTERNAL', 'A'.repeat(64), 'HTTP 500'])('规范码仅展开后呈现：%s', (code) => {
    const retry = vi.fn();
    const error = new BridgeError('failed', code, { message: '/private/fixture.key', body: 'fixture_body' });
    render(<BridgeReadFailure lang='en' error={error} onRetry={retry} />);
    const details = screen.getByRole('button', { name: 'Details' });
    expect(details.tagName).toBe('BUTTON');
    expect(screen.queryByText(code, { exact: true })).not.toBeInTheDocument();
    fireEvent.click(details);
    expect(screen.getByText(code, { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain('/private/fixture.key');
    expect(document.body.textContent).not.toContain('fixture_body');
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(details);
    expect(screen.queryByText(code, { exact: true })).not.toBeInTheDocument();
  });

  it.each(['/private/fixture.key', 'Bearer fixture-secret', '<script>fixture</script>', 'INTERNAL\n', 'A'.repeat(65)])(
    '非法诊断不回显：%s', (value) => {
      render(<BridgeReadFailure lang='en' error={new BridgeError('failed', value)} onRetry={vi.fn()} />);
      expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain(value);
    }
  );

  it('任意Error/对象的消息不作为诊断，不调用未知toString', () => {
    const view = render(<BridgeReadFailure lang='en' error={new Error('fixture_secret')} onRetry={vi.fn()} />);
    expect(document.body.textContent).not.toContain('fixture_secret');
    view.rerender(<BridgeReadFailure lang='en' error={{ toString: () => { throw new Error('must not stringify'); } }} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument();
  });

  it.each([new BridgeError('unauthenticated'), new BridgeError('failed', 'FORBIDDEN'),
    new BridgeError('failed', 'NOT_FOUND'), new BridgeError('scope_changed')])('不可直接重试的错误：%s', (error) => {
    render(<BridgeReadFailure lang='en' error={error} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('contact your administrator (details:');
  });

  it('新错误/语言不继承展开；重试只在点击时执行；旧字符串API保持原样', () => {
    const retry = vi.fn();
    const first = new BridgeError('failed', 'INTERNAL');
    const view = render(<BridgeReadFailure lang='en' error={first} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const second = new BridgeError('failed', 'UNSUPPORTED_FORMAT');
    view.rerender(<BridgeReadFailure lang='en' error={second} onRetry={retry} />);
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    view.rerender(<BridgeReadFailure lang='zh-CN' error={second} onRetry={retry} />);
    expect(screen.getByRole('button', { name: '详情' })).toHaveAttribute('aria-expanded', 'false');
    view.rerender(<BridgeReadFailure lang='en' error={second} onRetry={retry} />);
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
    view.rerender(<BridgeReadFailure lang='zh-CN' error={second} onRetry={retry} />);
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(bridgeFailureText('en', first)).toBe('The action did not finish; retry, or contact your administrator (details: INTERNAL).');
  });
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['imports', 'memory', 'browser'] as const)('真实入口 %s', (page) => {
  it('先显示人话；详情显式展开；原重试成功后清掉错误，篮子不丢', async () => {
    if (page === 'imports') render(<ImportsPage lang='en' />);
    else if (page === 'memory') render(<MemoryPage lang='en' />);
    else render(
      <ResourceBrowser
        source={{ source_id: 'src_fixture', name: '虚构库', provider: 'weknora', counts: { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 } }}
        tagIds={[]} initialIds={['res_keep']} lang='en'
        onClose={vi.fn()} onConfirm={vi.fn()} onPreview={vi.fn()} afterClose={vi.fn()}
      />
    );
    const details = await screen.findByRole('button', { name: 'Details' });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('INTERNAL', { exact: true })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('/private/fixture.key');
    fireEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('INTERNAL', { exact: true })).toBeVisible();
    if (page === 'browser') expect(screen.getByText('1 selected', { exact: true })).toBeVisible();
    failed = false;
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument());
    if (page === 'browser') expect(screen.getByText('1 selected', { exact: true })).toBeVisible();
  });
});
