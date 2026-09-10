'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { startService, requestHttp } = require('./helpers/service');

// 联调针对生产资产；无效场景仅通过 start 的 dataPath 注入本目录夹具，不改动任何实现。
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DATA_PATH = path.join(PROJECT_ROOT, 'data', 'levels.json');
const INVALID_DATA_PATH = path.join(__dirname, 'fixtures', 'levels.not-array.json');

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const DATA_UNAVAILABLE_CODE = 'LEVEL_DATA_UNAVAILABLE';

test('GET /api/levels 返回 200 与恰好五项满足字段约束的顶层数组', async () => {
  const instance = await startService({ dataPath: DATA_PATH });
  try {
    const { status, contentType, body } = await requestHttp(instance.origin, '/api/levels');
    assert.equal(status, 200);
    assert.equal(contentType, JSON_CONTENT_TYPE);
    assert.ok(Array.isArray(body), '响应体应为顶层数组');
    assert.equal(body.length, 5);
    assert.deepEqual(body.map((level) => level.id), [1, 2, 3, 4, 5]);
    for (const level of body) {
      assert.deepEqual(Object.keys(level).sort(), ['difficulty', 'enemies', 'id', 'name']);
      assert.ok(Number.isInteger(level.id) && level.id >= 1, 'id 必须是正整数');
      assert.ok(typeof level.name === 'string' && level.name.trim().length > 0, 'name 必须是非空字符串');
      assert.ok(
        Number.isInteger(level.difficulty) && level.difficulty >= 1 && level.difficulty <= 5,
        'difficulty 必须是 1~5 的整数'
      );
      assert.ok(Array.isArray(level.enemies) && level.enemies.length >= 1, 'enemies 必须是至少一项的数组');
      assert.ok(
        level.enemies.every((enemy) => typeof enemy === 'string' && enemy.trim().length > 0),
        'enemies 必须由非空字符串组成'
      );
    }
  } finally {
    await instance.stop();
  }
});

test('注入无效数据夹具的实例返回 500 与 LEVEL_DATA_UNAVAILABLE JSON 错误体', async () => {
  const instance = await startService({ dataPath: INVALID_DATA_PATH });
  try {
    const { status, contentType, body } = await requestHttp(instance.origin, '/api/levels');
    assert.equal(status, 500);
    assert.equal(contentType, JSON_CONTENT_TYPE);
    assert.equal(body.error.code, DATA_UNAVAILABLE_CODE);
    assert.equal(typeof body.error.message, 'string');
  } finally {
    await instance.stop();
  }
});
