'use strict';

// TASK-001：唯一测试——启动服务后请求 GET /api/hello，
// 断言状态码为 200 且响应 body 恰为 {"message":"hello"}。

const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const BASE_URL = 'http://127.0.0.1:3000';

// 等待 server.js 就绪；提前退出或超时则携带 stderr 失败。
function waitForServerReady(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      reject(new Error(`无法启动 server.js：${err.message}\n${stderr}`));
    });
    child.on('exit', (code, signal) => {
      reject(new Error(`server.js 提前退出（code=${code}, signal=${signal}）\n${stderr}`));
    });

    const deadline = Date.now() + timeoutMs;
    const poll = async () => {
      while (Date.now() < deadline) {
        try {
          await fetch(`${BASE_URL}/api/hello`);
          resolve();
          return;
        } catch {
          // 服务尚未监听，稍后重试
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      reject(new Error(`服务未在 ${timeoutMs}ms 内就绪\n${stderr}`));
    };
    poll();
  });
}

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async (t) => {
  const child = spawn(process.execPath, ['server.js'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  t.after(() => {
    child.kill('SIGTERM');
  });

  await waitForServerReady(child);

  const response = await fetch(`${BASE_URL}/api/hello`);
  assert.equal(response.status, 200);

  const body = await response.text();
  assert.equal(body, '{"message":"hello"}');
});
