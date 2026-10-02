/**
 * [mycowork] ADR-0011/D176: the trash route keeps one Space navigation.
 * Only the Bridge HTTP boundary is replaced; no runtime, credentials or user files.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';

const fetchMock = vi.fn();
const reply = (body: unknown) => ({ status: 200, ok: true, json: async () => body });
beforeEach(() => {
  localStorage.clear();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/bridge/v1/scopes') return reply({ sources: [], projects: [] });
    if (url === '/bridge/v1/tags') return reply({ tags: [] });
    if (url === '/bridge/v1/saved-views') return reply({ views: [] });
    if (url === '/bridge/v1/collections') return reply({ collections: [] });
    return reply({ items: [], page: 1, page_size: 50, total: 0 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('Space exposes trash at the bottom and entering it does not query ordinary resources', async () => {
  render(<ResourcesPage lang='zh-CN' />);
  const trash = await screen.findByRole('button', { name: '回收站' });
  await screen.findByText('最近没有变化的资料');
  fetchMock.mockClear();
  fireEvent.click(trash);
  await screen.findByTestId('mycowork-trash');
  expect(trash.getAttribute('aria-current')).toBe('page');
  expect(screen.getAllByRole('navigation', { name: '空间' })).toHaveLength(1);
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/bridge/v1/trash?'))).toBe(true)
  );
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('/bridge/v1/resources?'))).toBe(false);
  expect(fetchMock.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false);
});
