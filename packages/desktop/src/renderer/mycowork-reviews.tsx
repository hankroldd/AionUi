/**
 * 文件：packages/desktop/src/renderer/mycowork-reviews.tsx
 * 职责：通过公开 IPC 创建、核验和观察固定版本 Reviewer 会话。
 * 边界：不复用旧助手、Skill、文件或会话；未知响应不重投，空闲不代表审查成功。
 * 关联：PR10 E1；review-loop.md §7；全局只读 hook 由部署执行方保证。
 */
import React, { useEffect, useMemo, useRef } from 'react';
import type { ReviewAdapter, ReviewObservation } from '@mycowork/ui';
import { ReviewCreationNotStarted } from '@mycowork/ui';
import type { Review, ReviewExecution, ReviewSession } from '@mycowork/contracts';
import { ipcBridge } from '@/common';
import type { IMessageToolCall } from '@/common/chat/chatLib';
import type { ISessionMcpServer, TProviderWithModel } from '@/common/config/storage';
import { useOwnerKey } from '@/renderer/mycowork-resource-navigation';
import { safeModel, useReviewModelSelector, type ReviewModel } from '@/renderer/mycowork-review-model-selector';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { ReviewSourceSelector } from '@/renderer/components/workspace/ReviewSourceSelector';

type CheckOwner = () => void;
type MessagePage = Awaited<ReturnType<typeof ipcBridge.database.getConversationMessages.invoke>>;
type SessionServer = ReviewSession['session_mcp_server'];

function apiId(value: string): string {
  if (!value || value === '.' || value === '..') throw new Error('review_invalid_id');
  return encodeURIComponent(value);
}

async function owned<T>(pending: Promise<T>, check: CheckOwner): Promise<T> {
  try {
    return await pending;
  } finally {
    check();
  }
}

function sameServer(actual: ISessionMcpServer | undefined, expected: SessionServer): boolean {
  return (
    actual?.id === expected.id &&
    actual.name === expected.name &&
    actual.transport?.type === 'streamable_http' &&
    expected.transport.type === 'streamable_http' &&
    actual.transport.url === expected.transport.url &&
    JSON.stringify(Object.entries(actual.transport.headers ?? {}).toSorted()) ===
      JSON.stringify(Object.entries(expected.transport.headers ?? {}).toSorted())
  );
}

async function verify(
  conversationId: string,
  session: ReviewSession,
  expectedModel: ReviewModel | undefined,
  check: CheckOwner
): Promise<void> {
  const conversation = await owned(getConversationOrNull(apiId(conversationId)), check);
  if (!conversation) throw new Error('review_executor_lost');
  if (conversation.type !== 'aionrs') throw new Error('review_isolation_mismatch');
  const extra = conversation.extra;
  if (
    conversation.id !== conversationId ||
    conversation.assistant ||
    extra.preset_assistant_id ||
    extra.workspace !== session.workspace ||
    !Array.isArray(extra.skills) ||
    extra.skills.length !== 0 ||
    !Array.isArray(extra.mcp_server_ids) ||
    extra.mcp_server_ids.length !== 0 ||
    !Array.isArray(extra.session_mcp_servers) ||
    extra.session_mcp_servers.length !== 1 ||
    !sameServer(extra.session_mcp_servers[0]!, session.session_mcp_server) ||
    (extra.session_mode !== undefined && extra.session_mode !== 'default')
  )
    throw new Error('review_isolation_mismatch');
  // 宿主fromApiConversation已将REST的provider_id/model归一为id/use_model。
  const actual: unknown = conversation.model;
  if (
    !expectedModel ||
    !record(actual) ||
    actual.id !== expectedModel.id ||
    actual.use_model !== expectedModel.use_model
  )
    throw new Error('review_model_mismatch');
}

const absolutePath = (path: string): boolean => /^(?:\/|[A-Za-z]:[\\/])/.test(path);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function expectedImages(workspace: string, review: Review, check: CheckOwner): Promise<string[]> {
  const raw = await owned(ipcBridge.fs.readFile.invoke({ path: `${workspace}/review-input.json`, workspace }), check);
  let input: unknown;
  try {
    input = typeof raw === 'string' ? JSON.parse(raw) : undefined;
  } catch (cause) {
    throw new Error('review_input_unconfirmed', { cause });
  }
  if (
    !record(input) ||
    input.resource_id !== review.resource_id ||
    input.input_revision_id !== review.input_revision_id
  )
    throw new Error('review_input_unconfirmed');
  if (input.format === 'text' && input.render === null) return [];
  const render = input.render;
  if (
    input.format !== 'pptx' ||
    !record(render) ||
    !Number.isSafeInteger(render.expected_pages) ||
    Number(render.expected_pages) < 1 ||
    render.completed_pages !== render.expected_pages ||
    !Array.isArray(render.pages) ||
    render.pages.length !== render.expected_pages ||
    render.pages.some(
      (page, index) => !record(page) || page.page !== index + 1 || page.png !== `render-${index + 1}.png`
    )
  )
    throw new Error('review_input_unconfirmed');
  return render.pages.map((_page, index) => `${workspace}/render-${index + 1}.png`);
}

