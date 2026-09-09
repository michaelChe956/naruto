'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const SERVER_ENTRY_PATH = path.join(__dirname, '..', 'server.js');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const HELLO_PATH = '/api/hello';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestHello(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: HOST, port, path: HELLO_PATH }, (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body });
      });
    });
    request.setTimeout(1000, () => {
      request.destroy(new Error('单次请求超时'));
    });
    request.on('error', reject);
  });
}

// 起服务、轮询直到就绪后请求 /api/hello，返回 { statusCode, body }。
// 子进程启动失败或提前退出会立即失败（避免端口被其他服务占用时误用外部服务的响应）。
async function startServerAndRequest({ env = {}, port = DEFAULT_PORT } = {}) {
  const server = spawn(process.execPath, [SERVER_ENTRY_PATH], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderrText = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => {
    stderrText += chunk;
  });

  const startupFailure = new Promise((_, reject) => {
    server.once('error', (error) => {
      reject(new Error(`server 进程启动失败：${error.message}`));
    });
    server.once('exit', (code, signal) => {
      reject(new Error(`server 进程提前退出 (code=${code}, signal=${signal})\n${stderrText}`));
    });
  });
  // 成功路径下该 Promise 不会 resolve，挂空 catch 避免 unhandled rejection
  startupFailure.catch(() => {});

  try {
    let response = null;
    let lastError = null;
    const deadline = Date.now() + 5000;
    while (response === null && Date.now() < deadline) {
      try {
        response = await Promise.race([
          requestHello(port),
          sleep(1000).then(() => null),
          startupFailure,
        ]);
      } catch (error) {
        lastError = error;
        await sleep(100);
      }
    }

    if (response === null) {
      throw new Error(
        `服务未在 5 秒内就绪：${lastError ? lastError.message : '请求超时'}\n${stderrText}`,
      );
    }
    return response;
  } finally {
    server.kill();
  }
}

test(`GET ${HELLO_PATH} 返回 200 且 body 恰为 {"message":"hello"}（AC-001，默认监听 127.0.0.1:${DEFAULT_PORT}）`, async () => {
  const response = await startServerAndRequest();
  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body, '{"message":"hello"}');
});

test(`GET ${HELLO_PATH} 内部错误返回 500 且 body 恰为 {"error":"internal"}（CT-001 错误响应）`, async () => {
  // 注入 PORT 验证端口环境变量生效，并与默认端口场景隔离，降低共享环境端口冲突风险
  const response = await startServerAndRequest({ env: { HELLO_FAULT: 'injection', PORT: '3100' }, port: 3100 });
  assert.strictEqual(response.statusCode, 500);
  assert.strictEqual(response.body, '{"error":"internal"}');
});
