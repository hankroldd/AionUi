/**
 * 文件：officeObjectSelectionAsk.dom.test.tsx
 * 职责：询问前的版本/私密/权限重检，取消与关闭不交接迟到结果。
 * 边界：只替换HTTP；不是原生发送或服务端写入权限验收。
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  SHA,
  NEW_SHA,
  fetchMock,
  changed,
  ask,
  response,
  selected,
  pending,
  props,
  opened,
  pick,
  previews,
} from './officeSelection.fixture';
describe('Office对象选择询问交接', () => {
  it('询问前重检选区与当前私密状态，回调只收到服务器目标与检查结果', async () => {
    const { frame } = await opened();
    pick(frame, '/body/p[1]');
    fireEvent.click(await screen.findByRole('button', { name: '询问所选内容' }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(ask.mock.calls[0][0]).toEqual(selected());
    expect(ask.mock.calls[0][1]).toMatchObject({ status: 'ok', current_content_sha256: SHA });
    expect(ask.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    expect(previews()).toHaveLength(1);
  });
  it.each(['drift', 'secret', 'revoked'])('询问时%s拒绝交接并保留原预览', async (condition) => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) =>
      condition === 'secret' && String(u).endsWith('/metadata')
        ? Promise.resolve(response(200, { secret: true }))
        : condition !== 'secret' && String(u).endsWith('/check')
          ? Promise.resolve(
              condition === 'revoked'
                ? response(404, { error: { code: 'NOT_FOUND' } })
                : response(200, { status: 'drifted', reason: 'fingerprint_mismatch', current_content_sha256: NEW_SHA })
            )
          : original(u, init)
    );
    const { frame } = await opened();
    const body = frame.srcdoc;
    pick(frame, '/body/p[1]');
    fireEvent.click(await screen.findByRole('button', { name: '询问所选内容' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(null));
    expect(ask).not.toHaveBeenCalled();
    expect(frame.srcdoc).toBe(body);
  });
  it('文件其他位置更新时说明差异，不替换原预览', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) =>
      String(u).endsWith('/check')
        ? Promise.resolve(
            response(200, {
              selection_id: 'sel_fixture',
              status: 'ok_revision_changed',
              current_content_sha256: NEW_SHA,
            })
          )
        : original(u, init)
    );
    const { frame } = await opened();
    const body = frame.srcdoc;
    pick(frame, '/body/p[1]');
    fireEvent.click(await screen.findByRole('button', { name: '询问所选内容' }));
    expect(await screen.findByText('文件有新版本，所选内容未变化。')).toBeTruthy();
    expect(ask.mock.calls[0][0].content_sha256).toBe(SHA);
    expect(ask.mock.calls[0][1].current_content_sha256).toBe(NEW_SHA);
    expect(frame.srcdoc).toBe(body);
  });
  it('关闭预览清除宿主目标，中止仍在进行的询问重检', async () => {
    const hold = pending<ReturnType<typeof response>>();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) => (String(u).endsWith('/check') ? hold.promise : original(u, init)));
    const view = await opened();
    pick(view.frame, '/body/p[1]');
    fireEvent.click(await screen.findByRole('button', { name: '询问所选内容' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/check'))).toBe(true));
    view.unmount();
    expect(changed).toHaveBeenLastCalledWith(null);
    await act(async () =>
      hold.resolve(response(200, { selection_id: 'sel_fixture', status: 'ok', current_content_sha256: SHA }))
    );
    expect(ask).not.toHaveBeenCalled();
  });
  it('重检期间取消选择不交接迟到结果', async () => {
    const hold = pending<ReturnType<typeof response>>();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) => (String(u).endsWith('/check') ? hold.promise : original(u, init)));
    const { frame } = await opened();
    pick(frame, '/body/p[1]');
    fireEvent.click(await screen.findByRole('button', { name: '询问所选内容' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/check'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }));
    await act(async () =>
      hold.resolve(response(200, { selection_id: 'sel_fixture', status: 'ok', current_content_sha256: SHA }))
    );
    expect(ask).not.toHaveBeenCalled();
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText('可直接修改')).toBeNull();
  });
  it('宿主未接询问回调时不出现无效入口', async () => {
    const { frame } = await opened({ ...props(), selection: { ownerKey: 'u1', onChange: changed, onAsk: undefined } });
    pick(frame, '/body/p[1]');
    expect(await screen.findByText('可直接修改')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '询问所选内容' })).toBeNull();
  });
});
