/**
 * 文件：Messages/components/toolDisplayName.ts
 * 职责：把真实办公工具名显示为业务动作，不从模型正文推断。
 * 边界：只改名称；不判断安全、不改变批准或执行。
 */
import type { I18nKey } from '@/renderer/services/i18n';

const labels: Record<string, I18nKey> = {
  search: 'messages.toolNames.search',
  read: 'messages.toolNames.read',
  coverage: 'messages.toolNames.coverage',
  changes: 'messages.toolNames.changes',
  manifest: 'messages.toolNames.manifest',
  skill_read: 'messages.toolNames.skill_read',
  template_recommend: 'messages.toolNames.template_recommend',
  office_copy_to_workspace: 'messages.toolNames.office_copy_to_workspace',
  office_fetch_original: 'messages.toolNames.office_fetch_original',
  office_edit: 'messages.toolNames.office_edit',
  office_register_output: 'messages.toolNames.office_register_output',
  office_read: 'messages.toolNames.office_read',
  office_check: 'messages.toolNames.office_check',
  office_calc: 'messages.toolNames.office_calc',
  memory_suggest: 'messages.toolNames.memory_suggest',
  research_search_arxiv: 'messages.toolNames.research_search_arxiv',
  ExecCommand: 'messages.toolNames.ExecCommand',
  Write: 'messages.toolNames.Write', // [mycowork] A568：aionrs 原生写文件卡片不再显示英文工具名
  Edit: 'messages.toolNames.Edit',
  template_select: 'messages.toolNames.template_select',
  review_report_candidate: 'messages.toolNames.review_report_candidate',
};

/** 未知工具保留原名，避免把未知动作包装成已知业务操作。 */
export function toolDisplayNameKey(name: string | undefined): I18nKey | undefined {
  const key = name?.replace(/^mcp__mycowork_bridge_+/, '');
  return key && Object.hasOwn(labels, key) ? labels[key] : undefined;
}
