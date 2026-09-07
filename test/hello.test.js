'use strict';

/**
 * 验收测试（AC-001）：
 * WHEN 客户端请求 GET /api/hello
 * THE SYSTEM SHALL 返回 200 且 body 恰为 {"message":"hello"}。
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
const TARGET_URL = `http://${HOST}:${PORT}/api/hello`;

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
 * 若端口被外部同名服务占用，被测进程会因 EADDRINUSE 退出，此处必须显式失败，
 * 而不是误连外部服务造成假通过。
 */
async function waitForServerReady(getStartupFailure, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const startupFailure = getStartupFailure();
    if (startupFailure) {
      throw new Error(`被测服务未能启动：${startupFailure}`);
    }
    if (await isPortOpen()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`服务未在 ${timeoutMs}ms 内于 ${HOST}:${PORT} 就绪`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async (t) => {
  const server = spawn(process.execPath, [SERVER_PATH]);
  t.after(() => {
    server.kill();
  });

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

  await waitForServerReady(() => startupFailure);

  const response = await fetch(TARGET_URL, { method: 'GET' });
  assert.strictEqual(response.status, 200);

  const body = await response.json();
  assert.deepStrictEqual(body, { message: 'hello' });
});
