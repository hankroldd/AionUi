/**
 * 文件：renderer/mycowork-drafts-helpers.ts
 * 职责：[mycowork] 持久草稿的纯函数：键序无关的状态比较、草稿指针、对话草稿的附件归一。
 * 边界：无副作用、无 React；供 mycowork-drafts.tsx 使用，从中拆出以守单文件 ≤400 行。
 */
import type { DraftDocument, DraftState } from '@mycowork/contracts';
import { collectChatFileRefs, splitChatFileRefs } from '@/renderer/utils/file/messageFiles';

const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, sorted(item)])
        )
      : value;
export const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
export type DraftPointer = Pick<DraftDocument, 'input_location' | 'revision' | 'submission_id'>;
export const pointer = ({ input_location, revision, submission_id }: DraftDocument): DraftPointer => ({
  input_location,
  revision,
  submission_id,
});

export function conversationDraftState(state: DraftState): DraftState {
  const { uploadFiles, atPath } = splitChatFileRefs(state.files);
  return { ...state, files: collectChatFileRefs(uploadFiles, atPath) };
}
