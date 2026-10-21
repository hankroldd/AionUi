/**
 * [mycowork] A532：对话/首页/批准卡的体验修复。
 * 覆盖：WebUI 不渲染“在项目中工作”（D306）、内部路径过滤、批准卡请求详情默认收起、停止后“重新发送本轮”、开关与关闭按钮补名称、Microcompact 提示不显示。
 * 只替身外部边界（ipcBridge、i18n）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { TaskRun } from '@mycowork/contracts';
import { TaskCompletion } from '@mycowork/ui';
import type { IMessagePermission, IMessageTips, TMessage } from '@/common/chat/chatLib';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import MessagePermission from '@/renderer/pages/conversation/Messages/components/MessagePermission';
import MessageTips from '@/renderer/pages/conversation/Messages/components/MessageTips';
import { MessageListProvider } from '@/renderer/pages/conversation/Messages/hooks';
import GuidWorkspaceFootnote from '@/renderer/pages/guid/components/GuidWorkspaceFootnote';
import { hideInternalNodes, isInternalPath } from '@/renderer/pages/conversation/explorer/search/internalPaths';
import { labelUnnamed } from '@/renderer/mycowork-a11y';

vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getConversationMessage: { invoke: vi.fn().mockResolvedValue(null) } },
    conversation: { confirmation: { confirm: { invoke: vi.fn() } } },
    dialog: { showOpen: { invoke: vi.fn() } },
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key,
    i18n: { language: 'zh-CN', t: (k: string) => (k === 'common.close' ? '关闭' : k) },
  }),
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({ useThemeContext: () => ({ theme: 'light' }) }));
vi.mock('i18next', () => ({ default: { t: (k: string) => (k === 'common.close' ? '关闭' : k) } }));

const electron = (window as { electronAPI?: unknown }).electronAPI; // 测试环境默认模拟桌面端；WebUI 用例临时去掉
afterEach(() => {
  cleanup();
  (window as { electronAPI?: unknown }).electronAPI = electron;
});

describe('D306 WebUI 不提供服务器目录入口', () => {
  const footnote = () =>
    render(<GuidWorkspaceFootnote workspaceDir='' onSelectWorkspace={vi.fn()} onClearWorkspace={vi.fn()} />);
  it('WebUI：不渲染“在项目中工作”', () => {
    delete (window as { electronAPI?: unknown }).electronAPI;
    footnote();
    expect(screen.queryByTestId('workspace-selector-btn')).toBeNull();
  });
  it('桌面端（有 electronAPI）：照常渲染', () => {
    (window as { electronAPI?: unknown }).electronAPI = {};
    footnote();
    expect(screen.getByTestId('workspace-selector-btn')).toBeTruthy();
  });
});

describe('文件区与 @ 候选隐藏内部路径', () => {
  it('点目录/点文件与他会话 deck/<哈希> 隐藏，本会话与非哈希目录保留', () => {
    const cid = 'c1ac6fe4';
    expect(isInternalPath('.claude/settings.json', cid, true)).toBe(true);
    expect(isInternalPath('.aionrs.toml', cid, true)).toBe(true);
    expect(isInternalPath('deck/b723c644/汇报.pptx', cid, true)).toBe(true);
    expect(isInternalPath(`deck/${cid}/汇报.pptx`, cid, true)).toBe(false);
    expect(isInternalPath('deck/e2e-2026/汇报.pptx', cid, true)).toBe(false);
    expect(isInternalPath('原件/预算.xlsx', cid, true)).toBe(false);
    expect(isInternalPath('deck/20261021/a.pptx', cid, true)).toBe(false); // 纯数字目录是日期，不是会话哈希
    expect(isInternalPath('.claude/settings.json', cid, false)).toBe(false); // 非 MyCowork 会话不过滤
  });
  it('树节点递归过滤', () => {
    const n = (path: string, children?: unknown[]) => ({
      key: `pe1\u0000${path}`,
      title: path,
      isLeaf: !children,
      children,
    });
    const out = hideInternalNodes(
      [n('.claude'), n('deck', [n('deck/aaaaaaaa'), n('deck/c1ac6fe4')]), n('原件')] as never,
      'c1ac6fe4',
      true
    );
    expect(out.map((x) => x.title)).toEqual(['deck', '原件']);
    expect(out[0].children?.map((x) => x.title)).toEqual(['deck/c1ac6fe4']);
  });
});

describe('批准卡请求详情默认收起', () => {
  const card = (): IMessagePermission => ({
    id: 'm1',
    msg_id: 'db1',
    conversation_id: 'conv-1',
    type: 'permission',
    position: 'left',
    content: {
      id: 'c1',
      title: 't',
      description: 'd',
      action: 'office_copy_to_workspace',
      call_id: 'call-1',
      command_type: 'mcp',
      options: [
        { label: 'Yes', value: 'proceed_once' },
        { label: 'No', value: 'cancel' },
      ],
    },
  });
  const tool = {
    id: 't1',
    conversation_id: 'conv-1',
    type: 'tool_call',
    position: 'left',
    content: {
      call_id: 'call-1',
      name: 'office_copy_to_workspace',
      status: 'pending',
      input: { asset_id: 'theme.x', relative_path: 'deck/a/模板.pptx' },
    },
  } as unknown as TMessage;
  it('details 默认不展开，DOM 仍含全文；点开后 open', () => {
    render(
      <ConversationProvider
        value={{ conversation_id: 'conv-1', type: 'aionrs', loadedMcpServers: ['mycowork_bridge'] }}
      >
        <MessageListProvider value={[tool]}>
          <MessagePermission message={card()} />
        </MessageListProvider>
      </ConversationProvider>
    );
    const details = screen.getByTestId('message-permission-detail') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('"asset_id": "theme.x"');
    fireEvent.click(details.querySelector('summary')!);
    details.open = true; // jsdom 不实现 summary 点击切换，直接置位后确认内容仍在
    expect(details.textContent).toContain('"relative_path": "deck/a/模板.pptx"');
  });
});

describe('停止后“重新发送本轮”', () => {
  const run = {
    run_id: 'r1',
    submission_id: 's1',
    created_at: '2026-10-21T00:00:00Z',
    conversation_id: 'c1',
    turn_id: 't1',
    status: 'cancelled',
    stop_confirmed: true,
  } as TaskRun;
  it('已确认停止：出现按钮，点击触发一次', () => {
    const onResend = vi.fn();
    render(<TaskCompletion run={run} lang='zh-CN' onAccept={vi.fn()} onResend={onResend} />);
    fireEvent.click(screen.getByText('重新发送本轮'));
    expect(onResend).toHaveBeenCalledTimes(1);
  });
  it('输入框有草稿（resendBlocked）时按钮禁用并提示先清空，点击不触发', () => {
    const onResend = vi.fn();
    render(<TaskCompletion run={run} lang='zh-CN' onAccept={vi.fn()} onResend={onResend} resendBlocked />);
    const button = screen.getByText('重新发送本轮').closest('button')!;
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toContain('先清空输入框');
    fireEvent.click(button);
    expect(onResend).not.toHaveBeenCalled();
  });
  it('未确认停止或没有回调：不出现', () => {
    render(
      <TaskCompletion
        run={{ ...run, stop_confirmed: false } as TaskRun}
        lang='zh-CN'
        onAccept={vi.fn()}
        onResend={vi.fn()}
      />
    );
    expect(screen.queryByText('重新发送本轮')).toBeNull();
    cleanup();
    render(<TaskCompletion run={run} lang='zh-CN' onAccept={vi.fn()} />);
    expect(screen.queryByText('重新发送本轮')).toBeNull();
  });
});

describe('D306 WebUI 下 showOpen 返回空', () => {
  it('blockedWebShowOpen 返回 undefined（目录/文件选择一律取消），并已注册为 WebUI 的处理器', async () => {
    const { blockedWebShowOpen } = await import('@/renderer/components/workspace/mycoworkShowOpen');
    expect(await blockedWebShowOpen({ properties: ['openDirectory'] })).toBeUndefined();
    expect(await blockedWebShowOpen({ properties: ['openFile'] })).toBeUndefined();
    const reg = vi.fn();
    vi.doMock('@/common/adapter/ipcBridge', () => ({ registerWebShowOpenHandler: reg }));
    const electron = (window as { electronAPI?: unknown }).electronAPI;
    delete (window as { electronAPI?: unknown }).electronAPI;
    try {
      vi.resetModules();
      await import('@/renderer/components/workspace/registerWebFsPicker');
      expect(reg).toHaveBeenCalledTimes(1);
      expect(reg.mock.calls[0][0].name).toBe('blockedWebShowOpen');
    } finally {
      (window as { electronAPI?: unknown }).electronAPI = electron;
      vi.doUnmock('@/common/adapter/ipcBridge');
    }
  });
});

describe('补读屏名称', () => {
  it('无名开关取旁边标签文字；已有名称不改；Close 改中文', () => {
    document.body.innerHTML = `<div><span>保持唤醒</span><button role="switch"></button></div>
      <div><span>x</span><button role="switch" aria-label="已有"></button></div>
      <span role="button" aria-label="Close"></span>`;
    labelUnnamed();
    const sw = document.querySelectorAll('button[role="switch"]');
    expect(sw[0].getAttribute('aria-label')).toBe('保持唤醒');
    expect(sw[1].getAttribute('aria-label')).toBe('已有');
    expect(document.querySelector('[role="button"]')!.getAttribute('aria-label')).toBe('关闭');
  });
});

describe('Microcompact 系统提示不显示', () => {
  const tip = (content: string): IMessageTips =>
    ({
      id: 'tp',
      conversation_id: 'c',
      type: 'tips',
      position: 'center',
      content: { content, type: 'success' },
    }) as IMessageTips;
  it('隐藏上游英文整理提示', () => {
    const { container } = render(
      <MessageTips message={tip('Microcompact: cleared 6 tool results (~14982 tokens freed)')} />
    );
    expect(container.textContent).toBe('');
    cleanup();
    render(<MessageTips message={tip('另一个提示')} />); // 对照：普通提示照常显示
    expect(document.body.textContent).toContain('另一个提示');
  });
});
