/**
 * 文件：tests/unit/mycowork/reviewModelSelector.dom.test.tsx
 * 职责：核查Reviewer只选择已配置可用模型，并以创建时身份核验真实会话。
 * 边界：仅模拟宿主选择状态与公开IPC；不运行模型、不保存全局默认或真实凭据。
 * 关联：PR10 E1；renderer/mycowork-reviews.tsx。
 */
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReviewAdapter } from '@mycowork/ui';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useReviewAdapter } from '@/renderer/mycowork-reviews';

const api = vi.hoisted(() => ({
  providers: [] as IProvider[],
  initial: undefined as TProviderWithModel | undefined,
  create: vi.fn(),
  get: vi.fn(),
  send: vi.fn(),
  skills: vi.fn(),
  select: vi.fn(),
  persist: vi.fn(),
}));
vi.mock('@/common', async () => {
  const { withResponseMap } = await import('@/common/adapter/httpBridge');
  const { fromApiConversation } = await import('@/common/adapter/apiModelMapper');
  return {
    ipcBridge: {
      conversation: {
        create: { invoke: api.create },
        get: withResponseMap({ provider: () => {}, invoke: api.get }, fromApiConversation),
        sendMessage: { invoke: api.send },
      },
      fs: { listAvailableSkills: { invoke: api.skills } },
      mode: { updateProvider: { invoke: api.persist } },
    },
  };
});
vi.mock('@/renderer/mycowork-resource-navigation', () => ({ useOwnerKey: () => 'fixture-owner' }));
vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => {
    const [current_model, set] = useState(api.initial);
    return {
      current_model,
      modelList: api.providers,
      setCurrentModel: async (model: TProviderWithModel, options: unknown) => {
        api.select(model, options);
        set(model);
      },
    };
  },
}));
const provider: IProvider = {
  id: 'review-provider',
  name: '虚构网关',
  platform: 'custom',
  base_url: 'https://fixture.invalid',
  api_key: 'fixture-secret-not-forwarded',
  models: ['zhanlu/qwen3.7-max', 'zhanlu/qwen3.7-plus', 'fixture-disabled', 'text-embedding-3-small'],
  model_enabled: { 'fixture-disabled': false },
};
const maximum = provider.models[0]!,
  plus = provider.models[1]!;
const session = {
  review_id: 'model-fixture',
  plan_id: 'plan-fixture',
  workspace: '/fixture/MyCowork 审查 model-fixture',
  prompt: '只读审查虚构文件',
  input_revision_id: 'revision-fixture',
  input_content_sha256: 'a'.repeat(64),
  session_mcp_server: {
    id: 'mycowork_bridge' as const,
    name: 'mycowork_bridge' as const,
    transport: { type: 'streamable_http' as const, url: '/bridge/mcp', headers: { Authorization: 'fixture' } },
  },
};
function conversation(model = maximum, providerId = provider.id) {
  return {
    id: 'created-fixture',
    type: 'aionrs',
    model: { provider_id: providerId, model, use_model: null },
    extra: {
      workspace: session.workspace,
      skills: [],
      mcp_server_ids: [],
      session_mcp_servers: [session.session_mcp_server],
    },
  };
}
let adapter: ReviewAdapter;
function Screen({ disabled = false }: { disabled?: boolean }) {
  adapter = useReviewAdapter();
  return <>{adapter.renderModelSelector?.({ disabled, label: '审查模型' })}</>;
}
async function choose(model: string) {
  fireEvent.click(screen.getByRole('button', { name: '审查模型' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: model, exact: true }));
}
beforeEach(() => {
  vi.clearAllMocks();
  api.providers = [provider];
  api.initial = { ...provider, use_model: maximum };
  api.skills.mockResolvedValue([]);
  api.create.mockResolvedValue({ id: 'created-fixture' });
  api.get.mockResolvedValue(conversation());
  api.send.mockResolvedValue({ msg_id: 'message-fixture', turn_id: 'turn-fixture' });
});
afterEach(cleanup);

