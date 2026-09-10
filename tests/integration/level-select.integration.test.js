'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { start } = require('../../server/server.js');
const { CONTAINER_IDS } = require('../../web/level-select.js');

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const INVALID_DATA_PATH = path.join(FIXTURES_DIR, 'invalid-levels.json');
const SCRIPT_SRC = '/level-select.js';
const API_LEVELS_RELATIVE_PATH = '/api/levels';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
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

test('CT-002 stop 返回 Promise 并释放端口监听（同端口可重绑）', async () => {
  const instance = await start({ port: 0 });
  const { port } = instance;
  const stopped = instance.stop();
  assert.equal(typeof stopped.then, 'function', 'stop 应返回 Promise');
  await stopped;

  const rebound = await start({ port });
  try {
    assert.equal(rebound.port, port, 'stop 后同一端口应可重新绑定，说明监听已释放');
  } finally {
    await rebound.stop();
  }
});

test('AC-012 start({ port: 0 }) 后页面与关卡 API 在同一 origin 同源可达', async () => {
  await withServer({}, async (instance) => {
    assert.ok(Number.isInteger(instance.port) && instance.port > 0, 'port 应为非零临时端口');
    assert.equal(instance.origin, `http://127.0.0.1:${instance.port}`);

    const page = await fetch(`${instance.origin}/`);
    assert.equal(page.status, 200, 'GET / 应同源返回关卡选择页');
    assert.match(page.headers.get('content-type') || '', /text\/html/);
    assert.equal(new URL(page.url).origin, instance.origin, '页面响应应来自 start 返回的 origin');

    const api = await fetch(`${instance.origin}/api/levels`);
    assert.equal(api.status, 200, 'GET /api/levels 应同源返回关卡数据');
    assert.equal(new URL(api.url).origin, instance.origin, 'API 响应应来自同一 origin');
  });
});

test('AC-013 GET /api/levels 返回 200、application/json 与满足字段约束的 5 项数组', async () => {
  await withServer({}, async (instance) => {
    const response = await fetch(`${instance.origin}/api/levels`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/json/);

    const body = await response.json();
    assert.ok(Array.isArray(body), '响应体顶层数组应为数组');
    assert.equal(body.length, 5, '应恰好包含 5 个关卡');
    body.forEach((level, index) => assertLevelShape(level, `body[${index}]`));
  });
});

test('AC-014 注入 tests/integration 自有无效数据文件时返回 500、LEVEL_DATA_UNAVAILABLE 与 JSON 错误头', async () => {
  await withServer({ dataPath: INVALID_DATA_PATH }, async (instance) => {
    const response = await fetch(`${instance.origin}/api/levels`);
    assert.equal(response.status, 500);
    assert.equal(
      response.headers.get('content-type'),
      JSON_CONTENT_TYPE,
      '错误响应 Content-Type 应为 application/json; charset=utf-8'
    );

    const body = await response.json();
    assert.equal(body.code, 'LEVEL_DATA_UNAVAILABLE');
    assert.equal(typeof body.message, 'string', '错误 message 应为字符串');
    assert.ok(body.message.length > 0, '错误 message 应为非空文本');
  });
});

test('AC-015 GET / 页面包含三个关卡容器标记与 level-select.js 引入', async () => {
  await withServer({}, async (instance) => {
    const response = await fetch(`${instance.origin}/`);
    assert.equal(response.status, 200);
    const html = await response.text();

    Object.values(CONTAINER_IDS).forEach((id) => {
      assert.ok(
        html.includes(`id="${id}"`),
        `页面应包含容器标记 id="${id}"（level-select.js 依赖的三个容器之一）`
      );
    });
    assert.ok(
      html.includes(`src="${SCRIPT_SRC}"`),
      '页面应通过 script 标签引入 web/level-select.js'
    );
  });
});

test('AC-015 web/level-select.js 脚本资源同源可达且以相对路径引用 /api/levels', async () => {
  await withServer({}, async (instance) => {
    const response = await fetch(`${instance.origin}${SCRIPT_SRC}`);
    assert.equal(response.status, 200, '脚本应经同一 origin 的静态托管返回');
    assert.match(response.headers.get('content-type') || '', /text\/javascript/);

    const scriptText = await response.text();
    assert.ok(
      scriptText.includes(API_LEVELS_RELATIVE_PATH),
      '脚本内应以相对路径 /api/levels 引用关卡 API（CT-004）'
    );
  });
});
