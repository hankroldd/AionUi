/**
 * [mycowork] ADR-0011: `/office/setup` (MyCowork P00 first-run checklist, PR12 T05d slice 1, R001). Only fetch is mocked.
 * Covers: step states come from real capability checks (nothing stored); the image-model step is optional and never
 * "required"; a failed capability read still shows every step with a retry that recovers.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeSetupSlot } from '@/renderer/mycowork-slots';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body });
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
    fetchMock.mockResolvedValue(
      reply(200, { capabilities: [cap('knowledge.retrieval', 'ready'), cap('office.native-edit', 'not_configured')] }),
    );
    render(<OfficeSetupSlot />);
    const kb = await screen.findByTestId('setup-knowledge');
    expect(within(kb).getByText('已就绪')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-native')).getByText('待设置')).toBeInTheDocument();
    const image = screen.getByTestId('setup-image');
    expect(within(image).getByText('可选')).toBeInTheDocument();
    expect(within(image).getByText('稍后再说')).toBeInTheDocument();
    expect(within(screen.getByTestId('setup-model')).getByText('必需')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '开始聊天' })).toHaveAttribute('href', '#/guid');
  });

  it('keeps all steps when capabilities cannot be read, and recovers on retry', async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { error: { code: 'INTERNAL', message: 'x' } }));
    fetchMock.mockResolvedValue(reply(200, { capabilities: [cap('knowledge.retrieval', 'ready')] }));
    render(<OfficeSetupSlot />);
    expect(await screen.findByText(/没有读到资料与 Office 的状态/)).toBeInTheDocument();
    expect(screen.getByTestId('setup-image')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /重试检查/ }));
    expect(await screen.findByText('已就绪')).toBeInTheDocument();
  });
});
