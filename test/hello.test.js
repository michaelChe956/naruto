'use strict';

// AC-001 验收测试：
// WHEN 客户端请求 GET /api/hello THE SYSTEM SHALL 返回 200 且 body 恰为 {"message":"hello"}。
// 测试内以子进程方式启动 server.js，就绪后发起真实 HTTP 请求并断言响应。

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const SERVER_ENTRY = path.join(__dirname, '..', 'server.js');
const HOST = '127.0.0.1';
const PORT = 3000;
const READY_TIMEOUT_MS = 5000;
const PROBE_INTERVAL_MS = 100;
const EXIT_WAIT_TIMEOUT_MS = 5000;

// 以子进程方式启动 server.js；stderr 收集到 chunks 中，便于失败时输出诊断信息。
// envOverrides 用于向子进程注入环境变量（如 PORT 覆盖）。
function startServer(stderrChunks, envOverrides) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ...envOverrides },
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
  // 兜底吞掉 error 事件，避免无人监听时抛出未处理异常；就绪等待逻辑会自行监听并据此判定失败。
  child.on('error', () => {});
  return child;
}

// 轮询探测直到服务可响应，或子进程退出/启动出错/超时。
function waitForServerReady(child, host, port, getStderr) {
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
          `server.js 在 ${READY_TIMEOUT_MS}ms 内未在 ${host}:${port} 提供服务。stderr: ${getStderr()}`
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
      const req = http.get({ host, port, path: '/api/hello' }, (res) => {
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

// 注册测试收尾：若子进程仍在运行则以 SIGTERM 终止并等待其退出，避免跨用例残留监听进程。
function stopChildOnTeardown(t, child) {
  t.after(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  });
}

// 发起 GET 请求，返回状态码与原始 body 字符串。
function getRaw(host, port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: pathname }, (res) => {
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
  stopChildOnTeardown(t, child);

  await waitForServerReady(child, HOST, PORT, () => stderrChunks.join(''));

  const { statusCode, rawBody } = await getRaw(HOST, PORT, '/api/hello');

  assert.equal(statusCode, 200);
  assert.deepEqual(JSON.parse(rawBody), { message: 'hello' });
  // “恰为”按字节级校验原始 body。
  assert.equal(rawBody, '{"message":"hello"}');
});

// CT-001：GET /api/hello 处理路径必须具备内部错误处理分支——
// 处理过程抛出异常时返回 500 且 body 恰为 {"error":"internal"}，而非由 Node 默认断开连接。
test('GET /api/hello 处理器异常时返回 500 且 body 恰为 {"error":"internal"}', async (t) => {
  // 惰性引入以获取服务器工厂，注入必然抛错的 helloProvider 触发内部错误分支；
  // 入口模块仅在直接运行时才监听端口。
  const { createServer } = require('../server.js');

  const server = createServer({
    helloProvider: () => {
      throw new Error('测试注入的内部错误');
    },
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const { statusCode, rawBody } = await getRaw(HOST, port, '/api/hello');

  assert.equal(statusCode, 500);
  assert.deepEqual(JSON.parse(rawBody), { error: 'internal' });
  assert.equal(rawBody, '{"error":"internal"}');
});

// 借助监听 0 号端口获取一个当前可用端口（释放后存在极小的被抢占竞态，属可接受的测试代价）。
function getFreePort() {
  return new Promise((resolve, reject) => {
    const prober = net.createServer();
    prober.listen(0, HOST, () => {
      const { port } = prober.address();
      prober.close(() => resolve(port));
    });
    prober.once('error', reject);
  });
}

// 端口健壮性：PORT 环境变量可覆盖默认监听端口，避免端口占用/并行环境下测试不稳定。
test('PORT 环境变量可覆盖监听端口', async (t) => {
  const freePort = await getFreePort();

  const stderrChunks = [];
  const child = startServer(stderrChunks, { PORT: String(freePort) });
  stopChildOnTeardown(t, child);

  await waitForServerReady(child, HOST, freePort, () => stderrChunks.join(''));

  const { statusCode, rawBody } = await getRaw(HOST, freePort, '/api/hello');

  assert.equal(statusCode, 200);
  assert.equal(rawBody, '{"message":"hello"}');
});

// 等待子进程退出；超时则判定失败，避免套件因子进程未退出而无限挂起。
function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error(`子进程在 ${EXIT_WAIT_TIMEOUT_MS}ms 内未退出`));
    }, EXIT_WAIT_TIMEOUT_MS);

    function onExit(exitCode, exitSignal) {
      clearTimeout(timer);
      resolve([exitCode, exitSignal]);
    }

    child.once('exit', onExit);
  });
}

// 端口健壮性：目标端口被占用时，入口应输出清晰错误并以非零状态退出，而非未处理 error 事件直接崩溃。
test('端口被占用时以清晰错误退出而非未处理异常崩溃', async (t) => {
  const occupier = net.createServer();
  await new Promise((resolve, reject) => {
    occupier.once('error', reject);
    occupier.listen(0, HOST, resolve);
  });
  t.after(() => new Promise((resolve) => occupier.close(resolve)));
  const occupiedPort = occupier.address().port;

  const stderrChunks = [];
  const child = startServer(stderrChunks, { PORT: String(occupiedPort) });
  stopChildOnTeardown(t, child);

  const [code, signal] = await waitForExit(child);

  const stderr = stderrChunks.join('');
  assert.equal(signal, null);
  assert.equal(code, 1);
  assert.match(stderr, /server 启动或运行失败/);
  assert.match(stderr, /EADDRINUSE/);
});
