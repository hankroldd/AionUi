/**
 * 文件：tests/unit/mycowork/officeTaskSend.harness.tsx
 * 职责：officeTaskSend 测试的渲染外壳（Provider 组合与对话发送框夹具），从测试文件拆出以守单文件 ≤400 行。
 * 边界：不含断言；依赖测试文件里的 vi.mock（IPC、fetch）对同一模块图生效。
 */
import React from 'react';
import { createInstance } from 'i18next';
import enConversation from '@/renderer/services/i18n/locales/en-US/conversation.json';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { AuthProvider } from '@/renderer/hooks/context/AuthContext';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import { ThemeProvider } from '@/renderer/hooks/context/ThemeContext';
import { PreviewProvider } from '@/renderer/pages/conversation/Preview';
import AionrsSendBox from '@/renderer/pages/conversation/platforms/aionrs/AionrsSendBox';
import { fixture } from './officeTaskSend.fixture';

const i18n = createInstance();
void i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: { conversation: enConversation } } },
});
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <AuthProvider>
            <ThemeProvider>{children}</ThemeProvider>
          </AuthProvider>
        </MemoryRouter>
      </I18nextProvider>
    </SWRConfig>
  );
}
const model = {
  current_model: { id: 'provider-fixture', use_model: 'model-fixture' },
  providers: [],
  getAvailableModels: (): string[] => [],
  formatModelLabel: () => '',
  handleSelectModel: async () => {},
} as never;
export function Conversation({ team }: { team?: (payload: unknown) => Promise<void> }) {
  return (
    <ConversationProvider
      value={{
        conversation_id: fixture.conversation,
        type: 'aionrs',
        workspace: '/fixture/native',
        assistantId: fixture.scene ? 'mycowork-scene-ppt' : 'generic-fixture',
      }}
    >
      <PreviewProvider>
        <AionrsSendBox conversation_id={fixture.conversation} modelSelection={model} teamSendMessage={team} />
      </PreviewProvider>
    </ConversationProvider>
  );
}
