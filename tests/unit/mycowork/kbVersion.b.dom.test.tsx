/**
 * [mycowork] adapted：知识库版本标记与汇总（拆分b，原 kbVersion.dom.test.tsx，用例原样）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourceItems } from '@mycowork/ui/pages/resources/ResourceItems.tsx';
import { useResourceSelection } from '@mycowork/ui/pages/resources/ResourceSelection.tsx';
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
