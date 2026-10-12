/**
 * 文件：officeObjectSelectionSafety.dom.test.tsx
 * 职责：只有明确非私密、同选区且允许继续的重检结果才交接。
 * 边界：合约外响应为独立安全审查的边界实验，不声称服务端可产生或已被越权。
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHA, fetchMock, ask, response, opened, pick } from './officeSelection.fixture';

describe('Office选择交接的明确允许条件', () => {
  it.each([
    ['metadata', {}],
    ['metadata', null],
    ['metadata', { secret: 'true' }],
    ['check', {}],
    ['check', { selection_id: 'sel_fixture', status: 'unknown', current_content_sha256: SHA }],
    ['check', { selection_id: 'sel_other', status: 'ok', current_content_sha256: SHA }],
  ])('%s没有明确允许时不交接：%j', async (endpoint, body) => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, init) =>
      String(url).endsWith(`/${endpoint}`) ? Promise.resolve(response(200, body)) : original(url, init)
    );
    const { frame } = await opened();
    const html = frame.srcdoc;
    pick(frame, '/body/p[1]');
    fireEvent.click(await screen.findByRole('button', { name: '询问所选内容' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(ask).not.toHaveBeenCalled();
    expect(frame.srcdoc).toBe(html);
  });
});
