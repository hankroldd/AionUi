/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Side-effect module: wires the server-side picker into `dialog.showOpen` when
 * running as WebUI. Electron keeps its native dialog — the handler is only
 * registered when `window.electronAPI` is absent.
 */

import { registerWebShowOpenHandler } from '@/common/adapter/ipcBridge';
import { blockedWebShowOpen } from './mycoworkShowOpen';

if (typeof window !== 'undefined' && !(window as { electronAPI?: unknown }).electronAPI) {
  registerWebShowOpenHandler(blockedWebShowOpen); // [mycowork] D306：不再提供服务器目录选择器
}
