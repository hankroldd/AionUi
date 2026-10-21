/**
 * 文件：packages/desktop/src/renderer/mycowork-task-recovery.tsx
 * 职责：返回办公会话时只读找回最近任务，读取失败提供原位重试。
 * 边界：不发送、不清草稿、不确认完成；切会话、账号或新发送后丢弃旧响应。
 * 关联：PR03 plan §14；task-states.md §6，D297。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@arco-design/web-react';
import type { TaskRun } from '@mycowork/contracts';
import { lookupOfficeTask, readOfficeTask } from '@mycowork/ui';
import { wsEmitter } from '@/common/adapter/httpBridge';
import { officeTaskRuntime } from './mycowork-task-send';

const turnCompleted = wsEmitter<Record<string, unknown>>('turn.completed');

/** 只恢复本人已确认办公会话的状态；invalidate 在新提交开始时使旧读取失效。 */
export function useOfficeTaskRecovery(options: {
  conversationId: string;
  ownerKey: string | undefined;
  isCurrent: () => boolean;
  enabled: boolean;
  lang: string | undefined;
  onRecovered: (run: TaskRun | null, ended: boolean) => void;
}) {
  const current = useRef(options);
  current.current = options;
  const request = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [observedEnds, setObservedEnds] = useState<{
    ownerKey: string;
    conversationId: string;
    turns: Set<string>;
  } | null>(null);
  const { conversationId, ownerKey, enabled, lang } = options;
  const invalidate = useCallback(() => {
    request.current += 1;
    setError(false);
    setObservedEnds(null);
    current.current.onRecovered(null, false);
  }, []);

  useEffect(() => {
    const ticket = ++request.current;
    let cancelled = false;
    setError(false);
    current.current.onRecovered(null, false);
    if (!enabled || !ownerKey) return;
    const isCurrent = () =>
      !cancelled &&
      request.current === ticket &&
      current.current.conversationId === conversationId &&
      current.current.ownerKey === ownerKey &&
      current.current.isCurrent();
    const owner = { ownerKey, isCurrent };
    // 查回 run 前先接住结束事件，避免旧 HTTP 快照抹掉已观察到的同轮结束。
    const turns = new Set<string>();
    const unsubscribe = turnCompleted.on((raw) => {
      const conversation = raw.conversation_id ?? raw.session_id ?? raw.sessionId;
      const turn = raw.turn_id ?? raw.turnId;
      if (!isCurrent() || conversation !== conversationId || typeof turn !== 'string' || !turn || turns.has(turn))
        return;
      turns.add(turn);
      setObservedEnds({ ownerKey, conversationId, turns: new Set(turns) });
    });
    void (async () => {
      try {
        const found = await lookupOfficeTask(owner, { conversationId });
        if (!isCurrent()) return;
        const run = found ? await readOfficeTask(owner, found.run_id) : null;
        if (!isCurrent()) return;
        if (run && run.conversation_id !== conversationId) throw new Error('任务关联与当前会话不一致。');
        const runtime = run ? officeTaskRuntime(run) : null;
        // 空闲只说明回复已结束；成功仍须用户确认，不能补造 turn_end。
        const ended =
          run?.delivery_phase === 'accepted' && runtime?.turn_id === null && runtime.is_processing === false;
        current.current.onRecovered(run, ended);
      } catch {
        if (isCurrent()) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [conversationId, ownerKey, enabled, attempt]);

  const zh = lang?.startsWith('zh');
  return {
    invalidate,
    hasObservedEnd: (turnId: string | undefined) =>
      Boolean(
        turnId &&
        observedEnds?.ownerKey === ownerKey &&
        observedEnds.conversationId === conversationId &&
        observedEnds.turns.has(turnId)
      ),
    notice:
      error && enabled && ownerKey ? (
        <div role='alert'>
          {zh
            ? '暂时无法读取本轮任务状态，输入和文件仍保留。'
            : 'Could not read the task status. Your input and files are kept.'}
          <Button size='mini' onClick={() => setAttempt((value) => value + 1)}>
            {zh ? '重试任务状态' : 'Retry task status'}
          </Button>
        </div>
      ) : null,
  };
}
