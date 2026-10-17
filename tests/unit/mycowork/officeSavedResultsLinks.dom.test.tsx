/**
 * [mycowork] A513 切片 2（R068）。文件：tests/unit/mycowork/officeSavedResultsLinks.dom.test.tsx
 * 职责：已登记结果的 resource_id / revision_id 不符合 Bridge 的 res_/rev_ 格式时，只显示文件名、不出版本页链接。
 * 边界：只渲染 SavedResults，不调用 Bridge；合法 id 的链接与汇总行见 officeTaskSend.dom.test.tsx。
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { TaskRun } from '@mycowork/contracts';
import { SavedResults } from '@mycowork/ui';

const saved = (resource_id: string, revision_id: string): NonNullable<TaskRun['saved_results']> => [
  {
    kind: 'output',
    resource_id,
    revision_id,
    file_name: '结果.docx',
    content_sha256: 'a'.repeat(64),
    created_at: '2026-10-17T00:00:00Z',
  },
];
const run = (s: TaskRun['saved_results']): TaskRun => ({
  run_id: 'r',
  submission_id: '00000000-0000-4000-8000-000000000000',
  status: 'failed',
  created_at: '2026-10-17T00:00:00Z',
  saved_results: s,
});

it.each([
  ['res/0', 'rev_0'],
  ['res_0', 'rev-0'],
])('id 格式不对（%s, %s）只显示文件名，不出链接', (res, rev) => {
  render(<SavedResults run={run(saved(res, rev))} lang='zh-CN' />);
  expect(screen.getByText('结果.docx')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
});
