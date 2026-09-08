'use strict';

// tests/backend/server.lifecycle.test.js — AC-004 / TASK-003：服务生命周期与端口解析
//
// 覆盖：
//   - 模块导出 createServer、start、stop
//   - start({ port: 0 }) 解析为 { origin, port, stop }，origin 为 http://127.0.0.1:<实际端口>
//   - stop() 关闭服务（后续连接被拒绝）且幂等；停止后可再次启动
//   - 默认端口 3000；PORT 环境变量覆盖默认端口；显式 start({ port }) 优先于 PORT
//     （端口解析通过子进程验证，避免污染当前进程环境）

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
  createServer,
  serverModule,
  startTestServer,
  dataFixture,
  STATIC_FIXTURES_DIR,
  request,
  expectConnectionFailure,
} = require('./helpers.js');

test('模块导出 createServer、start、stop 且均为函数', () => {
  const mod = require('../../server/server.js');
  assert.equal(typeof mod.createServer, 'function');
  assert.equal(typeof mod.start, 'function');
  assert.equal(typeof mod.stop, 'function');
});

test('start({ port: 0 }) 解析为 origin、实际端口与可用 stop，并支持测试内启停', async () => {
  const app = createServer({
    port: 0,
    dataPath: dataFixture('levels-valid.json'),
    staticRoot: STATIC_FIXTURES_DIR,
  });
  const info = await app.start({ port: 0 });
  try {
    assert.equal(typeof info.port, 'number');
    assert.ok(info.port > 0);
    assert.equal(info.origin, `http://127.0.0.1:${info.port}`);
    assert.equal(typeof info.stop, 'function');

    const res = await request({ port: info.port, path: '/api/levels' });
    assert.equal(res.status, 200);
  } finally {
    await info.stop();
  }

  // stop() 后服务不再响应（接受任意连接层错误，不限定 TCP 错误码）
  const failureCode = await expectConnectionFailure({ port: info.port, path: '/api/levels' });
  assert.ok(['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED'].includes(failureCode), `意外错误码：${failureCode}`);

  // 停止后可再次启动并正常服务
  const again = await app.start({ port: 0 });
  try {
    assert.ok(again.port > 0);
    const res = await request({ port: again.port, path: '/api/levels' });
    assert.equal(res.status, 200);
  } finally {
    await again.stop();
  }
});

test('stop() 幂等：重复调用解析为成功', async () => {
  const { port, stop } = await startTestServer({ dataPath: dataFixture('levels-valid.json') });
  assert.ok(port > 0);
  await stop();
  await stop(); // 第二次调用不得抛错
});

test('同一实例 start 后 start 不重复监听，返回既有信息', async () => {
  const { app, port, stop } = await startTestServer({ dataPath: dataFixture('levels-valid.json') });
  try {
    const second = await app.start();
    assert.equal(second.port, port);
  } finally {
    await stop();
  }
});

/**
 * 在子进程中验证端口解析优先级（不污染当前测试进程的环境变量）。
 * @param {string} scenario 'port-env' | 'explicit-wins' | 'default'
 * @param {string} [portEnv] 传给子进程的 PORT 环境变量值
 * @returns {{ port: number }}
 */
function probePort(scenario, portEnv) {
  const script = `
    const { createServer } = require(${JSON.stringify(serverModule)});
    const app = createServer({
      dataPath: ${JSON.stringify(dataFixture('levels-valid.json'))},
      staticRoot: ${JSON.stringify(STATIC_FIXTURES_DIR)},
    });
    const startArg = ${JSON.stringify(scenario === 'explicit-wins' ? { port: 0 } : {})};
    app.start(startArg).then((info) => {
      console.log(JSON.stringify({ port: info.port }));
      return info.stop();
    }).then(() => process.exit(0)).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: portEnv === undefined ? { ...process.env, PORT: '' } : { ...process.env, PORT: portEnv },
  });
  assert.equal(result.status, 0, `子进程探测失败：${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

test('未设置 PORT 时默认监听 3000', () => {
  const { port } = probePort('default');
  assert.equal(port, 3000);
});

test('PORT 环境变量覆盖默认端口', () => {
  // 选取高位非常用端口，降低占用概率
  const candidate = 30000 + (process.pid % 20000);
  const { port } = probePort('port-env', String(candidate));
  assert.equal(port, candidate);
});

test('显式 start({ port: 0 }) 优先于 PORT 环境变量（使用临时端口）', () => {
  const candidate = 30000 + ((process.pid + 1) % 20000);
  const { port } = probePort('explicit-wins', String(candidate));
  assert.notEqual(port, candidate);
  assert.ok(port > 0);
});
