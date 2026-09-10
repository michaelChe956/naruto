'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readLevels } = require('../../server/levels-store');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const VALID_PATH = path.join(FIXTURES_DIR, 'levels.valid.json');
const INVALID_JSON_PATH = path.join(FIXTURES_DIR, 'levels.invalid-json.json');
const NOT_ARRAY_PATH = path.join(FIXTURES_DIR, 'levels.not-array.json');
const WRONG_COUNT_PATH = path.join(FIXTURES_DIR, 'levels.wrong-count.json');
const BAD_FIELD_PATH = path.join(FIXTURES_DIR, 'levels.bad-field.json');
const MISSING_PATH = path.join(FIXTURES_DIR, 'levels.not-exists.json');
const DEFAULT_DATA_PATH = path.join(__dirname, '..', '..', 'data', 'levels.json');

const LEVEL_KEYS = ['difficulty', 'enemies', 'id', 'name'];

function assertValidLevel(level) {
  assert.deepEqual(Object.keys(level).sort(), LEVEL_KEYS);
  assert.equal(Number.isInteger(level.id) && level.id >= 1, true, 'id 应为正整数');
  assert.equal(typeof level.name, 'string');
  assert.equal(level.name.length > 0 && level.name === level.name.trim(), true, 'name 应为去除首尾空白的非空字符串');
  assert.equal(
    Number.isInteger(level.difficulty) && level.difficulty >= 1 && level.difficulty <= 5,
    true,
    'difficulty 应为 1~5 的整数',
  );
  assert.equal(Array.isArray(level.enemies) && level.enemies.length >= 1, true, 'enemies 应为至少一项的数组');
  for (const enemy of level.enemies) {
    assert.equal(typeof enemy, 'string');
    assert.equal(enemy.length > 0 && enemy === enemy.trim(), true, '敌人名应为去除首尾空白的非空字符串');
  }
}

async function assertDataError(dataPath, label) {
  const result = await readLevels(dataPath);
  assert.equal(result.ok, false, label);
  assert.equal(typeof result.reason, 'string', '数据错误应附带原因说明');
  assert.equal('levels' in result, false, '数据错误时不应输出关卡数组');
}

test('有效数据返回 ok 并输出按 id 升序标准化的五项数组', async () => {
  const result = await readLevels(VALID_PATH);
  assert.equal(result.ok, true);
  assert.equal(result.levels.length, 5);
  assert.deepEqual(result.levels.map((level) => level.id), [1, 2, 3, 4, 5]);
  for (const level of result.levels) {
    assertValidLevel(level);
  }
  assert.equal(result.levels[0].name, '木叶村门口');
  assert.equal(result.levels[1].name, '死亡森林', '标准化应去除首尾空白');
  assert.deepEqual(result.levels[4].enemies, ['音忍四人众', '大蛇丸'], '敌人名应去除首尾空白');
});

test('默认数据文件 data/levels.json 恰为五项有效关卡', async () => {
  const result = await readLevels(DEFAULT_DATA_PATH);
  assert.equal(result.ok, true);
  assert.equal(result.levels.length, 5);
  for (const level of result.levels) {
    assertValidLevel(level);
  }
});

test('数据文件缺失时返回数据错误', async () => {
  await assertDataError(MISSING_PATH, '缺失文件应读取失败');
});

test('数据文件不可解析时返回数据错误', async () => {
  await assertDataError(INVALID_JSON_PATH, '非法 JSON 应解析失败');
});

test('顶层不是数组时返回数据错误', async () => {
  await assertDataError(NOT_ARRAY_PATH, '顶层数据必须是数组');
});

test('关卡数量不是恰好五项时返回数据错误', async () => {
  await assertDataError(WRONG_COUNT_PATH, '关卡数量必须为五项');
});

test('关卡字段校验失败时返回数据错误', async () => {
  await assertDataError(BAD_FIELD_PATH, 'difficulty 超出范围应校验失败');
});
