/**
 * [mycowork] PR11: smart-group edit keeps the draft after a revision conflict; the first save uses the revision read
 * when the dialog opened, a save after a failure uses the re-read one (and overwrites the other edit, single owner).
 * Only Bridge HTTP is substituted; React state and Arco controls are real. Server contract: Bridge catalog-api tests.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { ResourcesPage } from '@mycowork/ui';

const fetchMock = vi.fn();
const labels = {
  zh: {
    manage: '管理智能分组',
    edit: '编辑分组',
    name: '分组名',
    exact: '带这些标签的文件（任一，不含子标签）',
    save: '保存',
  },
  en: {
    manage: 'Manage smart groups',
    edit: 'Edit group',
    name: 'Group name',
    exact: 'Files with any of these tags (sub-tags excluded)',
    save: 'Save',
  },
};
const tags = ['a', 'b'].map((id) => ({
  tag_id: 'tag_' + id,
  name: '虚构标签' + id,
  parent_id: null,
  namespace: 'platform',
  aliases: [],
  revision: 1,
  updated_at: '2026-10-02T00:00:00Z',
}));
const view = () => ({
  view_id: 'view_fixture',
  name: '虚构分组',
  filter: { tag_ids: ['tag_a'], source_ids: ['src_fixture'], include_descendants: false },
  layout: 'list',
  icon: '',
  position: 0,
  revision: 7,
  missing_tag_ids: [],
  updated_at: '2026-10-02T00:00:00Z',
});
const reply = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => structuredClone(body),
});
const failure = (status: number, code: string) => reply(status, { error: { code, message: code } });
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
const bodies = () => writes().map(([, init]) => JSON.parse(String(init.body)));
type Mode = 'conflict' | 'deleted' | 'unreadable';
const scopes = {
  sources: [
    {
      source_id: 'src_fixture',
      name: '虚构知识库',
      provider: 'weknora',
      counts: { total: 0, ready: 0, indexing: 0, failed: 0, unavailable: 0 },
    },
  ],
  projects: [],
};
const item = {
  resource_id: 'res_fixture',
  file_name: '虚构稿.md',
  source_id: null,
  purpose: 'working',
  state: 'stored',
  tag_ids: [],
  secret: false,
  can_mark_secret: true,
  updated_at: '2026-10-02T00:00:00Z',
  revision_count: 1,
};

function bridge(mode: Mode = 'conflict', conflicts = 1, pendingStar = false) {
  let current = view();
  let attempts = 0;
  let finishStar!: () => void;
  const star = new Promise<void>((resolve) => {
    finishStar = resolve;
  });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/bridge/v1/scopes') return reply(200, scopes);
    if (url === '/bridge/v1/tags') return reply(200, { tags });
    if (url === '/bridge/v1/collections' && method === 'GET') return reply(200, { collections: [] });
    if (url === '/bridge/v1/collections' && method === 'POST') {
      await star;
      return reply(201, {});
    }
    if (url.startsWith('/bridge/v1/resources?'))
      return reply(200, {
        items: pendingStar ? [item] : [],
        total: pendingStar ? 1 : 0,
        page: 1,
        page_size: 50,
      });
    if (url === '/bridge/v1/saved-views' && method === 'GET') {
      if (attempts && mode === 'unreadable') return failure(503, 'UPSTREAM_UNAVAILABLE');
      return reply(200, {
        views: [
          { ...view(), view_id: 'other_view', name: '其他分组', revision: 88 },
          ...(attempts && mode === 'deleted' ? [] : [current]),
        ],
      });
    }
    if (url === '/bridge/v1/saved-views/view_fixture' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body));
      attempts++;
      if (attempts <= conflicts) {
        current = {
          ...current,
          name: '并发版本' + attempts,
          revision: current.revision + 1,
          filter: { tag_ids: ['tag_a'], source_ids: ['src_fixture'], include_descendants: true },
        };
        return failure(409, 'REVISION_CONFLICT');
      }
      if (mode === 'deleted') return failure(404, 'NOT_FOUND');
      if (body.expected_revision !== current.revision) return failure(409, 'REVISION_CONFLICT');
      current = { ...current, ...body, revision: current.revision + 1 };
      return reply(200, current);
    }
    throw new Error('unexpected request: ' + method + ' ' + url);
  });
  return () => {
    current = { ...current, name: '其他操作刷新', revision: 8 };
    finishStar();
  };
}

function holdRequest(match: (url: string, init?: RequestInit) => boolean) {
  const original = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
  let finish!: () => void;
  let held = false;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (!held && match(url, init)) {
      held = true;
      return new Promise((resolve) => {
        finish = () => resolve(original(url, init));
      });
    }
    return original(url, init);
  });
  return () => finish();
}

async function edit(beforeOpen?: () => void, renderPage = true, lang = 'zh-CN') {
  const text = lang === 'en' ? labels.en : labels.zh;
  if (renderPage) render(<ResourcesPage lang={lang} />);
  await screen.findByTestId('mycowork-nav-view-view_fixture');
  if (beforeOpen) {
    await screen.findByText('虚构稿.md');
    beforeOpen();
  }
  fireEvent.click(screen.getByRole('button', { name: text.manage }));
  const manager = await screen.findByRole('dialog');
  const row = within(manager).getByText('虚构分组').closest('.mcw-manage-row') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: text.edit }));
  fireEvent.change(await screen.findByLabelText(text.name), { target: { value: '用户草稿' } });
  fireEvent.click(screen.getByLabelText(text.exact));
  fireEvent.click(await screen.findByText('虚构标签b', { selector: '.arco-tree-select-popup *' }));
  fireEvent.click(screen.getByLabelText(text.name));
}

const save = (lang = 'zh-CN') =>
  fireEvent.click(screen.getByRole('button', { name: (lang === 'en' ? labels.en : labels.zh).save, exact: true }));
const draftBody = (revision: number) => ({
  expected_revision: revision,
  name: '用户草稿',
  filter: { tag_ids: ['tag_a', 'tag_b'], source_ids: ['src_fixture'], include_descendants: false },
});

describe('智能分组条件编辑冲突恢复', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('打开编辑后其他pending写入触发重读，首次保存仍用打开时版本并显示冲突', async () => {
    const refresh = bridge('conflict', 1, true);
    await edit(() => fireEvent.click(screen.getByRole('button', { name: '收藏 虚构稿.md' })));
    refresh();
    await screen.findByText('其他操作刷新', { selector: '[data-testid="mycowork-nav-view-view_fixture"] *' });
    save();
    await waitFor(() => expect(bodies()).toEqual([draftBody(7)]));
    expect(screen.getByLabelText('分组名')).toHaveValue('用户草稿');
  });

  it('取消pending保存并重开后，旧409不会允许新草稿首次保存跳过版本门', async () => {
    bridge();
    const finish = holdRequest((_, init) => init?.method === 'PATCH');
    await edit();
    save();
    fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }));
    await waitFor(() => expect(screen.queryByLabelText('分组名')).toBeNull());
    await edit(undefined, false);
    fireEvent.change(screen.getByLabelText('分组名'), { target: { value: '新会话草稿' } });
    finish();
    await screen.findByText('并发版本1', { selector: '[data-testid="mycowork-nav-view-view_fixture"] *' });
    save();
    await waitFor(() => expect(bodies()).toEqual([draftBody(7), { ...draftBody(7), name: '新会话草稿' }]));
    expect(screen.getByLabelText('分组名')).toHaveValue('新会话草稿');
  });

  it('旧200不能关闭同ID重开的新草稿，当前草稿仍按自己的首次版本保存与重试', async () => {
    bridge('conflict', 0);
    const finish = holdRequest((_, init) => init?.method === 'PATCH');
    await edit();
    save();
    fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }));
    await waitFor(() => expect(screen.queryByLabelText('分组名')).toBeNull());
    await edit(undefined, false);
    fireEvent.change(screen.getByLabelText('分组名'), { target: { value: '新会话草稿' } });
    finish();
    await screen.findByText('用户草稿', { selector: '[data-testid="mycowork-nav-view-view_fixture"] *' });
    expect(screen.getByLabelText('分组名')).toHaveValue('新会话草稿');
    save();
    await screen.findByRole('alert');
    save();
    await waitFor(() =>
      expect(bodies()).toEqual([
        draftBody(7),
        { ...draftBody(7), name: '新会话草稿' },
        { ...draftBody(8), name: '新会话草稿' },
      ])
    );
    await waitFor(() => expect(screen.queryByLabelText('分组名')).toBeNull());
  });

  it.each(['zh-CN', 'en'])('%s慢重读期间只提示实际冲突，不声称已重读成功', async (lang) => {
    bridge();
    await edit(undefined, true, lang);
    const finish = holdRequest((url, init) => url === '/bridge/v1/saved-views' && !init?.method);
    save(lang);
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(lang === 'en' ? /reloaded/i : /已重新读取/);
    expect(writes()).toHaveLength(1);
    finish();
    await screen.findByText('并发版本1', { selector: '[data-testid="mycowork-nav-view-view_fixture"] *' });
    save(lang);
    await waitFor(() => expect(bodies()).toEqual([draftBody(7), draftBody(8)]));
    await waitFor(() => expect(screen.queryByLabelText((lang === 'en' ? labels.en : labels.zh).name)).toBeNull());
  });

  it('重读当前版本后保留草稿，用户再次保存成功且仍为精确标签口径', async () => {
    bridge();
    await edit();
    save();
    await screen.findByText('并发版本1', { selector: '[data-testid="mycowork-nav-view-view_fixture"] *' });
    expect(screen.getByLabelText('分组名')).toHaveValue('用户草稿');
    expect(writes()).toHaveLength(1);
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(/刚在别处被改过.*覆盖/);
    save();
    await waitFor(() => expect(bodies()).toEqual([draftBody(7), draftBody(8)]));
    await waitFor(() => expect(screen.queryByLabelText('分组名')).toBeNull());
  });

  it('再次冲突时不自动重发，每次显式保存取该分组已重读的版本', async () => {
    bridge('conflict', 2);
    await edit();
    save();
    await screen.findByText('并发版本1', { selector: '[data-testid="mycowork-nav-view-view_fixture"] *' });
    save();
    await screen.findByText('并发版本2', { selector: '[data-testid="mycowork-nav-view-view_fixture"] *' });
    expect(writes()).toHaveLength(2);
    save();
    await waitFor(() => expect(bodies()).toEqual([draftBody(7), draftBody(8), draftBody(9)]));
    await waitFor(() => expect(screen.queryByLabelText('分组名')).toBeNull());
  });

  it.each(['deleted', 'unreadable'] as const)('%s时保持原ID和草稿，重试不变成新建或绕过版本门', async (mode) => {
    bridge(mode);
    await edit();
    save();
    await screen.findByText(
      mode === 'deleted' ? /这个分组刚在别处被改过/ : '资料服务暂不可用，请稍后重试；已保存的内容不受影响。'
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url, init]) => url === '/bridge/v1/saved-views' && !init?.method).length
      ).toBe(2)
    );
    save();
    await waitFor(() => expect(bodies()).toEqual([draftBody(7), draftBody(7)]));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(screen.getByLabelText('分组名')).toHaveValue('用户草稿');
    fireEvent.click(screen.getByRole('button', { name: '取消', exact: true }));
    await waitFor(() => expect(screen.queryByLabelText('分组名')).toBeNull());
  });
});
