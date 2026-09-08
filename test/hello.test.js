'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = 3000;
const SERVER_PATH = path.join(__dirname, '..', 'server.js');

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: HOST, port: PORT, path: pathname, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      }
    );
    req.setTimeout(2000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(t, extraEnv) {
  const server = spawn(process.execPath, [SERVER_PATH], {
    stdio: 'ignore',
    env: { ...process.env, ...extraEnv },
  });

  let spawnError = null;
  const exited = new Promise((resolve) => {
    server.on('exit', (code, signal) => resolve({ code, signal }));
    server.on('error', (err) => {
      spawnError = err;
      resolve({ spawnError });
    });
  });

  t.after(async () => {
    if (server.exitCode === null && spawnError === null) {
      server.kill('SIGTERM');
    }
    await exited;
  });

  const deadline = Date.now() + 5000;
  let lastError = null;
  for (;;) {
    if (spawnError !== null || server.exitCode !== null) {
      const info = await exited;
      assert.fail(`server.js 未能在 ${HOST}:${PORT} 提供服务: ${JSON.stringify(info)}`);
    }
    if (Date.now() > deadline) {
      assert.fail(`等待 ${HOST}:${PORT} 就绪超时，最后一次错误: ${lastError}`);
    }
    try {
      return await get('/api/hello');
    } catch (err) {
      lastError = err;
      await sleep(100);
    }
  }
}

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async (t) => {
  const res = await startServer(t, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '{"message":"hello"}');
});

test('GET /api/hello 遇内部错误时返回 500 且 body 恰为 {"error":"internal"}', async (t) => {
  const res = await startServer(t, { HELLO_FAULT: 'internal' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body, '{"error":"internal"}');
});
