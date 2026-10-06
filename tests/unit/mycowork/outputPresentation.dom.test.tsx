/**
 * [mycowork] PR11 W4-4o。文件：tests/unit/mycowork/outputPresentation.dom.test.tsx
 * 职责：产物来源、发布摘要与菜单的真实React/Arco边界检查。
 * 边界：只替换标题resolver与资源HTTP边界，不证明真实原生身份或WeKnora发布。
 */
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ItemMenu, type ItemActions } from '@mycowork/ui/pages/resources/ItemParts.tsx';
import { OutputPublication, OutputSourceLine } from '@mycowork/ui/pages/resources/OutputParts.tsx';
import { resourceText } from '@mycowork/ui/pages/resources/messages.ts';
import { useOutputConversations } from '@mycowork/ui/pages/resources/use-output-conversations.ts';
import { useResources } from '@mycowork/ui/pages/resources/use-resources.ts';
import { ResourceItems } from '@mycowork/ui/pages/resources/ResourceItems.tsx';
import { useResourceSelection } from '@mycowork/ui/pages/resources/ResourceSelection.tsx';
import type { Layout } from '@mycowork/ui/pages/resources/messages.ts';
import type { Resource } from '@mycowork/ui/pages/resources/resource-client.ts';

const text = resourceText('zh-CN');
const output = (over: Partial<Resource> = {}): Resource => ({
  resource_id: 'fictional-output',
  file_name: '虚构产物.pptx',
  origin: 'outputs',
  source_id: null,
  state: 'stored',
  purpose: 'working',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-03T09:00:00Z',
  revision_count: 1,
  produced_in: { plan_id: 'plan-fictional', conversation_id: 'chat-fictional' },
  ...over,
});
const actions = (over: Partial<ItemActions> = {}): ItemActions => ({
  starred: () => false,
  originName: () => '产物',
  sourceName: () => '—',
  onStar: vi.fn(),
  onEditTags: vi.fn(),
  onSecret: vi.fn(),
  ...over,
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('产物展示边界', () => {
  it('历史成功与最近失败并列；产物胶囊不带存档文案', () => {
    const r = output({
      published_to: [
        { publication_id: 'pub-original', source_id: 'src-fictional', status: 'failed', has_published: true },
      ],
    });
    render(<OutputPublication r={r} text={text} />);
    expect(screen.getByText('已发布')).toBeInTheDocument();
    expect(screen.getByText('发布失败')).toBeInTheDocument();
    expect(screen.queryByText(/存档|AI 不引用/)).toBeNull();
    expect(screen.queryByText('已生成')).toBeNull();
  });
  it('排队不显示成功；status不足以猜历史成功', () => {
    const r = output({
      published_to: [
        { publication_id: 'pub-q', source_id: 'src-q', status: 'queued', has_published: false },
        { publication_id: 'pub-legacy', source_id: 'src-legacy', status: 'published' },
      ],
    });
    render(<OutputPublication r={r} text={text} />);
    expect(screen.getByText('已生成')).toBeInTheDocument();
    expect(screen.getByText('发布排队中')).toBeInTheDocument();
    expect(screen.queryByText('已发布')).toBeNull();
  });
  it('来源空名只时间，有解析名称显示来源副标题', () => {
    const { rerender } = render(<OutputSourceLine r={output()} name=' ' lang='zh-CN' text={text} />);
    expect(screen.getByTestId('mycowork-output-source').textContent).not.toContain('来自对话');
    expect(screen.getByTestId('mycowork-output-source').querySelectorAll('.mcw-rc-time')).toHaveLength(1);
    rerender(<OutputSourceLine r={output()} name=' 虚构会话 ' lang='zh-CN' text={text} />);
    expect(screen.getByText('来自对话 ‹虚构会话›')).toBeInTheDocument();
    rerender(
      <OutputSourceLine
        r={output({ produced_in: { plan_id: 'plan-no-chat' } })}
        name='孤立标题'
        lang='zh-CN'
        text={text}
      />
    );
    expect(screen.queryByText('来自对话 ‹孤立标题›')).toBeNull();
  });
  it('发布与来源已接时出现，失败按原ID重试', async () => {
    const onPublish = vi.fn(),
      onRetryPublication = vi.fn();
    const r = output({
      published_to: [
        { publication_id: 'pub-original', source_id: 'src-fictional', status: 'failed', has_published: true },
      ],
    });
    render(
      <ItemMenu
        r={r}
        text={text}
        actions={actions({ conversationName: () => '虚构会话', onPublish, onRetryPublication })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '更多操作 虚构产物.pptx' }));
    expect(await screen.findByRole('link', { name: '打开来源对话' })).toHaveAttribute(
      'href',
      '#/conversation/chat-fictional'
    );
    fireEvent.click(screen.getByText('发布到知识库'));
    expect(onPublish).toHaveBeenCalledWith(r);
    fireEvent.click(screen.getByRole('button', { name: '更多操作 虚构产物.pptx' }));
    fireEvent.click(await screen.findByText('重试失败发布'));
    expect(onRetryPublication).toHaveBeenCalledWith('pub-original');
  });
  it('Secret隐藏发布重试；空标题隐藏来源', async () => {
    render(
      <ItemMenu
        r={output({
          secret: true,
          published_to: [
            { publication_id: 'pub-original', source_id: 'src-fictional', status: 'failed', has_published: true },
          ],
        })}
        text={text}
        actions={actions({ conversationName: () => ' ', onPublish: vi.fn(), onRetryPublication: vi.fn() })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '更多操作 虚构产物.pptx' }));
    await screen.findByText('版本与变化');
    expect(screen.queryByText('发布到知识库')).toBeNull();
    expect(screen.queryByText('重试失败发布')).toBeNull();
    expect(screen.queryByText('打开来源对话')).toBeNull();
  });
  it('卡片与列表共用来源副标题且时间只出现一次', () => {
    const items = [output()];
    const itemActions = actions({ conversationName: () => '虚构会话' });
    function View({ layout }: { layout: Layout }) {
      const selection = useResourceSelection(items, 'query');
      return (
        <ResourceItems
          items={items}
          layout={layout}
          lang='zh-CN'
          text={text}
          tags={[]}
          hit={new Set()}
          actions={itemActions}
          selection={selection}
        />
      );
    }
    const { rerender } = render(<View layout='card' />);
    expect(screen.getByText('来自对话 ‹虚构会话›')).toBeInTheDocument();
    expect(document.querySelectorAll('.mcw-rc-time')).toHaveLength(1);
    rerender(<View layout='list' />);
    expect(screen.getByText('来自对话 ‹虚构会话›')).toBeInTheDocument();
    expect(document.querySelectorAll('.mcw-rc-time')).toHaveLength(1);
    expect(screen.getByText('产物')).toHaveClass('mcw-rc-source');
    expect(screen.getByText('—')).toHaveClass('mcw-rc-knowledge-base');
  });
});

