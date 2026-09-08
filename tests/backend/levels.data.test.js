'use strict';

// tests/backend/levels.data.test.js — TASK-002：数据读取器与校验
//
// 覆盖：
//   - data/levels.json 与自有夹具（有效）→ 读取成功且恰好五项
//   - 各无效分支（自有夹具触发）：非数组、项数不足/超出、项非对象、
//     id 空/重复、name 空、difficulty 非法、unlocked 非布尔、非法 JSON、文件缺失

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadLevels, dataFixture } = require('./helpers.js');

test('读取真实 data/levels.json 成功且恰好五项', async () => {
  const result = await loadLevels('data/levels.json');
  assert.equal(result.ok, true);
  assert.equal(result.levels.length, 5);
});

test('读取有效夹具成功且恰好五项', async () => {
  const result = await loadLevels(dataFixture('levels-valid.json'));
  assert.equal(result.ok, true);
  assert.equal(result.levels.length, 5);
  assert.equal(result.levels[0].id, 'level-1');
});

test('顶层数组但为零项判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-empty-array.json'));
  assert.equal(result.ok, false);
});

test('顶层数组但不足五项判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-too-few.json'));
  assert.equal(result.ok, false);
});

test('顶层数组但超过五项判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-too-many.json'));
  assert.equal(result.ok, false);
});

test('顶层非数组判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-not-array.json'));
  assert.equal(result.ok, false);
});

test('关卡项不是对象判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-item-not-object.json'));
  assert.equal(result.ok, false);
});

test('id 为空字符串判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-empty-id.json'));
  assert.equal(result.ok, false);
});

test('id 在文件内重复判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-duplicate-id.json'));
  assert.equal(result.ok, false);
});

test('name 为空白字符串判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-empty-name.json'));
  assert.equal(result.ok, false);
});

test('difficulty 不在允许集合判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-bad-difficulty.json'));
  assert.equal(result.ok, false);
});

test('unlocked 不是布尔值判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-bad-unlocked.json'));
  assert.equal(result.ok, false);
});

test('非法 JSON 判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-invalid-json.json'));
  assert.equal(result.ok, false);
});

test('数据文件缺失判定无效', async () => {
  const result = await loadLevels(dataFixture('levels-not-exist.json'));
  assert.equal(result.ok, false);
});
