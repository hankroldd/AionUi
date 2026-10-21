/**
 * 文件：components/workspace/mycoworkShowOpen.ts
 * 职责：[mycowork] D306：WebUI 下 `dialog.showOpen`（选目录/选文件）一律返回空并提示，不再浏览服务器目录。
 * 边界：只遮界面；后端 /api/fs/dir、/api/fs/read 对已登录会话仍接受任意路径，这里不是安全边界。
 * 退出条件：后端对 fs 接口做根目录校验、前端恢复选择器后删除。
 */
import { Message } from '@arco-design/web-react';
import i18n from 'i18next';
import type { ShowOpenHandler } from '@/common/adapter/ipcBridge';

export const blockedWebShowOpen: ShowOpenHandler = async () => {
  Message.warning(
    i18n.t('fileSelection.webFsPicker.disabled', {
      defaultValue: '网页版不能浏览服务器目录，请用“从设备上传”或直接输入路径',
    })
  );
  return undefined;
};
