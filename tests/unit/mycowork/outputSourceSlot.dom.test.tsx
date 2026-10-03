/**
 * 文件：tests/native-output-source.test.tsx
 * 职责：以真实 React DOM 验证原生产物来源入口的身份、重挂与会话标题解析。
 * 边界：仅模拟 Auth、IPC、资源页与重型预览边界；不模拟被测 slot、getter 或错误判定。
 * 关联：PR11 spec §3.3；真实双用户后端鉴权仅源码核查，不属于本测试。
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { OfficeResourcesSlot } from '@/renderer/mycowork-slots';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type AuthState = {
  status: 'checking' | 'authenticated' | 'unauthenticated';
  user: { id: string; username: string } | null;
};
type PageProps = {
  lang: string;
  ownerKey: string | undefined;
  navigationContainer: HTMLElement | null;
  resolveConversationName: (id: string) => Promise<string | undefined>;
};

const boundary = vi.hoisted(() => ({
  auth: {
    status: 'authenticated',
    user: { id: 'fixture-user-a', username: '虚构账户甲' },
  } as AuthState,
  get: vi.fn(),
  props: undefined as PageProps | undefined,
  mounts: 0,
  unmounts: 0,
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => boundary.auth }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => undefined }));
vi.mock('@/common', () => ({ ipcBridge: { conversation: { get: { invoke: boundary.get } } } }));
vi.mock('@/renderer/mycowork-secondary', () => ({
  MYCOWORK_SPACE_SIDER_ID: 'mycowork-space-sider',
  MYCOWORK_MEMORY_SIDER_ID: 'mycowork-memory-sider',
}));
vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
vi.mock('react-router-dom', () => ({
  useInRouterContext: () => true,
  useLocation: () => ({ pathname: '/office/space', state: null }),
  useMatch: () => null,
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));
vi.mock('@icon-park/react', () => ({ BookOpen: () => null }));
vi.mock('@/renderer/pages/conversation/Preview/components/editors', () => ({
  CodeEditor: () => null,
  MarkdownEditor: () => null,
}));
vi.mock('@/renderer/components/Markdown', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/Preview/components/viewers', () => ({ MarkdownViewer: () => null }));
vi.mock('@mycowork/ui', async () => {
  const { createElement, useEffect, useState } = await import('react');
  return {
    ResourcesPage: (props: PageProps) => {
      boundary.props = props;
      const [draft, setDraft] = useState('初始状态');
      useEffect(() => {
        boundary.mounts += 1;
        return () => { boundary.unmounts += 1; };
      }, []);
      return createElement('button', {
        'data-owner': props.ownerKey ?? '',
        onClick: () => setDraft('账户甲旧状态'),
      }, draft);
    },
  };
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  boundary.auth = {
    status: 'authenticated',
    user: { id: 'fixture-user-a', username: '虚构账户甲' },
  };
  boundary.get.mockReset();
  boundary.props = undefined;
  boundary.mounts = 0;
  boundary.unmounts = 0;
  document.body.innerHTML = '<aside id="mycowork-space-sider"></aside>';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function renderSlot() {
  await act(async () => root.render(<OfficeResourcesSlot />));
  return boundary.props!;
}

test('当前登录用户 id、语言及原生二级栏容器透传', async () => {
  const props = await renderSlot();
  expect(props.ownerKey).toBe('fixture-user-a');
  expect(props.lang).toBe('zh-CN');
  expect(props.navigationContainer).toBe(document.getElementById('mycowork-space-sider'));
  expect(typeof props.resolveConversationName).toBe('function');
  expect(boundary.get).not.toHaveBeenCalled();
});

test('同一账户重渲染保留子组件状态', async () => {
  await renderSlot();
  await act(async () => container.querySelector('button')!.click());
  await renderSlot();
  expect(container.textContent).toBe('账户甲旧状态');
  expect(boundary.mounts).toBe(1);
  expect(boundary.unmounts).toBe(0);
});

test('账户变化通过 key 真正重挂并清除旧组件状态', async () => {
  await renderSlot();
  await act(async () => container.querySelector('button')!.click());
  boundary.auth.user = { id: 'fixture-user-b', username: '虚构账户乙' };
  const props = await renderSlot();
  expect(props.ownerKey).toBe('fixture-user-b');
  expect(container.textContent).toBe('初始状态');
  expect(boundary.mounts).toBe(2);
  expect(boundary.unmounts).toBe(1);
});

test.each(['checking', 'unauthenticated'] as const)('%s 即使仍有旧 user 也不提供 ownerKey', async (status) => {
  await renderSlot();
  await act(async () => container.querySelector('button')!.click());
  boundary.auth.status = status;
  const props = await renderSlot();
  expect(props.ownerKey).toBeUndefined();
  expect(container.querySelector('button')!.dataset.owner).toBe('');
  expect(container.textContent).toBe('初始状态');
  expect(boundary.mounts).toBe(2);
  expect(boundary.unmounts).toBe(1);
});

test('桌面 authenticated 且 user 为 null 时使用 local', async () => {
  boundary.auth.user = null;
  const props = await renderSlot();
  expect(props.ownerKey).toBe('local');
});

test('真实 getter 向当前原生 IPC 传入准确 id 并 trim 成功标题', async () => {
  boundary.get.mockResolvedValue({ id: 'fixture-conversation-a', name: '  虚构汇报会话  \n' });
  const props = await renderSlot();
  await expect(props.resolveConversationName('fixture-conversation-a')).resolves.toBe('虚构汇报会话');
  expect(boundary.get).toHaveBeenCalledExactlyOnceWith({ id: 'fixture-conversation-a' });
});

test('结构化 404 NOT_FOUND 由真实 getter 返回 null，resolver 不提供标题', async () => {
  const error = new BackendHttpError({
    method: 'GET', path: '/api/conversations/fixture-missing', status: 404,
    body: { success: false, code: 'NOT_FOUND', error: '虚构会话不可见' },
  });
  boundary.get.mockRejectedValue(error);
  const props = await renderSlot();
  await expect(props.resolveConversationName('fixture-missing')).resolves.toBeUndefined();
  expect(boundary.get).toHaveBeenCalledExactlyOnceWith({ id: 'fixture-missing' });
});

test.each(['', '  \n\t '])('空白原生会话标题 %j 不提供标题', async (name) => {
  boundary.get.mockResolvedValue({ id: 'fixture-empty', name });
  const props = await renderSlot();
  await expect(props.resolveConversationName('fixture-empty')).resolves.toBeUndefined();
});

test('原生 API 失败保留拒绝，让资源页 hook 决定遮蔽', async () => {
  const error = new BackendHttpError({
    method: 'GET', path: '/api/conversations/fixture-failed', status: 503,
    body: { success: false, code: 'UNAVAILABLE', error: '虚构后端故障' },
  });
  boundary.get.mockRejectedValue(error);
  const props = await renderSlot();
  await expect(props.resolveConversationName('fixture-failed')).rejects.toBe(error);
});

test('404 的非 NOT_FOUND 错误仍拒绝，避免吞掉原生 API 故障', async () => {
  const error = new BackendHttpError({
    method: 'GET', path: '/api/conversations/fixture-failed', status: 404,
    body: { success: false, code: 'ROUTE_MISSING', error: '虚构接口不可用' },
  });
  boundary.get.mockRejectedValue(error);
  const props = await renderSlot();
  await expect(props.resolveConversationName('fixture-failed')).rejects.toBe(error);
});

test('同 id 的标题每次重新原生查询，不复用全局缓存', async () => {
  boundary.get.mockResolvedValueOnce({ id: 'fixture-conversation-a', name: '甲可见标题' });
  boundary.get.mockResolvedValueOnce({ id: 'fixture-conversation-a', name: '乙可见新标题' });
  const firstProps = await renderSlot();
  await expect(firstProps.resolveConversationName('fixture-conversation-a')).resolves.toBe('甲可见标题');
  boundary.auth.user = { id: 'fixture-user-b', username: '虚构账户乙' };
  const secondProps = await renderSlot();
  await expect(secondProps.resolveConversationName('fixture-conversation-a')).resolves.toBe('乙可见新标题');
  expect(boundary.get).toHaveBeenCalledTimes(2);
  expect(boundary.get).toHaveBeenNthCalledWith(1, { id: 'fixture-conversation-a' });
  expect(boundary.get).toHaveBeenNthCalledWith(2, { id: 'fixture-conversation-a' });
});
