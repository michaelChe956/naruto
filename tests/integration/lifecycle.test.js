'use strict';

// tests/integration/lifecycle.test.js — 套件生命周期验证（TASK-014 / AC-016）
// 集成验证完成后调用 stop() 释放监听；目录零测试判定失败由 index.js 兜底
// （已在 RED 阶段以 node --test tests/integration/ 真实验证 exit 1）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { startIntegrationServer } = require('./helpers.js');

test('AC-016: stop() 后监听释放，端口不再可达', async () => {
  const server = await startIntegrationServer();
  const port = server.port;
  assert.ok(Number.isInteger(port) && port > 0, 'port=0 启动必须解析为非零实际端口');
  await server.stop();

  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/levels`), (error) => {
    assert.ok(
      error.cause && ['ECONNREFUSED', 'ECONNRESET'].includes(error.cause.code),
      `预期连接被拒绝，实际: ${error.cause && error.cause.code}`,
    );
    return true;
  });
});

test('AC-016: 重复调用 stop() 幂等不抛错', async () => {
  const server = await startIntegrationServer();
  await server.stop();
  await assert.doesNotReject(server.stop(), 'stop() 必须幂等');
});
