/**
 * [mycowork] adapted：分支创建 UI 状态机（拆分b，原 branch-dialog.dom.test.tsx，用例原样）。
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { BranchDialog, BranchMessageButton } from '@mycowork/ui/branches/index.ts';
import { VersionTimeline } from '@mycowork/ui/pages/versions/VersionTimeline.tsx';
import { versionsText } from '@mycowork/ui/pages/versions/index.ts';
import { anchor, ownerKey, setup, mount, create } from './branch-dialog.fixture';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('分支创建的真实UI状态机', () => {
  it('超长消息明确报错，不截断、不发写请求', async () => {
    const s = setup({ content: 'x'.repeat(262145) });
    mount(s.adapter);
    await screen.findByText(/所选消息超过输入框可保存的长度/);
    expect(s.calls).toHaveLength(0);
  });

  it.each(['owner', 'unmount'])('在途配置准备期间%s变化后不继续创建', async (change) => {
    const s = setup();
    let release!: (value: any) => void;
    const original = await s.adapter.prepare(anchor);
    vi.mocked(s.adapter.prepare).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const view = mount(s.adapter);
    if (change === 'owner')
      view.rerender(
        <BranchDialog
          anchor={anchor}
          files={[]}
          ownerKey='other-owner'
          adapter={s.adapter}
          lang='zh-CN'
          onCancel={vi.fn()}
        />
      );
    else view.unmount();
    await act(async () => release(original));
    expect(s.calls).toHaveLength(0);
    expect(s.adapter.openConversation).not.toHaveBeenCalled();
  });

  it.each(['owner', 'unmount'])('在途会话创建期间%s变化后不登记、不绑定、不导航', async (change) => {
    const s = setup();
    let release!: () => void;
    s.createConversation.mockImplementationOnce(async (id, session) => {
      s.conversations.set(s.actualId, session.workspace);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return s.actualId;
    });
    const view = mount(s.adapter);
    await create();
    await waitFor(() => expect(s.createConversation).toHaveBeenCalledOnce());
    if (change === 'owner')
      view.rerender(
        <BranchDialog
          anchor={anchor}
          files={[]}
          ownerKey='other-owner'
          adapter={s.adapter}
          lang='zh-CN'
          onCancel={vi.fn()}
        />
      );
    else view.unmount();
    await act(async () => release());
    expect(
      s.calls.some((c) => c.path.endsWith('/execution') || c.path.endsWith('/plan') || c.path.includes('/drafts/'))
    ).toBe(false);
    expect(s.adapter.openConversation).not.toHaveBeenCalled();
  });

  it('P04必须明确选择不复制文件；不宣称冻结整个文件现场', async () => {
    const s = setup();
    render(<BranchMessageButton anchor={anchor} ownerKey={ownerKey} adapter={s.adapter} lang='zh-CN' />);
    fireEvent.click(screen.getByRole('button', { name: '基于此内容新建会话' }));
    fireEvent.click(await screen.findByRole('button', { name: /技术细节/ }));
    await screen.findByText(/入口哈希已冻结/);
    expect(screen.getByRole('button', { name: '创建会话' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('不复制文件，仅基于这条消息创建'));
    await create();
    await waitFor(() => expect(s.adapter.openConversation).toHaveBeenCalledOnce());
    expect(s.calls.find((c) => c.path === '/bridge/v1/branches')!.body.files).toEqual([]);
  });

  it('P04从授权资源列表明确选择历史版本，冻结并在草稿说明所复制版本', async () => {
    const s = setup();
    render(<BranchMessageButton anchor={anchor} ownerKey={ownerKey} adapter={s.adapter} lang='zh-CN' />);
    fireEvent.click(screen.getByRole('button', { name: '基于此内容新建会话' }));
    fireEvent.click(screen.getByLabelText('复制选定文件版本'));
    await waitFor(() => expect(s.calls.some((c) => c.path.startsWith('/bridge/v1/resources?'))).toBe(true));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '选择文件' })).not.toHaveClass('arco-select-disabled')
    );
    fireEvent.click(screen.getByRole('combobox', { name: '选择文件' }));
    fireEvent.click(await screen.findByText('合成资料.md'));
    await waitFor(() => expect(s.calls.some((c) => c.path.endsWith('/file-1/revisions'))).toBe(true));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '选择版本' })).not.toHaveClass('arco-select-disabled')
    );
    fireEvent.click(screen.getByRole('combobox', { name: '选择版本' }));
    fireEvent.click(await screen.findByText('v1 · 2026-10-14T00:00:00Z'));
    fireEvent.click(screen.getByRole('button', { name: '加入分支' }));
    await create();
    await waitFor(() => expect(s.adapter.openConversation).toHaveBeenCalledOnce());
    expect(s.calls.find((c) => c.path === '/bridge/v1/branches')!.body.files).toEqual([
      { resource_id: 'file-1', revision_id: 'rev-1' },
    ]);
    expect(s.calls.find((c) => c.path.includes('/drafts/'))!.body.state.content).toContain('合成资料.md (rev-1)');
  });

  it('P12更多菜单固定选中历史版本，anchor:null且不查询原会话计划', async () => {
    const s = setup();
    const props = {
      items: [
        { revision_id: 'historical-rev', origin: 'edit', created_at: '2026-10-14T00:00:00Z', current: false } as any,
      ],
      pubs: [],
      pubsStale: false,
      selected: undefined,
      lang: 'zh-CN',
      text: versionsText('zh-CN'),
      vOf: () => 'v1',
      kbName: () => undefined,
      canAct: true,
      more: { has: false, loading: false, onLoad: vi.fn() },
      onSelect: vi.fn(),
      onRestore: vi.fn(),
      resourceId: 'file-1',
      headRevisionId: 'latest-rev',
      ownerKey,
      fileName: '合成文件.md',
      onAccept: vi.fn(),
      onRetry: vi.fn(),
      branchAdapter: s.adapter,
    };
    render(<VersionTimeline {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '更多操作 v1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '从此分支' }));
    expect(await screen.findByText(/只复制所选版本，不继承原会话/)).toBeInTheDocument();
    await create();
    await waitFor(() => expect(s.adapter.openConversation).toHaveBeenCalledOnce());
    expect(s.adapter.prepare).toHaveBeenCalledWith(null);
    expect(s.calls.some((c) => c.path.endsWith('/context'))).toBe(false);
    expect(s.calls.find((c) => c.path === '/bridge/v1/branches')!.body).toMatchObject({
      anchor: null,
      files: [{ resource_id: 'file-1', revision_id: 'historical-rev' }],
      context_plan_id: 'empty-plan',
    });
    expect(s.calls.find((c) => c.path === '/bridge/v1/branches')!.body).not.toHaveProperty('independent_context_plan');
    expect(s.calls.find((c) => c.path.includes('/drafts/'))!.body.state.content).toContain(
      '合成资料.md (historical-rev)'
    );
  });
});
