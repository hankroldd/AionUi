/**
 * [mycowork] ADR-0011: `/office/setup` (MyCowork P00 first-run checklist, PR12 T05d slice 1, R001). Only fetch is mocked.
 * Covers: step states come from real capability checks (nothing stored); the image-model step is optional and never
 * "required"; a failed capability read still shows every step with a retry that recovers. R001/D285: the chat/image
 * model steps come from AionUi's own provider list and tools setting (same fetch mock, routed by path); a failed read
 * never claims "configured".
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeSetupSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const provider = (models: string[], enabled = true) => ({
  id: `p-${models.join()}`,
  name: 'P',
  platform: 'x',
  models,
  enabled,
});
/** 按路径分流：Bridge 能力、AionUi provider 列表、AionUi 客户端设置（图像模型）。 */
const route = (caps: unknown, providers: unknown, image: unknown) =>
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/api/providers')) return providers;
    if (url.includes('/api/settings/client')) return image;
    return typeof caps === 'function' ? caps() : caps;
  });
const noImage = reply(200, { data: {} });
const cap = (id: string, state: string) => ({
  id,
  state,
  dependencies: [],
  allowedDataScopes: [],
  testedAt: new Date().toISOString(),
  version_verified: true,
});

describe('OfficeSetupSlot', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('derives step states from capabilities; image model is optional and skippable', async () => {
    route(
      reply(200, {
        capabilities: [
          cap('knowledge.retrieval', 'ready'),
          cap('office.native-edit', 'not_configured'),
          cap('office.online-edit', 'limited'),
        ],
      }),
      reply(200, { data: [] }),
      noImage
    );
    render(<OfficeSetupSlot />);
    const kb = await screen.findByTestId('setup-knowledge');
    expect(within(kb).getByText('已就绪')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-native')).getByText('待设置')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-online')).getByText('可用，写入待验收')).toBeInTheDocument(); // limited 不当待办
    const image = screen.getByTestId('setup-image');
    expect(within(image).getByText('可选')).toBeInTheDocument();
    expect(within(image).getByText('稍后再说')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-model')).getByText('必需')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '开始聊天' })).toHaveAttribute('href', '#/guid');
  });

  it('keeps all steps when capabilities cannot be read, and recovers on retry', async () => {
    let calls = 0;
    route(
      () =>
        calls++
          ? reply(200, { capabilities: [cap('knowledge.retrieval', 'ready')] })
          : reply(500, { error: { code: 'INTERNAL', message: 'x' } }),
      reply(200, { data: [] }),
      noImage
    );
    render(<OfficeSetupSlot />);
    expect(await screen.findByText(/没有读到资料与 Office 的状态/)).toBeInTheDocument();
    expect(screen.getByTestId('setup-image')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重试检查/ }));
    expect(await screen.findByText('已就绪')).toBeInTheDocument();
  });

  it('chat model is configured when an enabled provider has a usable model; image only when explicitly on', async () => {
    route(
      reply(200, { capabilities: [] }),
      reply(200, { data: [provider(['m1'])] }),
      reply(200, { data: { 'tools.imageGenerationModel': { id: 'p-m1', use_model: 'm1', switch: true } } })
    );
    render(<OfficeSetupSlot />);
    expect(await within(await screen.findByTestId('setup-model')).findByText('已配置')).toBeInTheDocument();
    expect(await within(screen.getByTestId('setup-image')).findByText('已配置')).toBeInTheDocument();
  });

  it('no enabled provider with models → 未配置 with a link to model settings; unset image → 稍后再说', async () => {
    route(reply(200, { capabilities: [] }), reply(200, { data: [provider(['m1'], false), provider([])] }), noImage);
    render(<OfficeSetupSlot />);
    const model = await screen.findByTestId('setup-model');
    expect(await within(model).findByText('未配置')).toBeInTheDocument();
    expect(within(model).getByRole('link', { name: '去设置' })).toHaveAttribute('href', '#/settings/model');
    const image = screen.getByTestId('setup-image');
    expect(within(image).getByText('稍后再说')).toBeInTheDocument();
    expect(within(image).getByRole('link', { name: '去设置' })).toHaveAttribute('href', '#/settings/tools');
  });

  it('a failed AionUi read never claims configured: chat stays 暂未检查, image 稍后再说', async () => {
    const fail = reply(500, { error: 'x' });
    route(reply(200, { capabilities: [] }), fail, fail);
    render(<OfficeSetupSlot />);
    const model = await screen.findByTestId('setup-model');
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/providers'))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(within(model).getByText('暂未检查')).toBeInTheDocument();
    expect(within(model).queryByText('已配置')).toBeNull();
    expect(within(screen.getByTestId('setup-image')).getByText('稍后再说')).toBeInTheDocument();
  });

  it('R001: host step reads /instance (已读取), backup is always 未检测; both optional, link to P16, never block', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/providers')) return reply(200, { data: [] });
      if (url.includes('/api/settings/client')) return noImage;
      if (url.includes('/instance'))
        return reply(200, { host: 'h1', data_dir_label: 'data', build: { commit: 'abcdef12' } });
      return reply(200, { capabilities: [] });
    });
    render(<OfficeSetupSlot />);
    const host = await screen.findByTestId('setup-host');
    expect(await within(host).findByText('已读取')).toBeInTheDocument();
    expect(within(host).getByText('可选')).toBeInTheDocument();
    expect(within(host).getByRole('link', { name: '去查看' })).toHaveAttribute('href', '#/office/maintenance');
    const backup = screen.getByTestId('setup-backup');
    expect(within(backup).getByText('未检测')).toBeInTheDocument();
    expect(within(backup).getByText('可选')).toBeInTheDocument();
    expect(within(backup).getByText(/备份脚本/)).toBeInTheDocument();
    expect(within(backup).getByRole('link', { name: '去查看' })).toHaveAttribute('href', '#/office/maintenance');
    expect(screen.getByRole('link', { name: '开始聊天' })).toBeInTheDocument();
  });

  it('R001: unreadable /instance → host step 未检测 and the rest of the page still works', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/instance')) return reply(500, { error: { code: 'INTERNAL', message: 'x' } });
      if (url.includes('/api/providers')) return reply(200, { data: [] });
      if (url.includes('/api/settings/client')) return noImage;
      return reply(200, { capabilities: [cap('knowledge.retrieval', 'ready')] });
    });
    render(<OfficeSetupSlot />);
    const host = await screen.findByTestId('setup-host');
    expect(within(host).getByText('未检测')).toBeInTheDocument();
    expect(within(host).queryByText('已读取')).toBeNull();
    expect(within(screen.getByTestId('setup-knowledge')).getByText('已就绪')).toBeInTheDocument();
  });
});
