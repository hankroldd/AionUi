/**
 * 文件：tests/unit/mycowork/templateConfirmation.dom.test.tsx
 * 职责：真实会话插槽、共享投影和 Arco 弹窗的点击、重读、流刷新及失效隔离。
 * 边界：只替换 HTTP、IPC 与预览承载，模板 UI 与 Bridge 响应解析真实运行。
 */
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MyCoworkTemplateConfirmationProvider,
  MyCoworkTemplateConfirmationDialog,
  MyCoworkWorkspaceFileLinkSlot,
} from '@/renderer/mycowork-slots';
import { ConversationFilesToggle, fetchConversationContext } from '@mycowork/ui';
import {
  resetCurrentProjectForTest,
  setCurrentProject,
} from '@/renderer/pages/conversation/explorer/currentProjectStore';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';

type Stream = { conversation_id: string; type: string; data?: { name: string; status: string } };
const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  preview: vi.fn(),
  submit: vi.fn(),
  owner: { current: 'owner-a' as string | undefined },
  stream: new Set<(message: Stream) => void>(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: h.owner.current ? 'authenticated' : 'unauthenticated', user: { id: h.owner.current } }),
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => ({ openPreview: vi.fn() }),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: (fn: (message: Stream) => void) => {
          h.stream.add(fn);
          return () => h.stream.delete(fn);
        },
      },
    },
  },
}));
const preview = {
  decision_id: 'private-decision-id',
  decision_version: 1,
  theme: { asset_id: 'private-asset-id', version: 2, title: '暖色活动' },
  copy_id: 'private-copy-id',
  relative_path: 'deck/c1/模板.pptx',
};
const context = (value: unknown = preview) => ({
  plan_id: 'plan-one',
  version: 1,
  status: 'OK',
  working_project_id: 'p1',
  brief: { groups: [] as unknown[], policy: {} },
  used: [] as unknown[],
  withheld: 0,
  superseded: false,
  ...(value === undefined || value === null ? {} : { template_preview: value }),
});
const response = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
function Harness({ id = 'c1', disabled = false, initial = '' }: { id?: string; disabled?: boolean; initial?: string }) {
  const [content, setContent] = useState(initial);
  return (
    <MyCoworkTemplateConfirmationProvider conversationId={id} enabled>
      <MyCoworkWorkspaceFileLinkSlot relativePath={`deck/${id}/模板.pptx`}>模板.pptx</MyCoworkWorkspaceFileLinkSlot>
      <MyCoworkWorkspaceFileLinkSlot relativePath={`deck/${id}/旧模板.pptx`}>旧模板.pptx</MyCoworkWorkspaceFileLinkSlot>
      <MyCoworkWorkspaceFileLinkSlot relativePath={`deck/${id}/成品.pptx`}>成品.pptx</MyCoworkWorkspaceFileLinkSlot>
      <output data-testid='draft'>{content}</output>
      <MyCoworkTemplateConfirmationDialog
        content={content}
        onContentChange={setContent}
        onSubmit={h.submit}
        disabled={disabled}
      />
    </MyCoworkTemplateConfirmationProvider>
  );
}
const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '使用此模板' }));
  return screen.getByRole('dialog');
};
const confirm = () => fireEvent.click(screen.getByRole('button', { name: '使用并继续制作' }));
const stream = (name?: string, status = 'completed', conversation_id = 'c1') =>
  act(async () => {
    h.stream.forEach((fn) =>
      fn({ conversation_id, type: name ? 'tool_call' : 'finish', ...(name ? { data: { name, status } } : {}) })
    );
  });
