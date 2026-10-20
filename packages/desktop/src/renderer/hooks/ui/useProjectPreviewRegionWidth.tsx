/**
 * 文件：packages/desktop/src/renderer/hooks/ui/useProjectPreviewRegionWidth.tsx
 * 职责：约束预览宽度并保留用户拖动后的可读宽度。
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Layout-level width engine for the hoisted preview region (stage3 FULL / P4).
 *
 * For project conversations the preview panel is hoisted out of ChatLayout up to
 * the Layout host so it is structurally persistent (no remount across
 * same-project conversation switches). The Layout host row is then partitioned as
 * `[content(chat) | preview | explorer]`, all at the Layout level. This hook owns
 * the preview region width (resizable, persisted) and clamps it so chat keeps its
 * `MIN_CHAT_PANEL_PX` reserve *after* the explorer column has already taken its
 * (separately clamped) width — the two clamps are ordered so the sum can never
 * crowd chat below its minimum:
 *
 *   explorer ≤ available − MIN_CHAT − MIN_PREVIEW      (useProjectExplorerColumnWidth)
 *   preview  ≤ available − MIN_CHAT − explorerWidthPx  (here)
 *   ⇒ content = available − explorer − preview ≥ MIN_CHAT
 */

import {
  MIN_CHAT_PANEL_PX,
  MIN_PREVIEW_PANEL_PX,
  PREVIEW_REGION_CHROME_PX,
} from '@/renderer/pages/conversation/utils/layoutCalc';
import { useResizableSplit } from '@/renderer/hooks/ui/useResizableSplit';

const DEFAULT_PREVIEW_REGION_PX = 640;
const MAX_PREVIEW_REGION_PX = 1200;

export function useProjectPreviewRegionWidth(availableWidth: number, explorerWidthPx: number, _active: boolean) {
  // Clamp against the space left after chat's reserve and the explorer column,
  // minus the preview region's own horizontal chrome (margins + border) so the
  // occupied width (preview + chrome) never pushes the explorer past the row.
  const maxByContainer = Math.max(
    MIN_PREVIEW_PANEL_PX,
    availableWidth - MIN_CHAT_PANEL_PX - explorerWidthPx - PREVIEW_REGION_CHROME_PX
  );
  const { splitRatio: requestedWidth, createDragHandle } = useResizableSplit({
    unit: 'px',
    defaultWidth: DEFAULT_PREVIEW_REGION_PX,
    minWidth: 480,
    maxWidth: MAX_PREVIEW_REGION_PX,
    storageKey: 'chat-preview-width-px',
    getDragStartWidth: (width) => Math.min(width, maxByContainer),
  });
  const widthPx = Math.min(requestedWidth, maxByContainer);

  // 窄窗只约束本次显示，避免把用户的可读宽度永久压成最小值。
  return { widthPx, createDragHandle };
}
