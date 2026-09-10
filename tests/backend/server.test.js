'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const { createServer, start } = require('../../server/server.js');

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const STATIC_ROOT = path.join(FIXTURES_DIR, 'static');
const DATA_PATH = path.resolve(__dirname, '..', '..', 'data', 'levels.json');
const DIFFICULTY_VALUES = new Set(['easy', 'normal', 'hard']);

function assertLevelShape(level, where) {
  assert.equal(typeof level.id, 'string', `${where}.id 应为字符串`);
  assert.ok(level.id.trim().length > 0, `${where}.id 应为非空字符串`);
  assert.equal(typeof level.name, 'string', `${where}.name 应为字符串`);
  assert.ok(level.name.trim().length > 0, `${where}.name 应为非空字符串`);
  assert.ok(
    DIFFICULTY_VALUES.has(level.difficulty),
    `${where}.difficulty 应为 easy/normal/hard 之一`
  );
  assert.equal(typeof level.unlocked, 'boolean', `${where}.unlocked 应为布尔值`);
}

async function withServer(options, run) {
  const instance = await start({ port: 0, ...options });
  try {
    return await run(instance);
  } finally {
    await instance.stop();
  }
}

test('AC-001 start 以 port 0 使用临时端口并返回 origin/port/stop', async () => {
  const instance = await start({ port: 0 });
  try {
    assert.ok(Number.isInteger(instance.port) && instance.port > 0, 'port 应为非零临时端口');
    assert.equal(instance.origin, `http://127.0.0.1:${instance.port}`);
    assert.equal(typeof instance.stop, 'function');
  } finally {
    await instance.stop();
  }
});

test('AC-001 createServer 注入 options 后经 start 监听临时端口', async () => {
  const server = createServer({ dataPath: DATA_PATH, staticRoot: STATIC_ROOT });
  const instance = await server.start({ port: 0 });
  try {
    assert.ok(instance.port > 0, '注入 options 后 start 仍应支持 port 0 临时端口');
    const response = await fetch(`${instance.origin}/api/levels`);
    assert.equal(response.status, 200);
  } finally {
    await instance.stop();
  }
});

test('AC-002 data/levels.json 提供恰好 5 个满足字段约束的关卡', async () => {
  const raw = JSON.parse(await readFile(DATA_PATH, 'utf8'));
  assert.ok(Array.isArray(raw), '顶层数据应为数组');
  assert.equal(raw.length, 5, '应恰好包含 5 个关卡');
  raw.forEach((level, index) => assertLevelShape(level, `levels[${index}]`));
});

test('AC-003 GET /api/levels 返回 200 与 application/json 的 5 项顶层数组', async () => {
  await withServer({ dataPath: DATA_PATH }, async (instance) => {
    const response = await fetch(`${instance.origin}/api/levels`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    const body = await response.json();
    assert.ok(Array.isArray(body), '响应体顶层数组应为数组');
    assert.equal(body.length, 5);
    body.forEach((level, index) => assertLevelShape(level, `body[${index}]`));
  });
});

test('AC-004 关卡数据文件缺失时返回 500 与 LEVEL_DATA_UNAVAILABLE', async () => {
  await withServer(
    { dataPath: path.join(FIXTURES_DIR, 'no-such-levels.json') },
    async (instance) => {
      const response = await fetch(`${instance.origin}/api/levels`);
      assert.equal(response.status, 500);
      assert.match(response.headers.get('content-type') || '', /application\/json/);
      const body = await response.json();
      assert.equal(body.code, 'LEVEL_DATA_UNAVAILABLE');
    }
  );
});

test('AC-004 关卡数据解析失败时返回 500 与 LEVEL_DATA_UNAVAILABLE', async () => {
  await withServer(
    { dataPath: path.join(FIXTURES_DIR, 'broken.json') },
    async (instance) => {
      const response = await fetch(`${instance.origin}/api/levels`);
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.code, 'LEVEL_DATA_UNAVAILABLE');
    }
  );
});

test('AC-004 关卡数据校验失败（顶层数组非数组）时返回 500 与 LEVEL_DATA_UNAVAILABLE', async () => {
  await withServer(
    { dataPath: path.join(FIXTURES_DIR, 'bad-data.json') },
    async (instance) => {
      const response = await fetch(`${instance.origin}/api/levels`);
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.code, 'LEVEL_DATA_UNAVAILABLE');
    }
  );
});

test('AC-004 关卡数据不可读（dataPath 指向目录）时返回 500 与 LEVEL_DATA_UNAVAILABLE', async () => {
  await withServer({ dataPath: FIXTURES_DIR }, async (instance) => {
    const response = await fetch(`${instance.origin}/api/levels`);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.code, 'LEVEL_DATA_UNAVAILABLE');
  });
});

test('AC-005 GET / 返回 staticRoot 下的 index.html 与 text/html', async () => {
  await withServer({ staticRoot: STATIC_ROOT }, async (instance) => {
    const response = await fetch(`${instance.origin}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(await response.text(), /backend-static-index/);
  });
});

test('AC-005 静态资源按扩展名返回内容与 Content-Type', async () => {
  await withServer({ staticRoot: STATIC_ROOT }, async (instance) => {
    const css = await fetch(`${instance.origin}/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') || '', /text\/css/);
    assert.match(await css.text(), /teal/);

    const js = await fetch(`${instance.origin}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') || '', /text\/javascript/);
    assert.match(await js.text(), /backend-static-app/);
  });
});

test('AC-006 静态路径越界（编码 ../）被拒绝且不泄露文件内容', async () => {
  await withServer({ staticRoot: STATIC_ROOT }, async (instance) => {
    const response = await fetch(`${instance.origin}/%2e%2e/bad-data.json`);
    assert.ok(
      response.status === 403 || response.status === 404,
      `越界访问应被拒绝，实际状态码 ${response.status}`
    );
    const body = await response.text();
    assert.ok(!body.includes('not-a-top-level-array'), '越界响应不应返回目标文件内容');
    assert.match(response.headers.get('content-type') || '', /text\/plain/);
  });
});

test('AC-006 静态资源缺失返回 404 文本响应', async () => {
  await withServer({ staticRoot: STATIC_ROOT }, async (instance) => {
    const response = await fetch(`${instance.origin}/no-such-asset.txt`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /text\/plain/);
    assert.ok((await response.text()).length > 0, '404 应返回文本响应体');
  });
});
