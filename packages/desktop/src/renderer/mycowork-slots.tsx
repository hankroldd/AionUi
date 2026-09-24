/**
 * [mycowork] ADR-0011: the single registration file for MyCowork mount points.
 * Each AionUi insertion point is a 1–2 line call into this file; components and Bridge calls
 * live in MyCowork packages/ui (resolved via the `@mycowork/ui` build alias). Ledger: MyCowork upstream/PATCHES.md.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScopeChip } from '@mycowork/ui';

/** Mount point: the "sources" scope chip above the Guid (new task) input. */
export const GuidScopeSlot: React.FC = () => {
  const { i18n: current } = useTranslation();
  return <ScopeChip lang={current.language} />;
};
