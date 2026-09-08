'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadLevels,
  LevelDataError,
  LEVEL_DATA_ERROR_CODE,
} = require('../../server/levels');

const fixture = (name) => path.join(__dirname, 'fixtures', name);
const SHIPPED_DATA_PATH = path.join(__dirname, '..', '..', 'data', 'levels.json');

function assertLevelDataError(operation) {
  assert.throws(operation, (err) => {
    assert.ok(err instanceof LevelDataError, `应抛出 LevelDataError，实际为 ${err.constructor.name}`);
    assert.equal(err.code, 'LEVEL_DATA_UNAVAILABLE');
    assert.equal(err.code, LEVEL_DATA_ERROR_CODE);
    return true;
  });
}

test('loadLevels 解析合法关卡数据并恰返回五项记录', () => {
  const levels = loadLevels(fixture('levels.valid.json'));

  assert.ok(Array.isArray(levels));
  assert.equal(levels.length, 5);
  for (const record of levels) {
    assert.equal(typeof record.id, 'string');
    assert.ok(record.id.length > 0);
    assert.equal(typeof record.name, 'string');
    assert.ok(record.name.length > 0);
    assert.ok(['简单', '普通', '困难'].includes(record.difficulty));
    assert.equal(typeof record.unlocked, 'boolean');
  }
});

test('loadLevels 校验随仓库交付的 data/levels.json 合法', () => {
  const levels = loadLevels(SHIPPED_DATA_PATH);
  assert.equal(levels.length, 5);
});

test('loadLevels 对关卡数据文件缺失抛出 LEVEL_DATA_UNAVAILABLE', () => {
  assertLevelDataError(() => loadLevels(fixture('levels.not-exist.json')));
});

test('loadLevels 对 JSON 解析失败抛出 LEVEL_DATA_UNAVAILABLE', () => {
  assertLevelDataError(() => loadLevels(fixture('levels.bad-json.json')));
});

test('loadLevels 对非数组顶层结构抛出 LEVEL_DATA_UNAVAILABLE', () => {
  assertLevelDataError(() => loadLevels(fixture('levels.not-array.json')));
});

test('loadLevels 对记录数量不为五抛出 LEVEL_DATA_UNAVAILABLE', () => {
  assertLevelDataError(() => loadLevels(fixture('levels.wrong-count.json')));
});

test('loadLevels 对文件内重复 id 抛出 LEVEL_DATA_UNAVAILABLE', () => {
  assertLevelDataError(() => loadLevels(fixture('levels.duplicate-id.json')));
});

test('loadLevels 对空字符串 id 抛出 LEVEL_DATA_UNAVAILABLE', () => {
  assertLevelDataError(() => loadLevels(fixture('levels.empty-id.json')));
});

test('loadLevels 对缺失 name 字段抛出 LEVEL_DATA_UNAVAILABLE', () => {
  assertLevelDataError(() => loadLevels(fixture('levels.missing-name.json')));
});

test('loadLevels 对非法 difficulty 取值抛出 LEVEL_DATA_UNAVAILABLE', () => {
  assertLevelDataError(() => loadLevels(fixture('levels.bad-difficulty.json')));
});

test('loadLevels 对非布尔 unlocked 取值抛出 LEVEL_DATA_UNAVAILABLE', () => {
  assertLevelDataError(() => loadLevels(fixture('levels.bad-unlocked.json')));
});
