/**
 * [mycowork] D115：MyCowork 会话里写工具的逐次批准不被 aionrs（Aion CLI）的“始终允许”与 YOLO 绕过。
 * aionrs v0.2.11 的“始终允许”按工具类别记住（MCP 工具同为 mcp 类），YOLO 跳过全部批准；二者都没有按工具禁用的配置，
 * 只能在界面上不提供。纯函数、无依赖，供批准卡、权限模式选择器与新建任务发送调用（台账：MyCowork upstream/PATCHES.md）。
 * 退出条件：上游支持按工具禁用“始终允许”并能锁定权限模式后删除本文件与各调用点。
 */

/** Bridge 会话 MCP 服务名（MyCowork services/bridge/src/context/tokens.ts MCP_SERVER_NAME）。 */
const BRIDGE_MCP = 'mycowork_bridge';
/** Bridge 三个写工具；与别的服务同名时 aionrs 改名为 `mcp__<服务>_<工具>`，故按后缀认。 */
const WRITE_TOOL = /(^|_)office_(edit|register_output|copy_to_workspace)$/;

/** 会话挂了 Bridge MCP（conversation.extra.mcp_servers 含其服务名）即 MyCowork 会话。 */
export const isMycoworkSession = (mcpServers?: string[]): boolean => Boolean(mcpServers?.includes(BRIDGE_MCP));

/**
 * [mycowork] D115 安全审查 M3：MyCowork 会话里 exec 类（ExecCommand、Spawn）同样不给——“始终允许”一次后 shell 免批准，
 * 模型可从 AionUi 库里读出计划令牌、用 curl 直连 Bridge MCP 调写工具，绕过写工具卡片。
 */
const GUARDED_IN_SESSION = new Set(['mcp', 'exec']);

/**
 * 批准卡是否隐藏此选项：只隐藏“始终允许”（proceed_always）。MyCowork 会话里 mcp 类（任一 mcp 卡片点了始终允许都会连带放行
 * 三个写工具）与 exec 类（见上）整类不给；写工具本身的卡片无论会话信息是否可得都不给。其余卡片与会话不受影响。
 */
export const hidesAlwaysAllow = (
  mcpServers: string[] | undefined,
  category: string | undefined,
  tool: string | undefined,
  value: string
): boolean =>
  value === 'proceed_always' &&
  ((isMycoworkSession(mcpServers) && GUARDED_IN_SESSION.has(category ?? '')) ||
    (category === 'mcp' && WRITE_TOOL.test(tool ?? '')));

/** 权限模式列表：MyCowork 会话去掉 yolo（auto_edit 只放行 info/edit 类，不含 mcp，保留）。 */
export const withoutYolo = <T extends { value: string }>(mcpServers: string[] | undefined, modes: T[]): T[] =>
  isMycoworkSession(mcpServers) ? modes.filter((mode) => mode.value !== 'yolo') : modes;
