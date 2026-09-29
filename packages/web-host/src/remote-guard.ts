/**
 * 文件：packages/web-host/src/remote-guard.ts
 * 职责：[mycowork] 安全（A67/D150）——Web Host 对非回环来源的逐请求守卫：路径规范化、无鉴权管理族判定、
 *       回环判定、403 写回，以及把已解析的 upgrade 请求重建为原始字节供裸 TCP 转发。
 * 边界：只做判定与写回，接线（连接分流、请求处理器、upgrade 处理器）在 static-server.ts。
 * 关联：MyCowork open-issues A67、ADR-0016 D150、upstream/PATCHES.md；static-server.unit.test.ts。
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

// [mycowork] 安全（A67/D150）：aioncore 有一族无需登录即可调用的端点——
//   POST /api/webui/reset-password（返回明文管理员口令）、
//   POST /api/webui/generate-qr-token（无鉴权签发登录令牌，配 /qr-login 可静默接管）、
//   GET  /api/auth/internal/*（账户记录、内部会话，供本机进程直连后端用）。
// 经反向代理放行且 WebUI 对局域网开放（allowRemote，产品要求“其他设备可查看”）时，局域网任意
// 主机不登录即可接管或泄露账户。合法调用者要么直连后端端口、绕过本代理（首启种子口令：
// scripts/webui.ts、web-cli、webuiBridge.ts；resetpass.ts 路径 2 自起后端），要么来自本机回环
// （resetpass.ts 路径 1、桌面设置页在本机）。
// 修复要点（逐请求判定，不再靠首行 peek，独立安全审查 M1–M3）：非回环连接不再原样 TCP splice
// 到内部 HTTP server，而是把 socket 交给进程内 http.Server，使每个请求（含 keep-alive 后续请求
// 与 WebSocket upgrade）都能拿到真实 remoteAddress；对非回环请求按后端会用的规范化路径默认拒绝
// 敏感族，解析不了就拒绝（fail-closed）。回环连接保持原路径，纯回环部署字节行为不变。

export function isLoopbackAddr(addr: string | undefined): boolean {
  if (!addr) return false;
  // 0.0.0.0 绑定下回环客户端显示 127.0.0.0/8；双栈/映射形态防御性一并纳入。
  return addr.startsWith('127.') || addr === '::1' || addr.startsWith('::ffff:127.');
}

// 只有这两条是合法的 WebSocket/流 upgrade 目标（peekWsRoute 亦然）。
export const UPGRADE_ALLOWED = new Set(['/ws', '/api/stt/stream']);

// 按后端会解释的方式把请求目标归一成小写绝对路径：取绝对形式 URI 的 path、去 query/fragment、
// 百分号解码一次（%2f→/、%2e→.）、反斜杠转斜杠、去每段的 ;matrix 参数、合并 // 并解析 . 与 ..。
// 不是绝对路径或 URI 解析不了返回 null（调用方对非回环按拒绝处理，fail-closed）。含非法转义（半个
// %、非 UTF-8 序列）时改用宽松解码：合法转义照常解、非法的原样保留，再交敏感族判定——敏感则拒，
// 普通 API（如文件名里的 `%zz`）放行交后端处理（复审 S-a）。
export function normalizeGuardPath(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  let s = rawUrl.trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('//')) {
      s = new URL(s, 'http://placeholder').pathname; // 绝对形式 / 协议相对 → 只取 path
    } else {
      const cut = s.search(/[?#]/);
      if (cut >= 0) s = s.slice(0, cut);
    }
  } catch {
    return null;
  }
  if (!s.startsWith('/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    decoded = s.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        // 非法序列原样保留，但其中的 ASCII 转义（%00–%7f，如紧挨坏 UTF-8 的 %2f）照样解开，免得藏住斜杠
        return run.replace(/%[0-7][0-9a-f]/gi, (e) => decodeURIComponent(e));
      }
    });
  }
  decoded = decoded.replace(/\\/g, '/');
  const out: string[] = [];
  for (let seg of decoded.split('/')) {
    const sc = seg.indexOf(';');
    if (sc >= 0) seg = seg.slice(0, sc); // 去矩阵参数
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return '/' + out.join('/').toLowerCase();
}

// 默认拒绝整个无鉴权管理族（私有实例实测：reset-password / change-password / change-username /
// generate-qr-token 无 cookie 从局域网均 200，即接管或改名换密），以及供本机进程直连后端的
// /api/auth/internal/*。范围按前缀而非逐条枚举（审查 M3“范围太窄”），远程无这些端点的合法用途；
// 手机扫码登录用顶层 /qr-login（token 即凭据），不在此列，仍放行。
export function isSensitivePath(normalizedPath: string): boolean {
  if (normalizedPath === '/api/auth/internal' || normalizedPath.startsWith('/api/auth/internal/')) return true;
  if (normalizedPath === '/api/webui' || normalizedPath.startsWith('/api/webui/')) return true;
  return false;
}

// 非回环请求是否应拒绝：来源非回环，且（路径解析不了 → fail-closed，或命中敏感族）。
export function isBlockedRemoteRequest(rawUrl: string | undefined, remoteAddress: string | undefined): boolean {
  if (isLoopbackAddr(remoteAddress)) return false;
  let p = normalizeGuardPath(rawUrl);
  if (p === null) return true;
  // 多轮解码（复审 S3）：aioncore v0.2.2 实测不解码 %2f、不合并 //（直连后端均 404），但不把安全性押在
  // 后端“只解一层”上——%252f 等多重编码逐轮再解，任何一轮落入敏感族即拒绝；后续轮解不开说明后端
  // 也得不到敏感路径，停止；4 轮后仍含转义则 fail-closed。
  for (let round = 0; round < 3; round++) {
    if (isSensitivePath(p)) return true;
    if (!p.includes('%')) return false;
    const next = normalizeGuardPath(p);
    if (next === null || next === p) return false;
    p = next;
  }
  return true;
}

const REMOTE_FORBIDDEN_BODY = '{"error":"REMOTE_FORBIDDEN"}';

export function writeRemoteForbidden(res: ServerResponse): void {
  res.writeHead(403, { 'content-type': 'application/json' }).end(REMOTE_FORBIDDEN_BODY);
}

export function destroyRemoteForbidden(socket: Socket): void {
  socket.end(
    `HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(REMOTE_FORBIDDEN_BODY)}\r\nConnection: close\r\n\r\n${REMOTE_FORBIDDEN_BODY}`
  );
}

// 把 http.Server 已解析的 upgrade 请求原样重建（保持首部大小写与顺序），供裸 TCP 转发给后端。
export function reconstructRequest(req: IncomingMessage, head: Buffer): Buffer {
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
  const rh = req.rawHeaders;
  for (let i = 0; i < rh.length; i += 2) lines.push(`${rh[i]}: ${rh[i + 1]}`);
  return Buffer.concat([Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1'), head ?? Buffer.alloc(0)]);
}
