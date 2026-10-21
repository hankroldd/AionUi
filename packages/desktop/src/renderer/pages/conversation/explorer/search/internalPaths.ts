/**
 * [mycowork] 文件：文件区与“@”候选里的内部路径过滤（纯函数）。
 * 职责：隐藏点目录/点文件（.aionrs、.claude 等运行配置）与其它会话的 deck/<哈希>/ 目录；
 *       “显示全部”也不例外。只改展示，不改路径。
 * 关联：PR11 验收 中3/中4（A532）。
 */
import { keyToRef, type TreeNode } from '../explorerModel';

// 8 位以上十六进制且至少含一个 a–f（纯数字目录如 20261021 是日期，不算会话哈希）
const HASH_DIR = /^(?=.*[a-f])[0-9a-f]{8,}$/;

/** MyCowork 会话里：relativePath 含点开头的段，或位于 deck/<别的会话哈希>/ 之下时为内部路径；其它会话不过滤。 */
export function isInternalPath(relativePath: string, conversationId: string | null, mycowork: boolean): boolean {
  if (!mycowork) return false;
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.'))) return true;
  return parts[0] === 'deck' && !!parts[1] && HASH_DIR.test(parts[1]) && parts[1] !== conversationId;
}

export function hideInternalNodes(nodes: TreeNode[], conversationId: string | null, mycowork: boolean): TreeNode[] {
  if (!mycowork) return nodes;
  return nodes.flatMap((node) => {
    if (isInternalPath(keyToRef(node.key).relative_path, conversationId, true)) return [];
    return [node.children ? { ...node, children: hideInternalNodes(node.children, conversationId, true) } : node];
  });
}
