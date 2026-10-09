/**
 * [mycowork] PR08 S4（C12、A330）。文件：tests/unit/mycowork/kbVersion.dom.test.tsx
 * 职责：“知识库里的那一份是哪个版本”的界面：空间行 / 卡片上的小标记（原件落后 / 最新 / 多个库、库内资料落后 / 最新 / 无法确认、
 *       本人发布的副本与原件不可读时不泄露名字、别人发布的副本不标）、同库两项不写“库里是最新”、正在发布不给按钮、
 *       卡片只留标记且“重新发布”进“···”菜单、“重新发布”预选库、来源标签跟随原件、版本页顶部汇总。
 * 边界：只用真实 React/Arco 组件，不连 Bridge；字段形状与 docs/contracts/kb-version.md 一致。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { KbVersionMark } from '@mycowork/ui/pages/resources/KbVersion.tsx';
import { ResourceItems } from '@mycowork/ui/pages/resources/ResourceItems.tsx';
import { useResourceSelection } from '@mycowork/ui/pages/resources/ResourceSelection.tsx';
import { sourceGroupOf } from '@mycowork/ui/pages/resources/resource-enums.ts';
import { resourceText } from '@mycowork/ui/pages/resources/messages.ts';
import { rowActionText } from '@mycowork/ui/pages/resources/row-action-messages.ts';
import type { ItemActions } from '@mycowork/ui/pages/resources/ItemParts.tsx';
import type { Layout } from '@mycowork/ui/pages/resources/messages.ts';
import type { Resource } from '@mycowork/ui/pages/resources/resource-client.ts';
import { KbVersionBar } from '@mycowork/ui/pages/versions/KbVersionBar.tsx';
import { PublishDialog } from '@mycowork/ui/pages/versions/PublishDialog.tsx';
import { versionsText } from '@mycowork/ui/pages/versions/messages.ts';

const names: Record<string, string> = { 'src-a': '库甲', 'src-b': '库乙' };
const kbName = (id: string) => names[id] ?? id;
const res = (over: Partial<Resource> = {}): Resource => ({
  resource_id: 'fictional',
  file_name: '虚构.md',
  origin: 'imports',
  source_id: null,
  state: 'stored',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-03T09:00:00Z',
  revision_count: 5,
  ...over,
});
const target = (source_id: string, over: Record<string, unknown> = {}) => ({
  publication_id: `pub-${source_id}`,
  source_id,
  status: 'published' as const,
  has_published: true,
  revision_id: 'rev-3',
  revision_no: 3,
  is_current: false,
  ...over,
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('原件已发布：库里是哪一版', () => {
  it('落后：写“库里是 v3，当前 v5”并给“重新发布”，点它带上该库', () => {
    const onRepublish = vi.fn();
    const r = res({ published_to: [target('src-a')] });
    render(<KbVersionMark r={r} lang='zh-CN' kbName={kbName} onRepublish={onRepublish} />);
    expect(screen.getByTestId('mycowork-kb-version')).toHaveTextContent('库里是 v3，当前 v5');
    fireEvent.click(screen.getByRole('button', { name: '重新发布' }));
    expect(onRepublish).toHaveBeenCalledWith(r, 'src-a');
  });
  it('最新：只写“库里是最新”，没有重新发布', () => {
    render(
      <KbVersionMark
        r={res({ published_to: [target('src-a', { revision_no: 5, is_current: true })] })}
        lang='zh-CN'
        kbName={kbName}
        onRepublish={vi.fn()}
      />
    );
    expect(screen.getByTestId('mycowork-kb-version')).toHaveTextContent('库里是最新');
    expect(screen.queryByRole('button', { name: '重新发布' })).toBeNull();
  });
  it('多个库各一：只标落后的那个库并带库名，点它预选的是它', () => {
    const onRepublish = vi.fn();
    const r = res({
      published_to: [target('src-a', { revision_no: 5, is_current: true }), target('src-b', { revision_no: 1 })],
    });
    render(<KbVersionMark r={r} lang='zh-CN' kbName={kbName} onRepublish={onRepublish} />);
    const marks = screen.getAllByTestId('mycowork-kb-version');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('库乙：库里是 v1，当前 v5');
    fireEvent.click(screen.getByRole('button', { name: '重新发布' }));
    expect(onRepublish).toHaveBeenCalledWith(r, 'src-b');
  });
  it('没有结论（revision_id 为 null）、没有发布记录、Secret：什么都不写', () => {
    const none = { revision_id: null, revision_no: null, is_current: null };
    const { container, rerender } = render(
      <KbVersionMark r={res({ published_to: [target('src-a', none)] })} lang='zh-CN' kbName={kbName} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<KbVersionMark r={res({ published_to: [] })} lang='zh-CN' kbName={kbName} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<KbVersionMark r={res({ secret: true, published_to: [target('src-a')] })} lang='zh-CN' kbName={kbName} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('英文界面有对应文案', () => {
    render(
      <KbVersionMark r={res({ published_to: [target('src-a')] })} lang='en' kbName={kbName} onRepublish={vi.fn()} />
    );
    expect(screen.getByTestId('mycowork-kb-version')).toHaveTextContent('library has v3, current v5');
    expect(screen.getByRole('button', { name: 'Publish again' })).toBeInTheDocument();
  });
});

describe('直接在库里的资料', () => {
  it('落后：提示“知识库里还是 v1”，不给“重新发布”（没有现成的更新路径）', () => {
    render(
      <KbVersionMark
        r={res({
          source_id: 'src-a',
          indexed_revision_id: 'r1',
          indexed_revision_no: 1,
          indexed_is_current: false,
          revision_count: 2,
        })}
        lang='zh-CN'
        kbName={kbName}
        onRepublish={vi.fn()}
      />
    );
    expect(screen.getByTestId('mycowork-kb-version')).toHaveTextContent('知识库里还是 v1');
    expect(screen.queryByRole('button', { name: '重新发布' })).toBeNull();
  });
  it('最新与无法确认（null）都不显示版本结论', () => {
    const base = { source_id: 'src-a', indexed_revision_id: 'r2', indexed_revision_no: 2, revision_count: 2 };
    const { container, rerender } = render(
      <KbVersionMark r={res({ ...base, indexed_is_current: true })} lang='zh-CN' kbName={kbName} />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <KbVersionMark
        r={res({ source_id: 'src-a', indexed_revision_id: null, indexed_is_current: null })}
        lang='zh-CN'
        kbName={kbName}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('同一个库里原条目与发布的副本（M2）', () => {
  it('原条目还是 v1、发布进同一库的 v2 是最新：不写“库里是最新”，只写“知识库里还是 v1”', () => {
    render(
      <KbVersionMark
        r={res({
          source_id: 'src-a',
          indexed_revision_no: 1,
          indexed_is_current: false,
          revision_count: 2,
          published_to: [target('src-a', { revision_no: 2, is_current: true })],
        })}
        lang='zh-CN'
        kbName={kbName}
      />
    );
    expect(screen.getByTestId('mycowork-kb-version')).toHaveTextContent('知识库里还是 v1');
    expect(screen.queryByText('库里是最新')).toBeNull();
  });
  it('发布到别的库且最新、原条目在另一个库落后：两句各说各的库，不互相盖掉', () => {
    render(
      <KbVersionMark
        r={res({
          source_id: 'src-a',
          indexed_revision_no: 1,
          indexed_is_current: false,
          revision_count: 2,
          published_to: [target('src-b', { revision_no: 2, is_current: true })],
        })}
        lang='zh-CN'
        kbName={kbName}
      />
    );
    expect(screen.getAllByTestId('mycowork-kb-version').map((n) => n.textContent)).toEqual([
      '库里是最新',
      '知识库里还是 v1',
    ]);
  });
});

describe('发布出来的副本（A330）', () => {
  const copy = (over: Partial<Resource> = {}) =>
    res({
      origin: 'publication',
      origin_group: 'mine_uploaded',
      source_id: 'src-a',
      state: 'ready',
      published_from: { revision_id: 'r3', original: { resource_id: 'orig-1', file_name: '我的报告.md' } },
      indexed_revision_no: 3,
      current_revision_no: 3,
      indexed_is_current: true,
      ...over,
    });
  it('标“已发布的副本”，可点回原件的版本页，悬停说明从哪份原件哪一版来', async () => {
    render(<KbVersionMark r={copy()} lang='zh-CN' kbName={kbName} />);
    expect(screen.getByText('已发布的副本')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看原件的版本' })).toHaveAttribute(
      'href',
      '#/office/resources/orig-1/versions'
    );
    fireEvent.mouseEnter(screen.getByText('已发布的副本'));
    expect(await screen.findByText('由《我的报告.md》的 v3 发布而来。')).toBeInTheDocument();
  });
  it('原件已删或读不到：只标“已发布的副本”，不出现原件名也没有链接', async () => {
    render(
      <KbVersionMark r={copy({ published_from: { revision_id: 'r3', original: null } })} lang='zh-CN' kbName={kbName} />
    );
    fireEvent.mouseEnter(screen.getByText('已发布的副本'));
    expect(await screen.findByText(/原件现在看不到（已删除或无权查看）/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('已不在');
    expect(document.body.textContent).not.toContain('我的报告');
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('别人发布到共享库的副本（没有 published_from）：不标“已发布的副本”，也不说原件如何', () => {
    const { container } = render(
      <KbVersionMark
        r={copy({
          origin_group: 'kb_native',
          published_from: undefined,
          indexed_revision_no: undefined,
          indexed_is_current: null,
        })}
        lang='zh-CN'
        kbName={kbName}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('原件之后又改了：写“原件已更新到 v5”', () => {
    render(
      <KbVersionMark r={copy({ indexed_is_current: false, current_revision_no: 5 })} lang='zh-CN' kbName={kbName} />
    );
    expect(screen.getByTestId('mycowork-kb-version')).toHaveTextContent('原件已更新到 v5');
  });
  it('来源标签跟随原件：有 origin_group 以它为准，缺省才按 origin 推', () => {
    expect(sourceGroupOf(copy())).toBe('mine_uploaded');
    expect(sourceGroupOf(copy({ origin_group: 'ai_generated' }))).toBe('ai_generated');
    expect(sourceGroupOf({ origin: 'publication' })).toBe('kb_native');
    expect(sourceGroupOf({ origin: 'outputs' })).toBe('ai_generated');
    expect(sourceGroupOf({ origin: 'imports' })).toBe('mine_uploaded');
  });
});

describe('行与卡片', () => {
  const actions = (over: Partial<ItemActions> = {}): ItemActions => ({
    starred: () => false,
    starring: () => false,
    originName: () => '来源',
    sourceName: () => '—',
    kbName,
    onStar: vi.fn(),
    onEditTags: vi.fn(),
    onSecret: vi.fn(),
    row: rowActionText('zh-CN'),
    canTrash: () => false,
    onTrash: vi.fn(),
    ...over,
  });
  const text = resourceText('zh-CN');
  function View({ layout, items, a }: { layout: Layout; items: Resource[]; a: ItemActions }) {
    const selection = useResourceSelection(items, 'query');
    return (
      <ResourceItems
        items={items}
        layout={layout}
        lang='zh-CN'
        text={text}
        tags={[]}
        hit={new Set()}
        actions={a}
        selection={selection}
      />
    );
  }
  it('列表：落后的原件行内给“重新发布”，点它走现有发布入口并带库', () => {
    const onPublish = vi.fn();
    const r = res({ published_to: [target('src-a')] });
    render(<View layout='list' items={[r]} a={actions({ onPublish })} />);
    expect(screen.getByTestId('mycowork-kb-version')).toHaveTextContent('库里是 v3，当前 v5');
    fireEvent.click(screen.getByRole('button', { name: '重新发布' }));
    expect(onPublish).toHaveBeenCalledWith(r, 'src-a');
  });
  it('卡片：只留标记，行内没有“重新发布”；它在“···”菜单里，点它带库走发布入口', async () => {
    const onPublish = vi.fn();
    const r = res({ published_to: [target('src-a')] });
    render(<View layout='card' items={[r]} a={actions({ onPublish })} />);
    expect(screen.getByTestId('mycowork-kb-version')).toHaveTextContent('库里是 v3，当前 v5');
    expect(screen.queryByRole('button', { name: '重新发布' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `更多操作 ${r.file_name}` }));
    fireEvent.click(await screen.findByText('重新发布'));
    expect(onPublish).toHaveBeenCalledWith(r, 'src-a');
  });
  it('卡片：副本只留一个标记（没有“查看原件的版本”链接）；原件更新了则那一个标记写“原件已更新到 v5”', () => {
    const copy = res({
      origin: 'publication',
      source_id: 'src-a',
      published_from: { revision_id: 'r3', original: { resource_id: 'orig-1', file_name: '我的报告.md' } },
      indexed_revision_no: 3,
      current_revision_no: 5,
      indexed_is_current: false,
    });
    render(<View layout='card' items={[copy]} a={actions()} />);
    const mark = screen.getByTestId('mycowork-published-copy');
    expect(mark).toHaveTextContent('原件已更新到 v5');
    expect(within(mark).queryByRole('link')).toBeNull();
    expect(mark.querySelectorAll('.arco-tag')).toHaveLength(1);
  });
  it('正在发布（排队 / 入库中）：行上不给“重新发布”，改写“正在发布”；卡片菜单里也没有', async () => {
    const onPublish = vi.fn();
    const r = res({ published_to: [target('src-a', { status: 'indexing' })] });
    const { unmount } = render(<View layout='list' items={[r]} a={actions({ onPublish })} />);
    expect(screen.getByTestId('mycowork-kb-version')).toHaveTextContent('库里是 v3，当前 v5');
    expect(screen.queryByRole('button', { name: '重新发布' })).toBeNull();
    expect(screen.getByText('正在发布')).toBeInTheDocument();
    unmount();
    render(<View layout='card' items={[r]} a={actions({ onPublish })} />);
    fireEvent.click(screen.getByRole('button', { name: `更多操作 ${r.file_name}` }));
    await screen.findByText(text.versions); // 菜单已展开
    expect(screen.queryByText('重新发布')).toBeNull();
  });
});

describe('“重新发布”预选库', () => {
  const sources = [
    { source_id: 'src-a', name: '库甲' },
    { source_id: 'src-b', name: '库乙' },
  ] as never;
  const dialog = (initialSourceId?: string) => (
    <PublishDialog
      visible
      secret={false}
      sources={sources}
      text={versionsText('zh-CN')}
      initialFileName='虚构.md'
      initialSourceId={initialSourceId}
      pending={false}
      frozen={false}
      okText='发布'
      notice={null}
      onCancel={vi.fn()}
      onPublish={vi.fn()}
    />
  );
  it('给了库就预选它，发布按钮可点；不给且有多个库时不预选', () => {
    const { unmount } = render(dialog('src-b'));
    expect(screen.getByText('库乙')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布' })).not.toBeDisabled();
    unmount();
    render(dialog());
    expect(screen.getByRole('button', { name: '发布' })).toBeDisabled();
  });
});

describe('版本页顶部汇总', () => {
  it('同一个库有落后的原条目和发布的副本：并成一句，不出现“（最新）”', () => {
    render(
      <KbVersionBar
        lang='zh-CN'
        kbs={[
          { source_id: 'src-a', via: 'publication', revision_id: 'r2', revision_no: 2, is_current: true },
          { source_id: 'src-a', via: 'fingerprint', revision_id: 'r1', revision_no: 1, is_current: false },
        ]}
        currentNo={2}
        kbName={kbName}
        onRepublish={vi.fn()}
      />
    );
    const bar = screen.getByTestId('mycowork-versions-kb');
    expect(bar.querySelectorAll('.mcw-ver-kb-row')).toHaveLength(1);
    expect(bar).toHaveTextContent('知识库「库甲」里同时有原条目 v1和发布的副本 v2，AI 仍可能检索到 v1');
    expect(bar).not.toHaveTextContent('最新');
    expect(screen.queryByRole('button', { name: '重新发布' })).toBeNull();
  });
  it('正在发布的库：不给“重新发布”，写“正在发布”', () => {
    render(
      <KbVersionBar
        lang='zh-CN'
        kbs={[kb({})]}
        currentNo={5}
        kbName={kbName}
        onRepublish={vi.fn()}
        publishing={new Set(['src-a'])}
      />
    );
    expect(screen.queryByRole('button', { name: '重新发布' })).toBeNull();
    expect(screen.getByText('正在发布')).toBeInTheDocument();
  });
  const kb = (over: Record<string, unknown>) => ({
    source_id: 'src-a',
    via: 'publication' as const,
    revision_id: 'r3',
    revision_no: 3,
    is_current: false,
    ...over,
  });
  it('落后：写“知识库「库甲」里是 v3，不是当前版本 v5”，带“重新发布”预选该库', () => {
    const onRepublish = vi.fn();
    render(<KbVersionBar lang='zh-CN' kbs={[kb({})]} currentNo={5} kbName={kbName} onRepublish={onRepublish} />);
    expect(screen.getByTestId('mycowork-versions-kb')).toHaveTextContent('知识库「库甲」里是 v3，不是当前版本 v5');
    fireEvent.click(screen.getByRole('button', { name: '重新发布' }));
    expect(onRepublish).toHaveBeenCalledWith('src-a');
  });
  it('最新、无法确认、库内资料（fingerprint）落后不给按钮、没有库时不显示', () => {
    const { container, rerender } = render(
      <KbVersionBar
        lang='zh-CN'
        kbs={[kb({ revision_no: 5, is_current: true })]}
        currentNo={5}
        kbName={kbName}
        onRepublish={vi.fn()}
      />
    );
    expect(screen.getByTestId('mycowork-versions-kb')).toHaveTextContent('里是 v5（最新）');
    rerender(
      <KbVersionBar
        lang='zh-CN'
        kbs={[kb({ revision_id: null, revision_no: null, is_current: null, via: 'fingerprint' })]}
        currentNo={5}
        kbName={kbName}
      />
    );
    expect(screen.getByTestId('mycowork-versions-kb')).toHaveTextContent('无法确认知识库「库甲」里是哪一版');
    rerender(
      <KbVersionBar
        lang='zh-CN'
        kbs={[kb({ via: 'fingerprint' })]}
        currentNo={5}
        kbName={kbName}
        onRepublish={vi.fn()}
      />
    );
    expect(screen.getByTestId('mycowork-versions-kb')).toHaveTextContent('不是当前版本');
    expect(screen.queryByRole('button', { name: '重新发布' })).toBeNull();
    rerender(<KbVersionBar lang='zh-CN' kbs={[]} currentNo={5} kbName={kbName} />);
    expect(container).toBeEmptyDOMElement();
  });
});
