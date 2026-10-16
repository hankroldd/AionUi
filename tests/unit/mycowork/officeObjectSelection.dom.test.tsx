/**
 * 文件：officeObjectSelection.dom.test.tsx
 * 职责：同响应身份、冻结/取消/迟到响应、四类状态与显式对象下钻。
 * 边界：只替换HTTP；iframe脚本由父仓真实浏览器验证。
 */
import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewBody } from '@mycowork/ui';
import {
  SHA,
  NEW_SHA,
  CLIENT,
  fetchMock,
  changed,
  response,
  selected,
  structure,
  pending,
  fixture,
  props,
  opened,
  generation,
  pick,
  writes,
  previews,
} from './officeSelection.fixture';
describe('Office对象选择控制器', () => {
  it('一次读取正文/版本，未选择时只提示操作，不提前调用冻结或结构', async () => {
    const { frame } = await opened();
    expect(await screen.findByText('点击预览中的内容，或浏览对象进行选择。')).toBeTruthy();
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(previews()).toHaveLength(1);
    expect(writes()).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([u]) => /preflight|structure/.test(String(u)))).toBe(false);
  });
  it('冻结只用本次响应sha/client及原locator，成功不重载预览', async () => {
    const { frame } = await opened();
    const body = frame.srcdoc;
    pick(frame, '/body/p[1]');
    expect(await screen.findByText('可直接修改')).toBeTruthy();
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      resource_id: 'res_fixture',
      locator: '/body/p[1]',
      expected_content_sha256: SHA,
      preview_client: CLIENT,
    });
    expect(changed).toHaveBeenLastCalledWith(selected());
    expect(frame.srcdoc).toBe(body);
    expect(previews()).toHaveLength(1);
  });
  it.each([
    ['native', '可直接修改'],
    ['container_only', '请展开选择'],
    ['reference_only', '仅供参考'],
    ['unsupported', '暂不支持'],
  ])('显示服务端%s状态，不猜可编辑性', async (kind, label) => {
    fixture();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) =>
      u === '/bridge/v1/office/selections'
        ? Promise.resolve(response(201, selected('/body/p[1]', kind)))
        : original(u, init)
    );
    const { frame } = await opened();
    pick(frame, '/body/p[1]');
    expect(await screen.findByText(label)).toBeTruthy();
    expect(changed.mock.lastCall?.[0].editability).toBe(kind);
  });
  it('快速改选中止前一请求，即使旧响应晚到也不能覆盖新选区', async () => {
    const old = pending<ReturnType<typeof response>>();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) =>
      u === '/bridge/v1/office/selections' && JSON.parse(init.body).locator === '/body/p[1]'
        ? old.promise
        : original(u, init)
    );
    const { frame } = await opened();
    pick(frame, '/body/p[1]');
    await waitFor(() => expect(writes()).toHaveLength(1));
    pick(frame, '/body/p[2]');
    await waitFor(() => expect(changed.mock.lastCall?.[0]?.locator).toBe('/body/p[2]'));
    expect(writes()[0][1].signal.aborted).toBe(true);
    await act(async () => old.resolve(response(201, selected('/body/p[1]'))));
    expect(changed.mock.lastCall?.[0]?.locator).toBe('/body/p[2]');
  });
  it('取消选择清标记并中止冻结，不接纳迟到结果', async () => {
    const hold = pending<ReturnType<typeof response>>();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) =>
      u === '/bridge/v1/office/selections' ? hold.promise : original(u, init)
    );
    const { frame } = await opened();
    const paint = vi.spyOn(frame.contentWindow!, 'postMessage');
    pick(frame, '/body/p[1]');
    await waitFor(() => expect(writes()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }));
    expect(writes()[0][1].signal.aborted).toBe(true);
    expect(paint).toHaveBeenLastCalledWith(
      { type: 'mycowork.office.highlight', generation: generation(frame), locator: null },
      '*'
    );
    await act(async () => hold.resolve(response(201, selected())));
    expect(changed.mock.calls.some(([v]) => v !== null)).toBe(false);
  });
  it.each(['owner', 'resource'])('%s切换同步换预览，旧窗口/旧响应不安装选择', async (kind) => {
    const hold = pending<ReturnType<typeof response>>();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) =>
      u === '/bridge/v1/office/selections' ? hold.promise : original(u, init)
    );
    const view = await opened();
    const oldGeneration = generation(view.frame);
    pick(view.frame, '/body/p[1]');
    await waitFor(() => expect(writes()).toHaveLength(1));
    view.rerender(
      <PreviewBody
        {...{ ...props(kind === 'owner' ? 'u2' : 'u1'), resourceId: kind === 'resource' ? 'res_other' : 'res_fixture' }}
      />
    );
    const next = (await screen.findByTitle('备忘（虚构）.docx 的只读预览')) as HTMLIFrameElement;
    expect(next).not.toBe(view.frame);
    expect(generation(next)).not.toBe(oldGeneration);
    expect(writes()[0][1].signal.aborted).toBe(true);
    await act(async () => hold.resolve(response(201, selected())));
    expect(changed.mock.calls.some(([v]) => v !== null)).toBe(false);
  });
  it('其他来源、旧代次和多字段消息不触发冻结', async () => {
    const { frame } = await opened();
    pick(frame, '/body/p[1]', 'old');
    fireEvent(
      window,
      new MessageEvent('message', {
        source: window,
        origin: 'null',
        data: { type: 'mycowork.office.selection', generation: generation(frame), locator: '/body/p[1]' },
      })
    );
    fireEvent(
      window,
      new MessageEvent('message', {
        source: frame.contentWindow,
        origin: 'null',
        data: {
          type: 'mycowork.office.selection',
          generation: generation(frame),
          locator: '/body/p[1]',
          html: '不得附加',
        },
      })
    );
    expect(writes()).toHaveLength(0);
    pick(frame, '/body/p[1]');
    await waitFor(() => expect(writes()).toHaveLength(1));
  });
  it('旧版本冻结409保留原预览，刷新重选才重读，不自动重放写请求', async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) =>
      u === '/bridge/v1/office/selections'
        ? Promise.resolve(response(409, { error: { code: 'SELECTION_STALE' } }))
        : original(u, init)
    );
    const { frame } = await opened();
    const body = frame.srcdoc;
    pick(frame, '/body/p[1]');
    const refresh = await screen.findByRole('button', { name: '刷新预览并重选' });
    expect(frame.srcdoc).toBe(body);
    expect(writes()).toHaveLength(1);
    fireEvent.click(refresh);
    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(writes()).toHaveLength(1);
  });
  it('临时冻结失败可手动重试，始终保持同一预览', async () => {
    const original = fetchMock.getMockImplementation()!;
    let count = 0;
    fetchMock.mockImplementation((u, init) =>
      u === '/bridge/v1/office/selections' && count++ === 0
        ? Promise.resolve(response(503, { error: { code: 'UPSTREAM_UNAVAILABLE' } }))
        : original(u, init)
    );
    const { frame } = await opened();
    pick(frame, '/body/p[1]');
    fireEvent.click(await screen.findByRole('button', { name: '重试' }));
    expect(await screen.findByText('可直接修改')).toBeTruthy();
    expect(previews()).toHaveLength(1);
    expect(writes()).toHaveLength(2);
  });
  it('从对象列表显式下钻和选择，不将Word规范路径改成序号', async () => {
    await opened();
    fireEvent.click(await screen.findByRole('button', { name: '浏览对象' }));
    fireEvent.click(await screen.findByRole('button', { name: /展开.*正文/ }));
    fireEvent.click(await screen.findByRole('button', { name: /展开.*段落/ }));
    fireEvent.click(await screen.findByRole('button', { name: /选择.*子内容/ }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body).locator).toBe('/body/p[@paraId=00100000]/r[1]');
    expect(screen.getByRole('button', { name: '返回上一级' })).toBeTruthy();
  });
  it.each(['sha', 'client'])('结构%s变了则拒绝混入旧预览，不冻结新节点', async (kind) => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((u, init) =>
      String(u).includes('/office/structure?')
        ? Promise.resolve(
            response(200, structure('/', kind === 'sha' ? NEW_SHA : SHA, kind === 'client' ? '1.0.153' : '1.0.152'))
          )
        : original(u, init)
    );
    await opened();
    fireEvent.click(await screen.findByRole('button', { name: '浏览对象' }));
    expect(await screen.findByRole('button', { name: '刷新预览并重选' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /选择.*正文/ })).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});
