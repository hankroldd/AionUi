/**
 * [mycowork] PR11 体验片 A：读请求自动重试与“读失败不吓人”。只替换 Bridge 边界（fetch）。
 * 覆盖：GET 遇网络失败 / 502 / 503 重试两次后成功且不出错误态；写请求不重试；401 / 404 / 409 立即抛；Bridge 自己的 5xx 错误体不重试；
 * 读超时按“连不上”处理；对话页“本轮范围”条重读失败保留上次内容；版本页 30 秒后台重读失败保留时间线，慢的旧响应盖不掉新响应。
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRetry } from '@mycowork/ui/scope-picker/bridge-client';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { bridgeJson } from '@mycowork/ui/scope-picker/bridge-client';
import { ConversationScopeSlot, OfficeImportsSlot, OfficeVersionsSlot } from '@/renderer/mycowork-slots';

type StreamMessage = { type: string; conversation_id: string };
const streamListeners = new Set<(m: StreamMessage) => void>();
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: (fn: (m: StreamMessage) => void) => (streamListeners.add(fn), () => streamListeners.delete(fn)),
      },
    },
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/' }),
  useParams: () => ({ resourceId: 'res_1' }),
}));

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => {
  const res = { status, ok: status < 300, json: async () => body, clone: () => res };
  return res;
};
const proxy = (status: number) => ({ status, ok: false, json: async () => Promise.reject(new Error('html')) }); // 代理层的非 JSON 5xx
const UNREACHABLE_ZH = '网络不太稳定，没能连上服务；已自动重试，请稍后再试。已保存的内容不受影响。';

beforeEach(() => {
  fetchMock.mockReset();
  streamListeners.clear();
  vi.stubGlobal('fetch', fetchMock);
  readRetry.delays = [0, 0];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('bridgeJson 读请求重试', () => {
  it('GET：网络失败、非 JSON 的 502、503 各重试，第三次成功不报错', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(proxy(502))
      .mockResolvedValueOnce(reply(200, { ok: 1 }));
    await expect(bridgeJson('/bridge/v1/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('GET：三次都失败才抛原来的错误（连不上 / 503）', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    await expect(bridgeJson('/bridge/v1/x')).rejects.toMatchObject({ kind: 'unavailable', message: 'UNREACHABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 503, ok: false, json: async () => ({}) });
    await expect(bridgeJson('/bridge/v1/x')).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('写请求（POST / PATCH）不重试：断网与 503 都只发一次', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    await expect(bridgeJson('/bridge/v1/x', { body: {} })).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(bridgeJson('/bridge/v1/x', { method: 'PATCH', body: {} })).rejects.toMatchObject({
      kind: 'unavailable',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(reply(503, {}));
    await expect(bridgeJson('/bridge/v1/x', { body: {} })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'unauthenticated'],
    [404, 'failed'],
    [409, 'failed'],
    [400, 'failed'],
  ])('GET %s 立即抛、不重试', async (status, kind) => {
    fetchMock.mockResolvedValue(reply(status, { error: { code: 'X', message: 'x' } }));
    await expect(bridgeJson('/bridge/v1/x')).rejects.toMatchObject({ kind });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Bridge 自己回的 504（带错误体，如对比超时）不重试', async () => {
    fetchMock.mockResolvedValue(reply(504, { error: { code: 'UPSTREAM_TIMEOUT', message: 'x' } }));
    await expect(bridgeJson('/bridge/v1/x')).rejects.toMatchObject({ message: 'UPSTREAM_TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('502 + Web Host 真实错误体（UPSTREAM_UNAVAILABLE）也是代理层的失败：重试两次后成功', async () => {
    const webHost502 = () => {
      const res = {
        status: 502,
        ok: false,
        json: async () => ({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Bridge is unreachable' } }),
        clone: () => res, // 真实 Response 有 clone；旧实现靠它判断“带错误体 = Bridge 自己的回答”
      };
      return res;
    };
    fetchMock
      .mockResolvedValueOnce(webHost502())
      .mockResolvedValueOnce(webHost502())
      .mockResolvedValueOnce(reply(200, { ok: 1 }));
    await expect(bridgeJson('/bridge/v1/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('连不上的说法：读请求重试过才说“已自动重试”，写请求和超时不说', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    const read = await bridgeJson('/bridge/v1/x').catch((e) => e);
    const write = await bridgeJson('/bridge/v1/x', { body: {} }).catch((e) => e);
    expect(read.info).toEqual({ retried: true });
    expect(write.info).toEqual({ retried: false });
  });

  it('读 60 秒 / 写 90 秒兜底超时：到点按“连不上”处理，超时不重试，读正文也计时', async () => {
    vi.useFakeTimers();
    readRetry.delays = [300, 900]; // 就算开着重试，超时也不重试
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );
    const read = expect(bridgeJson('/bridge/v1/x')).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'UNREACHABLE',
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await read;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const write = expect(bridgeJson('/bridge/v1/x', { body: {} })).rejects.toMatchObject({ kind: 'unavailable' });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(fetchMock.mock.calls[1]![1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await write;
    // 响应头到了、正文迟迟不来：同一个计时
    fetchMock.mockReset();
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve({
        status: 200,
        ok: true,
        json: () =>
          new Promise((_, reject) =>
            init.signal?.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')))
          ),
      })
    );
    const body = expect(bridgeJson('/bridge/v1/x')).rejects.toMatchObject({ message: 'UNREACHABLE' });
    await vi.advanceTimersByTimeAsync(60_000);
    await body;
  });
});

describe('对话页“本轮范围”条', () => {
  const ctx = {
    plan_id: 'plan_1',
    version: 1,
    status: 'OK',
    brief: {
      groups: [
        {
          source_id: 'src_a',
          source_name: '项目A资料',
          mode: 'whole',
          counts: { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 },
        },
      ],
      excluded: 0,
      unauthorized: 0,
      refs: {},
      policy: { strict: false, web: 'off' },
    },
    used: [],
    withheld: 0,
    superseded: false,
  };

  it('每轮回复后重读失败：保留上一次成功的内容和“更改范围”', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, ctx));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    await screen.findByText(/项目A资料/);
    fetchMock.mockResolvedValue(proxy(503));
    await act(async () => streamListeners.forEach((fn) => fn({ type: 'finish', conversation_id: 'conv-1' })));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4)); // 1 次成功 + 重读 3 次尝试
    expect(screen.getByText(/项目A资料/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更改范围' })).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE_ZH)).toBeNull();
  });
});

describe('保留旧内容只对暂时连不上生效', () => {
  const ctx = {
    plan_id: 'plan_1',
    version: 1,
    status: 'OK',
    brief: {
      groups: [
        {
          source_id: 'src_a',
          source_name: '项目A资料',
          mode: 'whole',
          counts: { total: 1, ready: 1, indexing: 0, failed: 0, unavailable: 0 },
        },
      ],
      excluded: 0,
      unauthorized: 0,
      refs: {},
      policy: { strict: false, web: 'off' },
    },
    used: [],
    withheld: 0,
    superseded: false,
  };
  it('范围条：用户点“刷新”后暂时失败 → 保留内容并提示、先不让改范围；404 → 不保留', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, ctx));
    render(<ConversationScopeSlot conversation_id='conv-1' />);
    await screen.findByText(/项目A资料/);
    fetchMock.mockResolvedValue(proxy(503));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await screen.findByText(/没能刷新本轮范围/);
    expect(screen.getByText(/项目A资料/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更改范围' })).toBeNull();
    fetchMock.mockResolvedValue(reply(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await screen.findByText('未选择资料：仅普通对话');
  });
});

describe('版本页后台重读', () => {
  const rev = (id: string, over = {}) => ({
    revision_id: id,
    parent_id: null,
    content_sha256: 'x',
    size: 1,
    created_at: '2026-10-01T01:00:00.000Z',
    origin: 'original',
    current: false,
    ...over,
  });
  const timeline = (n: number) => ({
    resource_id: 'res_1',
    current_revision_id: `rev_${n}`,
    items: Array.from({ length: n }, (_, i) => rev(`rev_${n - i}`, { current: i === 0 })),
    page: 1,
    page_size: 50,
    total: n,
  });
  let revisions: () => Promise<unknown>;
  const thirtySeconds: Array<() => void> = []; // 截下页面登记的 30 秒定时重读，用例手动触发
  beforeEach(() => {
    thirtySeconds.length = 0;
    const real = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) =>
      ms === 30_000 ? (thirtySeconds.push(fn), 0) : real(fn, ms)) as typeof setInterval);
    revisions = async () => reply(200, timeline(2));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/revisions')) return revisions();
      if (url.startsWith('/bridge/v1/publications?'))
        return reply(200, { items: [], page: 1, page_size: 50, total: 0 });
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url.endsWith('/metadata'))
        return reply(200, {
          resource_id: 'res_1',
          metadata_revision: 1,
          current_revision_id: 'rev_2',
          tag_ids: [],
          secret: false,
        });
      if (url.includes('/changes?')) return reply(404, { error: { code: 'NOT_FOUND', message: 'x' } });
      if (url.endsWith('/office/html')) return { ...reply(200, null), text: async () => '<html><body>x</body></html>' };
      if (url === '/bridge/v1/edit-sessions') return reply(200, { items: [], next_page: null });
      return reply(404, {});
    });
  });

  it('30 秒后台重读失败：时间线和预览留着，不出错误态', async () => {
    render(<OfficeVersionsSlot />);
    await screen.findByText('v2');
    revisions = async () => proxy(503);
    await act(async () => thirtySeconds.forEach((fn) => fn()));
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/revisions'))).toHaveLength(4)
    );
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.queryByText('版本列表没有读取成功')).toBeNull();
    expect(screen.getByTestId('versions-preview')).toBeInTheDocument();
  });

  it('后台重读得到 404 不保留（照旧进错误态）；用户点刷新后暂时失败则保留并提示', async () => {
    render(<OfficeVersionsSlot />);
    await screen.findByText('v2');
    revisions = async () => reply(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    await act(async () => thirtySeconds.forEach((fn) => fn()));
    await screen.findByText('版本列表没有读取成功');
    revisions = async () => reply(200, timeline(2));
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByText('v2');
    revisions = async () => proxy(503);
    // 预览加载中“刷新预览”是禁用的：等它可点再点，否则点击被忽略（高负载下的竞态）
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '刷新预览' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '刷新预览' }));
    await screen.findByText(/没能刷新版本列表/);
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('慢的旧响应不能盖掉新响应', async () => {
    render(<OfficeVersionsSlot />);
    await screen.findByText('v2');
    let releaseOld: (() => void) | undefined;
    revisions = () => new Promise((ok) => (releaseOld = () => ok(reply(200, timeline(2))))); // 定时重读：慢，且内容是旧的 2 版
    await act(async () => thirtySeconds.forEach((fn) => fn()));
    for (let i = 0; i < 20 && !releaseOld; i++) await act(async () => void (await Promise.resolve())); // 等旧请求真的发出去
    expect(releaseOld).toBeDefined();
    revisions = async () => reply(200, timeline(3)); // 用户点“刷新预览”：快，3 版
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '刷新预览' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '刷新预览' }));
    await screen.findByText('v3');
    await act(async () => releaseOld?.());
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText(/共 3 个版本/)).toBeInTheDocument();
  });
});

describe('上传弹窗读知识库', () => {
  it('知识库 / 标签读不到：说明只能“仅存档”并给重试，点了重读', async () => {
    let down = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (down && (url === '/bridge/v1/scopes' || url === '/bridge/v1/tags')) return proxy(503);
      if (url === '/bridge/v1/scopes') return reply(200, { sources: [], projects: [] });
      if (url === '/bridge/v1/tags') return reply(200, { tags: [] });
      return reply(404, {});
    });
    render(<OfficeImportsSlot />);
    await screen.findByText(/知识库和标签没读到/);
    down = false;
    fireEvent.click(screen.getByRole('button', { name: '立即重试' }));
    await vi.waitFor(() => expect(screen.queryByText(/知识库和标签没读到/)).toBeNull());
  });
});
