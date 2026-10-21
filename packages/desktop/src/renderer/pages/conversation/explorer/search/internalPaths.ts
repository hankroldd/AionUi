/**
 * [mycowork] 文件：文件区与“@”候选里的内部路径过滤（纯函数）。
 * 职责：隐藏点目录/点文件（.aionrs、.claude 等运行配置）与其它会话的 deck/<哈希>/ 目录；
 *       “显示全部”也不例外。只改展示，不改路径。
 * 关联：PR11 验收 中3/中4（A532）。
 */
import { keyToRef, type TreeNode } from '../explorerModel';

const HASH_DIR = /^[0-9a-f]{8,}$/;

/** relativePath 含点开头的段，或位于 deck/<别的会话哈希>/ 之下时为内部路径。 */
export function isInternalPath(relativePath: string, conversationId: string | null): boolean {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.'))) return true;
  return parts[0] === 'deck' && !!parts[1] && HASH_DIR.test(parts[1]) && parts[1] !== conversationId;
}

export function hideInternalNodes(nodes: TreeNode[], conversationId: string | null): TreeNode[] {
  return nodes.flatMap((node) => {
    if (isInternalPath(keyToRef(node.key).relative_path, conversationId)) return [];
    return [node.children ? { ...node, children: hideInternalNodes(node.children, conversationId) } : node];
  });
}