function viewedImage(tool: IMessageToolCall['content']): string | undefined {
  const path = (tool.input ?? tool.args)?.file_path;
  return tool.name === 'ViewImage' &&
    tool.status === 'completed' &&
    !tool.error &&
    typeof path === 'string' &&
    absolutePath(path) &&
    tool.output === `Image loaded from ${path} and attached to the next model turn.`
    ? path
    : undefined;
}

function candidateReport(tool: IMessageToolCall['content']): string | undefined {
  return (tool.name === 'review_report_candidate' || tool.name === 'mcp__mycowork_bridge_review_report_candidate') &&
    tool.status === 'completed' &&
    !tool.error &&
    typeof tool.output === 'string'
    ? tool.output
    : undefined;
}

async function outputs(execution: ReviewExecution, images: string[], check: CheckOwner) {
  if (!execution.message_id || !execution.turn_id) throw new Error('review_turn_unknown');
  const conversation_id = apiId(execution.conversation_id);
  const read = (cursor?: string): Promise<MessagePage> =>
    owned(
      ipcBridge.database.getConversationMessages.invoke({
        conversation_id,
        content_mode: 'full',
        limit: 100,
        ...(cursor ? { after: cursor } : { anchor_message_id: execution.message_id }),
      }),
      check
    );
  let page = await read();
  const anchor = page.items.findIndex(
    (item) => item.id === execution.message_id || item.msg_id === execution.message_id
  );
  if (
    anchor < 0 ||
    page.items[anchor]!.position !== 'right' ||
    page.items[anchor]!.conversation_id !== execution.conversation_id
  )
    throw new Error('review_message_anchor_missing');
  let items = page.items.slice(anchor + 1);
  const result = {
    texts: [] as string[],
    viewed: new Set<string>(),
    renderingVerifiedFrom: images.length === 0 ? 0 : null,
  };
  const cursors = new Set<string>();
  for (;;) {
    for (const item of items) {
      if (item.conversation_id !== execution.conversation_id) throw new Error('review_message_scope_mismatch');
      if (item.position === 'right') return result;
      if (item.type === 'tool_call' && item.backend_turn_id === execution.turn_id) {
        const path = viewedImage(item.content);
        if (path) {
          result.viewed.add(path);
          if (result.renderingVerifiedFrom === null && images.every((image) => result.viewed.has(image)))
            result.renderingVerifiedFrom = result.texts.length;
        }
        const report = candidateReport(item.content);
        if (report !== undefined) result.texts.push(report);
      }
      if (
        item.position === 'left' &&
        item.type === 'text' &&
        item.status === 'finish' &&
        typeof item.content.content === 'string'
      )
        result.texts.push(item.content.content);
    }
    if (!page.has_more_after) return result;
    const cursor = page.newest_cursor;
    if (!cursor || cursors.has(cursor) || cursors.size >= 50) throw new Error('review_messages_incomplete');
    cursors.add(cursor);
    // eslint-disable-next-line no-await-in-loop -- 后页游标来自当前页，不能并行读取。
    page = await read(cursor);
    items = page.items;
  }
}

async function create(session: ReviewSession, model: TProviderWithModel, check: CheckOwner): Promise<string> {
  let excluded: string[];
  try {
    const skills = await owned(ipcBridge.fs.listAvailableSkills.invoke(), check);
    excluded = skills.filter((skill) => skill.source === 'builtin').map((skill) => skill.name);
  } catch (cause) {
    check();
    throw new ReviewCreationNotStarted(cause);
  }
  const created = await owned(
    ipcBridge.conversation.create.invoke({
      type: 'aionrs',
      name: session.review_id,
      model,
      extra: {
        workspace: session.workspace,
        custom_workspace: true,
        default_files: [],
        preset_enabled_skills: [],
        exclude_auto_inject_skills: excluded,
        selected_mcp_server_ids: [],
        selected_session_mcp_servers: [session.session_mcp_server],
      },
    }),
    check
  );
  if (!created || typeof created.id !== 'string' || !created.id.trim()) throw new Error('review_create_ack_invalid');
  return created.id;
}

