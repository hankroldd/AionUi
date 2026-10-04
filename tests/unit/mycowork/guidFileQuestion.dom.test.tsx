/**
 * 文件：guidFileQuestion.dom.test.tsx
 * 职责：真实 Guid 页面、输入状态、Arco 与 Router 消费一次性单文件问题，保留草稿与附件。
 * 边界：只提供身份、提供者选项、原生 IO 与无关媒体界面；不替换 Guid/input/scope/send 逻辑。
 */
import React from 'react';
import { Button } from '@arco-design/web-react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
  mycoworkScopeDraft: { ownerKey, selection: selected, question },
  workspace: '/fixture/controlled',
});
let navigate: ReturnType<typeof useNavigate>;
function Probe() {
  const location = useLocation();
  navigate = useNavigate();
  return <output data-testid='route'>{JSON.stringify({ pathname: location.pathname, state: location.state })}</output>;
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
const route = () => JSON.parse(screen.getByTestId('route').textContent!);
const move = async (state: unknown) =>
  act(async () => {
    await navigate('/guid', { state });
  });
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

it('fills a new Guid from the owned question and installs exactly its required file without creating a conversation', async () => {
  render(tree(owned()));
  await waitFor(() => expect(input()).toHaveValue('解释文件的关键变化'));
  await waitFor(() => expect(route().state).toBeNull());
  expect(getScope()).toMatchObject(selected);
  expect(boundary.create).not.toHaveBeenCalled();
});

it('appends to a still-mounted draft while retaining its attachment and the controlled workspace', async () => {
  render(tree());
  fireEvent.change(input(), { target: { value: '原草稿内容' } });
  fireEvent.click(screen.getByRole('button', { name: '选择虚构附件' }));
  await move(owned());
  await waitFor(() => expect(route().state).toBeNull());
  expect(input()).toHaveValue('原草稿内容\n解释文件的关键变化');
  expect(screen.getByTestId('attached-file')).toHaveTextContent('/fixture/attachment.txt');
  expect(screen.getByRole('button', { name: 'controlled' })).toBeInTheDocument();
  expect(getScope()).toMatchObject(selected);
});

it('StrictMode and state-clearing replace consume a question once and retain its required file selection', async () => {
  const view = render(tree(owned(), true));
  await waitFor(() => expect(route().state).toBeNull());
  view.rerender(tree(owned(), true));
  expect(input()).toHaveValue('解释文件的关键变化');
  expect(getScope()).toMatchObject(selected);
  expect(boundary.create).not.toHaveBeenCalled();
});

it('wrong-owner intent mixed with ordinary prefill cannot install either question, attachment or workspace after replace', async () => {
  render(
    tree({
      ...owned('另一个账号的问题', 'other-owner'),
      prefillPrompt: '伪装成普通预填的问题',
      prefillFiles: ['/fixture/private.txt'],
      preservePrefillDraft: true,
      focusPrefill: true,
    })
  );
  await waitFor(() => expect(route().state).toBeNull());
  expect(input()).toHaveValue('');
  expect(screen.queryByTestId('attached-file')).toBeNull();
  expect(screen.queryByRole('button', { name: 'controlled' })).toBeNull();
  expect(getScope()).toMatchObject({ items: [], views: [], requiredResourceIds: [] });
  expect(boundary.create).not.toHaveBeenCalled();
});

it('a consumed history entry cannot resurrect the question after the Guid was unmounted', async () => {
  render(tree(owned()));
  await waitFor(() => expect(route().state).toBeNull());
  expect(input()).toHaveValue('解释文件的关键变化');
  fireEvent.change(input(), { target: { value: '人工更新草稿' } });
  await act(async () => {
    await navigate('/settings');
  });
  await act(async () => {
    await navigate(-1);
  });
  expect(input()).toHaveValue('');
  expect(route().state).toBeNull();
  expect(boundary.create).not.toHaveBeenCalled();
});

it('ordinary replacement prefill still replaces a mounted draft and accepts its explicitly supplied attachments', async () => {
  render(tree());
  fireEvent.change(input(), { target: { value: '原草稿内容' } });
  fireEvent.click(screen.getByRole('button', { name: '选择虚构附件' }));
  await move({ prefillPrompt: '普通入口的新草稿', prefillFiles: ['/fixture/new.txt'] });
  expect(input()).toHaveValue('普通入口的新草稿');
  expect(screen.getByTestId('attached-file')).toHaveTextContent('/fixture/new.txt');
  expect(boundary.create).not.toHaveBeenCalled();
});

it('ordinary draft-preserving prefill keeps its existing append contract after the single-file feature', async () => {
  render(tree());
  fireEvent.change(input(), { target: { value: '原草稿内容' } });
  fireEvent.click(screen.getByRole('button', { name: '选择虚构附件' }));
  await move({ prefillPrompt: '普通入口追加', preservePrefillDraft: true });
  await waitFor(() => expect(route().state).toBeNull());
  expect(input()).toHaveValue('原草稿内容\n普通入口追加');
  expect(screen.getByTestId('attached-file')).toHaveTextContent('/fixture/attachment.txt');
});
