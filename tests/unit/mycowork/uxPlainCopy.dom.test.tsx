/**
 * [mycowork] 文件：tests/unit/mycowork/uxPlainCopy.dom.test.tsx
 * 职责：体验片 D 的文案底线：主文案是人话，错误码 / 内部路径不直接给用户（错误码只在句末“详情”括号里，路径只放 title）；
 *       回收站每行只在非零时说明影响。
 * 边界：只测文案函数与一个小页面片段；不 mock 页面逻辑。
 */
import { describe, expect, it } from 'vitest';
import { bridgeFailureText } from '@mycowork/ui';
import { BridgeError } from '@mycowork/ui/scope-picker/index.ts';
import { scopeText } from '@mycowork/ui/scope-picker/messages.ts';
import { trashText } from '@mycowork/ui/pages/trash/messages.ts';

describe('错误码进“详情”，主文案没有错误码', () => {
  it('未知失败：句子先说怎么办，码只在“详情：…”里', () => {
    const text = bridgeFailureText('zh-CN', new Error('REVISION_CONFLICT'));
    expect(text).toBe('操作没有完成，请重试；仍失败请联系管理员（详情：REVISION_CONFLICT）。');
    expect(text.replace(/（详情：[^）]*）/, '')).not.toMatch(/[A-Z]{3,}_[A-Z]+|代码|HTTP/);
  });

  it('failed 类错误：中英文都是“没能处理 … 再附详情”', () => {
    const failed = new BridgeError('failed', 'HTTP 500');
    const zh = bridgeFailureText('zh-CN', failed);
    expect(scopeText('zh-CN').errors.failed).not.toMatch(/HTTP|失败（/);
    expect(zh).toContain('请联系管理员');
    expect(bridgeFailureText('en-US', new Error('REVISION_CONFLICT'))).toContain('(details: REVISION_CONFLICT)');
  });
});

describe('回收站影响说明', () => {
  const zero = { publications: 0, memory_items: 0, collections: 0, plans: 0 };
  it('全零不说话（空串），非零只列非零项，不出现内部词', () => {
    const t = trashText('zh-CN');
    expect(t.impact(zero)).toBe('');
    expect(t.impact({ ...zero, publications: 2 })).toBe('已发布到 2 个知识库');
    expect(t.impact({ publications: 1, memory_items: 3, collections: 0, plans: 0 })).toBe('已发布到 1 个知识库 · 3 条记忆来自它');
    expect(t.impact({ publications: 1, memory_items: 3, collections: 1, plans: 1 })).not.toMatch(/发布记录|记忆来源|集合关系|历史引用/);
  });
});
