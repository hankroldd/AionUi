/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';

export type GuidWorkContext = { ownerKey: string; workspace: string };

export interface LayoutContextValue {
  isMobile: boolean;
  siderCollapsed: boolean;
  setSiderCollapsed: (value: boolean) => void;
  guidWork: GuidWorkContext | null;
  setGuidWork: React.Dispatch<React.SetStateAction<GuidWorkContext | null>>;
}

export const LayoutContext = React.createContext<LayoutContextValue | null>(null);

export function useLayoutContext(): LayoutContextValue | null {
  return React.useContext(LayoutContext);
}
