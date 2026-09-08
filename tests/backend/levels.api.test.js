'use strict';

// tests/backend/levels.api.test.js — AC-001 / AC-002：GET /api/levels 成功与错误语义
//
// 覆盖：
//   - 数据有效 → 200 JSON 顶层数组恰好五项，Content-Type application/json; charset=utf-8
//   - 数据缺失/校验失败 → 500 JSON 错误（error.code + error.message，不泄漏堆栈与绝对路径）
//   - 未知 API 路径 → 404 JSON 错误
//   - 非允许方法 → 405 JSON 错误

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, dataFixture, request, REPO_ROOT } = require('./helpers.js');

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function assertJsonError(res, status) {
  assert.equal(res.status, status);
  assert.equal(res.headers['content-type'], JSON_CONTENT_TYPE);
  const payload = JSON.parse(res.body.toString('utf8'));
  assert.equal(typeof payload.error.code, 'string');
  assert.ok(payload.error.code.length > 0);
  assert.equal(typeof payload.error.message, 'string');
  assert.ok(payload.error.message.length > 0);
  return payload;
}

test('GET /api/levels 数据有效时返回 200 且恰好五项', async () => {
  const { port, stop } = await startTestServer({ dataPath: 'data/levels.json' });
  try {
    const res = await request({ port, path: '/api/levels' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], JSON_CONTENT_TYPE);
    const levels = JSON.parse(res.body.toString('utf8'));
    assert.ok(Array.isArray(levels));
    assert.equal(levels.length, 5);
    for (const item of levels) {
      assert.equal(typeof item.id, 'string');
      assert.equal(typeof item.name, 'string');
      assert.equal(typeof item.unlocked, 'boolean');
    }
  } finally {
    await stop();
  }
});

test('GET /api/levels 返回体与数据文件内容一致', async () => {
  const { port, stop } = await startTestServer({ dataPath: dataFixture('levels-valid.json') });
  try {
    const res = await request({ port, path: '/api/levels' });
    assert.equal(res.status, 200);
    const levels = JSON.parse(res.body.toString('utf8'));
    const expected = JSON.parse(require('node:fs').readFileSync(dataFixture('levels-valid.json'), 'utf8'));
    assert.deepEqual(levels, expected);
  } finally {
    await stop();
  }
});

test('GET /api/levels 数据文件缺失时返回 500 JSON 错误', async () => {
  const { port, stop } = await startTestServer({ dataPath: dataFixture('levels-not-exist.json') });
  try {
    const res = await request({ port, path: '/api/levels' });
    assertJsonError(res, 500);
  } finally {
    await stop();
  }
});

test('GET /api/levels 数据校验失败时返回 500 JSON 错误', async () => {
  const { port, stop } = await startTestServer({ dataPath: dataFixture('levels-bad-difficulty.json') });
  try {
    const res = await request({ port, path: '/api/levels' });
    const payload = assertJsonError(res, 500);
    assert.ok(!payload.error.message.includes(REPO_ROOT), '错误信息不得包含仓库绝对路径');
  } finally {
    await stop();
  }
});

test('GET /api/levels 数据为非法 JSON 时返回 500 JSON 错误', async () => {
  const { port, stop } = await startTestServer({ dataPath: dataFixture('levels-invalid-json.json') });
  try {
    const res = await request({ port, path: '/api/levels' });
    assertJsonError(res, 500);
  } finally {
    await stop();
  }
});

test('GET 未知 API 路径返回 404 JSON 错误', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/api/unknown' });
    assertJsonError(res, 404);
  } finally {
    await stop();
  }
});

test('POST /api/levels 返回 405 JSON 错误', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/api/levels', method: 'POST' });
    assertJsonError(res, 405);
  } finally {
    await stop();
  }
});

test('PUT /api/levels 返回 405 JSON 错误', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/api/levels', method: 'PUT' });
    assertJsonError(res, 405);
  } finally {
    await stop();
  }
});

test('DELETE /api/levels 返回 405 JSON 错误', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/api/levels', method: 'DELETE' });
    assertJsonError(res, 405);
  } finally {
    await stop();
  }
});
