/**
 * 文件：packages/desktop/src/renderer/mycowork-cited-revision.tsx
 * [mycowork] 职责：对话工具步骤行的挂点——Bridge `read` 结果带 revision_id 时给“查看当时的版本”（R014，D279）。
 * 边界：只转交工具名与结果文字；解析、校验与跳转都在 MyCowork packages/ui（navigation-intent §10）。
 * 关联：MessageToolGroupSummary.tsx 一处调用；台账 MyCowork upstream/PATCHES.md。
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { CitedRevisionAction } from '@mycowork/ui';

export const MyCoworkCitedRevisionSlot: React.FC<{ name?: string; output?: string }> = ({ name, output }) => {
  const { i18n } = useTranslation();
  return <CitedRevisionAction lang={i18n?.language} toolName={name} output={output} />;
};
