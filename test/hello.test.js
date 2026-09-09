'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = 3000;
const TARGET_URL = `http://${HOST}:${PORT}/api/hello`;

// 轮询等待子进程服务就绪，超时后判定失败
function waitForServer(deadlineMs = 5000) {
  const deadline = Date.now() + deadlineMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (Date.now() > deadline) {
        reject(new Error(`服务在 ${deadlineMs}ms 内未就绪：${TARGET_URL}`));
        return;
      }
      try {
        const res = await fetch(TARGET_URL);
        resolve(res);
      } catch {
        setTimeout(attempt, 50);
      }
    };
    attempt();
  });
}

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async () => {
  const server = spawn(process.execPath, ['server.js'], { stdio: 'ignore' });
  try {
    const res = await waitForServer();
    assert.equal(res.status, 200);

    const bodyText = await res.text();
    // deepEqual 对单键对象断言可同时拒绝多余字段，保证 body 恰为该对象
    assert.deepEqual(JSON.parse(bodyText), { message: 'hello' });
  } finally {
    server.kill();
  }
});
