/**
 * 文件：tests/unit/mycowork/templateConfirmationSend.dom.test.tsx
 * 职责：真实弹窗、SendBox、Aionrs持久草稿与任务客户端联合证明一次发送及输入保留。
 * 边界：仅替换虚构HTTP/IPC与无关偏好；不替换弹窗、发送组装、草稿控制器和任务用例。
 * 关联：ADR-0031；officeTaskSend.fixture。
 */
import '@arco-design/web-react/lib/_util/react-19-adapter';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import type { DraftState } from '@mycowork/contracts';
import { count, fixture, fixtureFetch, ipcCount, resetFixture } from './officeTaskSend.fixture';
import { resetAccountScopedState, restoreScope } from '@mycowork/ui';
import { AuthProvider } from '@/renderer/hooks/context/AuthContext';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { ThemeProvider } from '@/renderer/hooks/context/ThemeContext';
import { PreviewProvider, usePreviewContext } from '@/renderer/pages/conversation/Preview';
import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import type { AionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import { resetConversationRuntimeViewStoreForTest } from '@/renderer/pages/conversation/runtime/conversationRuntimeViewStore';
import { resetConversationCommandQueueBackgroundRunnerForTest } from '@/renderer/pages/conversation/platforms/useConversationCommandQueue';
import { captureOfficeDraftState } from '@/renderer/mycowork-task-send';
import { MyCoworkTemplateConfirmationProvider, MyCoworkWorkspaceFileLinkSlot } from '@/renderer/mycowork-slots';
import {
  resetCurrentProjectForTest,
  setCurrentProject,
} from '@/renderer/pages/conversation/explorer/currentProjectStore';
import {
  resetCurrentConversationForTest,
  setCurrentConversation,
} from '@/renderer/pages/conversation/explorer/currentConversationStore';
import { emitter } from '@/renderer/utils/emitter';

vi.hoisted(() => {
  vi.stubGlobal('electronAPI', undefined);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
});
vi.mock('@/common', async () => {
  const { ipcBridge } = (await import('./officeTaskSend.fixture')).createIPCFixture();
  return {
    ipcBridge: new Proxy(ipcBridge, {
      get: (target, key) =>
        key === 'project'
          ? {
              get: {
                invoke: async () => ({
                  project_id: 'p1',
                  name: '虚构项目',
                  explorer: { workspace_pe_id: 'pe-a', entries: [] as unknown[] },
                }),
              },
            }
          : Reflect.get(target, key),
    }),
  };
});
vi.mock('@/renderer/hooks/chat/useCrossSessionMessageEnabled', () => ({
  useCrossSessionMessageEnabled: () => ({ enabled: true }),
}));
const i18n = createInstance();
void i18n.init({ lng: 'zh-CN', fallbackLng: 'zh-CN', resources: {} });
const model = {
  current_model: { id: 'provider-fixture', use_model: 'model-fixture' },
  providers: [],
  getAvailableModels: (): string[] => [],
  formatModelLabel: () => '',
  handleSelectModel: async () => {},
} as unknown as AionrsModelSelection;
const original = (): DraftState =>
  captureOfficeDraftState(
    {
      content: '请参考 @@原会话名称 生成材料',
      files: [
        { kind: 'upload', path: '/fixture/upload.txt' },
        { kind: 'project', pe_id: 'pe-a', relative_path: 'project.txt' },
      ],
      sessions: [{ id: 'session-original', name: '原会话名称' }],
    },
    { workspace: '/fixture/native', assistantId: 'mycowork-scene-ppt', model: model.current_model }
  );
let submitted: DraftState | undefined;
let unknown = false;
function InputSources() {
  const preview = usePreviewContext();
  return (
    <button
      onClick={() => {
        preview.addDomSnippet('section', '<section>虚构版式</section>');
        emitter.emit('sendbox.reply', { content: '虚构引用', messageId: 'quote-one', position: 'left' });
      }}
    >
      加入引用和DOM
    </button>
  );
}
function Tree() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AuthProvider>
            <ThemeProvider>
              <ConversationProvider
                value={{
                  conversation_id: fixture.conversation,
                  type: 'aionrs',
                  workspace: '/fixture/native',
                  assistantId: 'mycowork-scene-ppt',
                }}
              >
                <PreviewProvider>
                  <MyCoworkTemplateConfirmationProvider conversationId={fixture.conversation} enabled>
                    <MyCoworkWorkspaceFileLinkSlot relativePath={`deck/${fixture.conversation}/模板.pptx`}>
                      模板.pptx
                    </MyCoworkWorkspaceFileLinkSlot>
                    <InputSources />
                    <AionrsSendBox conversation_id={fixture.conversation} modelSelection={model} />
                  </MyCoworkTemplateConfirmationProvider>
                </PreviewProvider>
              </ConversationProvider>
            </ThemeProvider>
          </AuthProvider>
        </MemoryRouter>
      </I18nextProvider>
    </SWRConfig>
  );
}
beforeEach(() => {
  restoreScope({ items: [], views: [], origin: 'turn' });
  resetAccountScopedState();
  resetConversationRuntimeViewStoreForTest();
  resetConversationCommandQueueBackgroundRunnerForTest();
  sessionStorage.clear();
  localStorage.clear();
  resetFixture();
  resetCurrentProjectForTest();
  resetCurrentConversationForTest();
  setCurrentProject('p1');
  setCurrentConversation(fixture.conversation);
  unknown = false;
  submitted = undefined;
  fixture.docs.set(`conversation:${fixture.conversation}`, {
    draft_id: 'draft-confirmation',
    input_location: `conversation:${fixture.conversation}`,
    revision: 1,
    submission_id: '76bb5e4a-b57b-4a8b-bb90-fac6e5bfe17d',
    updated_at: '2026-10-20T00:00:00Z',
    state: original(),
  });
  vi.stubGlobal('fetch', async (raw: string, init?: RequestInit) => {
    if (String(raw) === '/bridge/v1/tasks')
      submitted = structuredClone(fixture.docs.get(`conversation:${fixture.conversation}`)?.state);
    const response = await fixtureFetch(raw, init);
    if (String(raw).endsWith('/context'))
      return new Response(
        JSON.stringify({
          ...(await response.json()),
          version: 1,
          working_project_id: 'p1',
          template_preview: {
            decision_id: 'decision-private',
            decision_version: 1,
            theme: { asset_id: 'asset-private', version: 2, title: '暖色活动' },
            copy_id: 'copy-private',
            relative_path: `deck/${fixture.conversation}/模板.pptx`,
          },
        }),
        { status: 200 }
      );
    if (String(raw) === '/bridge/v1/tasks' && unknown) {
      fixture.task = { ...fixture.task!, status: 'recovery_required', delivery_phase: 'unknown' };
      return new Response(JSON.stringify(fixture.task), { status: 202 });
    }
    return response;
  });
});
afterEach(() => {
  cleanup();
  resetAccountScopedState();
  resetConversationCommandQueueBackgroundRunnerForTest();
  vi.unstubAllGlobals();
});
async function open() {
  render(<Tree />);
  await waitFor(() => expect(screen.getByTestId('sendbox-input')).toHaveValue(original().content));
  fireEvent.click(await screen.findByRole('button', { name: '使用此模板' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '使用并继续制作' })).not.toBeDisabled());
}

