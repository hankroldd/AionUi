/**
 * 文件：tests/unit/mycowork/templateConfirmation.fixture.ts
 * 职责：templateConfirmation 测试的虚构数据（模板预览、会话上下文响应、HTTP 响应），从测试文件拆出以守单文件 ≤400 行。
 * 边界：只放数据与纯构造函数，不含断言和 mock。
 */
export const preview = {
  decision_id: 'private-decision-id',
  decision_version: 1,
  theme: { asset_id: 'private-asset-id', version: 2, title: '暖色活动' },
  copy_id: 'private-copy-id',
  relative_path: 'deck/c1/模板.pptx',
};
export const context = (value: unknown = preview) => ({
  plan_id: 'plan-one',
  version: 1,
  status: 'OK',
  working_project_id: 'p1',
  brief: { groups: [] as unknown[], policy: {} },
  used: [] as unknown[],
  withheld: 0,
  superseded: false,
  ...(value === undefined || value === null ? {} : { template_preview: value }),
});
export const response = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});