describe('来源标题与查询隔离', () => {
  it('当前页唯一outputs会话ID，空名与404失败不显示', async () => {
    const resolve = vi.fn(async (id: string) => {
      if (id === 'missing') throw new Error('404');
      return id === 'blank' ? ' ' : '虚构标题';
    });
    const items = [
      output(),
      output({ resource_id: 'duplicate' }),
      output({ resource_id: 'missing', produced_in: { plan_id: 'p', conversation_id: 'missing' } }),
      output({ resource_id: 'blank', produced_in: { plan_id: 'p', conversation_id: 'blank' } }),
      output({ resource_id: 'import', origin: 'imports', produced_in: { plan_id: 'p', conversation_id: 'no-read' } }),
    ];
    const { result } = renderHook(() => useOutputConversations(items, 'query-page-1', 'owner-a', resolve));
    await waitFor(() => expect(result.current.get('chat-fictional')).toBe('虚构标题'));
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(result.current.size).toBe(1);
    expect(resolve).not.toHaveBeenCalledWith('no-read');
  });
  it('切页与账户在render即隐藏旧map，迟到响应不重新出现', async () => {
    let late!: (name: string) => void;
    const pending = new Promise<string>((r) => {
      late = r;
    });
    const resolve = vi
      .fn()
      .mockResolvedValueOnce('旧标题')
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce('新账户标题');
    const items = [output()];
    const { result, rerender } = renderHook(({ key, owner }) => useOutputConversations(items, key, owner, resolve), {
      initialProps: { key: 'page-1', owner: 'owner-a' },
    });
    await waitFor(() => expect(result.current.get('chat-fictional')).toBe('旧标题'));
    rerender({ key: 'page-2', owner: 'owner-a' });
    expect(result.current.size).toBe(0);
    rerender({ key: 'page-2', owner: 'owner-b' });
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(result.current.get('chat-fictional')).toBe('新账户标题'));
    await act(async () => late('迟到旧账户标题'));
    expect(result.current.get('chat-fictional')).toBe('新账户标题');
  });
  it('产物Place单次origin=outputs，切换保留服务端查询语义', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [],
        total: 0,
        page: 1,
        page_size: 50,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useResources(null, 0, true));
    await waitFor(() => expect(result.current.state.status).toBe('ok'));
    fetchMock.mockClear();
    act(() => result.current.setPlace({ kind: 'outputs' }));
    await waitFor(() => expect(result.current.state.status).toBe('ok'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('origin=outputs');
    expect(text.outputs).toBe('产物');
    expect(resourceText('en').outputs).toBe('Outputs');
    expect(text.empty.outputs[0]).toBe('还没有产物');
  });
  it('未提供账户不读取，resolver变化当帧隐藏旧标题', async () => {
    const first = vi.fn(async () => '旧resolver标题');
    const second = vi.fn(async () => '新resolver标题');
    const items = [output()];
    const { result, rerender } = renderHook(
      ({ owner, resolver }) => useOutputConversations(items, 'query', owner, resolver),
      { initialProps: { owner: undefined as string | undefined, resolver: first } }
    );
    expect(first).not.toHaveBeenCalled();
    rerender({ owner: 'owner-a', resolver: first });
    await waitFor(() => expect(result.current.get('chat-fictional')).toBe('旧resolver标题'));
    rerender({ owner: 'owner-a', resolver: second });
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(result.current.get('chat-fictional')).toBe('新resolver标题'));
  });
});
