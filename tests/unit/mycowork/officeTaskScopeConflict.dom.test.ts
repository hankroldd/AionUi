/**
 * 文件：tests/unit/mycowork/officeTaskScopeConflict.dom.test.ts
 * 职责：A521：授权被撤销后在已有对话里发送，Bridge 回 409 SCOPE_CONFLICT；submitOfficeTask 抛出的错误正文（发送横幅直接显示）须是约定文案，不是原始码。
 * 边界：只替换 fetch；其他错误码原样透传。
 * 关联：docs/contracts/ui-states-and-microcopy.md；packages/ui/src/task-send/client.ts。
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { DraftDocument } from '@mycowork/contracts';
import { submitOfficeTask } from '@mycowork/ui';

afterEach(() => vi.unstubAllGlobals());
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const draft = {
  draft_id: 'd1',
  revision: 1,
  submission_id: '00000000-0000-4000-8000-000000000001',
  state: { content: '请汇总（虚构）', files: [] },
} as unknown as DraftDocument;
const send = (lang: string) =>
  submitOfficeTask({ ownerKey: 'u', isCurrent: () => true, draft, conversationId: 'c1', lang });
/** 第一次 fetch 是 lookup（404 = 没有旧提交），第二次是读会话资料计划，回指定错误码。 */
const stub = (code: string) => {
  let n = 0;
  vi.stubGlobal('fetch', async () => (++n === 1 ? json(404, {}) : json(409, { error: { code, message: 'x' } })));
};

it('SCOPE_CONFLICT 换成约定文案（中英），不显示原始码', async () => {
  const expected = { 'zh-CN': '所选资料已发生变化或权限已撤销', 'en-US': 'revoked' };
  for (const [lang, part] of Object.entries(expected)) {
    stub('SCOPE_CONFLICT');
    const e = (await send(lang).catch((err: Error) => err)) as Error;
    expect(e.message).toContain(part);
    expect(e.message).not.toContain('SCOPE_CONFLICT');
  }
});

it('其他错误码原样透传', async () => {
  stub('SOMETHING_ELSE');
  await expect(send('zh-CN')).rejects.toThrow('SOMETHING_ELSE');
});
