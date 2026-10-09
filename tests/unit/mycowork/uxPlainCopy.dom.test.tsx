/**
 * [mycowork] 文件：tests/unit/mycowork/uxPlainCopy.dom.test.tsx
 * 职责：体验片 D 的文案底线：主文案是人话，错误码 / 内部路径不直接给用户（错误码只在句末“详情”括号里，路径只放 title）；
 *       回收站每行只在非零时说明影响。
 * 边界：只测文案函数与一个小页面片段；不 mock 页面逻辑。
 */
import { describe, expect, it } from 'vitest';
import { bridgeFailureText } from '@mycowork/ui';
import { bridgeErrorText } from '@mycowork/ui/scope-picker/messages.ts';
import { trashText } from '@mycowork/ui/pages/trash/messages.ts';

describe('错误码进“详情”，主文案没有错误码', () => {
  it('未知失败：句子先说怎么办，码只在“详情：…”里', () => {
    const text = bridgeFailureText('zh-CN', new Error('REVISION_CONFLICT'));
    expect(text).toBe('操作没有完成，请重试；仍失败请联系管理员（详情：REVISION_CONFLICT）。');
    expect(text.replace(/（详情：[^）]*）/, '')).not.toMatch(/[A-Z]{3,}_[A-Z]+|代码|HTTP/);
  });

  it('bridgeErrorText 的 failed 分支：中英文主文案无码，码只在“详情”里；没权限不叫人重试', () => {
    const failed = { kind: 'failed' as const, message: 'HTTP 500' };
    expect(bridgeErrorText('zh-CN', failed)).toBe('没能处理资料范围（详情：HTTP 500）');
    expect(bridgeErrorText('en-US', failed)).toBe('Could not prepare the sources (details: HTTP 500)');
    const forbidden = bridgeErrorText('zh-CN', { kind: 'failed', message: 'FORBIDDEN' });
    expect(forbidden).toBe('你没有权限做这个操作。');
    expect(forbidden).not.toMatch(/重试|FORBIDDEN/);
  });
});

describe('回收站影响说明', () => {
  const zero = { publications: 0, memory_items: 0, collections: 0, plans: 0 };
  it('全零不说话（空串），非零只列非零项，不出现内部词', () => {
    const t = trashText('zh-CN');
    expect(t.impact(zero)).toBe('');
    expect(t.impact({ ...zero, publications: 2 })).toBe('发布过 2 次');
    expect(t.impact({ publications: 1, memory_items: 3, collections: 0, plans: 0 })).toBe('发布过 1 次 · 3 条记忆来自它');
    expect(t.impact({ publications: 1, memory_items: 3, collections: 2, plans: 4 })).toBe(
      '发布过 1 次 · 3 条记忆来自它 · 在 2 个集合里（含收藏） · 在 4 次对话的资料范围里用过',
    );
    expect(t.impact({ publications: 1, memory_items: 3, collections: 1, plans: 1 })).not.toMatch(/发布记录|记忆来源|集合关系|历史引用|页面计划|分组/);
  });
});
