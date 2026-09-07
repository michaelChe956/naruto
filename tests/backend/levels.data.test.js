'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, dataFixture, FIXTURES_DIR } = require('./helpers.js');

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

// 覆盖 AC-003 的数据错误分支：缺失文件、非法 JSON、结构非法（逐项校验规则）。
const DATA_ERROR_CASES = [
  { name: 'dataPath 指向缺失文件', dataPath: dataFixture('does-not-exist.json') },
  { name: 'dataPath 指向非法 JSON', dataPath: dataFixture('levels-invalid-json.json') },
  { name: '顶层不是数组', dataPath: dataFixture('levels-not-array.json') },
  { name: '关卡项不是对象', dataPath: dataFixture('levels-item-not-object.json') },
  { name: 'id 非字符串或为空', dataPath: dataFixture('levels-empty-id.json') },
  { name: 'id 在文件内重复', dataPath: dataFixture('levels-duplicate-id.json') },
  { name: 'name 为空', dataPath: dataFixture('levels-empty-name.json') },
  { name: 'difficulty 不在允许集合', dataPath: dataFixture('levels-bad-difficulty.json') },
  { name: 'unlocked 不是布尔', dataPath: dataFixture('levels-bad-unlocked.json') },
  { name: '关卡项缺失必需字段', dataPath: dataFixture('levels-missing-fields.json') },
];

for (const testCase of DATA_ERROR_CASES) {
  test(`AC-003: ${testCase.name} 时 GET /api/levels 返回 500 LEVEL_DATA_UNAVAILABLE 统一 JSON 错误`, async () => {
    const server = await startTestServer({ dataPath: testCase.dataPath });
    try {
      const response = await fetch(`${server.origin}/api/levels`);
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE);

      const body = await response.json();
      assert.equal(typeof body, 'object');
      assert.notEqual(body, null);
      assert.equal(typeof body.error, 'object');
      assert.notEqual(body.error, null);
      assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
      assert.equal(typeof body.error.message, 'string');
      assert.ok(body.error.message.length > 0, 'message 必须非空');

      // message 不含堆栈或绝对路径
      assert.doesNotMatch(body.error.message, /^\s+at /m, 'message 不得包含堆栈帧');
      assert.ok(!body.error.message.includes(FIXTURES_DIR), 'message 不得包含绝对路径');
      assert.ok(!body.error.message.includes('/home/'), 'message 不得包含绝对路径');
      assert.equal(body.error.message, body.error.message.split('\n')[0], 'message 必须是单行');
    } finally {
      await server.stop();
    }
  });
}
