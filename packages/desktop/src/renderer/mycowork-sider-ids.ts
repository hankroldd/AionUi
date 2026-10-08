/**
 * 文件：renderer/mycowork-sider-ids.ts
 * 职责：Office 页面占用原生二级栏时的容器 ID 与路由映射。
 * 边界：不 import 任何组件——slots 被对话页引用，从 secondary 取 ID 会把会话搜索整条依赖拖进对话页并成环。
 * 关联：ADR-0022；mycowork-secondary.tsx；mycowork-slots.tsx。
 */
export const MYCOWORK_SPACE_SIDER_ID = 'mycowork-space-sider';
export const MYCOWORK_MEMORY_SIDER_ID = 'mycowork-memory-sider';
export const MYCOWORK_SCHEDULED_SIDER_ID = 'mycowork-scheduled-sider';
/** 只有已接通导航的Office页面占用原生二级栏，预留页与版本页仍独立；定时任务占用容器只为不显示首页的会话列表。 */
export const mycoworkSiderId = (path: string): string | null =>
  /^\/office\/(space|resources|trash)\/?$/.test(path)
    ? MYCOWORK_SPACE_SIDER_ID
    : /^\/office\/memory\/?$/.test(path)
      ? MYCOWORK_MEMORY_SIDER_ID
      : /^\/scheduled(\/|$)/.test(path)
        ? MYCOWORK_SCHEDULED_SIDER_ID
        : null;
