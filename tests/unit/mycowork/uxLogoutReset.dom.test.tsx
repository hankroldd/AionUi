/**
 * [mycowork] PR11 体验片 B 审查修正：退出登录后，删除 / 永久删除 / 发布的后台任务状态与提示不残留（里面有上一个账号的文件名）。
 * 边界：身份 / 主题 / 预览 hook 为替身（同 officeRail）；批次模块、Arco 提示与图标栏是真的，fetch 返回 409 让两类批次留下失败项。
 */
import React from 'react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Message } from '@arco-design/web-react';
import { runTrashBatch } from '@mycowork/ui/pages/resources/trash-batch-notice.tsx';
import { trashBatchState } from '@mycowork/ui/pages/resources/trash-batch.ts';
import { purgeBatch, startPurge } from '@mycowork/ui/pages/trash/purge-batch.ts';
import { publishNotice } from '@mycowork/ui/pages/versions/publication-notice.tsx';

configure({ asyncUtilTimeout: 4000 });
const state = vi.hoisted(() => ({ logout: vi.fn(), closePreview: vi.fn(), clearPreviewForScope: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'a' }, status: 'authenticated', logout: state.logout }),
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ activeId: 'system', selectTheme: vi.fn() }),
}));
vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({ useFeedback: () => ({ openFeedback: vi.fn() }) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ setSiderCollapsed: vi.fn() }) }));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({ usePreviewContext: () => state }));
import MyCoworkRail from '@/renderer/mycowork-rail';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('electronAPI', undefined);
  state.logout.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', async (url: string) =>
    String(url).endsWith('/metadata') ? reply(200, { metadata_revision: 1 }) : reply(409, { error: { code: 'EDIT_LEASE_HELD' } }),
  );
});
afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});

it('退出登录后：失败提示消失、三类批次状态为空', async () => {
  runTrashBatch(
    [{ resource_id: 'res_x', file_name: '上一个账号的文件.md', origin: 'imports', source_id: null } as never],
    'zh-CN',
  );
  startPurge([{ resource_id: 'res_y', file_name: '另一个文件.md', metadata_revision: 1 } as never], false);
  publishNotice('publish:res_z').info('上一个账号的发布提示');
  await screen.findByText(/上一个账号的文件\.md/);
  await waitFor(() => expect(purgeBatch().failed).toHaveLength(1));
  render(
    <MemoryRouter initialEntries={['/guid']}>
      <MyCoworkRail mobile={false} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: '账户菜单' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }));
  await waitFor(() => expect(screen.queryByText(/上一个账号的文件\.md/)).toBeNull());
  await waitFor(() => expect(screen.queryByText('上一个账号的发布提示')).toBeNull());
  expect(trashBatchState().failed).toHaveLength(0);
  expect(trashBatchState().total).toBe(0);
  expect(purgeBatch().total).toBe(0);
  expect(purgeBatch().failed).toHaveLength(0);
});
