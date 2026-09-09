'use strict';

// AC-001 验收测试：
// WHEN 客户端请求 GET /api/hello THE SYSTEM SHALL 返回 200 且 body 恰为 {"message":"hello"}。
// 测试内以子进程方式启动 server.js，就绪后发起真实 HTTP 请求并断言响应。

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const SERVER_ENTRY = path.join(__dirname, '..', 'server.js');
const HOST = '127.0.0.1';
const PORT = 3000;
const READY_TIMEOUT_MS = 5000;
const PROBE_INTERVAL_MS = 100;

// 以子进程方式启动 server.js；stderr 收集到 chunks 中，便于失败时输出诊断信息。
function startServer(stderrChunks) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
  // 兜底吞掉 error 事件，避免无人监听时抛出未处理异常；就绪等待逻辑会自行监听并据此判定失败。
  child.on('error', () => {});
  return child;
}

// 轮询探测直到服务可响应，或子进程退出/启动出错/超时。
function waitForServerReady(child, getStderr) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let retryTimer = null;

    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimer);
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (error) reject(error);
      else resolve();
    };

    const readyTimer = setTimeout(() => {
      settle(
        new Error(
          `server.js 在 ${READY_TIMEOUT_MS}ms 内未在 ${HOST}:${PORT} 提供服务。stderr: ${getStderr()}`
        )
      );
    }, READY_TIMEOUT_MS);

    child.once('exit', (code, signal) => {
      settle(
        new Error(
          `server.js 在就绪前退出（code=${code}, signal=${signal}）。stderr: ${getStderr()}`
        )
      );
    });

    child.once('error', (err) => {
      settle(new Error(`server.js 启动失败：${err.message}。stderr: ${getStderr()}`));
    });

    const probe = () => {
      if (settled) return;
      const req = http.get({ host: HOST, port: PORT, path: '/api/hello' }, (res) => {
        res.resume();
        settle();
      });
      req.on('error', () => {
        if (settled) return;
        retryTimer = setTimeout(probe, PROBE_INTERVAL_MS);
      });
    };

    probe();
  });
}

// 发起 GET 请求，返回状态码与原始 body 字符串。
function getRaw(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: PORT, path: pathname }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          rawBody: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
  });
}

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async (t) => {
  const stderrChunks = [];
  const child = startServer(stderrChunks);

  t.after(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  });

  await waitForServerReady(child, () => stderrChunks.join(''));

  const { statusCode, rawBody } = await getRaw('/api/hello');

  assert.equal(statusCode, 200);
  assert.deepEqual(JSON.parse(rawBody), { message: 'hello' });
  // “恰为”按字节级校验原始 body。
  assert.equal(rawBody, '{"message":"hello"}');
});
