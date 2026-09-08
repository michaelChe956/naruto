'use strict';

// tests/backend/static.test.js — AC-003 / TASK-004：静态资源托管与路径安全
//
// 覆盖：
//   - GET / 返回静态根目录默认页面（index.html）
//   - 子目录资源可访问，Content-Type 按扩展名返回
//   - 缺失资源 → 404 文本响应
//   - 越界路径（原始 ../、深层 ../、编码 %2e%2e）→ 404 文本响应
//   - 静态资源非允许方法 → 405 JSON 错误

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, request, dataFixture } = require('./helpers.js');

const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function assertText404(res) {
  assert.equal(res.status, 404);
  assert.equal(res.headers['content-type'], TEXT_CONTENT_TYPE);
  assert.ok(res.body.length > 0);
}

test('GET / 返回静态根目录默认页面', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body.toString('utf8'), /木叶村欢迎你/);
  } finally {
    await stop();
  }
});

test('GET /style.css 按扩展名返回 CSS Content-Type', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/style.css' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/css/);
  } finally {
    await stop();
  }
});

test('GET /app.js 按扩展名返回 JS Content-Type', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/app.js' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /(text\/javascript|application\/javascript)/);
  } finally {
    await stop();
  }
});

test('GET 子目录资源返回 200', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/sub/page.html' });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body.toString('utf8'), /子目录页面/);
  } finally {
    await stop();
  }
});

test('GET 缺失资源返回 404 文本响应', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/missing.png' });
    assertText404(res);
  } finally {
    await stop();
  }
});

test('GET 单层越界路径返回 404 文本响应', async () => {
  const { port, stop } = await startTestServer();
  try {
    // 原始请求不做客户端规范化：/../levels-valid.json 指向 fixtures 下的有效数据
    const res = await request({ port, path: '/../levels-valid.json' });
    assertText404(res);
  } finally {
    await stop();
  }
});

test('GET 深层越界路径返回 404 文本响应', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/../../data/levels.json' });
    assertText404(res);
  } finally {
    await stop();
  }
});

test('GET 编码越界路径（%2e%2e）返回 404 文本响应', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/%2e%2e/levels-valid.json' });
    assertText404(res);
  } finally {
    await stop();
  }
});

test('POST 静态资源路径返回 405 JSON 错误', async () => {
  const { port, stop } = await startTestServer();
  try {
    const res = await request({ port, path: '/index.html', method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(res.headers['content-type'], JSON_CONTENT_TYPE);
    const payload = JSON.parse(res.body.toString('utf8'));
    assert.equal(typeof payload.error.code, 'string');
    assert.equal(typeof payload.error.message, 'string');
  } finally {
    await stop();
  }
});

test('GET / 解析默认页面失败时返回 404 文本响应', async () => {
  // 指向空目录：无 index.html，/ 不应泄漏目录列表或错误堆栈
  const { port, stop } = await startTestServer({
    staticRoot: dataFixture('static-empty-root'),
  });
  try {
    const res = await request({ port, path: '/' });
    assertText404(res);
  } finally {
    await stop();
  }
});