it('verifies the real host IPC normalization of the REST model before sending', async () => {
  render(<Screen />);
  const id = await adapter.create(session);
  await adapter.verify(id, session);
  await adapter.send(id, session.prompt);
  expect(api.get).toHaveBeenCalledExactlyOnceWith({ id });
  expect(api.send).toHaveBeenCalledTimes(1);
});

it('selects an available configured model for create without forwarding credentials or persisting a default', async () => {
  render(<Screen />);
  await choose(plus);
  await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
  expect(screen.getByRole('button', { name: '审查模型' })).toHaveTextContent(plus);
  expect(await adapter.create(session)).toBe('created-fixture');
  expect(api.create.mock.calls[0]![0].model).toEqual({
    id: provider.id,
    use_model: plus,
    platform: '',
    name: '',
    base_url: '',
    api_key: '',
  });
  expect(api.select).toHaveBeenCalledWith(expect.objectContaining({ id: provider.id, use_model: plus }), {
    persistPreference: false,
  });
  expect(api.persist).not.toHaveBeenCalled();
  expect(api.providers[0]!.models[0]).toBe(maximum);
});

it('cannot change selection while disabled and hides unavailable models and providers', async () => {
  api.providers = [provider, { ...provider, id: 'disabled-provider', name: '禁用网关', enabled: false }];
  const view = render(<Screen disabled />);
  expect(screen.getByRole('button', { name: '审查模型' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '审查模型' }));
  expect(api.select).not.toHaveBeenCalled();
  view.rerender(<Screen />);
  fireEvent.click(screen.getByRole('button', { name: '审查模型' }));
  expect(await screen.findByText(plus, { exact: true })).toBeVisible();
  expect(screen.queryByText('fixture-disabled', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText('text-embedding-3-small', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText('禁用网关', { exact: true })).not.toBeInTheDocument();
});

it.each(['not-configured', 'fixture-disabled', 'text-embedding-3-small'])(
  'does not create with unavailable selected model %s',
  async (model) => {
    api.initial = { ...provider, use_model: model };
    render(<Screen />);
    await expect(adapter.create(session)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'review_model_unavailable' }),
    });
    expect(api.create).not.toHaveBeenCalled();
  }
);

it('does not create after the selected provider is removed', async () => {
  const view = render(<Screen />);
  await choose(plus);
  api.providers = [];
  view.rerender(<Screen />);
  await expect(adapter.create(session)).rejects.toMatchObject({
    cause: expect.objectContaining({ message: 'review_model_unavailable' }),
  });
  expect(api.create).not.toHaveBeenCalled();
});

it('keeps the captured create model through a later selector change and registration retry', async () => {
  let complete!: (value: { id: string }) => void;
  api.create.mockReturnValue(
    new Promise<{ id: string }>((resolve) => {
      complete = resolve;
    })
  );
  render(<Screen />);
  const creating = adapter.create(session);
  await act(async () => {
    await Promise.resolve();
  });
  await choose(plus);
  await act(async () => {
    complete({ id: 'created-fixture' });
    await creating;
  });
  expect(api.create.mock.calls[0]![0].model.use_model).toBe(maximum);
  await adapter.verify('created-fixture', session);
  await adapter.verify('created-fixture', session);
  expect(api.get).toHaveBeenCalledTimes(2);
});

it.each([
  { model: plus, providerId: provider.id },
  { model: maximum, providerId: 'wrong-provider' },
])('does not send when the real public conversation model disagrees %#', async ({ model, providerId }) => {
  api.get.mockResolvedValue(conversation(model, providerId));
  render(<Screen />);
  await expect(
    (async () => {
      const id = await adapter.create(session);
      await adapter.verify(id, session);
      await adapter.send(id, session.prompt);
    })()
  ).rejects.toThrow('review_model_mismatch');
  expect(api.send).not.toHaveBeenCalled();
});
