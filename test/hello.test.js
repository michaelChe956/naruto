'use strict';

/**
 * 验收测试（AC-001 主路径 + CT-001 错误分支）：
 * 1. GET  /api/hello       → 200，body 恰为 {"message":"hello"}
 * 2. 非 GET 访问 /api/hello → 405，body 恰为 {"error":"method not allowed"}
 * 3. GET  访问未命中路径    → 404，body 恰为 {"error":"not found"}
 *
 * 使用 node --test 内置测试运行器，启动 server.js 后发起真实 HTTP 请求断言。
 */

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const HOST = '127.0.0.1';
const PORT = 3000;
const BASE_URL = `http://${HOST}:${PORT}`;

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 5000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 探测端口是否可建立连接。
 */
function isPortOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * 轮询探测服务端口就绪（最多 5 秒），避免在服务未监听时提前发起断言请求。
 * 同时通过 getStartupFailure 守护“被测服务进程自身启动失败/提前退出”的情况：
 * 若端口被外部服务占用，被测进程会因 EADDRINUSE 退出，此处必须显式失败，
 * 而不是误连外部服务造成假通过。
 *
 * 端口可连后不做立即返回，而是等待一个轮询周期做宽限复查：
 * 被测进程 spawn 后需数十毫秒才尝试绑定端口，若仅凭“端口可连”立即返回，
 * 可能在 exit 事件登记启动失败之前连上占用端口的外部服务（同契约响应会造成假通过）；
 * 宽限复查确保被测进程自身启动失败时测试显式失败。
 */
async function waitForServerReady(getStartupFailure, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const startupFailure = getStartupFailure();
    if (startupFailure) {
      throw new Error(`被测服务未能启动：${startupFailure}`);
    }
    if (await isPortOpen()) {
      await delay(POLL_INTERVAL_MS);
      const recheckFailure = getStartupFailure();
      if (recheckFailure) {
        throw new Error(`被测服务未能启动：${recheckFailure}`);
      }
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`服务未在 ${timeoutMs}ms 内于 ${HOST}:${PORT} 就绪`);
    }
    await delay(POLL_INTERVAL_MS);
  }
}

/**
 * 为单个测试启动被测服务进程：登记启动失败守护信息与测试结束清理。
 */
function startServerForTest(t) {
  const server = spawn(process.execPath, [SERVER_PATH]);

  let stderrText = '';
  server.stderr.on('data', (chunk) => {
    stderrText += chunk;
  });

  let startupFailure = null;
  server.once('error', (err) => {
    startupFailure = `spawn 失败：${err.message}`;
  });
  server.once('exit', (code, signal) => {
    startupFailure = `服务进程提前退出 code=${code} signal=${signal}\nstderr: ${stderrText.trim()}`;
  });

  t.after(() => {
    server.kill();
  });

  return { getStartupFailure: () => startupFailure };
}

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async (t) => {
  const { getStartupFailure } = startServerForTest(t);
  await waitForServerReady(getStartupFailure);

  const response = await fetch(`${BASE_URL}/api/hello`, { method: 'GET' });
  assert.strictEqual(response.status, 200);

  const body = await response.json();
  assert.deepStrictEqual(body, { message: 'hello' });
});

test('POST /api/hello 返回 405 且 body 恰为 {"error":"method not allowed"}', async (t) => {
  const { getStartupFailure } = startServerForTest(t);
  await waitForServerReady(getStartupFailure);

  const response = await fetch(`${BASE_URL}/api/hello`, { method: 'POST' });
  assert.strictEqual(response.status, 405);

  const body = await response.json();
  assert.deepStrictEqual(body, { error: 'method not allowed' });
});

test('GET 未命中路径返回 404 且 body 恰为 {"error":"not found"}', async (t) => {
  const { getStartupFailure } = startServerForTest(t);
  await waitForServerReady(getStartupFailure);

  const response = await fetch(`${BASE_URL}/path-does-not-exist`, { method: 'GET' });
  assert.strictEqual(response.status, 404);

  const body = await response.json();
  assert.deepStrictEqual(body, { error: 'not found' });
});
