/**
 * 文件：tests/unit/mycowork/reviewModelControl.dom.test.tsx
 * 职责：开始新审查可选模型；已有执行或待恢复时不切换执行者。
 * 边界：只替换宿主及HTTP，不创建会话或投递模型请求。
 * 关联：PR10 E1；VersionReview。
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import type { ReviewAdapter } from '@mycowork/ui';
import { VersionReview } from '@mycowork/ui/reviews/index.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(['new', 'reviewing', 'recovery_required'])('model selection respects the %s review state', async (status) => {
  const selector = vi.fn(({ disabled, label }: { disabled: boolean; label: string }) => (
    <button disabled={disabled}>{label}</button>
  ));
  const adapter: ReviewAdapter = {
    renderModelSelector: selector,
    create: vi.fn(),
    verify: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    observe: vi.fn(async () => ({ status: 'running', outputs: [], tokensUsed: null, renderingVerifiedFrom: null })),
  };
  const stored = {
    review_id: 'review',
    resource_id: 'resource',
    base_revision_id: 'revision',
    input_revision_id: 'revision',
    context_plan_id: 'plan',
    mode: 'review_only',
    max_rounds: 1,
    status,
    policy: { strict: true, web: 'off' },
    rounds: [],
    unresolved: [],
    execution: { conversation_id: 'conversation', message_id: 'message', turn_id: 'turn' },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path === '/bridge/v1/review-rules'
              ? { enabled_by_default: false, budget_tokens: { default: 100000, max: 500000 }, rules: [] }
              : { items: status === 'new' ? [] : [stored], page: 1, total: status === 'new' ? 0 : 1 }
          )
        )
    )
  );
  render(
    <VersionReview
      resourceId='resource'
      revisionId='revision'
      label='虚构版本'
      ownerKey='owner'
      lang='zh-CN'
      adapter={adapter}
      open
      onClose={() => {}}
    />
  );
  await waitFor(() => expect(selector).toHaveBeenLastCalledWith({ disabled: status !== 'new', label: '审查模型' }));
  expect(screen.getByRole('button', { name: '审查模型' }).hasAttribute('disabled')).toBe(status !== 'new');
  expect(adapter.create).not.toHaveBeenCalled();
  expect(adapter.send).not.toHaveBeenCalled();
});
