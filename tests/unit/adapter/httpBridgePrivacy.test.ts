/**
 * 文件：tests/unit/adapter/httpBridgePrivacy.test.ts
 * 职责：[mycowork] 用真实HTTP验证共享适配器的直接日志只含方法、不带查询串的路径与状态（D191）。
 * 边界：只用虚构数据；不验证调用方Error日志或真实Cookie认证。
 * SPDX-License-Identifier: Apache-2.0
 */

import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError, getBaseUrl, httpRequest, wsEmitter } from '@/common/adapter/httpBridge';

const route = '/api/route-marker';
const path = `${route}?query=private-query-marker`;
const requestBody = {
  name: 'fictional-question-marker',
  content: 'fictional-chat-message-marker', // 对话消息经 ipcBridge 映射成 content 发出
  input: 'fictional-chat-message-marker',
  workspace: '/fictional/private-path-marker/document.md',
  nested: { api_key: 'fictional-nested-key-marker' },
};
const authorization = 'Bearer fictional-header-key-marker';
const responseBody = {
  success: false,
  code: 'FIXTURE_FAILED',
  error: 'fictional-response-marker',
  details: requestBody,
};

describe('httpRequest direct log privacy with a real HTTP server', () => {
  let server: Server;
  let status: number;
  let response: unknown;
  let contentType: string;
  let received: unknown;
  let refreshReplay: boolean;
  let dataRequests: number;
  let requestPaths: string[];
  let debug: ReturnType<typeof vi.spyOn<typeof console, 'debug'>>;
  let error: ReturnType<typeof vi.spyOn<typeof console, 'error'>>;
  let others: ReturnType<typeof vi.spyOn<typeof console, 'log' | 'info' | 'warn'>>[];
  // console 的五个输出方法一起看，换哪个方法打印都逃不过
  const allLogs = () => JSON.stringify([debug, error, ...others].map((spy) => spy.mock.calls));

  function expectPrivateLogs(method: string, responseStatus: number) {
    const logs = allLogs();
    expect(logs).not.toMatch(
      /private-query-marker|fictional-(chat-message|question|nested-key|header-key|response)-marker|private-path-marker/
    );
    expect(logs).toMatch(new RegExp(`\\[httpBridge\\] ${method} \\S*${route}`)); // 路径保留（233 处调用靠它定位），查询串不留
    expect(logs).toMatch(new RegExp(`\\[httpBridge\\].*${method}.*${responseStatus}`));
  }

  beforeEach(async () => {
    status = 200;
    response = { data: { result: 'fictional-response-marker' } };
    contentType = 'application/json';
    received = undefined;
    refreshReplay = false;
    dataRequests = 0;
    requestPaths = [];
    debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    others = (['log', 'info', 'warn'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    server = createServer(async (request, reply) => {
      request.setEncoding('utf8');
      let body = '';
      for await (const chunk of request) body += chunk;
      requestPaths.push(request.url ?? '');
      if (refreshReplay) status = request.url === '/api/auth/refresh' || dataRequests++ > 0 ? 200 : 401;
      received = {
        method: request.method,
        path: request.url,
        body,
        contentType: request.headers['content-type'],
        authorization: request.headers.authorization,
        customHeader: request.headers['x-fixture'],
      };
      reply.writeHead(status, { 'Content-Type': contentType });
      reply.end(contentType === 'application/json' ? JSON.stringify(response) : response);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as { port: number };
    vi.stubGlobal('__backendPort', address.port);
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((failure) => (failure ? reject(failure) : resolve())));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps successful URL, body, headers and unwrapped data while logging only method and status', async () => {
    status = 201;
    const result = await httpRequest('POST', path, requestBody, {
      headers: { Authorization: authorization, 'X-Fixture': 'fictional-header-key-marker' },
    });

    expect(received).toEqual({
      method: 'POST',
      path,
      body: JSON.stringify(requestBody),
      contentType: 'application/json',
      authorization,
      customHeader: 'fictional-header-key-marker',
    });
    expect(result).toEqual({ result: 'fictional-response-marker' });
    expect(error).not.toHaveBeenCalled();
    expectPrivateLogs('POST', 201);
  });

  it('preserves structured JSON errors without logging their contents at error level', async () => {
    status = 400;
    response = responseBody;
    const failure = await httpRequest('GET', path).catch((reason: unknown) => reason);

    expect(failure).toBeInstanceOf(BackendHttpError);
    expect(failure).toMatchObject({
      name: 'BackendHttpError',
      status: 400,
      code: responseBody.code,
      backendMessage: responseBody.error,
      details: requestBody,
      body: responseBody,
      message: `Backend GET ${path} failed (400): ${JSON.stringify(responseBody)}`,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expectPrivateLogs('GET', 400);
  });

  it('still throws silent statuses but uses only debug logs with no request or response contents', async () => {
    status = 404;
    response = responseBody;
    const failure = await httpRequest('GET', path, undefined, { silentStatuses: [404] }).catch(
      (reason: unknown) => reason
    );

    expect(failure).toBeInstanceOf(BackendHttpError);
    expect(failure).toMatchObject({
      status: 404,
      code: responseBody.code,
      backendMessage: responseBody.error,
      details: requestBody,
      body: responseBody,
      message: `Backend GET ${path} failed (404): ${JSON.stringify(responseBody)}`,
    });
    expect(error).not.toHaveBeenCalled();
    expectPrivateLogs('GET', 404);
  });

  it('preserves non-JSON error text and message without emitting that text to the console', async () => {
    status = 502;
    contentType = 'text/plain';
    response = 'fictional-response-marker /fictional/private-path-marker/document.md';
    const failure = await httpRequest('GET', path).catch((reason: unknown) => reason);

    expect(failure).toBeInstanceOf(BackendHttpError);
    expect(failure).toMatchObject({
      status: 502,
      code: '',
      backendMessage: response,
      details: undefined,
      body: response,
      message: `Backend GET ${path} failed (502): ${JSON.stringify(response)}`,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expectPrivateLogs('GET', 502);
  });

  it('keeps real 401 refresh and replay requests private without changing the replayed payload', async () => {
    refreshReplay = true;
    const origin = getBaseUrl();
    const nativeFetch = globalThis.fetch;
    // Forward relative WebUI refresh URLs to the same fixture server, without replacing network responses.
    const forwardFetch: typeof fetch = (input, init) =>
      nativeFetch(typeof input === 'string' && input.startsWith('/') ? `${origin}${input}` : input, init);
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    vi.stubGlobal('fetch', forwardFetch);
    const result = await httpRequest('POST', `${origin}${path}`, requestBody, {
      headers: { Authorization: authorization, 'X-Fixture': 'fictional-header-key-marker' },
    });

    expect(requestPaths).toEqual([path, '/api/auth/refresh', path]);
    expect({ result, received }).toEqual({
      result: { result: 'fictional-response-marker' },
      received: {
        method: 'POST',
        path,
        body: JSON.stringify(requestBody),
        contentType: 'application/json',
        authorization,
        customHeader: 'fictional-header-key-marker',
      },
    });
    expect(error).not.toHaveBeenCalled();
    expectPrivateLogs('POST', 200);
  });

  it('a network failure (nothing listening) logs no request body or query text', async () => {
    const dead = createServer();
    dead.listen(0, '127.0.0.1');
    await once(dead, 'listening');
    const { port } = dead.address() as { port: number };
    dead.close();
    await once(dead, 'close');
    await httpRequest('POST', `http://127.0.0.1:${port}${path}`, requestBody).catch(() => undefined);
    expect(allLogs()).not.toMatch(/private-query-marker|fictional-(chat-message|question)-marker/);
  });

  it('a received WebSocket message is dispatched to listeners but only its event name is logged, never the payload', async () => {
    let onMessage: ((event: { data: string }) => void) | undefined;
    class FakeSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      readyState = 0;
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'message') onMessage = listener;
      }
      close() {}
    }
    vi.stubGlobal('window', {});
    vi.stubGlobal('WebSocket', FakeSocket);
    const received: unknown[] = [];
    const off = wsEmitter<{ text: string }>('fixture.stream').on((payload) => received.push(payload));
    const payload = { text: 'fictional-stream-chunk-marker' };
    onMessage?.({ data: JSON.stringify({ name: 'fixture.stream', data: payload }) });
    off();
    expect(received).toEqual([payload]);
    expect(allLogs()).toMatch(/\[WS:msg\].*fixture\.stream/);
    expect(allLogs()).not.toMatch(/fictional-stream-chunk-marker/);
  });
});
