'use strict';

// AC-005 与 TASK-003 端口策略：start({port:0}) → origin+stop、stop 后端口释放且可重复调用；
// PORT 环境变量优先；两者皆无时缺省 3000。
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const { start } = require('../../server/index.js');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

test('AC-005: start({port:0}) resolve 为含 origin 与 stop 的对象且 stop 后端口释放、stop 幂等', async () => {
  const handle = await start({ port: 0 });
  assert.equal(typeof handle.stop, 'function');
  assert.match(handle.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(handle.origin, `http://127.0.0.1:${handle.port}`);

  const boundPort = handle.port;
  await handle.stop();
  await handle.stop(); // 幂等：重复 stop 不应抛错

  // stop 后端口释放：同一端口可立即重新监听
  const second = await start({ port: boundPort });
  try {
    assert.equal(second.port, boundPort);
  } finally {
    await second.stop();
  }
});

test('start() 缺省端口取 PORT 环境变量', async (t) => {
  const freePort = await findFreePort();
  process.env.PORT = String(freePort);
  t.after(() => delete process.env.PORT);

  const handle = await start({});
  t.after(() => handle.stop());
  assert.equal(handle.port, freePort);
});

test('start() 未提供 port 且无 PORT 环境变量时缺省 3000', async (t) => {
  const hadPort = Object.hasOwn(process.env, 'PORT');
  const previous = process.env.PORT;
  delete process.env.PORT;
  t.after(() => {
    if (hadPort) process.env.PORT = previous;
  });

  const handle = await start();
  t.after(() => handle.stop());
  assert.equal(handle.port, 3000);
});
