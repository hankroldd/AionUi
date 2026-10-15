/**
 * 文件：tests/unit/mycowork/persistentSendBox.dom.test.tsx
 * 职责：真实SendBox在持久草稿模式下保留失败输入，并恢复@@名称到ID的撤回语义。
 * 边界：只替换无关runtime、上传和页面context，发送输入及引用协调逻辑真实运行。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { layoutState } = vi.hoisted(() => ({
  layoutState: { isMobile: false },
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
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    step: 'menu',
    filename: '',
    pathPreview: '',
    menuItems: [],
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
    ask: vi.fn(),
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
  useUploadState: () => ({ isUploading: false }),
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
  useAddEventListener: vi.fn(),
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

import SendBox from '@/renderer/components/chat/SendBox';

import { cleanup } from '@testing-library/react';
afterEach(cleanup);
function Harness({
  send,
  initial = '虚构未发送输入',
  refs = false,
}: {
  send: (value: string) => Promise<void | false>;
  initial?: string;
  refs?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [sessions, setSessions] = useState(refs ? [{ id: 'conversation-original' }] : []);
  const [names, setNames] = useState(refs ? { 'conversation-original': '原会话名称' } : {});
  return (
    <>
      <output data-testid='refs'>{JSON.stringify(sessions)}</output>
      <SendBox
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
