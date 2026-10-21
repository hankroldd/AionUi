/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Display-only tree projection: keep permitted subtrees and their ancestor rows. */
import { keyToRef, type DirRef, type TreeNode } from '../explorerModel';

export function matchesVisibleRoots(ref: DirRef, roots: DirRef[]): boolean {
  return roots.some(
    (root) =>
      root.pe_id === ref.pe_id &&
      (root.relative_path === '' ||
        ref.relative_path === root.relative_path ||
        ref.relative_path.startsWith(`${root.relative_path}/`))
  );
}

export function filterVisibleTree(nodes: TreeNode[], roots: DirRef[] | undefined): TreeNode[] {
  if (roots === undefined) return nodes;
  return nodes.flatMap((node) => {
    const ref = keyToRef(node.key);
    if (matchesVisibleRoots(ref, roots)) return [node];
    const ancestor = roots.some(
      (root) =>
        root.pe_id === ref.pe_id && (ref.relative_path === '' || root.relative_path.startsWith(`${ref.relative_path}/`))
    );
    if (!ancestor) return [];
    // 折叠目录没有 children，不等于目标目录不存在；保留可重新展开的祖先。
    if (node.children === undefined) return [node];
    const children = filterVisibleTree(node.children ?? [], roots);
    return children.length ? [{ ...node, children }] : [];
  });
}

/**
 * [mycowork] 仅本次对话：找到恰好等于唯一可见目录的节点，丢掉其祖先链（项目根 / deck），
 * 标成 label 作为唯一根；只改展示，key 与路径不变。目录尚未出现在树里时原样返回。
 */
export function collapseToVisibleRoot(
  nodes: TreeNode[],
  roots: DirRef[] | undefined,
  label: string | undefined
): TreeNode[] {
  const target = roots?.length === 1 ? roots[0] : undefined;
  if (!target || !label || !target.relative_path) return nodes;
  const find = (list: TreeNode[]): TreeNode | undefined => {
    for (const node of list) {
      const ref = keyToRef(node.key);
      if (ref.pe_id === target.pe_id && ref.relative_path === target.relative_path) return node;
      const hit = node.children && find(node.children);
      if (hit) return hit;
    }
  };
  const hit = find(nodes);
  return hit ? [{ ...hit, title: label }] : nodes;
}
