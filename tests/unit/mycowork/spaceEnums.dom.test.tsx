/**
 * [mycowork] PR11 W4-8。文件：tests/unit/mycowork/spaceEnums.dom.test.tsx
 * 职责：空间“来源三项 / 状态四项”的映射、悬停原因、筛选项与标签列“最多 2 个 + N”。
 * 边界：只用真实 React/Arco 组件，不连 Bridge；参数怎么带给 Bridge 见 globalResourcesQuery。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { StateTag, TagList } from '@mycowork/ui/pages/resources/ItemParts.tsx';
import { resourceText } from '@mycowork/ui/pages/resources/messages.ts';
import {
  SOURCE_GROUPS,
  SOURCE_ORIGINS,
  STATE_GROUPS,
  STATE_VALUES,
  sourceGroupOf,
  stateGroupOf,
} from '@mycowork/ui/pages/resources/resource-enums.ts';
import type { Resource } from '@mycowork/ui/pages/resources/resource-client.ts';

const text = resourceText('zh-CN');
const en = resourceText('en');
const res = (over: Partial<Resource> = {}): Resource => ({
  resource_id: 'fictional',
  file_name: '虚构.md',
  origin: 'imports',
  source_id: null,
  state: 'ready',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-03T09:00:00Z',
  revision_count: 1,
  ...over,
});
afterEach(cleanup);

describe('来源与状态枚举', () => {
  it('来源三项、状态四项，文案中英文各一套', () => {
    expect(SOURCE_GROUPS.map((g) => text.source[g])).toEqual(['我上传的', 'AI 生成的', '知识库原有的']);
    expect(STATE_GROUPS.map((g) => text.status[g])).toEqual(['AI 可引用', '处理中', '不可用', '仅存档']);
    expect(SOURCE_GROUPS.map((g) => en.source[g])).toEqual(['Uploaded by me', 'AI-generated', 'From knowledge base']);
    expect(STATE_GROUPS.map((g) => en.status[g])).toEqual(['AI can cite', 'Processing', 'Unavailable', 'Archive only']);
  });
  it('四个 origin 恰好各属一个来源组（互斥且穷尽）；已发布成果仍算 AI 生成的', () => {
    const all = Object.values(SOURCE_ORIGINS).flat();
    expect([...all].sort()).toEqual(['imports', 'knowledge_base', 'outputs', 'publication']);
    expect(sourceGroupOf('publication')).toBe('ai');
    expect(sourceGroupOf('outputs')).toBe('ai');
  });
  it('五个 state 恰好各属一个状态组；“不可用”合并失败与暂不可用', () => {
    expect(Object.values(STATE_VALUES).flat().sort()).toEqual(['failed', 'indexing', 'ready', 'stored', 'unavailable']);
    expect(STATE_VALUES.unavailable).toEqual(['failed', 'unavailable']);
  });
  it.each([
    ['ready', 'AI 可引用', 'ready'],
    ['indexing', '处理中', 'processing'],
    ['failed', '不可用', 'unavailable'],
    ['unavailable', '不可用', 'unavailable'],
    ['stored', '仅存档', 'archived'],
  ] as const)('state=%s 显示“%s”', (state, label, group) => {
    const r = res({ state });
    expect(stateGroupOf(r)).toBe(group);
    render(<StateTag r={r} text={text} />);
    expect(screen.getByText(label).closest('.mcw-rc-state')).toHaveAttribute('data-status', group);
  });
  it('不可用的两种原因悬停时仍分得开', async () => {
    const { rerender } = render(<StateTag r={res({ state: 'failed' })} text={text} />);
    fireEvent.mouseEnter(screen.getByText('不可用'));
    expect(await screen.findByText(/入库失败：解析或入库没成功/)).toBeInTheDocument();
    rerender(<StateTag r={res({ state: 'unavailable' })} text={text} />);
    fireEvent.mouseEnter(screen.getByText('不可用'));
    expect(await screen.findByText(/暂不可用：知识库暂时读不到/)).toBeInTheDocument();
  });
  it('产物：没发布过 = 仅存档，发布过 = AI 可引用；Secret 的 ready 仍显示 AI 不引用', () => {
    const out = res({ origin: 'outputs', state: 'stored', published_to: [] });
    expect(stateGroupOf(out)).toBe('archived');
    const published = res({
      origin: 'outputs',
      state: 'stored',
      published_to: [{ publication_id: 'p', source_id: 's', status: 'published', has_published: true }],
    });
    expect(stateGroupOf(published)).toBe('ready');
    render(<StateTag r={res({ secret: true })} text={text} />);
    expect(screen.getByText('AI 不引用')).toBeInTheDocument();
  });
});

describe('标签列', () => {
  const tags = ['a', 'b', 'c', 'd'].map((id) => ({ tag_id: id, name: `标签${id}`, parent_id: null })) as never;
  it('最多显示 2 个，其余收成 +N', () => {
    render(<TagList r={res({ tag_ids: ['a', 'b', 'c', 'd'] })} tags={tags} hit={new Set()} text={text} />);
    expect(screen.getByText('标签a')).toBeInTheDocument();
    expect(screen.getByText('标签b')).toBeInTheDocument();
    expect(screen.queryByText('标签c')).toBeNull();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
  it('2 个以内不出 +N，没有标签不占位', () => {
    const { container, rerender } = render(
      <TagList r={res({ tag_ids: ['a', 'b'] })} tags={tags} hit={new Set()} text={text} />
    );
    expect(screen.queryByText(/^\+\d/)).toBeNull();
    rerender(<TagList r={res()} tags={tags} hit={new Set()} text={text} />);
    expect(container.textContent).toBe('');
  });
});