beforeEach(() => {
  resetCurrentProjectForTest();
  resetCurrentConversationForTest();
  setCurrentProject('p1');
  setCurrentConversation('c1');
  h.owner.current = 'owner-a';
  h.stream.clear();
  h.fetch.mockReset().mockResolvedValue(response(context()));
  h.submit.mockReset().mockResolvedValue(true);
  h.preview.mockReset().mockResolvedValue({ ok: true, status: 200, text: async () => '<p>代表性正文页</p>' });
  // 预览请求单独记数；文件卡片的“交付文件”角色查询（output-resource）也不计入会话上下文的读取次数
  vi.stubGlobal('IntersectionObserver', undefined); // 无观察器时预览挂载即请求
  vi.stubGlobal('fetch', (url: unknown, init?: unknown) =>
    String(url).includes('/assets/')
      ? h.preview(url, init)
      : String(url).includes('/output-resource')
        ? Promise.resolve(response({}, 404))
        : h.fetch(url, init)
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('会话模板点击确认', () => {
  it('一次共享读取，只给当前真实模板动作和主题提示；原草稿带入，取消保留', async () => {
    render(<Harness initial='需要简洁的活动介绍' />);
    expect(await screen.findByRole('button', { name: '使用此模板' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: '使用此模板' })).toHaveLength(1);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/样式预览 · 待确认/)).toHaveTextContent('暖色活动');
    const dialog = await open();
    expect(within(dialog).getByText('暖色活动')).toBeVisible();
    expect(screen.queryByText('private-decision-id')).toBeNull();
    const input = screen.getByRole('textbox', { name: '补充要求（可选）' });
    expect(input).toHaveValue('需要简洁的活动介绍');
    fireEvent.change(input, { target: { value: '新补充：不要示例数字' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('draft')).toHaveTextContent('新补充：不要示例数字');
    expect(h.submit).not.toHaveBeenCalled();
  });
  it('空补充可采用，重读后只提交一次人话+相对链接，不把内部编号放进正文', async () => {
    render(<Harness />);
    await open();
    confirm();
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(h.fetch).toHaveBeenCalledTimes(2);
    const prefix = h.submit.mock.calls[0][0] as string;
    expect(prefix).toContain('请使用这个模板');
    expect(prefix).toContain('[暖色活动](deck/c1/%E6%A8%A1%E6%9D%BF.pptx)');
    expect(prefix).not.toMatch(/private-|decision|asset_id|copy_id/);
    expect(screen.getByTestId('draft')).toHaveTextContent('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('换个样式是普通用户请求，不提前选择或生成；多行Enter不提交', async () => {
    render(<Harness initial='保留原来的内容' />);
    await open();
    fireEvent.click(screen.getByRole('radio', { name: '换个样式' }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' });
    expect(h.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看其他样式' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(h.submit.mock.calls[0][0]).toContain('重新推荐并展示新模板后再由我确认');
    expect(h.fetch.mock.calls.every(([url]) => String(url).endsWith('/context'))).toBe(true);
  });
  it.each([
    { name: '计划版本', fresh: { ...context(), version: 2 } },
    { name: '决策', fresh: context({ ...preview, decision_id: 'next' }) },
    { name: '主题版本', fresh: context({ ...preview, theme: { ...preview.theme, version: 3 } }) },
    { name: '副本', fresh: context({ ...preview, copy_id: 'next' }) },
    { name: '路径', fresh: context({ ...preview, relative_path: 'deck/c1/新模板.pptx' }) },
    { name: '收缩', fresh: { ...context(), superseded: true } },
    { name: '已经采用', fresh: context(null) },
  ])('$name变化拒发，补充保留', async ({ fresh }) => {
    render(<Harness initial='请保留' />);
    await open();
    h.fetch.mockResolvedValueOnce(response(fresh));
    confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('模板已变化');
    expect(h.submit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('请保留');
  });
  it.each(['取消', '会话', '账号'])('重读迟到时%s使提交失效', async (change) => {
    const view = render(<Harness initial='补充保留' />);
    await open();
    let finish!: (v: ReturnType<typeof response>) => void;
    h.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    confirm();
    await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    if (change === '取消') fireEvent.click(screen.getByRole('button', { name: '取消' }));
    else if (change === '会话') {
      act(() => setCurrentConversation('c2'));
      view.rerender(<Harness id='c2' />);
    } else {
      h.owner.current = 'owner-b';
      view.rerender(<Harness />);
    }
    await act(async () => finish(response(context())));
    expect(h.submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('draft')).toHaveTextContent('补充保留');
  });
  it('离开账号后返回也不复活旧弹窗或迟到提交', async () => {
    const view = render(<Harness initial='未发草稿' />);
    await open();
    let finish!: (v: ReturnType<typeof response>) => void;
    h.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    confirm();
    h.owner.current = 'owner-b';
    view.rerender(<Harness />);
    h.owner.current = 'owner-a';
    view.rerender(<Harness />);
    await act(async () => finish(response(context())));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.submit).not.toHaveBeenCalled();
  });
  it('确认重读single-flight，失败/unknown保留输入且不自动重发', async () => {
    render(<Harness initial='未确认的补充' />);
    await open();
    let finish!: (v: ReturnType<typeof response>) => void;
    h.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    confirm();
    confirm();
    expect(h.fetch).toHaveBeenCalledTimes(2);
    h.submit.mockRejectedValueOnce(new Error('unknown'));
    await act(async () => finish(response(context())));
    expect(await screen.findByRole('alert')).toHaveTextContent('发送未确认');
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue('未确认的补充');
  });
  it('读取失败或忙时不发送，失败显示原输入', async () => {
    const view = render(<Harness initial='保留原输入' disabled />);
    await open();
    expect(screen.getByRole('button', { name: '使用并继续制作' })).toBeDisabled();
    confirm();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    view.rerender(<Harness initial='保留原输入' />);
    h.fetch.mockResolvedValueOnce(response({ error: { code: 'NOT_AVAILABLE' } }, 503));
    confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法核实模板');
    expect(h.submit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('保留原输入');
  });
  it('初次无模板，当前成功推荐/复制/finish自然显示，selected刷新撤去动作', async () => {
    h.fetch.mockResolvedValueOnce(response(context(null)));
    render(<Harness />);
    await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: '使用此模板' })).toBeNull();
    await stream('template_recommend');
    expect(await screen.findByRole('button', { name: '使用此模板' })).toBeVisible();
    await stream('office_copy_to_workspace');
    expect(await screen.findByRole('button', { name: '使用此模板' })).toBeVisible();
    await stream();
    expect(await screen.findByRole('button', { name: '使用此模板' })).toBeVisible();
    h.fetch.mockResolvedValue(response(context(null)));
    await stream('template_select');
    await waitFor(() => expect(screen.queryByRole('button', { name: '使用此模板' })).toBeNull());
    expect(screen.queryByText(/已采用/)).toBeNull();
  });
  it('读取中合并同会话事件并尾刷，其他会话/失败/普通工具不触发', async () => {
    let finish!: (v: ReturnType<typeof response>) => void;
    h.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<Harness />);
    await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    await stream('office_copy_to_workspace', 'completed', 'other');
    await stream('office_copy_to_workspace', 'error');
    await stream('read');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await stream('template_recommend');
    await stream('office_copy_to_workspace');
    await stream();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    await act(async () => finish(response(context(null))));
    expect(await screen.findByRole('button', { name: '使用此模板' })).toBeVisible();
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
  it('初次读取晚到或刷新失败不保留旧会话/旧模板动作', async () => {
    let finish!: (v: ReturnType<typeof response>) => void;
    h.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const view = render(<Harness />);
    await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(1));
    h.fetch.mockResolvedValue(response(context(null)));
    act(() => setCurrentConversation('c2'));
    view.rerender(<Harness id='c2' />);
    await waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    await act(async () => finish(response(context())));
    expect(screen.queryByRole('button', { name: '使用此模板' })).toBeNull();
    h.fetch.mockResolvedValue(response(context({ ...preview, relative_path: 'deck/c2/模板.pptx' })));
    await stream(undefined, 'completed', 'c2');
    await screen.findByRole('button', { name: '使用此模板' });
    h.fetch.mockResolvedValue(response({ error: { code: 'UNAVAILABLE' } }, 503));
    await stream(undefined, 'completed', 'c2');
    await waitFor(() => expect(screen.queryByRole('button', { name: '使用此模板' })).toBeNull());
  });
  it('旧context兼容，非法可选投影被边界拒绝', async () => {
    h.fetch.mockResolvedValue(response(context(null)));
    expect(await fetchConversationContext('c1')).not.toBeNull();
    h.fetch.mockResolvedValue(response(context({ ...preview, theme: { ...preview.theme, version: 0 } })));
    await expect(fetchConversationContext('c1')).rejects.toThrow('invalid context response');
  });
});

describe('模板确认弹窗的正文页预览', () => {
  it('按主题 asset_id 与 version 请求预览并在隔离 iframe 渲染，不泄露内部编号', async () => {
    render(<Harness />);
    const dialog = await open();
    const frame = await within(dialog).findByTitle('暖色活动的预览');
    expect(h.preview.mock.calls[0][0]).toBe('/bridge/v1/assets/private-asset-id/preview?version=2');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain('代表性正文页');
    expect(dialog.textContent).not.toMatch(/private-/);
  });
  it.each([
    {
      name: 'ASSET_CHANGED',
      res: { ok: false, status: 409, json: async () => ({ error: { code: 'ASSET_CHANGED' } }) },
      note: '预览暂不可用',
    },
    {
      name: '服务错误',
      res: { ok: false, status: 500, json: async () => ({ error: { code: 'INTERNAL' } }) },
      note: '预览加载失败',
    },
  ])('预览$name时显示说明，仍可确认', async ({ res, note }) => {
    h.preview.mockResolvedValue(res);
    render(<Harness initial='先保留' />);
    const dialog = await open();
    expect(await within(dialog).findByTestId('asset-preview-msg')).toHaveTextContent(note);
    confirm();
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('没有“查看当前模板”按钮（预览已内嵌）；Esc 关闭后补充保留在草稿里，预览未成为必点步骤', async () => {
    render(<Harness initial='补充甲' />);
    await open();
    expect(screen.queryByRole('button', { name: '查看当前模板' })).toBeNull();
    fireEvent.keyDown(within(screen.getByRole('dialog')).getByRole('textbox'), { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('draft')).toHaveTextContent('补充甲');
    expect(h.submit).not.toHaveBeenCalled();
  });
  it('主按钮文案随选项切换：使用并继续制作 / 查看其他样式', async () => {
    render(<Harness />);
    await open();
    expect(screen.getByRole('button', { name: '使用并继续制作' })).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: '换个样式' }));
    expect(screen.getByRole('button', { name: '查看其他样式' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '使用并继续制作' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '采用这个模板' }));
    expect(screen.getByRole('button', { name: '使用并继续制作' })).toBeVisible();
  });
  it('弹窗带 mcw-modal，宽度不超过视口，Esc 取消', async () => {
    render(<Harness />);
    const dialog = await open();
    expect(dialog.closest('.mcw-modal')).not.toBeNull();
    expect((dialog.closest('.mcw-modal') as HTMLElement).style.maxWidth).toBe('calc(100vw - 32px)');
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape', code: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
it('当前文件范围提示随原按钮切换，按钮文字和回调保持', () => {
  function Toggle() {
    const [all, setAll] = useState(false);
    return <ConversationFilesToggle lang='zh-CN' showAll={all} onToggle={() => setAll(!all)} />;
  }
  render(<Toggle />);
  expect(screen.getByRole('status')).toHaveTextContent('本次对话');
  fireEvent.click(screen.getByRole('button', { name: '显示全部' }));
  expect(screen.getByRole('status')).toHaveTextContent('全部文件');
  fireEvent.click(screen.getByRole('button', { name: '仅本次对话' }));
  expect(screen.getByRole('status')).toHaveTextContent('本次对话');
});
