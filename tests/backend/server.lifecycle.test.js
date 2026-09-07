'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { once } = require('node:events');
const { createServer, STATIC_FIXTURES_DIR, REPO_ROOT } = require('./helpers.js');

const SERVER_MODULE = path.join(REPO_ROOT, 'server', 'server.js');

test('AC-001: createServer({ port: 0 }) + start() resolve 为 { origin, port, stop } 且 origin 匹配实际端口', async () => {
  const app = createServer({ port: 0, staticRoot: STATIC_FIXTURES_DIR });
  const info = await app.start();

  try {
    assert.equal(typeof info, 'object');
    assert.notEqual(info, null);
    assert.equal(typeof info.stop, 'function');
    assert.ok(Number.isInteger(info.port), 'port 必须是整数');
    assert.ok(info.port > 0, 'port 必须是操作系统分配的非零端口');
    assert.equal(info.origin, `http://127.0.0.1:${info.port}`);

    // 服务真实可访问
    const response = await fetch(`${info.origin}/api/levels`);
    assert.ok(response.status === 200 || response.status === 500);
  } finally {
    await info.stop();
  }
});

test('AC-001: stop() 关闭监听端口', async () => {
  const app = createServer({ port: 0, staticRoot: STATIC_FIXTURES_DIR });
  const info = await app.start();
  const port = info.port;
  await info.stop();

  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/levels`), (error) => {
    assert.ok(
      error.cause && ['ECONNREFUSED', 'ECONNRESET'].includes(error.cause.code),
      `预期连接被拒绝，实际: ${error.cause && error.cause.code}`,
    );
    return true;
  });
});

test('AC-001: start() 后重复调用 start() 幂等返回同一信息', async () => {
  const app = createServer({ port: 0, staticRoot: STATIC_FIXTURES_DIR });
  const first = await app.start();
  try {
    const second = await app.start();
    assert.equal(second.port, first.port);
    assert.equal(second.origin, first.origin);
  } finally {
    await first.stop();
  }
  await assert.doesNotReject(first.stop(), 'stop() 幂等且可重复调用');
});

test('AC-001: 未显式指定端口时使用 PORT 环境变量', async () => {
  const portEnv = String(20000 + Math.floor(Math.random() * 20000));
  const childScript = [
    `const { createServer } = require(${JSON.stringify(SERVER_MODULE)});`,
    `createServer({ staticRoot: ${JSON.stringify(STATIC_FIXTURES_DIR)} }).start().then((info) => {`,
    `  process.stdout.write('READY ' + info.port + '\\n');`,
    `});`,
  ].join('\n');

  const child = spawn(process.execPath, ['-e', childScript], {
    env: { ...process.env, PORT: portEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  const readyLine = new Promise((resolve) => {
    const onData = (chunk) => {
      stdout += chunk;
      const ready = stdout.match(/READY (\d+)/);
      if (ready) {
        child.stdout.off('data', onData);
        resolve(ready);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    setTimeout(() => resolve(null), 4000);
  });

  try {
    const match = await readyLine;
    assert.ok(match, `子进程未输出 READY 端口，stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`);
    const boundPort = Number(match[1]);
    assert.equal(boundPort, Number(portEnv), '未显式传端口时应绑定 PORT 环境变量指定的端口');

    const response = await fetch(`http://127.0.0.1:${boundPort}/api/levels`);
    assert.ok(response.status === 200 || response.status === 500);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
});
