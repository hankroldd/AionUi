/**
 * 文件：tests/unit/mycowork/persistentDraftStore.dom.test.tsx
 * 职责：通过真实草稿hook验证保存、刷新、冲突、未知写入结果和登出隔离。
 * 边界：只替换HTTP边界，不替换持久控制器；所有输入均为虚构。
 * 关联：ADR-0025第一片；R046/R067。
 */
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DraftDocument, DraftState } from '@mycowork/contracts';
import { acceptStoredDraft, DraftStatus, resetAccountScopedState, usePersistentDraft } from '@mycowork/ui';

const empty = (): DraftState => ({ content: '', files: [], sessions: [] });
const makeDoc = (state: DraftState, revision = 1): DraftDocument => ({
  draft_id: 'draft-fixture',
  input_location: 'guid',
  revision,
  submission_id: '18cf20c8-2070-45d4-bb4e-b323e1f9cb7f',
  state,
  updated_at: '2026-10-15T01:00:00Z',
});
let saved: DraftDocument | null;
let loseResponse: boolean;
let delayWrite: (() => Promise<void>) | undefined;
const writes: Array<{ expected_revision: number; submission_id: string; state: DraftState }> = [];
const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });

beforeEach(() => {
  saved = null;
  loseResponse = false;
  delayWrite = undefined;
  writes.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return saved ? reply(200, saved) : reply(404, { error: { code: 'NOT_FOUND' } });
      const input = JSON.parse(String(init.body));
      writes.push(input);
      if (delayWrite) await delayWrite();
      const last = writes[writes.length - 2];
      if (saved && last && JSON.stringify(input) === JSON.stringify(last)) return reply(200, saved);
      if (input.expected_revision !== (saved?.revision ?? 0))
        return reply(409, { error: { code: 'REVISION_CONFLICT' } });
      saved = { ...makeDoc(input.state, (saved?.revision ?? 0) + 1), submission_id: input.submission_id };
      if (loseResponse) {
        loseResponse = false;
        throw new TypeError('fixture connection closed');
      }
      return reply(200, saved);
    })
  );
});
afterEach(() => {
  cleanup();
  resetAccountScopedState();
  vi.unstubAllGlobals();
});

function Harness({ owner = 'owner-a' }: { owner?: string }) {
  const [state, setState] = useState<DraftState>(empty);
  const [result, setResult] = useState('');
  const draft = usePersistentDraft({ ownerKey: owner, inputLocation: 'guid', state, onRestore: setState });
  return (
    <>
      <textarea
        aria-label='正文'
        disabled={!draft.ready}
        value={state.content}
        onChange={(e) => setState({ ...state, content: e.target.value })}
      />
      <DraftStatus draft={draft} lang='zh-CN' />
      <output data-testid='result'>{result}</output>
      <output data-testid='state'>{JSON.stringify(state)}</output>
      <button
        onClick={() => {
          void draft
            .flush()
            .then((doc) => setResult(String(doc.revision)))
            .catch(() => setResult('failed'));
        }}
      >
        保存
      </button>
      <button
        onClick={() => {
          void draft
            .accept(state, empty())
            .then((ok) => setResult(String(ok)))
            .catch(() => setResult('failed'));
        }}
      >
        受理
      </button>
    </>
  );
}
const edit = (content: string) => fireEvent.change(screen.getByLabelText('正文'), { target: { value: content } });
const mount = async () => {
  const view = render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText('正文')).not.toBeDisabled());
  return view;
};

it('另一标签页切换账号后，旧页读写和卸载保存仍绑定原账号并保留输入', async () => {
  saved = makeDoc({ ...empty(), content: 'A的虚构草稿' });
  let cookieOwner = 'owner-a';
  const owners: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: RequestInit) => {
      const owner = new Headers(init?.headers).get('x-mycowork-draft-owner');
      owners.push(String(owner));
      if (owner !== cookieOwner) return reply(401, { error: { code: 'UNAUTHENTICATED' } });
      return reply(200, saved);
    })
  );
  await mount();
  cookieOwner = 'owner-b';
  edit('A继续填写的虚构正文');
  fireEvent.click(screen.getByText('保存', { exact: true }));
  await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('failed'));
  expect(screen.getByLabelText('正文')).toHaveValue('A继续填写的虚构正文');
  expect(saved!.state.content).toBe('A的虚构草稿');
  window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
  await waitFor(() => expect(owners.length).toBeGreaterThanOrEqual(3));
  expect(owners.every((owner) => owner === 'owner-a')).toBe(true);
});

it('正文及引用保存后，刷新重新读服务端，submission_id在编辑期间保持', async () => {
  saved = makeDoc({
    content: '旧虚构草稿',
    files: [{ kind: 'project', pe_id: 'project-fixture', relative_path: 'a.txt' }],
    sessions: [{ id: 'conversation-fixture', name: '虚构会话' }],
  });
  const view = await mount();
  expect(screen.getByLabelText('正文')).toHaveValue('旧虚构草稿');
  const status = screen.getByTestId('mycowork-draft-status');
  expect(status).toHaveAttribute('role', 'status');
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(status).toHaveTextContent('草稿已保存');
  expect(status).toHaveClass('mcw-composer-feedback--quiet');
  edit('新虚构草稿');
  expect(status).toHaveTextContent('草稿尚未保存');
  expect(status).not.toHaveClass('mcw-composer-feedback--quiet');
  await waitFor(() => expect(saved?.state.content).toBe('新虚构草稿'));
  const submission = saved!.submission_id;
  edit('继续填写虚构草稿');
  fireEvent.click(screen.getByText('保存', { exact: true }));
  await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('3'));
  expect(saved!.submission_id).toBe(submission);
  expect(saved!.state.files[0]).toEqual({ kind: 'project', pe_id: 'project-fixture', relative_path: 'a.txt' });
  view.unmount();
  resetAccountScopedState();
  await mount();
  expect(screen.getByLabelText('正文')).toHaveValue('继续填写虚构草稿');
  expect(screen.getByTestId('state')).toHaveTextContent('虚构会话');
});

