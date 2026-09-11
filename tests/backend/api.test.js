'use strict';

// AC-001 / AC-002 / AC-004：GET /api/levels 契约、数据异常错误、API 404/405。
const test = require('node:test');
const assert = require('node:assert/strict');

const { start } = require('../../server/index.js');
const { makeLevel, writeLevelsFixture } = require('./helpers/fixtures.js');

const JSON_UTF8 = 'application/json; charset=utf-8';
const EXE006_DIFFICULTIES = ['简单', '普通', '困难'];

function isExe006Level(level) {
  return (
    typeof level?.id === 'string' && level.id.length > 0 &&
    typeof level?.name === 'string' && level.name.length > 0 &&
    EXE006_DIFFICULTIES.includes(level?.difficulty) &&
    typeof level?.unlocked === 'boolean'
  );
}

function assertErrorEnvelope(body) {
  assert.ok(body && typeof body === 'object' && !Array.isArray(body), `响应体应为 error 对象，实际：${JSON.stringify(body)}`);
  assert.ok(typeof body.error?.code === 'string' && body.error.code.length > 0, 'error.code 应为非空字符串');
  assert.ok(typeof body.error?.message === 'string' && body.error.message.length > 0, 'error.message 应为非空可读字符串');
}

async function startFixture(t, options = {}) {
  const handle = await start({ ...options, port: 0 });
  t.after(() => handle.stop());
  return handle;
}

test('AC-001: GET /api/levels 基于自有夹具返回 200 与合法关卡数组', async (t) => {
  const dataPath = await writeLevelsFixture(t, [makeLevel(), makeLevel({ id: 'level-02', name: '波之国护送', difficulty: '普通', unlocked: false })]);
  const handle = await startFixture(t, { dataPath });

  const res = await fetch(`${handle.origin}/api/levels`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), JSON_UTF8);
  const body = await res.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 2);
  for (const level of body) assert.ok(isExe006Level(level), `关卡字段应满足 EXE-006：${JSON.stringify(level)}`);
});

test('AC-001: 真实 data/levels.json 恰好含 5 个满足 EXE-006 的关卡并通过 API 返回', async (t) => {
  const handle = await startFixture(t, {});

  const res = await fetch(`${handle.origin}/api/levels`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), JSON_UTF8);
  const body = await res.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 5);
  const ids = body.map((level) => level.id);
  assert.equal(new Set(ids).size, 5, '关卡 id 应非空且唯一');
  for (const level of body) assert.ok(isExe006Level(level), `关卡字段应满足 EXE-006：${JSON.stringify(level)}`);
});

test('AC-002: dataPath 指向缺失文件时返回 500 与 LEVEL_DATA_UNAVAILABLE 错误对象', async (t) => {
  const existing = await writeLevelsFixture(t, [makeLevel()]);
  const handle = await startFixture(t, { dataPath: `${existing}.absent` });

  const res = await fetch(`${handle.origin}/api/levels`);
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('content-type'), JSON_UTF8);
  const body = await res.json();
  assertErrorEnvelope(body);
  assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
});

test('AC-002: dataPath 内容非法 JSON 时返回 500 与 LEVEL_DATA_UNAVAILABLE 错误对象', async (t) => {
  const dataPath = await writeLevelsFixture(t, '{oops: not json');
  const handle = await startFixture(t, { dataPath });

  const res = await fetch(`${handle.origin}/api/levels`);
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('content-type'), JSON_UTF8);
  const body = await res.json();
  assertErrorEnvelope(body);
  assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
});

test('AC-002: 夹具违反 EXE-006 字段约束时返回 500 与 LEVEL_DATA_UNAVAILABLE 错误对象', async (t) => {
  const dataPath = await writeLevelsFixture(t, [makeLevel({ difficulty: '地狱' })]);
  const handle = await startFixture(t, { dataPath });

  const res = await fetch(`${handle.origin}/api/levels`);
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('content-type'), JSON_UTF8);
  const body = await res.json();
  assertErrorEnvelope(body);
  assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
});

test('AC-002: 夹具关卡 id 重复（结构校验失败）时返回 500 与 LEVEL_DATA_UNAVAILABLE', async (t) => {
  const dataPath = await writeLevelsFixture(t, [makeLevel(), makeLevel()]);
  const handle = await startFixture(t, { dataPath });

  const res = await fetch(`${handle.origin}/api/levels`);
  assert.equal(res.status, 500);
  const body = await res.json();
  assertErrorEnvelope(body);
  assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
});

test('AC-004: 未知 API 路径返回 API-002 结构的 JSON 404', async (t) => {
  const dataPath = await writeLevelsFixture(t, [makeLevel()]);
  const handle = await startFixture(t, { dataPath });

  const res = await fetch(`${handle.origin}/api/nope`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), JSON_UTF8);
  assertErrorEnvelope(await res.json());
});

test('AC-004: 对 /api/levels 使用非 GET 方法返回 API-002 结构的 JSON 405', async (t) => {
  const dataPath = await writeLevelsFixture(t, [makeLevel()]);
  const handle = await startFixture(t, { dataPath });

  const res = await fetch(`${handle.origin}/api/levels`, { method: 'POST' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('content-type'), JSON_UTF8);
  assert.equal(res.headers.get('allow'), 'GET');
  assertErrorEnvelope(await res.json());
});