it('一次原任务发送保留quote/DOM/附件/会话引用，原草稿只存raw content，ACK后结算', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: '加入引用和DOM' }));
  const supplement = '请参考 @@原会话名称 生成材料，使用黑字';
  fireEvent.change(screen.getByRole('textbox', { name: '补充要求（可选）' }), { target: { value: supplement } });
  fireEvent.click(screen.getByRole('button', { name: '使用并继续制作' }));
  await waitFor(() => expect(count('/bridge/v1/tasks')).toBe(1));
  const body = JSON.parse(String(fixture.requests.find((r) => r.path === '/bridge/v1/tasks')?.init?.body));
  expect(body.delivery_content).toContain('请使用这个模板');
  expect(body.delivery_content).toContain(supplement);
  expect(body.delivery_content).toContain('> 虚构引用');
  expect(body.delivery_content).toContain('<section>虚构版式</section>');
  expect(body.delivery_content).not.toContain('decision-private');
  expect(submitted).toMatchObject({ content: supplement, files: original().files, sessions: original().sessions });
  await waitFor(() => expect(fixture.docs.get(`conversation:${fixture.conversation}`)?.state.content).toBe(''));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(ipcCount('conversation.sendMessage')).toBe(0);
});
it('没有额外补充可纯点击发送，不给草稿填确认语句', async () => {
  await open();
  fireEvent.change(screen.getByRole('textbox', { name: '补充要求（可选）' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '使用并继续制作' }));
  await waitFor(() => expect(count('/bridge/v1/tasks')).toBe(1));
  expect(submitted?.content).toBe('');
  const body = JSON.parse(String(fixture.requests.find((r) => r.path === '/bridge/v1/tasks')?.init?.body));
  expect(body.delivery_content).toContain('请使用这个模板');
  expect(ipcCount('conversation.sendMessage')).toBe(0);
});
it.each(['明确拒绝', 'unknown'])('%s仍保留原输入附件，不自动重发或native补发', async (kind) => {
  if (kind === 'unknown') unknown = true;
  else fixture.rejectTask = true;
  await open();
  fireEvent.click(screen.getByRole('button', { name: '使用并继续制作' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('发送未确认'));
  expect(count('/bridge/v1/tasks')).toBe(1);
  expect(fixture.docs.get(`conversation:${fixture.conversation}`)?.state).toMatchObject(original());
  expect(screen.getByTestId('sendbox-input')).toHaveValue(original().content);
  expect(screen.getByRole('textbox', { name: '补充要求（可选）' })).toHaveValue(original().content);
  expect(ipcCount('conversation.sendMessage')).toBe(0);
});
