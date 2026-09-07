'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, createServer, STATIC_FIXTURES_DIR } = require('./helpers.js');
const { validateLevelsData } = require('../../server/server.js');

const DATA_FILE = path.join(REPO_ROOT, 'data', 'levels.json');
const VALID_DIFFICULTIES = new Set(['简单', '普通', '困难']);

test('TASK-003: data/levels.json 存在且为合法 JSON', () => {
  assert.ok(fs.existsSync(DATA_FILE), 'data/levels.json 必须存在');
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  assert.ok(Array.isArray(parsed), 'data/levels.json 顶层必须是数组');
});

test('TASK-003: data/levels.json 恰好五项且全部通过读取校验', () => {
  const levels = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  assert.equal(levels.length, 5);
  const reason = validateLevelsData(levels);
  assert.equal(reason, null, `data/levels.json 必须通过校验，实际原因: ${reason}`);
  const ids = new Set();
  for (const item of levels) {
    assert.ok(item.id.trim() !== '');
    assert.ok(!ids.has(item.id));
    ids.add(item.id);
    assert.ok(item.name.trim() !== '');
    assert.ok(VALID_DIFFICULTIES.has(item.difficulty));
    assert.equal(typeof item.unlocked, 'boolean');
  }
});

test('TASK-003: validateLevelsData 对每一类非法结构返回原因', () => {
  assert.ok(validateLevelsData({}) !== null, '非数组必须无效');
  assert.ok(validateLevelsData([null]) !== null, '非对象关卡项必须无效');
  assert.ok(validateLevelsData([{ id: '', name: 'x', difficulty: '简单', unlocked: true }]) !== null, '空 id 必须无效');
  assert.ok(
    validateLevelsData([
      { id: 'a', name: 'x', difficulty: '简单', unlocked: true },
      { id: 'a', name: 'y', difficulty: '普通', unlocked: true },
    ]) !== null,
    '重复 id 必须无效',
  );
  assert.ok(validateLevelsData([{ id: 'a', name: '  ', difficulty: '简单', unlocked: true }]) !== null, '空 name 必须无效');
  assert.ok(validateLevelsData([{ id: 'a', name: 'x', difficulty: '地狱', unlocked: true }]) !== null, '非法 difficulty 必须无效');
  assert.ok(validateLevelsData([{ id: 'a', name: 'x', difficulty: '简单', unlocked: 'yes' }]) !== null, '非布尔 unlocked 必须无效');
  assert.ok(validateLevelsData([{ id: 'a', name: 'x', difficulty: '简单' }]) !== null, '缺失字段必须无效');
});

test('AC-002: createServer 全默认选项时 dataPath 解析到仓库 data/levels.json', async () => {
  const app = createServer({ staticRoot: STATIC_FIXTURES_DIR });
  const server = await app.start();
  try {
    const response = await fetch(`${server.origin}/api/levels`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.length, 5);
  } finally {
    await server.stop();
  }
});
