/**
 * 文件：tests/unit/mycowork/resourceTagsSearch.dom.test.tsx
 * 职责：用真实 Arco 下拉验证标签显示名搜索，以及取消不保存、确认保留标签 ID。
 * 边界：只观测 TagsDialog 回调，不发网络请求、不替换 Select 或 Modal。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { Tag } from '@mycowork/contracts';
import { UploadChoices } from '@mycowork/ui/pages/imports/UploadChoices.tsx';
import { importText } from '@mycowork/ui/pages/imports/messages.ts';
import { SmartGroupDialog } from '@mycowork/ui/pages/resources/SmartGroupDialog.tsx';
import { BulkTagsDialog } from '@mycowork/ui/pages/resources/BulkTagsDialog.tsx';
import { TagsDialog } from '@mycowork/ui/pages/resources/TagsDialog.tsx';
import { resourceText } from '@mycowork/ui/pages/resources/messages.ts';
import type { Resource } from '@mycowork/ui/pages/resources/resource-client.ts';
import { item } from './officeResources.fixture';

const text = resourceText('zh-CN');
const tag = (tag_id: string, name: string, parent_id: string | null): Tag => ({
  tag_id,
  name,
  parent_id,
  namespace: 'platform',
  aliases: [],
  revision: 1,
  updated_at: '2026-10-19T00:00:00Z',
});
const tags = [
  tag('tag_801', '项目', null),
  tag('tag_802', 'ui-audit-20261019-space-tag', 'tag_801'),
  tag('tag_803', '其他', null),
];
const child = '项目 / ui-audit-20261019-space-tag';
const resource = item({ tag_ids: [] }) as Resource;

function open() {
  const onCancel = vi.fn();
  const onSave = vi.fn(async () => undefined);
  render(<TagsDialog resource={resource} tags={tags} text={text} onCancel={onCancel} onSave={onSave} />);
  return { onCancel, onSave };
}

async function search(user: ReturnType<typeof userEvent.setup>, query: string, label = text.editTags) {
  const select = screen.getByLabelText(label);
  await user.click(select);
  const input = select.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('标签搜索输入框未出现');
  await user.type(input, query);
}

async function pickChild() {
  const option = await screen.findByText(
    (_content, node) => node?.matches('.arco-select-option') === true && node.textContent === child
  );
  fireEvent.click(option);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('资源标签按显示名称搜索', () => {
  it.each([
    ['项目', ['项目', child]],
    ['UI-AUDIT', [child]],
    ['ui-audit-20261019-space-tag', [child]],
    ['不存在的名称', []],
  ])('输入 %s 只显示匹配的父或子标签', async (query, expected) => {
    const user = userEvent.setup();
    open();
    await search(user, query);
    await waitFor(() => expect(screen.queryAllByRole('option').map((option) => option.textContent)).toEqual(expected));
  });

  it('选中标签再取消不会触发保存', async () => {
    const user = userEvent.setup();
    const handlers = open();
    await user.click(screen.getByLabelText(text.editTags));
    await pickChild();
    expect(screen.getByLabelText(text.editTags)).toHaveTextContent(child);
    await user.click(screen.getByRole('button', { name: text.cancel, exact: true }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it('按名称选中后确认仍提交原标签 ID', async () => {
    const user = userEvent.setup();
    const handlers = open();
    await search(user, 'ui-audit');
    await pickChild();
    await user.click(screen.getByRole('button', { name: text.save, exact: true }));
    expect(handlers.onSave).toHaveBeenCalledExactlyOnceWith(resource, ['tag_802']);
  });
});

describe('其他已复现标签与知识库入口按显示名称搜索', () => {
  it('上传标签按子标签名称搜索', async () => {
    const user = userEvent.setup();
    const upload = importText('zh-CN');
    render(
      <UploadChoices
        text={upload}
        sources={[]}
        tags={tags}
        sourceId={undefined}
        tagIds={[]}
        secret={false}
        disabled={false}
        onSource={vi.fn()}
        onTags={vi.fn()}
        onSecret={vi.fn()}
      />
    );
    await search(user, 'ui-audit', upload.tagsLabel);
    await waitFor(() => expect(screen.queryAllByRole('option').map((option) => option.textContent)).toEqual([child]));
  });

  it.each(['标签', '知识库'])('智能分组的%s搜索按可见名称匹配', async (kind) => {
    const user = userEvent.setup();
    render(
      <SmartGroupDialog
        draft={{ name: '虚构分组', title: '新建虚构分组', filter: { tagIds: [], sourceIds: [] } }}
        tags={tags}
        sources={[
          {
            source_id: 'source_901',
            name: '虚构测试库',
            counts: { total: 0, ready: 0, indexing: 0, failed: 0, unavailable: 0 },
          },
        ]}
        text={text}
        onCancel={vi.fn()}
        onSave={vi.fn(async () => true)}
      />
    );
    if (kind === '标签') {
      await search(user, 'ui-audit', text.groupTags);
      await waitFor(() =>
        expect(
          screen.queryAllByRole('treeitem').some((node) => node.textContent?.includes('ui-audit-20261019-space-tag'))
        ).toBe(true)
      );
    } else {
      await search(user, '测试库', text.groupSources);
      await waitFor(() =>
        expect(screen.queryAllByRole('option').map((option) => option.textContent)).toEqual(['虚构测试库'])
      );
    }
  });

  it('批量标签按显示名称筛选且不触发元数据写入', async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ resource_id: resource.resource_id, metadata_revision: 1, tag_ids: [], secret: false })
        )
    );
    vi.stubGlobal('fetch', fetch);
    render(
      <BulkTagsDialog
        resources={[resource]}
        tags={tags}
        lang='zh-CN'
        text={text}
        onCancel={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByLabelText(text.bulk.chooseTags)).not.toHaveClass('arco-select-disabled'));
    await search(user, 'ui-audit', text.bulk.chooseTags);
    await waitFor(() => expect(screen.queryAllByRole('option').map((option) => option.textContent)).toEqual([child]));
    expect(fetch.mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
  });
});
