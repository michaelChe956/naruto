'use strict';

// tests/integration/api.levels.test.js — API 同源验证（TASK-013 / AC-014、AC-015）
// 同一服务、同一 origin：
//   - 默认 dataPath（仓库 data/levels.json）→ 200 顶层数组恰 5 项，JSON Content-Type
//   - 集成自有 dataPath 夹具注入无效数据（缺失文件 / 解析失败 / 校验失败）
//     → 500 LEVEL_DATA_UNAVAILABLE 统一错误结构，JSON Content-Type（CT-001）

const test = require('node:test');
const assert = require('node:assert/strict');
const { startIntegrationServer, integrationFixture, FIXTURES_DIR, REPO_ROOT } = require('./helpers.js');

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const VALID_DIFFICULTIES = new Set(['简单', '普通', '困难']);

test('AC-014: 经 origin 请求 GET /api/levels 返回 200 顶层数组恰 5 项且 Content-Type 为 application/json; charset=utf-8', async () => {
  const server = await startIntegrationServer();
  try {
    const response = await fetch(`${server.origin}/api/levels`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE);

    const body = await response.json();
    assert.ok(Array.isArray(body), '顶层必须是数组');
    assert.equal(body.length, 5, '数组必须恰好 5 项');

    // 交接契约 success shape：项 = { id, name, difficulty, unlocked }
    const seenIds = new Set();
    for (const item of body) {
      assert.equal(typeof item, 'object');
      assert.notEqual(item, null);
      assert.equal(typeof item.id, 'string');
      assert.ok(item.id.trim() !== '', 'id 必须非空');
      assert.ok(!seenIds.has(item.id), 'id 必须唯一');
      seenIds.add(item.id);
      assert.equal(typeof item.name, 'string');
      assert.ok(item.name.trim() !== '', 'name 必须非空');
      assert.ok(VALID_DIFFICULTIES.has(item.difficulty), `difficulty 必须属于 简单/普通/困难，实际: ${item.difficulty}`);
      assert.equal(typeof item.unlocked, 'boolean', 'unlocked 必须是布尔值');
    }
  } finally {
    await server.stop();
  }
});

// 集成自有夹具：覆盖 CT-001 的数据文件缺失 / 解析失败 / 校验失败三类不可用来源
const DATA_ERROR_CASES = [
  { name: '数据文件缺失（dataPath 指向不存在的文件）', dataPath: integrationFixture('does-not-exist.json') },
  { name: '解析失败（非法 JSON 夹具）', dataPath: integrationFixture('levels-invalid-json.json') },
  { name: '校验失败（顶层非数组的结构非法夹具）', dataPath: integrationFixture('levels-invalid-structure.json') },
];

for (const testCase of DATA_ERROR_CASES) {
  test(`AC-015: ${testCase.name}时经 origin 请求 GET /api/levels 返回 500 LEVEL_DATA_UNAVAILABLE 统一结构`, async () => {
    const server = await startIntegrationServer({ dataPath: testCase.dataPath });
    try {
      const response = await fetch(`${server.origin}/api/levels`);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE);

      const body = await response.json();
      assert.equal(typeof body, 'object');
      assert.notEqual(body, null);
      assert.equal(typeof body.error, 'object', '错误体必须是统一结构 { error: { code, message } }');
      assert.notEqual(body.error, null);
      assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
      assert.equal(typeof body.error.message, 'string');
      assert.ok(body.error.message.length > 0, 'message 必须非空');

      // message 不得泄漏堆栈或绝对路径
      assert.doesNotMatch(body.error.message, /^\s+at /m, 'message 不得包含堆栈帧');
      assert.ok(!body.error.message.includes(FIXTURES_DIR), 'message 不得包含夹具绝对路径');
      assert.ok(!body.error.message.includes(REPO_ROOT), 'message 不得包含仓库绝对路径');
      assert.ok(!body.error.message.includes('/home/'), 'message 不得包含绝对路径');
      assert.equal(body.error.message, body.error.message.split('\n')[0], 'message 必须是单行');
    } finally {
      await server.stop();
    }
  });
}