it('新用户没有草稿时不恢复过早捕获的空模型选择', async () => {
  await mount();
  edit('首次虚构输入');
  fireEvent.click(screen.getByText('保存', { exact: true }));
  await waitFor(() => expect(saved?.state.content).toBe('首次虚构输入'));
  expect(writes[0]!.expected_revision).toBe(0);
});

it('另一个标签页更新后冲突保留本页，明确保存本页输入后才覆盖', async () => {
  saved = makeDoc({ ...empty(), content: '共同初稿' });
  await mount();
  saved = makeDoc({ ...empty(), content: '另一页新稿' }, 2);
  edit('本页新稿');
  fireEvent.click(screen.getByText('保存', { exact: true }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('另一个页面'));
  expect(screen.getByRole('alert')).toHaveClass('mcw-composer-feedback--alert');
  expect(screen.getByRole('alert')).not.toHaveClass('mcw-composer-feedback--quiet');
  expect(screen.getByLabelText('正文')).toHaveValue('本页新稿');
  expect(saved.state.content).toBe('另一页新稿');
  fireEvent.click(screen.getByText('保存本页输入'));
  await waitFor(() => expect(saved?.state.content).toBe('本页新稿'));
  expect(saved!.revision).toBe(3);
});

it('选择服务端版本后恢复该版本，不继续覆盖它', async () => {
  saved = makeDoc({ ...empty(), content: '共同初稿' });
  await mount();
  saved = makeDoc({ ...empty(), content: '另一页新稿' }, 2);
  edit('本页新稿');
  fireEvent.click(screen.getByText('保存', { exact: true }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('使用已保存版本'));
  await waitFor(() => expect(screen.getByLabelText('正文')).toHaveValue('另一页新稿'));
  expect(saved.revision).toBe(2);
});

it('保存响应丢失时重试同一请求，不换键、不重复加版本', async () => {
  await mount();
  loseResponse = true;
  edit('响应丢失的虚构草稿');
  fireEvent.click(screen.getByText('保存', { exact: true }));
  const status = await screen.findByRole('alert');
  expect(status).toHaveTextContent('草稿尚未保存，请保留本页并重试。');
  expect(status).toHaveClass('mcw-composer-feedback--alert');
  expect(status).not.toHaveClass('mcw-composer-feedback--quiet');
  fireEvent.click(screen.getByText('重试保存'));
  await waitFor(() => expect(screen.getByTestId('mycowork-draft-status')).toHaveTextContent('草稿已保存'));
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(saved!.revision).toBe(1);
});

it('保存进行中继续输入，串行保存最终正文而不覆盖续写', async () => {
  let release!: () => void;
  delayWrite = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  await mount();
  edit('第一段');
  fireEvent.click(screen.getByText('保存', { exact: true }));
  await waitFor(() => expect(writes).toHaveLength(1));
  edit('第一段加续写');
  delayWrite = undefined;
  await act(async () => {
    release();
  });
  await waitFor(() => expect(saved?.state.content).toBe('第一段加续写'));
  expect(writes).toHaveLength(2);
});

it('受理后只清当前版本，后续任务使用新submission_id', async () => {
  saved = makeDoc({ ...empty(), content: '已发送虚构输入' });
  await mount();
  const previous = saved.submission_id;
  fireEvent.click(screen.getByText('受理', { exact: true }));
  await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('true'));
  expect(screen.getByLabelText('正文')).toHaveValue('');
  expect(saved!.submission_id).not.toBe(previous);
});

it('受理清空等待期间续写，迟到清空不会改掉新正文', async () => {
  saved = makeDoc({ ...empty(), content: '已发送虚构输入' });
  let release!: () => void;
  let first = true;
  delayWrite = () =>
    first
      ? ((first = false),
        new Promise<void>((resolve) => {
          release = resolve;
        }))
      : Promise.resolve();
  await mount();
  fireEvent.click(screen.getByText('受理', { exact: true }));
  await waitFor(() => expect(writes).toHaveLength(1));
  edit('用户已经继续输入');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  expect(writes).toHaveLength(1);
  delayWrite = undefined;
  await act(async () => {
    release();
  });
  await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('false'));
  expect(screen.getByLabelText('正文')).toHaveValue('用户已经继续输入');
  expect(saved!.state.content).toBe('用户已经继续输入');
});

it('登出清缓存后，旧首条消息回调不能清掉新登录账号的草稿', async () => {
  saved = makeDoc({ ...empty(), content: '账号A虚构输入' });
  const view = await mount();
  const source = saved;
  view.unmount();
  resetAccountScopedState();
  saved = makeDoc({ ...empty(), content: '账号B虚构输入' });
  expect(await acceptStoredDraft('owner-a', source, empty())).toBe(false);
  expect(writes).toHaveLength(0);
  expect(saved.state.content).toBe('账号B虚构输入');
});
