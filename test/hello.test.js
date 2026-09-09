'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createServer } = require('../server.js');

const HOST = '127.0.0.1';
const PORT = 3000;
const READY_TIMEOUT_MS = 5000;

// 轮询直到服务可连接；spawn 失败（如 server.js 缺失）时立即失败
function waitForServer(child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    const attempt = () => {
      const req = http.get({ host: HOST, port: PORT, path: '/api/hello', timeout: 1000 }, () => {
        req.destroy();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`服务未在 ${READY_TIMEOUT_MS}ms 内就绪 (${HOST}:${PORT})`));
          return;
        }
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

test('GET /api/hello 返回状态码 200 且响应 body 恰为 {"message":"hello"}', async (t) => {
  const server = spawn(process.execPath, ['server.js'], { stdio: 'ignore' });
  t.after(() => server.kill());

  await waitForServer(server);

  const result = await new Promise((resolve, reject) => {
    http.get(`http://${HOST}:${PORT}/api/hello`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    }).on('error', reject);
  });

  assert.strictEqual(result.statusCode, 200);
  assert.strictEqual(result.body, '{"message":"hello"}');
});

test('GET /api/hello 内部错误时返回状态码 500 且响应 body 恰为 {"error":"internal"}', async (t) => {
  // 依赖注入：让业务逻辑抛出异常，触发真实 HTTP 路径上的内部错误兜底
  const server = createServer({ sayHello: () => { throw new Error('simulated internal error'); } });
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  t.after(() => server.close());
  const { port } = server.address();

  const result = await new Promise((resolve, reject) => {
    http.get(`http://${HOST}:${port}/api/hello`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    }).on('error', reject);
  });

  assert.strictEqual(result.statusCode, 500);
  assert.strictEqual(result.body, '{"error":"internal"}');
});
