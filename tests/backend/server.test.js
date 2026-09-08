'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createServer } = require('../../server/server.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const STATIC_ROOT = path.join(FIXTURES, 'static');
const VALID_DATA_PATH = path.join(REPO_ROOT, 'data', 'levels.json');

function startServer({ dataPath }) {
  const app = createServer({ dataPath, staticRoot: STATIC_ROOT });
  return app.start({ port: 0 });
}

test('AC-001: 以 port 0 启动返回 Promise 结果含 origin、实际端口与 stop，stop 后服务关闭', async () => {
  const instance = await startServer({ dataPath: VALID_DATA_PATH });
  try {
    assert.strictEqual(typeof instance.origin, 'string');
    assert.ok(instance.origin.length > 0);
    assert.strictEqual(typeof instance.port, 'number');
    assert.ok(instance.port > 0);
    assert.strictEqual(typeof instance.stop, 'function');
    assert.ok(instance.origin.endsWith(`:${instance.port}`));
    const res = await fetch(`${instance.origin}/api/levels`);
    assert.strictEqual(res.status, 200);
  } finally {
    await instance.stop();
  }
  await assert.rejects(() => fetch(`${instance.origin}/api/levels`));
});

test('AC-001: 未显式提供 port 时遵循 PORT 环境变量', async () => {
  process.env.PORT = '0';
  try {
    const app = createServer({ dataPath: VALID_DATA_PATH, staticRoot: STATIC_ROOT });
    const instance = await app.start({});
    try {
      assert.strictEqual(typeof instance.port, 'number');
      assert.ok(instance.port > 0);
    } finally {
      await instance.stop();
    }
  } finally {
    delete process.env.PORT;
  }
});

test('AC-002: GET /api/levels 返回 200 与恰好 5 项的合法关卡顶层数组', async () => {
  const instance = await startServer({ dataPath: VALID_DATA_PATH });
  try {
    const res = await fetch(`${instance.origin}/api/levels`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.ok(Array.isArray(body), '响应体必须是顶层数组');
    assert.strictEqual(body.length, 5);
    const ids = new Set();
    for (const level of body) {
      assert.strictEqual(typeof level.id, 'string');
      assert.ok(level.id.length > 0, 'id 必须非空');
      ids.add(level.id);
      assert.strictEqual(typeof level.name, 'string');
      assert.ok(level.name.length > 0, 'name 必须非空');
      assert.ok(['简单', '普通', '困难'].includes(level.difficulty), 'difficulty 取值必须合法');
      assert.strictEqual(typeof level.unlocked, 'boolean', 'unlocked 必须是布尔值');
    }
    assert.strictEqual(ids.size, 5, 'id 必须在文件内唯一');
  } finally {
    await instance.stop();
  }
});

const INVALID_DATA_CASES = [
  ['夹具文件缺失', path.join(FIXTURES, 'levels', 'missing.json')],
  ['夹具不可读（目录）', path.join(FIXTURES, 'levels')],
  ['JSON 无法解析', path.join(FIXTURES, 'levels', 'bad-json.json')],
  ['关卡数量不是 5', path.join(FIXTURES, 'levels', 'four-items.json')],
  ['id 重复', path.join(FIXTURES, 'levels', 'duplicate-id.json')],
  ['name 为空', path.join(FIXTURES, 'levels', 'empty-name.json')],
  ['difficulty 取值非法', path.join(FIXTURES, 'levels', 'bad-difficulty.json')],
  ['unlocked 非布尔', path.join(FIXTURES, 'levels', 'unlocked-not-boolean.json')],
];

for (const [label, dataPath] of INVALID_DATA_CASES) {
  test(`AC-003: 数据不可用（${label}）返回 500 与 LEVEL_DATA_UNAVAILABLE 可读错误`, async () => {
    const instance = await startServer({ dataPath });
    try {
      const res = await fetch(`${instance.origin}/api/levels`);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
      const body = await res.json();
      assert.ok(body.error, '响应体必须含 error 结构');
      assert.strictEqual(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
      assert.strictEqual(typeof body.error.message, 'string');
      assert.ok(body.error.message.length > 0, 'message 必须可读非空');
      assert.ok(!body.error.message.includes('\n'), 'message 不含堆栈换行');
      assert.ok(!body.error.message.includes('at '), 'message 不含堆栈帧');
      assert.ok(!body.error.message.includes('ENOENT'), 'message 不含系统错误码');
      assert.ok(!body.error.message.includes(FIXTURES), 'message 不含内部夹具路径');
      assert.ok(!body.error.message.includes(REPO_ROOT), 'message 不含仓库内部路径');
    } finally {
      await instance.stop();
    }
  });
}

test('AC-004: API 路由收到不支持方法（POST /api/levels）返回 405 JSON 错误', async () => {
  const instance = await startServer({ dataPath: VALID_DATA_PATH });
  try {
    const res = await fetch(`${instance.origin}/api/levels`, { method: 'POST' });
    assert.strictEqual(res.status, 405);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.ok(body.error, '响应体必须是 JSON 错误结构');
    assert.strictEqual(typeof body.error.code, 'string');
    assert.ok(body.error.code.length > 0);
    assert.strictEqual(typeof body.error.message, 'string');
    assert.ok(body.error.message.length > 0);
  } finally {
    await instance.stop();
  }
});

test('AC-004: API 路由收到未知路径（GET /api/unknown）返回 404 JSON 错误', async () => {
  const instance = await startServer({ dataPath: VALID_DATA_PATH });
  try {
    const res = await fetch(`${instance.origin}/api/unknown`);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.ok(body.error, '响应体必须是 JSON 错误结构');
    assert.strictEqual(typeof body.error.code, 'string');
    assert.ok(body.error.code.length > 0);
    assert.strictEqual(typeof body.error.message, 'string');
    assert.ok(body.error.message.length > 0);
  } finally {
    await instance.stop();
  }
});
