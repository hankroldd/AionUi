/**
 * 文件：guidFileQuestion.dom.test.tsx
 * 职责：真实 Guid 页面、输入状态、Arco 与 Router 消费一次性单文件问题，保留草稿与附件。
 * 边界：只提供身份、提供者选项、原生 IO 与无关媒体界面；不替换 Guid/input/scope/send 逻辑。
 */
import React from 'react';
import { Button } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getScope, setScopeSelection } from '@mycowork/ui';
import GuidPage from '@/renderer/pages/guid/GuidPage';

const boundary = vi.hoisted(() => ({
  translate: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  owner: 'fixture-owner',
  fetch: vi.fn(),
  create: vi.fn(),
  dialog: vi.fn(),
  model: {
    modelList: [],
    isGoogleAuth: false,
    current_model: undefined,
    setCurrentModel: vi.fn(),
    resetCurrentModel: vi.fn(),
  },
  assistant: {
    selectedAssistantId: 'fixture-assistant',
    selectedAssistantBackend: 'aionrs',
    assistants: [],
    selectedMode: 'default',
    selectedAcpModel: null,
    currentAcpCachedModelInfo: null,
    currentAgentModeOptions: [],
    setSelectedAssistantId: vi.fn(),
    setSelectedMode: vi.fn(),
    setSelectedAcpModel: vi.fn(),
    setSelectedThoughtLevelValue: vi.fn(),
  },
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', user: { id: boundary.owner } }),
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({ useThemeContext: () => ({ theme: 'light', fontScale: 1 }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: boundary.translate, i18n: { language: 'zh-CN' } }) }));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('@/common', () => ({
  ipcBridge: {
    fs: { listAvailableSkills: { invoke: async () => [] } },
    dialog: { showOpen: { invoke: boundary.dialog } },
    assistants: { get: { invoke: async () => null } },
    conversation: { create: { invoke: boundary.create }, get: { invoke: async () => null } },
  },
}));
vi.mock('@/renderer/hooks/mcp/catalog', () => ({
  ensureBackendMcpCatalog: async () => ({ allServers: [] }),
  toSessionMcpServer: (server: unknown) => server,
}));
vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({ useGuidModelSelection: () => boundary.model }));
vi.mock('@/renderer/pages/guid/hooks/useGuidAssistantSelection', () => ({
  useGuidAssistantSelection: () => boundary.assistant,
}));
vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));
vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));
vi.mock('@/renderer/services/FileService', () => ({ allSupportedExts: ['txt'] }));
vi.mock('@/renderer/components/media/FilePreview', () => ({
  default: ({ path }: { path: string }) => <span data-testid='attached-file'>{path}</span>,
}));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));
vi.mock('@/renderer/components/workspace', () => ({ getRecentWorkspaces: () => [], addRecentWorkspace: vi.fn() }));
vi.mock('@/renderer/pages/guid/components/AssistantSelectionArea', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/components/GuidModelSelector', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/components/QuickActionButtons', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', () => ({
  useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }),
}));
vi.mock('@/renderer/hooks/system/useSpeechInput', () => ({
  appendSpeechTranscript: (draft: string, transcript: string) => draft + transcript,
}));
vi.mock('@/renderer/pages/conversation/Preview/components/editors', () => ({
  CodeEditor: () => null,
  MarkdownEditor: () => null,
}));
vi.mock('@/renderer/components/Markdown', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/Preview/components/viewers', () => ({ MarkdownViewer: () => null }));
vi.mock('swr', () => ({ default: () => ({ data: null }), mutate: vi.fn() }));
vi.mock('@/renderer/pages/guid/components/GuidActionRow', () => ({
  default: ({
    onFilesPicked,
    onSend,
    isButtonDisabled,
  }: {
    onFilesPicked: (paths: string[]) => void;
    onSend: () => void;
    isButtonDisabled: boolean;
  }) => (
    <>
      <Button onClick={() => onFilesPicked(['/fixture/attachment.txt'])}>选择虚构附件</Button>
      <Button disabled={isButtonDisabled} onClick={onSend}>
        确认发送
      </Button>
    </>
  ),
}));

const selected = {
  items: [{ source_id: 'src_file', name: '虚构库', resource_ids: ['res_one'] }],
  views: [],
  requiredResourceIds: ['res_one'],
  projectId: 'confirmed-project',
};
const owned = (question = '解释文件的关键变化', ownerKey = boundary.owner) => ({
  mycoworkScopeDraft: { ownerKey, selection: selected },
  prefillPrompt: question,
});
function Probe() {
  const location = useLocation();
  return <output data-testid='route'>{location.pathname}</output>;
}
function tree(state: unknown = null, strict = false) {
  const content = (
    <MemoryRouter initialEntries={[{ pathname: '/guid', state }]}>
      <Routes>
        <Route path='/guid' element={<GuidPage />} />
        <Route path='/settings' element={<div>设置</div>} />
      </Routes>
      <Probe />
    </MemoryRouter>
  );
  return strict ? <React.StrictMode>{content}</React.StrictMode> : content;
}
const input = () => screen.getByTestId('guid-input');
beforeEach(() => {
  boundary.owner = 'fixture-owner';
  boundary.fetch.mockReset();
  boundary.create.mockReset();
  boundary.dialog.mockReset();
  boundary.dialog.mockResolvedValue([]);
  boundary.fetch.mockImplementation(async (url: string) => ({
    status: 200,
    ok: true,
    json: async () =>
      url === '/bridge/v1/scopes'
        ? { sources: [], projects: [] }
        : url === '/bridge/v1/tags'
          ? { tags: [] }
          : { views: [] },
  }));
  setScopeSelection([]);
  localStorage.clear();
  vi.stubGlobal('fetch', boundary.fetch);
});
afterEach(() => {
  cleanup();
  setScopeSelection([]);
  vi.unstubAllGlobals();
});

it('fills a new Guid from the question and installs exactly its required file without creating a conversation', async () => {
  render(tree(owned()));
  await waitFor(() => expect(input()).toHaveValue('解释文件的关键变化'));
  expect(getScope()).toMatchObject(selected);
  expect(boundary.create).not.toHaveBeenCalled();
});

it('StrictMode consumes the question once and keeps the required file selection', async () => {
  const view = render(tree(owned(), true));
  await waitFor(() => expect(input()).toHaveValue('解释文件的关键变化'));
  view.rerender(tree(owned(), true));
  expect(input()).toHaveValue('解释文件的关键变化');
  expect(getScope()).toMatchObject(selected);
  expect(boundary.create).not.toHaveBeenCalled();
});

it('another account\'s intent installs an empty required set (send refused), never the file', async () => {
  render(tree(owned('另一个账号的问题', 'other-owner')));
  await waitFor(() => expect(getScope()).toMatchObject({ items: [], views: [], requiredResourceIds: [] }));
  expect(boundary.create).not.toHaveBeenCalled();
});
