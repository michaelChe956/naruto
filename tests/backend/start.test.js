'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const { createServer, start, resolvePort, DEFAULT_PORT } = require('../../server/index');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const VALID_PATH = path.join(FIXTURES_DIR, 'levels.valid.json');
const STATIC_ROOT = path.join(FIXTURES_DIR, 'static');

test('createServer 返回 node:http Server 实例', () => {
  const server = createServer({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  assert.ok(server instanceof http.Server);
});

test('start 以 port 为 0 启动并 resolve 为含实际 origin、port 与 stop 的对象', async () => {
  const instance = await start({ port: 0, dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  try {
    assert.equal(Number.isInteger(instance.port) && instance.port > 0, true, '应 resolve 为实际监听端口');
    assert.equal(instance.origin, `http://127.0.0.1:${instance.port}`);
    assert.equal(typeof instance.stop, 'function');
  } finally {
    await instance.stop();
  }
});

test('stop 之后端口不再接受请求', async () => {
  const instance = await start({ port: 0, dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  const { origin } = instance;
  await instance.stop();
  await assert.rejects(fetch(`${origin}/api/levels`), Error, '服务停止后请求应失败');
});

test('resolvePort 未指定端口且无 PORT 环境变量时回退默认端口', () => {
  assert.equal(DEFAULT_PORT, 3000);
  assert.equal(resolvePort(undefined, {}), DEFAULT_PORT);
  assert.equal(resolvePort(null, {}), DEFAULT_PORT);
});

test('resolvePort 未指定端口时读取 PORT 环境变量', () => {
  assert.equal(resolvePort(undefined, { PORT: '8080' }), 8080);
  assert.equal(resolvePort(undefined, { PORT: '0' }), 0);
});

test('resolvePort 显式端口优先于 PORT 环境变量', () => {
  assert.equal(resolvePort(0, { PORT: '8080' }), 0);
  assert.equal(resolvePort(5000, { PORT: '8080' }), 5000);
});

test('resolvePort 对非法 PORT 环境变量回退默认端口', () => {
  assert.equal(resolvePort(undefined, { PORT: 'abc' }), DEFAULT_PORT);
  assert.equal(resolvePort(undefined, { PORT: '-3' }), DEFAULT_PORT);
  assert.equal(resolvePort(undefined, { PORT: '3.5' }), DEFAULT_PORT);
});

test('start 未传端口时读取 PORT 环境变量并监听随机端口', async () => {
  const previousPort = process.env.PORT;
  process.env.PORT = '0';
  try {
    const instance = await start({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
    try {
      assert.equal(instance.port > 0, true, 'PORT=0 时应监听随机端口');
    } finally {
      await instance.stop();
    }
  } finally {
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
  }
});
