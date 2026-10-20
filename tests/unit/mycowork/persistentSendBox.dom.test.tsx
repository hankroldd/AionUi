/**
 * 文件：tests/unit/mycowork/persistentSendBox.dom.test.tsx
 * 职责：真实SendBox在持久草稿模式下保留失败输入，并恢复@@名称到ID的撤回语义。
 * 边界：只替换无关runtime、上传和页面context，发送输入及引用协调逻辑真实运行。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { layoutState, sendState } = vi.hoisted(() => ({
  layoutState: { isMobile: false },
  sendState: {
    uploading: false,
    snippets: [] as { id: string; tag: string; html: string }[],
    reply: null as null | ((value: { content: string }) => void),
    ask: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'var(--color-primary-6)',
    inactiveBorderColor: 'var(--color-border-2)',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({
    conversation_id: 'sendbox-prefill-conversation',
    type: 'acp',
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: layoutState.isMobile }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: sendState.snippets,
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: (): unknown[] => [],
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    step: 'menu',
    filename: '',
    pathPreview: '',
    menuItems: [] as unknown[],
    activeIndex: 0,
    loading: false,
    openExportFlow: vi.fn(),
    closeExportFlow: vi.fn(),
    handleKeyDown: vi.fn(),
    onSelectMenuItem: vi.fn(),
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));

vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    question: '',
    isLoading: false,
    isOpen: false,
    ask: sendState.ask,
    dismiss: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: sendState.uploading }),
}));

vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));

vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useLiveTranscriptInsertion')>();
  return {
    ...actual,
    useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
  };
});

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: vi.fn() },
  useAddEventListener: (name: string, callback: (value: { content: string }) => void) => {
    if (name === 'sendbox.reply') sendState.reply = callback;
  },
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: (): null => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: (): null => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: (): null => null }));

import SendBox, { type SendBoxSubmitHandle } from '@/renderer/components/chat/SendBox';

import { cleanup } from '@testing-library/react';
beforeEach(() => {
  sendState.uploading = false;
  sendState.snippets = [];
  sendState.reply = null;
  sendState.ask.mockClear();
});
afterEach(cleanup);
function Harness({
  send,
  initial = '虚构未发送输入',
  refs = false,
  actionRef,
  blocked = {},
}: {
  send: (value: string) => Promise<void | false>;
  initial?: string;
  refs?: boolean;
  actionRef?: React.Ref<SendBoxSubmitHandle>;
  blocked?: { disabled?: boolean; sendDisabled?: boolean; loading?: boolean };
}) {
  const [value, setValue] = useState(initial);
  const [sessions, setSessions] = useState(refs ? [{ id: 'conversation-original' }] : []);
  const [names, setNames] = useState(refs ? { 'conversation-original': '原会话名称' } : {});
  return (
    <>
      <output data-testid='refs'>{JSON.stringify(sessions)}</output>
      <SendBox
        {...blocked}
        submitRef={actionRef}
        enableBtw
        value={value}
        onChange={setValue}
        onSend={send}
        preserveInputOnSend
        selectedSessions={sessions}
        onSelectedSessionsChange={setSessions}
        sessionNames={names}
        onSessionNamesChange={setNames}
        crossSessionEnabled
      />
    </>
  );
}

describe('真实SendBox持久草稿边界', () => {
  it('发送拒绝后仍保留原文', async () => {
    const send = vi.fn().mockRejectedValue(new Error('网络未确认'));
    render(<Harness send={send} />);
    const input = screen.getByTestId('sendbox-input');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('虚构未发送输入');
  });
  it('发送结果返回false不能用旧快照覆盖用户续写', async () => {
    let finish!: (value: false) => void;
    const send = vi.fn(
      () =>
        new Promise<false>((resolve) => {
          finish = resolve;
        })
    );
    render(<Harness send={send} />);
    const input = screen.getByTestId('sendbox-input');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: '用户继续写的新输入' } });
    await act(async () => finish(false));
    expect(input).toHaveValue('用户继续写的新输入');
  });
  it('恢复@@原名称保持绑定，删除正文token才撤回原ID', async () => {
    render(<Harness send={vi.fn().mockResolvedValue(undefined)} refs initial='请参考 @@原会话名称 的结论' />);
    expect(screen.getByTestId('refs')).toHaveTextContent('conversation-original');
    fireEvent.change(screen.getByTestId('sendbox-input'), { target: { value: '请参考结论' } });
    await waitFor(() => expect(screen.getByTestId('refs')).toHaveTextContent('[]'));
  });
});

describe('模板动作复用真实SendBox', () => {
  it('空补充可发，quote与DOM都经过原组装且不污染原文', async () => {
    sendState.snippets = [{ id: 'dom-one', tag: 'section', html: '<section>虚构图表</section>' }];
    const actionRef = React.createRef<SendBoxSubmitHandle>();
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Harness send={send} initial='' actionRef={actionRef} />);
    act(() => sendState.reply?.({ content: '引用的一行\n引用的二行' }));
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await actionRef.current!.submitWithPrefix('请使用这个模板：[暖色活动](deck/c1/template.pptx)');
    });
    expect(accepted).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain('> 引用的一行\n> 引用的二行');
    expect(send.mock.calls[0][0]).toContain('DOM Snippet (section):');
    expect(send.mock.calls[0][0]).toContain('<section>虚构图表</section>');
    expect(screen.getByTestId('sendbox-input')).toHaveValue('');
  });
  it('仅动作允许空原文，普通空发送仍不发送，补充/btw不走旁支', async () => {
    const actionRef = React.createRef<SendBoxSubmitHandle>();
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Harness send={send} initial='' actionRef={actionRef} />);
    fireEvent.keyDown(screen.getByTestId('sendbox-input'), { key: 'Enter', code: 'Enter' });
    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      expect(await actionRef.current!.submitWithPrefix('请采用当前模板')).toBe(true);
    });
    fireEvent.change(screen.getByTestId('sendbox-input'), { target: { value: '/btw 保留为本次补充' } });
    await act(async () => {
      expect(await actionRef.current!.submitWithPrefix('请采用当前模板')).toBe(true);
    });
    expect(send.mock.calls[1][0]).toContain('/btw 保留为本次补充');
    expect(sendState.ask).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByTestId('sendbox-input'), { key: 'Enter', code: 'Enter' });
    expect(sendState.ask).toHaveBeenCalledWith('保留为本次补充');
  });
  it.each(['disabled', 'sendDisabled', 'loading', 'upload'])('%s阻塞动作且保留原文', async (kind) => {
    const actionRef = React.createRef<SendBoxSubmitHandle>();
    const send = vi.fn().mockResolvedValue(undefined);
    if (kind === 'upload') sendState.uploading = true;
    render(<Harness send={send} actionRef={actionRef} blocked={kind === 'upload' ? {} : { [kind]: true }} />);
    await act(async () => {
      expect(await actionRef.current!.submitWithPrefix('请采用当前模板')).toBe(false);
    });
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByTestId('sendbox-input')).toHaveValue('虚构未发送输入');
  });
  it('同一提交Promise未结束时挡双击，false不清输入，reject沿原失败路径抛回', async () => {
    const actionRef = React.createRef<SendBoxSubmitHandle>();
    let finish!: (value: false) => void;
    const send = vi.fn().mockImplementationOnce(
      () =>
        new Promise<false>((resolve) => {
          finish = resolve;
        })
    );
    render(<Harness send={send} actionRef={actionRef} />);
    let first!: Promise<boolean>;
    act(() => {
      first = actionRef.current!.submitWithPrefix('请采用当前模板');
    });
    await act(async () => {
      expect(await actionRef.current!.submitWithPrefix('请采用当前模板')).toBe(false);
    });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(false);
      expect(await first).toBe(false);
    });
    expect(screen.getByTestId('sendbox-input')).toHaveValue('虚构未发送输入');
    send.mockRejectedValueOnce(new Error('unknown'));
    await act(async () => {
      await expect(actionRef.current!.submitWithPrefix('请采用当前模板')).rejects.toThrow('unknown');
    });
    expect(screen.getByTestId('sendbox-input')).toHaveValue('虚构未发送输入');
  });
});
