/**
 * [mycowork] 文件：tests/unit/mycowork/safeExport.dom.test.tsx
 * 职责：PR08 R066安全导出：菜单与冻结参数、显式确认、真正下载链接、关闭/版本/身份变化取消与Blob回收。
 * 边界：只替换HTTP和浏览器BlobURL边界；真实React、Arco、客户端和状态逻辑，不调用产品实例。
 */
import React, { useState, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { SafeExportDialog } from '@mycowork/ui/pages/versions/SafeExportDialog.tsx';
import { VersionsPage } from '@mycowork/ui/pages/versions/index.ts';
import { RESOURCE_CHANGED } from '@mycowork/ui/pages/office-editor/index.ts';
import { installBridge, json } from './versionsFixture';

const defaults = {
  resourceId: 'resource-1',
  revisionId: 'rev-1',
  headRevisionId: 'rev-3',
  fileName: '../../私有文件名.docx',
  versionLabel: 'v1',
  ownerKey: 'account-a',
  lang: 'zh-CN',
};
const cancelled = vi.fn();
const create = vi.fn(() => 'blob:safe-export-copy');
const revoke = vi.fn();
type Request = { query: URLSearchParams; init: RequestInit | undefined; url: URL };
let requests: Request[];
const error = (code: string, status = 409) => json({ error: { code } }, status);

function serve(reply: (index: number) => Response | Promise<Response> = () => new Response('虚构副本')) {
  const boundary = installBridge({ total: 3, fileName: '虚构稿.docx' });
  const other = globalThis.fetch;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(String(url), 'http://bridge.test');
    if (parsed.pathname.endsWith('/export')) {
      requests.push({ query: parsed.searchParams, init, url: parsed });
      return reply(requests.length - 1);
    }
    return other(url, init);
  });
  return boundary;
}
function Harness({ overrides = {} }: { overrides?: Partial<ComponentProps<typeof SafeExportDialog>> }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <SafeExportDialog
      {...defaults}
      {...overrides}
      onCancel={() => {
        cancelled();
        setOpen(false);
      }}
    />
  ) : (
    <p>已关闭</p>
  );
}
function accept() {
  fireEvent.click(screen.getByRole('checkbox', { name: '我已审阅并认可这一版' }));
}
function prepare() {
  fireEvent.click(screen.getByRole('button', { name: '准备副本', exact: true }));
}
function close() {
  fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }));
}
async function openVersion(index = 1, total = 3) {
  await screen.findByText('已到最早的版本');
  const rows = within(screen.getByTestId('version-timeline')).getAllByTestId('version-item');
  fireEvent.click(within(rows[index]!).getByRole('button', { name: `更多操作 v${total - index}` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '安全导出副本' }));
  await screen.findByTestId('safe-export-dialog');
}
beforeEach(() => {
  requests = [];
  cancelled.mockClear();
  create.mockClear();
  revoke.mockClear();
  const NativeURL = globalThis.URL;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('安全导出真实React与Arco流程', () => {
  it('每个版本更多菜单均有入口，选中历史v2后冻结该revision与当前head，默认仅成果且先认可', async () => {
    serve();
    render(
      <VersionsPage resourceId='resource-1' ownerKey='account-a' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />
    );
    await openVersion();
    expect(screen.getByTestId('safe-export-dialog')).toHaveTextContent('虚构稿.docx · v2');
    expect(screen.getByRole('radio', { name: '仅成果' })).toBeChecked();
    expect(screen.getByRole('button', { name: '准备副本', exact: true })).toBeDisabled();
    expect(requests).toHaveLength(0);
    accept();
    prepare();
    await screen.findByTestId('safe-export-download');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.pathname).toBe('/bridge/v1/resources/resource-1/export');
    expect(Object.fromEntries(requests[0]!.query)).toMatchObject({
      revision_id: 'rev-2',
      expected_head_revision_id: 'rev-3',
      mode: 'result',
    });
    expect(requests[0]?.init?.credentials).toBe('same-origin');
    close();
    await waitFor(() => expect(screen.queryByTestId('safe-export-dialog')).toBeNull());
    await openVersion(2);
    expect(screen.getByTestId('safe-export-dialog')).toHaveTextContent('v1');
    close();
    await waitFor(() => expect(screen.queryByTestId('safe-export-dialog')).toBeNull());
    await openVersion(0);
    expect(screen.getByTestId('safe-export-dialog')).toHaveTextContent('v3');
  });

  it('两种mode绑定明确版本；TAR说明工具读取不能证明模型采用或冒称完整来源', async () => {
    serve();
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: '成果 + 来源清单（TAR）' }));
    expect(screen.getByTestId('safe-export-dialog')).toHaveTextContent('不能证明模型实际采用');
    expect(screen.getByTestId('safe-export-dialog')).toHaveTextContent('清单不完整');
    accept();
    prepare();
    const link = await screen.findByTestId('safe-export-download');
    expect(requests[0]?.query.get('mode')).toBe('result_with_sources');
    expect(requests[0]?.query.get('revision_id')).toBe('rev-1');
    expect(requests[0]?.query.get('expected_head_revision_id')).toBe('rev-3');
    expect(link).toHaveAttribute('download', 'result-with-sources.tar');
  });

  it('准备完成只显示真正a[href][download]，不会程序click或打开新窗口，关闭回收URL', async () => {
    serve();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    const open = vi.spyOn(window, 'open');
    render(<Harness />);
    accept();
    prepare();
    const link = await screen.findByRole('link', { name: '下载副本' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'blob:safe-export-copy');
    expect(link).toHaveAttribute('download', 'result.docx');
    expect(link).not.toHaveAttribute('target');
    expect(click).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    close();
    expect(revoke).toHaveBeenCalledWith('blob:safe-export-copy');
  });

  it('scope→hidden双409分别等待用户明确确认，不自动重发；两次确认保留原revision/head/mode', async () => {
    serve((index) =>
      index === 0
        ? error('DIFF_OUT_OF_SCOPE')
        : index === 1
          ? error('HIDDEN_CONTENT_PRESENT')
          : new Response('确认后副本')
    );
    render(<Harness />);
    accept();
    prepare();
    await screen.findByText(/这一版的 AI 改动超出声明范围/);
    expect(requests).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '确认以上影响并继续准备' }));
    await screen.findByText(/这一版含演讲者备注或批注/);
    expect(requests).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '确认以上影响并继续准备' }));
    await screen.findByTestId('safe-export-download');
    expect(requests).toHaveLength(3);
    requests.forEach((r) =>
      expect(Object.fromEntries(r.query)).toMatchObject({
        revision_id: 'rev-1',
        expected_head_revision_id: 'rev-3',
        mode: 'result',
      })
    );
    expect(requests.map((r) => [r.query.get('confirm_out_of_scope'), r.query.get('confirm_hidden_content')])).toEqual([
      ['false', 'false'],
      ['true', 'false'],
      ['true', 'true'],
    ]);
  });

  it('503显示人话和手动重试，无确认旁路、不自动重发或展示原始错误码', async () => {
    serve(() => error('UPSTREAM_UNAVAILABLE', 503));
    render(<Harness />);
    accept();
    prepare();
    await screen.findByText('资料服务暂不可用，请稍后重试；已保存的内容不受影响。');
    expect(requests).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '确认以上影响并继续准备' })).toBeNull();
    expect(screen.getByTestId('safe-export-dialog')).not.toHaveTextContent('UPSTREAM_UNAVAILABLE');
    fireEvent.click(screen.getByRole('button', { name: '重试准备副本' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.query.toString()).toBe(requests[0]?.query.toString());
    expect(screen.queryByTestId('safe-export-download')).toBeNull();
  });

  it('head冲突要求关闭查看最新后重开；切mode/取消认可不能解锁重试或静默重基准', async () => {
    serve(() => error('REVISION_CONFLICT'));
    render(<Harness />);
    accept();
    prepare();
    await screen.findByText(/文件已有新版本/);
    expect(screen.getByRole('button', { name: '重试准备副本' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '成果 + 来源清单（TAR）' }));
    accept();
    expect(screen.getByRole('button', { name: '重试准备副本' })).toBeDisabled();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.query.get('expected_head_revision_id')).toBe('rev-3');
    close();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SYNTHETIC_PRIVATE_CODE', 400, '操作没有完成，请重试；仍失败请联系管理员。'],
    ['UNSUPPORTED_FORMAT', 415, '这一文件格式不能安全导出，请选择支持的成果文件。'],
    ['NOT_FOUND', 404, '找不到这一版或你已无权导出。请关闭弹窗并重新查看资料。'],
    ['INVALID_REQUEST', 400, '这一版暂不能导出，请检查资源是否已标为秘密后重试。'],
    ['UNAUTHENTICATED', 401, '登录已过期，请重新登录后再试。'],
  ])('%s有本地化说明，技术码不会默认露出', async (code, status, message) => {
    serve(() => error(String(code), Number(status)));
    render(<Harness />);
    accept();
    prepare();
    await screen.findByText(String(message));
    expect(screen.getByTestId('safe-export-dialog')).not.toHaveTextContent(String(code));
  });

  it('pending防连击但关闭仍可取消；迟到fetch成功不创建URL、不恢复弹窗', async () => {
    let done!: (response: Response) => void;
    serve(
      () =>
        new Promise<Response>((resolve) => {
          done = resolve;
        })
    );
    render(<Harness />);
    accept();
    prepare();
    expect(screen.getByRole('button', { name: '正在准备…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '正在准备…' }));
    expect(requests).toHaveLength(1);
    expect(screen.getByRole('button', { name: '关闭', exact: true })).toBeEnabled();
    close();
    expect(requests[0]?.init?.signal?.aborted).toBe(true);
    await act(async () => done(new Response('迟到旧副本')));
    expect(screen.queryByTestId('safe-export-download')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('关闭发生在blob读取期间：迟到blob不创建URL', async () => {
    let done!: (blob: Blob) => void;
    const response = new Response('虚构');
    const blob = vi.spyOn(response, 'blob').mockImplementation(
      () =>
        new Promise<Blob>((resolve) => {
          done = resolve;
        })
    );
    serve(() => response);
    render(<Harness />);
    accept();
    prepare();
    await waitFor(() => expect(blob).toHaveBeenCalled());
    close();
    await act(async () => done(new Blob(['迟到blob'])));
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByTestId('safe-export-dialog')).toBeNull();
  });

  it.each(['resourceId', 'revisionId', 'headRevisionId', 'ownerKey'] as const)(
    '%s变化关闭弹窗并回收已准备URL',
    async (field) => {
      serve();
      const view = render(<Harness />);
      accept();
      prepare();
      await screen.findByTestId('safe-export-download');
      view.rerender(<Harness overrides={{ [field]: `${defaults[field]}-changed` }} />);
      await screen.findByText('已关闭');
      expect(revoke).toHaveBeenCalledWith('blob:safe-export-copy');
      expect(screen.queryByTestId('safe-export-download')).toBeNull();
    }
  );

  it('身份变化期间的迟到请求不能回填；父页面接线实际取消并允许继续导航', async () => {
    let done!: (response: Response) => void;
    serve(
      () =>
        new Promise<Response>((resolve) => {
          done = resolve;
        })
    );
    const props = {
      resourceId: 'resource-1',
      ownerKey: 'account-a',
      lang: 'zh-CN',
      renderMarkdown: (s: string) => <p>{s}</p>,
    };
    const view = render(<VersionsPage {...props} />);
    await openVersion();
    accept();
    prepare();
    view.rerender(<VersionsPage {...props} ownerKey='account-b' />);
    await waitFor(() => expect(screen.queryByTestId('safe-export-dialog')).toBeNull());
    expect(requests[0]?.init?.signal?.aborted).toBe(true);
    await act(async () => done(new Response('前一身份副本')));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByTestId('mycowork-versions')).toBeInTheDocument();
  });

  it('父页面观察到新head时回收旧下载；再次打开才冻结新head', async () => {
    const boundary = serve();
    render(
      <VersionsPage resourceId='resource-1' ownerKey='account-a' lang='zh-CN' renderMarkdown={(s) => <p>{s}</p>} />
    );
    await openVersion();
    accept();
    prepare();
    await screen.findByTestId('safe-export-download');
    boundary.hooks.total = 4;
    act(() => window.dispatchEvent(new CustomEvent(RESOURCE_CHANGED, { detail: { resourceId: 'resource-1' } })));
    await waitFor(() => expect(screen.queryByTestId('safe-export-dialog')).toBeNull());
    expect(revoke).toHaveBeenCalledWith('blob:safe-export-copy');
    await openVersion(1, 4);
    accept();
    prepare();
    await screen.findByTestId('safe-export-download');
    expect(requests[1]?.query.get('expected_head_revision_id')).toBe('rev-4');
    expect(requests[1]?.query.get('revision_id')).toBe('rev-3');
  });

  it('mode改变取消旧准备并清确认，迟到结果不混入另一种副本', async () => {
    let done!: (response: Response) => void;
    serve((index) =>
      index === 0
        ? new Promise<Response>((resolve) => {
            done = resolve;
          })
        : new Response('TAR副本')
    );
    render(<Harness />);
    accept();
    prepare();
    fireEvent.click(screen.getByRole('radio', { name: '成果 + 来源清单（TAR）' }));
    expect(requests[0]?.init?.signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: '准备副本', exact: true })).toBeDisabled();
    accept();
    prepare();
    await screen.findByTestId('safe-export-download');
    await act(async () => done(new Response('迟到原文件')));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('safe-export-download')).toHaveAttribute('download', 'result-with-sources.tar');
  });

  it('英文入口与认可/下载名称可访问', async () => {
    serve();
    render(<Harness overrides={{ lang: 'en-US' }} />);
    expect(screen.getByRole('radio', { name: 'Result only' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have reviewed and accepted this version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare copy', exact: true }));
    await screen.findByRole('link', { name: 'Download copy' });
  });
});
