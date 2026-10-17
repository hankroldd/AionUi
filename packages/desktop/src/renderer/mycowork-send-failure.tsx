/**
 * 文件：packages/desktop/src/renderer/mycowork-send-failure.tsx
 * 职责：办公任务未受理时，把具体原因常驻在发送框旁，直到再次发送或用户关掉。
 * 边界：只显示 sendOfficeDraft 抛出的原因文本；不改发送流程，顶部提示照旧。
 * 关联：验收清单 S40；R068。
 */
import React, { useCallback, useState } from 'react';

/** fail 记下原因；clear 在再次发送开始时清掉。 */
export function useSendFailure(lang: string | undefined) {
  const [reason, setReason] = useState<string | null>(null);
  const fail = useCallback((error: unknown) => setReason(error instanceof Error ? error.message : String(error)), []);
  const clear = useCallback(() => setReason(null), []);
  const notice = reason ? (
    <div role='alert' className='flex items-start gap-8px mb-8px px-12px py-8px rd-8px b-1 b-solid b-[var(--color-danger-light-4,#f5a3a3)] text-13px'>
      <span className='flex-1'>{reason}</span>
      <button type='button' onClick={clear}>
        {lang?.startsWith('zh') ? '关闭' : 'Dismiss'}
      </button>
    </div>
  ) : null;
  return { clear, fail, notice };
}
