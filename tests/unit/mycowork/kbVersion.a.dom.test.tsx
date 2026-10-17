/**
 * [mycowork] adapted：知识库版本标记与汇总（拆分a，原 kbVersion.dom.test.tsx，用例原样）。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { KbVersionMark } from '@mycowork/ui/pages/resources/KbVersion.tsx';
import { sourceGroupOf } from '@mycowork/ui/pages/resources/resource-enums.ts';
import type { Resource } from '@mycowork/ui/pages/resources/resource-client.ts';

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
