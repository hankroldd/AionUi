/**
 * [mycowork] S40：未受理原因常驻在发送框旁——过了顶部提示的时长仍在，下一次发送开始时清掉，可手动关闭。
 * 只测展示组件（useSendFailure）；原因文本由 sendOfficeDraft 按 failure.kind 生成，虚构数据。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useSendFailure } from '@/renderer/mycowork-send-failure';

let api: ReturnType<typeof useSendFailure>;
const Harness: React.FC<{ lang: string }> = ({ lang }) => {
  api = useSendFailure(lang);
  return <div>{api.notice}</div>;
};

describe('send failure notice', () => {
  it('stays after the toast duration, clears on next send, can be dismissed', () => {
    vi.useFakeTimers();
    render(<Harness lang='zh-CN' />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => api.fail(new Error('任务尚未受理：模型服务请求过多，请稍后再试。')));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('alert').textContent).toContain('模型服务请求过多');
    act(() => api.clear()); // 下一次发送开始
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => api.fail('again'));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('alert')).toBeNull();
    vi.useRealTimers();
  });

  it('dismiss label follows language', () => {
    render(<Harness lang='en-US' />);
    act(() => api.fail('x'));
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });
});
