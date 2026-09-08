'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { createServer, start } = require('../../server/server.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_PATH = path.join(REPO_ROOT, 'data', 'levels.json');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

const VALID_DIFFICULTIES = ['简单', '普通', '困难'];

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function withServer(serverOptions, run) {
  const server = createServer(serverOptions);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(origin);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('start({port:0}) 解析为 {origin,port,stop} 且 stop() 释放监听端口', async () => {
  const instance = await start({ port: 0 });

  assert.equal(typeof instance.port, 'number');
  assert.ok(instance.port > 0, '实际端口必须大于 0');
  assert.equal(instance.origin, `http://127.0.0.1:${instance.port}`);
  assert.equal(typeof instance.stop, 'function');

  const response = await fetch(`${instance.origin}/api/levels`);
  assert.equal(response.status, 200);

  await assert.doesNotReject(instance.stop());
  assert.equal(await canConnect(instance.port), false, 'stop() 后端口应已释放');
});

test('数据夹具异常时 GET /api/levels 返回 500 与 LEVEL_DATA_UNAVAILABLE，且不修改 data/levels.json', async () => {
  const dataBefore = fs.readFileSync(DATA_PATH, 'utf8');

  const cases = [
    ['文件缺失', path.join(FIXTURES_DIR, 'does-not-exist.json')],
    ['JSON 解析失败', path.join(FIXTURES_DIR, 'levels-invalid-json.json')],
    ['id 重复', path.join(FIXTURES_DIR, 'levels-duplicate-id.json')],
    ['id 为空', path.join(FIXTURES_DIR, 'levels-empty-id.json')],
    ['name 为空', path.join(FIXTURES_DIR, 'levels-empty-name.json')],
    ['difficulty 非法', path.join(FIXTURES_DIR, 'levels-bad-difficulty.json')],
    ['unlocked 非布尔', path.join(FIXTURES_DIR, 'levels-non-bool-unlocked.json')],
  ];

  for (const [label, dataPath] of cases) {
    await withServer({ dataPath }, async (origin) => {
      const response = await fetch(`${origin}/api/levels`);

      assert.equal(response.status, 500, `${label}：应返回 500`);
      assert.equal(
        response.headers.get('content-type'),
        'application/json; charset=utf-8',
        `${label}：错误响应 Content-Type 应为 application/json; charset=utf-8`
      );

      const body = await response.json();
      assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE', `${label}：错误码应为 LEVEL_DATA_UNAVAILABLE`);
      assert.equal(typeof body.error.message, 'string');
      assert.notEqual(body.error.message, '', `${label}：message 必须非空`);
    });
  }

  const dataAfter = fs.readFileSync(DATA_PATH, 'utf8');
  assert.equal(dataAfter, dataBefore, 'data/levels.json 不得被修改');
});

test('未知 API 路径返回 JSON 404', async () => {
  await withServer({ dataPath: DATA_PATH }, async (origin) => {
    const response = await fetch(`${origin}/api/does-not-exist`);

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');

    const body = await response.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.notEqual(body.error.message, '');
  });
});

test('API 路径不支持的方法返回 JSON 405', async () => {
  await withServer({ dataPath: DATA_PATH }, async (origin) => {
    const response = await fetch(`${origin}/api/levels`, { method: 'POST' });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');

    const body = await response.json();
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
    assert.notEqual(body.error.message, '');
  });
});

const STATIC_FIXTURE_DIR = path.join(FIXTURES_DIR, 'static');

const STATIC_CONTENT_TYPES = [
  ['/', 'index.html', 'text/html; charset=utf-8', 'STATIC_FIXTURE_ENTRY'],
  ['/index.html', 'index.html', 'text/html; charset=utf-8', 'STATIC_FIXTURE_ENTRY'],
  ['/styles.css', 'styles.css', 'text/css; charset=utf-8', 'margin: 0'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8', 'static fixture'],
  ['/data.json', 'data.json', 'application/json; charset=utf-8', '"fixture": true'],
];

test('静态托管返回入口内容与正确的 Content-Type 映射', async () => {
  for (const [requestPath, fixtureFile, expectedContentType, expectedBodyPart] of STATIC_CONTENT_TYPES) {
    await withServer({ dataPath: DATA_PATH, staticRoot: STATIC_FIXTURE_DIR }, async (origin) => {
      const response = await fetch(`${origin}${requestPath}`);

      assert.equal(response.status, 200, `${requestPath}：应返回 200`);
      assert.equal(
        response.headers.get('content-type'),
        expectedContentType,
        `${requestPath}：Content-Type 应为 ${expectedContentType}`
      );

      const body = await response.text();
      assert.ok(
        body.includes(expectedBodyPart),
        `${requestPath}：应返回夹具 ${fixtureFile} 的内容`
      );
    });
  }
});

test('静态托管对缺失资源返回 404 文本响应', async () => {
  await withServer({ dataPath: DATA_PATH, staticRoot: STATIC_FIXTURE_DIR }, async (origin) => {
    const response = await fetch(`${origin}/missing-resource.txt`);

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');

    const body = await response.text();
    assert.notEqual(body.trim(), '', '404 响应应有文本内容');
  });
});

test('静态托管拒绝越界路径穿越且不泄露 staticRoot 外文件', async () => {
  const traversalPaths = [
    '/../server/server.js',
    '/../data/levels.json',
    '/%2e%2e/server/server.js',
    '/..%2fdata%2flevels.json',
    '/%2e%2e%2f%2e%2e%2fserver%2fserver.js',
  ];

  for (const traversalPath of traversalPaths) {
    await withServer({ dataPath: DATA_PATH, staticRoot: STATIC_FIXTURE_DIR }, async (origin) => {
      const response = await fetch(`${origin}${traversalPath}`);
      const body = await response.text();

      assert.ok(
        response.status === 403 || response.status === 404,
        `${traversalPath}：越界路径应被拒绝，实际状态 ${response.status}`
      );
      assert.ok(
        !body.includes('createServer') && !body.includes('level-01'),
        `${traversalPath}：不得泄露 staticRoot 之外的文件内容`
      );
    });
  }
});

test('GET /api/levels 返回 200 与恰 5 个合法关卡', async () => {
  await withServer({ dataPath: DATA_PATH }, async (origin) => {
    const response = await fetch(`${origin}/api/levels`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);

    const body = await response.json();
    assert.equal(Array.isArray(body), true, '顶层数据必须是数组');
    assert.equal(body.length, 5, '必须恰为 5 个关卡');

    const ids = new Set();
    for (const level of body) {
      assert.equal(typeof level, 'object');
      assert.equal(typeof level.id, 'string', 'id 必须为字符串');
      assert.notEqual(level.id, '', 'id 必须非空');
      assert.ok(!ids.has(level.id), `关卡 id 必须唯一，重复: ${level.id}`);
      ids.add(level.id);

      assert.equal(typeof level.name, 'string', 'name 必须为字符串');
      assert.notEqual(level.name.trim(), '', 'name 必须非空');

      assert.ok(
        VALID_DIFFICULTIES.includes(level.difficulty),
        `difficulty 必须属于 简单/普通/困难，实际: ${level.difficulty}`
      );

      assert.equal(typeof level.unlocked, 'boolean', 'unlocked 必须为布尔值');
    }
  });
});
