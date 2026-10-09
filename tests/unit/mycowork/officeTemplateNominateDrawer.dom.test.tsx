/**
 * [mycowork] 文件：officeTemplateNominateDrawer.dom.test.tsx
 * 职责：P09 “查看原模板”抽屉里的审批区（MyCowork PR05 切片 g1，A168）：普通（非候选）资产不显示候选说明与按钮；owner 看被提名的候选时有审批按钮、不显示“等待管理员审核”。
 * 边界：真实 CompositionPage 与抽屉，只替换 Bridge HTTP（fetch，共用 templateBrowseFixture）。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { OfficeCompositionSlot } from '@/renderer/mycowork-slots';
import { detail, fetchMock, reply, serve } from './templateBrowseFixture';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null, pathname: '/' }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ decisionId: 'dec_1' }),
}));

const candidate = {
  ...detail('n2'),
  approval: 'draft',
  candidate: {
    nominated_by: 'u',
    derived_from: { resource_id: 'r', revision_id: 'v', content_sha256: 's', slide: 2 },
    findings: 0,
  },
  findings: [],
};
const openDetail = async (n2: object) => {
  serve({
    pages: [{ no: 1, cands: ['a1'], picked: 'n2' }],
    hook: (u) => (u.pathname.endsWith('/assets/n2') ? reply(200, n2) : undefined),
  });
  render(<OfficeCompositionSlot />);
  const line = await screen.findByTestId('selected-outside');
  fireEvent.click(await within(line).findByRole('button', { name: '查看原模板' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByTestId('asset-detail');
  return dialog;
};

describe('审批区 in the P09 detail drawer', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('an ordinary asset shows no candidate note and no buttons', async () => {
    const dialog = await openDetail({ ...detail('n2'), approval: 'approved' });
    expect(within(dialog).queryByTestId('asset-transitions')).toBeNull();
    expect(dialog.textContent).not.toMatch(/等待管理员审核|已批准，可在/);
  });

  it('the owner looking at a nominated candidate gets the next-step button and no waiting note', async () => {
    const dialog = await openDetail({ ...candidate, transitions: ['validating'] });
    const zone = await within(dialog).findByTestId('asset-transitions');
    expect(within(zone).getByRole('button', { name: '开始校验' })).toBeEnabled();
    expect(zone.textContent).not.toContain('等待管理员审核');
  });

  it('a non-owner nominee sees the waiting note and no buttons', async () => {
    const dialog = await openDetail({ ...candidate, transitions: [] });
    const zone = await within(dialog).findByTestId('asset-transitions');
    expect(zone).toHaveTextContent('等待管理员审核');
    expect(within(zone).queryByRole('button')).toBeNull();
  });
});