async function createSelected(
  session: ReviewSession,
  selected: () => ReviewModel,
  captured: Map<string, ReviewModel>,
  check: CheckOwner
): Promise<string> {
  let model: ReviewModel, payload: TProviderWithModel;
  try {
    model = selected();
    payload = safeModel(model);
  } catch (cause) {
    throw new ReviewCreationNotStarted(cause);
  }
  const id = await create(session, payload, check);
  captured.set(id, model);
  return id;
}

async function send(conversationId: string, prompt: string, check: CheckOwner) {
  const sent = await owned(
    ipcBridge.conversation.sendMessage.invoke({
      conversation_id: apiId(conversationId),
      input: prompt,
      files: [],
      sessions: [],
      inject_skills: [],
    }),
    check
  );
  if (
    !sent ||
    typeof sent.msg_id !== 'string' ||
    !sent.msg_id.trim() ||
    typeof sent.turn_id !== 'string' ||
    !sent.turn_id.trim()
  )
    throw new Error('review_send_ack_invalid');
  return { message_id: sent.msg_id, turn_id: sent.turn_id };
}

async function observe(execution: ReviewExecution, review: Review, check: CheckOwner): Promise<ReviewObservation> {
  const conversation = await owned(getConversationOrNull(apiId(execution.conversation_id)), check);
  if (!conversation) throw new Error('review_executor_lost');
  if (conversation.id !== execution.conversation_id || conversation.type !== 'aionrs')
    throw new Error('review_isolation_mismatch');
  const workspace = conversation.extra.workspace;
  if (
    typeof workspace !== 'string' ||
    !absolutePath(workspace) ||
    workspace.split(/[\\/]/).at(-1) !== `MyCowork 审查 ${review.review_id}`
  )
    throw new Error('review_isolation_mismatch');
  const images = await expectedImages(workspace, review, check);
  const observed = await outputs(execution, images, check);
  // shortcut: /usage 的 _meta 没有轮次关联；公开 API 提供可信 turn anchor 后再报告消耗。
  try {
    await owned(ipcBridge.conversation.getUsage.invoke({ conversation_id: apiId(execution.conversation_id) }), check);
  } catch {
    check();
  }
  return {
    status: conversation.runtime?.state === 'idle' ? 'idle' : 'running',
    outputs: observed.texts,
    tokensUsed: null,
    renderingVerifiedFrom: observed.renderingVerifiedFrom,
  };
}

/** 审查只调用公开会话接口；每次异步返回后复核账号及挂载生命周期。 */
export function useReviewAdapter(): ReviewAdapter {
  const ownerKey = useOwnerKey();
  const { selected, renderModelSelector } = useReviewModelSelector();
  const owner = useRef({ ownerKey, active: true, models: new Map<string, ReviewModel>() });
  if (owner.current.ownerKey !== ownerKey)
    owner.current = { ownerKey, active: true, models: new Map<string, ReviewModel>() };
  useEffect(() => {
    const instance = owner.current;
    instance.active = true;
    return () => {
      instance.active = false;
      instance.models.clear();
    };
  }, [ownerKey]);
  return useMemo<ReviewAdapter>(() => {
    const instance = owner.current;
    const capture = (): CheckOwner => {
      const check = () => {
        if (!instance.active || !instance.ownerKey || owner.current !== instance)
          throw new Error('review_identity_changed');
      };
      check();
      return check;
    };
    return {
      renderModelSelector,
      renderSourceSelector: (options) => <ReviewSourceSelector key={ownerKey} ownerKey={ownerKey} {...options} />,
      async create(session) {
        return createSelected(session, selected, instance.models, capture());
      },
      verify(conversationId, session) {
        return verify(conversationId, session, instance.models.get(conversationId), capture());
      },
      async send(conversationId, prompt) {
        return send(conversationId, prompt, capture());
      },
      async observe(execution, review) {
        return observe(execution, review, capture());
      },
      async cancel(execution) {
        const check = capture();
        if (!execution.turn_id) throw new Error('review_turn_unknown');
        await owned(
          ipcBridge.conversation.stop.invoke({
            conversation_id: apiId(execution.conversation_id),
            turn_id: execution.turn_id,
          }),
          check
        );
      },
    };
  }, [ownerKey, selected, renderModelSelector]);
}
