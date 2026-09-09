'use strict';

// TASK-001：启动服务后请求 GET /api/hello，断言状态码 200 且 body 恰为 {"message":"hello"}。
// CodeReview 返工（CT-001）：新增内部错误路径测试，断言 500 且 body 恰为 {"error":"internal"}。

const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const BASE_URL = 'http://127.0.0.1:3000';

// 默认就绪判据：200 且 body 恰为 hello——校验响应特征，避免端口被第三方进程占用时的假阳性。
function defaultIsReady(response, body) {
  return response.status === 200 && body === '{"message":"hello"}';
}

// 等待 server.js 满足就绪判据；启动失败、提前退出或超时则携带最后观测与 stderr 失败。
async function waitForServerReady(child, { timeoutMs = 5000, isReady = defaultIsReady } = {}) {
  let spawnError = null;
  child.on('error', (err) => {
    spawnError = err;
  });

  const deadline = Date.now() + timeoutMs;
  let lastObservation = '无响应';

  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`无法启动 server.js：${spawnError.message}\n${child.stderrText}`);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `server.js 提前退出（code=${child.exitCode}, signal=${child.signalCode}）\n${child.stderrText}`
      );
    }
    try {
      const response = await fetch(`${BASE_URL}/api/hello`);
      const body = await response.text();
      if (isReady(response, body)) {
        return;
      }
      lastObservation = `status=${response.status}, body=${body}`;
    } catch {
      // 服务尚未监听，稍后重试
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `服务未在 ${timeoutMs}ms 内满足就绪判据（最后观测：${lastObservation}）\n${child.stderrText}`
  );
}

function startServer(env = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ...env },
  });
  child.stderrText = '';
  child.stderr.on('data', (chunk) => {
    child.stderrText += chunk;
  });
  return child;
}

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async (t) => {
  const child = startServer();
  t.after(() => {
    child.kill('SIGTERM');
  });

  await waitForServerReady(child);

  const response = await fetch(`${BASE_URL}/api/hello`);
  assert.equal(response.status, 200);

  const body = await response.text();
  assert.equal(body, '{"message":"hello"}');
});

test('GET /api/hello 内部错误时返回 500 且 body 恰为 {"error":"internal"}', async (t) => {
  const child = startServer({ HELLO_INJECT_INTERNAL_ERROR: '1' });
  t.after(() => {
    child.kill('SIGTERM');
  });

  await waitForServerReady(child, {
    isReady: (response, body) => response.status === 500 && body === '{"error":"internal"}',
  });

  const response = await fetch(`${BASE_URL}/api/hello`);
  assert.equal(response.status, 500);

  const body = await response.text();
  assert.equal(body, '{"error":"internal"}');
});
