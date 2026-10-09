/**
 * [mycowork] 版本页正确性 C09：读取失败不冒充正常值。编辑状态读不到（非“暂时连不上”的错误）时，预览上不显示确定的“只读 / 编辑中”，
 * 而是“状态暂时读不到 [重试]”；发布记录重读失败时保留旧记录并标“可能不是最新”；暂时连不上则保留上一次读到的状态。
 */
import React from 'react';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import { VersionsPage } from '@mycowork/ui/pages/versions/index.ts';
import { RESOURCE_CHANGED } from '@mycowork/ui/pages/office-editor/index.ts';
import { installBridge, json, RES } from './versionsFixture';

configure({ asyncUtilTimeout: 4000 });
afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});
const mount = () => render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);
const changed = () =>
  act(async () => void window.dispatchEvent(new CustomEvent(RESOURCE_CHANGED, { detail: { resourceId: RES } })));
const pub = {
  publication_id: 'pub-1',
  resource_id: RES,
  revision_id: 'rev-3',
  target: { kind: 'archive' },
  status: 'published',
  error: null,
  accepted_at: 't',
  published_at: 't',
  created_at: 't',
};
const preview = () => screen.getByTestId('versions-preview');
const inPreview = (text: string) => waitFor(() => expect(within(preview()).getByText(text)).toBeInTheDocument());

describe('编辑状态', () => {
  it('读到了：显示“只读”，没人编辑时不显示“编辑中”', async () => {
    installBridge({ total: 3 });
    mount();
    await inPreview('只读');
    expect(screen.queryByTestId('versions-preview-editing')).toBeNull();
  });

  it('读不到（403 等非暂时连不上）：不显示“只读 / 编辑中”，显示“状态暂时读不到”和重试；重试读到后恢复', async () => {
    let fail = true;
    const b = installBridge({
      total: 3,
      editing: () => (fail ? json({ error: { code: 'FORBIDDEN' } }, 403) : json({ items: [] })),
    });
    mount();
    await inPreview('状态暂时读不到');
    expect(within(preview()).queryByText('只读')).toBeNull();
    expect(screen.queryByTestId('versions-preview-editing')).toBeNull();
    fail = false;
    const before = b.calls.filter((c) => c.url.endsWith('/edit-sessions')).length;
    fireEvent.click(within(preview()).getByRole('button', { name: '重试' }));
    await inPreview('只读');
    expect(b.calls.filter((c) => c.url.endsWith('/edit-sessions')).length).toBeGreaterThan(before);
    expect(within(preview()).queryByText('状态暂时读不到')).toBeNull();
  });

  it('读到过“编辑中”后暂时连不上（503）：保留上一次读到的状态，不翻成“没人在编辑”', async () => {
    let down = false;
    installBridge({
      total: 3,
      editing: () =>
        down
          ? json({ error: { code: 'UPSTREAM_UNAVAILABLE' } }, 503)
          : json({ items: [{ session_id: 's1', resource_id: RES, base_revision_id: 'rev-3', state: 'editing' }] }),
    });
    mount();
    await screen.findByTestId('versions-preview-editing');
    down = true;
    await changed();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByTestId('versions-preview-editing')).toBeInTheDocument();
    expect(within(preview()).queryByText('状态暂时读不到')).toBeNull();
  });
});

describe('发布记录', () => {
  it('重读失败：保留旧记录并标“发布记录可能不是最新”；下一次读到后撤掉标记', async () => {
    let state: 'ok' | 'bad' = 'ok';
    installBridge({
      total: 3,
      publications: () =>
        state === 'ok'
          ? json({ items: [pub], total: 1, page: 1, page_size: 50 })
          : json({ error: { code: 'INTERNAL' } }, 500),
    });
    mount();
    await screen.findByTestId('version-publication');
    expect(screen.queryByText('发布记录可能不是最新')).toBeNull();
    state = 'bad';
    await changed();
    await screen.findByText('发布记录可能不是最新');
    expect(screen.getByTestId('version-publication')).toBeInTheDocument();
    state = 'ok';
    await changed();
    await waitFor(() => expect(screen.queryByText('发布记录可能不是最新')).toBeNull());
  });
});
