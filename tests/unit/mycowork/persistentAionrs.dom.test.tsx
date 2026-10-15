/**
 * 文件：tests/unit/mycowork/persistentAionrs.dom.test.tsx
 * 职责：真实Aionrs与SendBox联合验证恢复后的附件和会话引用发送语义。
 * 边界：只替换无关runtime、上传和页面context，发送输入及引用协调逻辑真实运行。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import React, { useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { layoutState, send, accepted } = vi.hoisted(() => ({
  send: vi.fn(),
  accepted: vi.fn(),
  layoutState: { isMobile: false },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      sendMessage: { invoke: send },
      stop: { invoke: vi.fn() },
      get: { invoke: vi.fn(async () => ({ id: 'conversation-a' })) },
    },
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
    conversation_id: 'conversation-a',
    type: 'aionrs',
    loadedSkills: [],
    loadedMcpStatuses: [],
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

import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import { resetAccountScopedState } from '@mycowork/ui';

import { cleanup } from '@testing-library/react';
afterEach(cleanup);

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'owner-a' }, status: 'authenticated' }),
}));
vi.mock('@/renderer/hooks/agent/useAcpConfigOptions', () => ({
  classifyConfigSetError: () => 'unknown',
  useAcpConfigOptions: () => ({ mode: null, thoughtLevel: null, setConfigOption: vi.fn() }),
}));
vi.mock('@/renderer/hooks/chat/useAutoTitle', () => ({ useAutoTitle: () => ({ checkAndUpdateTitle: vi.fn() }) }));
vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({ useTeamPermission: () => null }));
vi.mock('@/renderer/hooks/chat/useCrossSessionMessageEnabled', () => ({
  useCrossSessionMessageEnabled: () => ({ enabled: true }),
}));
vi.mock('@/renderer/pages/conversation/utils/ensureConversationRuntime', () => ({
  ensureConversationRuntime: async () => ({}),
}));
vi.mock('@/renderer/pages/conversation/platforms/aionrs/useAionrsMessage', () => ({
  useAionrsMessage: () => ({
    thought: '',
    running: false,
    setActiveMsgId: vi.fn(),
    setWaitingResponse: vi.fn(),
    resetState: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => ({
    hydrated: true,
    canSendMessage: true,
    isProcessing: false,
    state: 'idle',
    markSendStarted: vi.fn(),
    markSendAccepted: accepted,
    markSendFailed: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/platforms/useConversationCommandQueue', () => ({
  useConversationCommandQueue: () => ({
    items: [],
    mode: 'manual',
    enqueue: vi.fn(),
    remove: vi.fn(),
    prioritize: vi.fn(),
    sendNow: vi.fn(),
    clear: vi.fn(),
    reorder: vi.fn(),
    toggleMode: vi.fn(),
    lockInteraction: vi.fn(),
    unlockInteraction: vi.fn(),
    resetActiveExecution: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/chat/useSlashCommands', () => ({ useSlashCommands: () => [] }));
vi.mock('@/renderer/hooks/file/useOpenFileSelector', () => ({
  useOpenFileSelector: () => ({ openFileSelector: vi.fn(), onSlashBuiltinCommand: vi.fn() }),
}));
vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/CommandQueuePanel', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/ThoughtDisplay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/MobileActionSheet', () => ({
  default: () => null,
  useAttachEntry: () => ({ entries: [], hiddenFileInput: null }),
}));
vi.mock('@/renderer/components/media/FileAttachButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/FilePreview', () => ({
  default: ({ path }: { path: string }) => <span>{path}</span>,
}));

const original = {
  content: '请参考 @@原会话名称 的结论',
  files: [
    { kind: 'upload', path: '/fixture/upload.txt' },
    { kind: 'project', pe_id: 'pe-a', relative_path: 'project.txt' },
    { kind: 'local', path: '/fixture/local.txt' },
  ],
  sessions: [{ id: 'session-original', name: '原会话名称' }],
};
let saved: any;
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  resetAccountScopedState();
  sessionStorage.clear();
  saved = {
    draft_id: 'draft-conversation-a',
    input_location: 'conversation:conversation-a',
    revision: 1,
    submission_id: '04a16b25-58d5-4f96-8739-c2b257cdb417',
    state: original,
    updated_at: '2026-10-15T00:00:00Z',
  };
  send.mockReset().mockRejectedValue(new Error('受理失败'));
  accepted.mockReset();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('/drafts/')) {
      if (init?.method === 'PUT') {
        const next = JSON.parse(String(init.body));
        saved = { ...saved, revision: saved.revision + 1, state: next.state, submission_id: next.submission_id };
      }
      return response(200, saved);
    }
    return response(200, []);
  });
});
afterEach(() => {
  resetAccountScopedState();
  Message.clear();
  vi.unstubAllGlobals();
});
const tree = () => (
  <AionrsSendBox
    conversation_id='conversation-a'
    modelSelection={
      {
        current_model: { id: 'provider-a', use_model: 'model-a' },
        providers: [],
        getAvailableModels: () => [],
      } as never
    }
  />
);

describe('真实Aionrs持久草稿接线', () => {
  it('恢复完整附件和@@后，原ID能发送且发送失败正文附件仍在', async () => {
    render(tree());
    const input = await screen.findByTestId('sendbox-input');
    await waitFor(() => expect(input).toHaveValue(original.content));
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      input: original.content,
      files: original.files,
      sessions: [{ id: 'session-original' }],
    });
    expect(input).toHaveValue(original.content);
    expect(saved.state.files).toEqual(original.files);
  });
  it('恢复后删除@@正文引用，实际API不再收到旧会话ID', async () => {
    render(tree());
    const input = await screen.findByTestId('sendbox-input');
    await waitFor(() => expect(input).toHaveValue(original.content));
    fireEvent.change(input, { target: { value: '已删除引用的新正文' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].sessions).toBeUndefined();
    expect(saved.state.sessions).toEqual([]);
  });
});
