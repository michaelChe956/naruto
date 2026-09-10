'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { startTestServer, requestJson } = require('./helpers/test-server');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const VALID_PATH = path.join(FIXTURES_DIR, 'levels.valid.json');
const INVALID_JSON_PATH = path.join(FIXTURES_DIR, 'levels.invalid-json.json');
const BAD_FIELD_PATH = path.join(FIXTURES_DIR, 'levels.bad-field.json');
const MISSING_PATH = path.join(FIXTURES_DIR, 'levels.not-exists.json');
const STATIC_ROOT = path.join(FIXTURES_DIR, 'static');

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const DATA_UNAVAILABLE_CODE = 'LEVEL_DATA_UNAVAILABLE';
const DATA_UNAVAILABLE_MESSAGE = '暂时无法加载关卡数据，请稍后重试';

test('GET /api/levels 返回 200 与恰好五项的顶层数组', async () => {
  const instance = await startTestServer({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  try {
    const { status, contentType, body } = await requestJson(instance.origin, '/api/levels');
    assert.equal(status, 200);
    assert.equal(contentType, JSON_CONTENT_TYPE);
    assert.equal(Array.isArray(body), true, '响应体应为顶层数组');
    assert.equal(body.length, 5);
    assert.deepEqual(body.map((level) => level.id), [1, 2, 3, 4, 5]);
    assert.deepEqual(Object.keys(body[0]).sort(), ['difficulty', 'enemies', 'id', 'name']);
  } finally {
    await instance.stop();
  }
});

for (const [label, dataPath] of [
  ['数据文件缺失', MISSING_PATH],
  ['数据文件不可解析', INVALID_JSON_PATH],
  ['数据字段校验失败', BAD_FIELD_PATH],
]) {
  test(`数据不可用（${label}）时返回 500 与 LEVEL_DATA_UNAVAILABLE JSON 错误体`, async () => {
    const instance = await startTestServer({ dataPath, staticRoot: STATIC_ROOT });
    try {
      const { status, contentType, body } = await requestJson(instance.origin, '/api/levels');
      assert.equal(status, 500);
      assert.equal(contentType, JSON_CONTENT_TYPE);
      assert.equal(body.error.code, DATA_UNAVAILABLE_CODE);
      assert.equal(body.error.message, DATA_UNAVAILABLE_MESSAGE);
    } finally {
      await instance.stop();
    }
  });
}

test('未知 API 路径返回 404 与 JSON 错误体', async () => {
  const instance = await startTestServer({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  try {
    for (const requestPath of ['/api/unknown', '/api/']) {
      const { status, contentType, body } = await requestJson(instance.origin, requestPath);
      assert.equal(status, 404, `${requestPath} 应返回 404`);
      assert.equal(contentType, JSON_CONTENT_TYPE);
      assert.equal(typeof body.error.code, 'string');
      assert.equal(typeof body.error.message, 'string');
      assert.notEqual(body.error.code, DATA_UNAVAILABLE_CODE);
    }
  } finally {
    await instance.stop();
  }
});

test('不允许的方法返回 405 与 JSON 错误体及 Allow 头', async () => {
  const instance = await startTestServer({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  try {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const { status, contentType, body, headers } = await requestJson(instance.origin, '/api/levels', { method });
      assert.equal(status, 405, `${method} /api/levels 应返回 405`);
      assert.equal(contentType, JSON_CONTENT_TYPE);
      assert.equal(typeof body.error.code, 'string');
      assert.equal(typeof body.error.message, 'string');
      assert.equal(headers.get('allow'), 'GET');
    }
  } finally {
    await instance.stop();
  }
});
