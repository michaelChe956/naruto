'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer, STATIC_FIXTURES_DIR } = require('./helpers.js');

test('AC-005: GET /index.html 按扩展名返回 text/html Content-Type', async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.origin}/index.html`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    const body = await response.text();
    assert.ok(body.includes('static-index-marker'), '必须返回夹具文件的原始内容');
  } finally {
    await server.stop();
  }
});

test('AC-005: GET / 返回静态入口 index.html', async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.origin}/`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    const body = await response.text();
    assert.ok(body.includes('static-index-marker'));
  } finally {
    await server.stop();
  }
});

test('AC-005: .js/.css/.json/.png 资源按扩展名返回 Content-Type', async () => {
  const server = await startTestServer();
  try {
    const js = await fetch(`${server.origin}/app.js`);
    assert.equal(js.status, 200);
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.ok((await js.text()).includes('static-js-marker'));

    const css = await fetch(`${server.origin}/style.css`);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');

    const json = await fetch(`${server.origin}/data.json`);
    assert.equal(json.status, 200);
    assert.equal(json.headers.get('content-type'), 'application/json; charset=utf-8');

    const png = await fetch(`${server.origin}/logo.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers.get('content-type'), 'image/png');
  } finally {
    await server.stop();
  }
});

test('AC-005: 缺失静态资源返回 404 文本响应', async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.origin}/missing-resource.txt`);
    assert.equal(response.status, 404);
    const contentType = response.headers.get('content-type') || '';
    assert.ok(contentType.startsWith('text/plain'), `404 必须是文本响应，实际 Content-Type: ${contentType}`);
    const body = await response.text();
    assert.equal(typeof body, 'string');
    assert.ok(body.length > 0);
  } finally {
    await server.stop();
  }
});

test('AC-005: 越出 staticRoot 的请求路径被拒绝', async () => {
  const server = await startTestServer();
  try {
    // 编码后的 .. 使请求绕过客户端 URL 规范化，直接命中服务器端路径处理
    const traversalUrls = [
      `${server.origin}/%2e%2e/server/server.js`,
      `${server.origin}/%2e%2e/%2e%2e/server/server.js`,
      `${server.origin}/sub/%2e%2e/%2e%2e/server/server.js`,
      `${server.origin}/..%2f..%2fserver%2fserver.js`,
    ];
    for (const url of traversalUrls) {
      const response = await fetch(url);
      assert.ok(
        response.status === 403 || response.status === 404,
        `越界请求 ${url} 必须被拒绝，实际状态: ${response.status}`,
      );
      if (response.status === 200) {
        const body = await response.text();
        assert.ok(!body.includes('createServer'), '越界请求不得泄漏目标文件内容');
      }
      // 即使是 403/404，也必须确保没有返回越界文件内容
      const body = await response.text();
      assert.ok(!body.includes('createServer'), `越界请求 ${url} 不得泄漏目标文件内容`);
    }
  } finally {
    await server.stop();
  }
});

test('AC-005: 越界请求不得返回 staticRoot 之外的文件内容（对照：目标文件真实存在于仓库中）', async () => {
  const server = await startTestServer();
  try {
    // 对照确认：fixtures/static 向上 4 级即仓库根，越界目标 server/server.js 真实存在
    const target = path.resolve(STATIC_FIXTURES_DIR, '..', '..', '..', '..', 'server', 'server.js');
    assert.ok(fs.existsSync(target), '仓库内 server/server.js 必须存在，用于构造越界请求');

    const response = await fetch(`${server.origin}/%2e%2e/%2e%2e/%2e%2e/server/server.js`);
    const body = await response.text();
    assert.ok(!body.includes('module.exports'), '越界请求不得泄漏 server.js 内容');
  } finally {
    await server.stop();
  }
});
