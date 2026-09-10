'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { startTestServer, requestJson } = require('./helpers/test-server');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const STATIC_ROOT = path.join(FIXTURES_DIR, 'static');
const VALID_PATH = path.join(FIXTURES_DIR, 'levels.valid.json');

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

test('GET / 返回 staticRoot 下 index.html', async () => {
  const instance = await startTestServer({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  try {
    const { status, contentType, text } = await requestJson(instance.origin, '/');
    assert.equal(status, 200);
    assert.equal(contentType, 'text/html; charset=utf-8');
    assert.match(text, /忍界闯关/);
  } finally {
    await instance.stop();
  }
});

test('GET /style.css 返回 CSS 内容与对应 Content-Type', async () => {
  const instance = await startTestServer({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  try {
    const { status, contentType, text } = await requestJson(instance.origin, '/style.css');
    assert.equal(status, 200);
    assert.equal(contentType, 'text/css; charset=utf-8');
    assert.match(text, /sans-serif/);
  } finally {
    await instance.stop();
  }
});

test('静态资源缺失时返回 404 文本响应', async () => {
  const instance = await startTestServer({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  try {
    const { status, contentType, text } = await requestJson(instance.origin, '/missing.png');
    assert.equal(status, 404);
    assert.equal(contentType, TEXT_CONTENT_TYPE);
    assert.equal(text, 'Not Found');
  } finally {
    await instance.stop();
  }
});

for (const requestPath of [
  '/../levels.valid.json',
  '/%2e%2e/levels.valid.json',
  '/..%2F..%2Fdata%2Flevels.json',
  '/static/../../levels.valid.json',
]) {
  test(`路径穿越被拒绝且不泄漏内部细节：${requestPath}`, async () => {
    const instance = await startTestServer({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
    try {
      const { status, contentType, text } = await requestJson(instance.origin, requestPath);
      assert.equal(status, 404, `${requestPath} 应拒绝解析并返回 404`);
      assert.equal(contentType, TEXT_CONTENT_TYPE);
      assert.equal(text, 'Not Found', '响应体不得包含服务端内部细节或文件内容');
    } finally {
      await instance.stop();
    }
  });
}

test('静态路径不允许的方法返回 405 与 JSON 错误体', async () => {
  const instance = await startTestServer({ dataPath: VALID_PATH, staticRoot: STATIC_ROOT });
  try {
    const { status, contentType, body, headers } = await requestJson(instance.origin, '/', { method: 'POST' });
    assert.equal(status, 405);
    assert.equal(contentType, JSON_CONTENT_TYPE);
    assert.equal(typeof body.error.code, 'string');
    assert.equal(typeof body.error.message, 'string');
    assert.equal(headers.get('allow'), 'GET');
  } finally {
    await instance.stop();
  }
});
