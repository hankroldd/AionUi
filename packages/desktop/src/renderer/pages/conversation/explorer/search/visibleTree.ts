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
    const children = filterVisibleTree(node.children ?? [], roots);
    return children.length ? [{ ...node, children }] : [];
  });
}
