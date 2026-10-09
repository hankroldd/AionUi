/**
 * [mycowork] 版本页正确性 C08：恢复为新版本。确认框写清后果并同时显示“要恢复的版本”与“当前版本”；确认后弹窗里显示处理中、禁止重复提交；
 * 成功后关闭并提示“已恢复为新版本 vN（内容与 vK 相同）”，时间线刷新、对比对准新版本；失败留在弹窗里给人话原因；
 * 结果未知（网络中断）重试沿用同一个 submission_id，用户重新发起一次恢复才换新的；与当前版本内容相同如实说“不需要恢复”。
 */
import React from 'react';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import { VersionsPage } from '@mycowork/ui/pages/versions/index.ts';
import { installBridge, json, revItem } from './versionsFixture';

configure({ asyncUtilTimeout: 4000 });
afterEach(() => {
  cleanup();
  Message.clear();
  vi.unstubAllGlobals();
});
const posts = (b: ReturnType<typeof installBridge>) => b.calls.filter((c) => c.method === 'POST');
const created = (rev: string, from: string, total: number) =>
  json(
    { created: true, revision: revItem(total, total, { revision_id: rev, origin: 'restore', restored_from: from }) },
    201
  );
async function openRestore(label: string) {
  fireEvent.click(
    within(await screen.findByTestId('version-timeline')).getByRole('button', { name: `更多操作 ${label}` })
  );
  fireEvent.click(await screen.findByRole('menuitem', { name: '恢复为新版本' }));
  return screen.findByRole('dialog');
}
const mount = () => render(<VersionsPage resourceId='resource-1' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />);

describe('恢复确认框', () => {
  it('写清后果，并同时显示“要恢复的版本”和“当前版本”', async () => {
    installBridge({ total: 3 });
    mount();
    const dialog = await openRestore('v1');
    expect(within(dialog).getByText(/恢复会新建一个内容相同的版本，原有历史都保留/)).toBeInTheDocument();
    expect(within(dialog).getByText('要恢复的版本').parentElement).toHaveTextContent('v1');
    expect(within(dialog).getByText('当前版本').parentElement).toHaveTextContent('v3');
  });

  it('确认后显示处理中并禁止重复提交；成功后关闭、提示新版本号、时间线多一版、对比对准新版本', async () => {
    let release!: (r: Response) => void;
    const b = installBridge({
      total: 3,
      restore: () => new Promise<Response>((r) => (release = r)),
    });
    mount();
    const dialog = await openRestore('v1');
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    await within(dialog).findByText('正在恢复…');
    fireEvent.click(within(dialog).getByRole('button', { name: /恢复为新版本|正在恢复/ }));
    expect(posts(b)).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    b.hooks.total = 4;
    await act(async () => release(created('rev-4', 'rev-1', 4)));
    expect(await screen.findByText('已恢复为新版本 v4（内容与 v1 相同）')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(within(screen.getByTestId('version-timeline')).getAllByTestId('version-item')).toHaveLength(4)
    );
    await waitFor(() => expect(screen.getByTestId('versions-compare-title')).toHaveTextContent('v3 → v4'));
    expect(posts(b)[0]?.body).toMatchObject({ expected_current_revision_id: 'rev-3' });
  });

  it('服务端拒绝：留在弹窗里给人话原因，不关闭', async () => {
    installBridge({ total: 3, restore: () => json({ error: { code: 'EDIT_LEASE_HELD' } }, 409) });
    mount();
    const dialog = await openRestore('v1');
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    expect(await within(dialog).findByText(/编辑中不能恢复覆盖/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('版本已变（REVISION_CONFLICT）：告诉用户关闭后重新选择，不再提供沿用旧请求的重试', async () => {
    installBridge({ total: 3, restore: () => json({ error: { code: 'REVISION_CONFLICT' } }, 409) });
    mount();
    const dialog = await openRestore('v1');
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    expect(await within(dialog).findByText(/文件刚刚出了新版本/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '恢复为新版本' })).toBeNull();
  });

  it('结果未知：重试沿用同一个 submission_id 与同一个期望版本；用户重新发起一次才换新的', async () => {
    let n = 0;
    const b = installBridge({
      total: 3,
      restore: () => {
        if (++n === 1) throw new TypeError('network down');
        return n === 2 ? created('rev-4', 'rev-1', 4) : json({ error: { code: 'EDIT_LEASE_HELD' } }, 409);
      },
    });
    mount();
    const dialog = await openRestore('v1');
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    expect(await within(dialog).findByText(/没有收到恢复结果/)).toBeInTheDocument();
    b.hooks.total = 4; // 第一次其实已经成功（服务端幂等重放）
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }));
    await screen.findByText(/已恢复为新版本/);
    const [first, second] = posts(b).map(
      (c) => c.body as { submission_id: string; expected_current_revision_id: string }
    );
    expect(second).toEqual(first);
    // 重新发起一次新的恢复：新 id
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const again = await openRestore('v2');
    fireEvent.click(within(again).getByRole('button', { name: '恢复为新版本' }));
    await waitFor(() => expect(posts(b)).toHaveLength(3));
    const third = posts(b)[2]?.body as { submission_id: string };
    expect(third.submission_id).not.toBe(first?.submission_id);
  });

  it('结果未知后重试得到重放（created=false 且是同一次恢复）：当成功，不说“内容相同”', async () => {
    let n = 0;
    const b = installBridge({
      total: 3,
      restore: () => {
        if (++n === 1) throw new TypeError('network down');
        return json(
          {
            created: false,
            revision: revItem(4, 4, { revision_id: 'rev-4', origin: 'restore', restored_from: 'rev-1' }),
          },
          200
        );
      },
    });
    mount();
    const dialog = await openRestore('v1');
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    await within(dialog).findByText(/没有收到恢复结果/);
    b.hooks.total = 4;
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }));
    expect(await screen.findByText('已恢复为新版本 v4（内容与 v1 相同）')).toBeInTheDocument();
  });

  it('要恢复的版本和当前版本内容相同：直接说不需要恢复，确认按钮不可用', async () => {
    const b = installBridge({ total: 3 });
    const tl = b.timelinePage;
    vi.stubGlobal(
      'fetch',
      ((orig) => async (url: string, init?: RequestInit) => {
        if (url.endsWith('/revisions') && !init?.method) {
          const t = tl(1);
          t.items[0] = { ...t.items[0]!, content_sha256: 'same' };
          t.items[1] = { ...t.items[1]!, content_sha256: 'same' };
          return json(t);
        }
        return orig(url, init);
      })(globalThis.fetch)
    );
    mount();
    const dialog = await openRestore('v2');
    expect(within(dialog).getByText('这一版和当前版本内容相同，不需要恢复。')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '恢复为新版本' })).toBeDisabled();
    expect(posts(b)).toHaveLength(0);
  });

  it('服务端说内容相同（created=false，不是重放）：如实提示，不当作恢复成功', async () => {
    installBridge({
      total: 3,
      restore: () => json({ created: false, revision: revItem(3, 3) }, 200),
    });
    mount();
    const dialog = await openRestore('v1');
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为新版本' }));
    expect(await within(dialog).findByText('这一版和当前版本内容相同，不需要恢复。')).toBeInTheDocument();
    expect(screen.queryByText(/已恢复为新版本 v/)).toBeNull();
  });
});
