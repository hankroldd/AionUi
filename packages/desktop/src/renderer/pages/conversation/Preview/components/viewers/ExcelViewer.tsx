/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { ChatFileRef } from '@/common/types/chatFile';
import OfficeWatchViewer from './OfficeWatchViewer';

interface ExcelPreviewProps {
  tabId?: string; // [mycowork] S10
  fileRef?: ChatFileRef;
  file_path?: string;
  content?: string;
  workspace?: string;
}

const ExcelPreview: React.FC<ExcelPreviewProps> = (props) => <OfficeWatchViewer docType='excel' {...props} />;

export default ExcelPreview;
