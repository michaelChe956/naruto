'use strict';

// tests/integration/page.same-origin.test.js — 页面同源验证（TASK-012 / AC-012、AC-013）
// 同一服务、同一 origin：
//   - GET / 返回 200 HTML，包含三个容器标记与 web/level-select.js 的 script 引用
//   - 该引用请求返回脚本内容，且以相对路径引用 /api/levels（CT-002）

const test = require('node:test');
const assert = require('node:assert/strict');
const { startIntegrationServer } = require('./helpers.js');

test('AC-012: port=0 启动后经 origin 请求 GET / 返回 200 HTML 且含三容器标记与 level-select.js 引用', async () => {
  const server = await startIntegrationServer();
  try {
    const response = await fetch(`${server.origin}/`);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') || '',
      /^text\/html/,
      '入口必须是 HTML 响应',
    );

    const html = await response.text();
    assert.match(html, /id="loading"/, '必须存在 id=loading 容器标记');
    assert.match(html, /id="level-list"/, '必须存在 id=level-list 容器标记');
    assert.match(html, /id="error-message"/, '必须存在 id=error-message 容器标记');

    // script 引用：src 指向 level-select.js（相对解析后即 web/level-select.js）
    const scriptMatch = html.match(/<script[^>]*src="([^"]*level-select\.js)"[^>]*>\s*<\/script>/);
    assert.ok(scriptMatch, '必须以 script 标签引用 web/level-select.js');
    const scriptSrc = scriptMatch[1];
    assert.doesNotMatch(scriptSrc, /^[a-z]+:\/\//i, 'script 引用必须是相对路径，不得硬编码绝对 URL');
  } finally {
    await server.stop();
  }
});

test('AC-013: 经 origin 请求 web/level-select.js 返回脚本内容且以相对路径引用 /api/levels', async () => {
  const server = await startIntegrationServer();
  try {
    // 从 GET / 提取真实引用路径，证明引用可经同源解析到 web/level-select.js
    const entry = await fetch(`${server.origin}/`);
    assert.equal(entry.status, 200);
    const html = await entry.text();
    const scriptMatch = html.match(/<script[^>]*src="([^"]*level-select\.js)"[^>]*>\s*<\/script>/);
    assert.ok(scriptMatch, '入口 HTML 必须引用 level-select.js');
    const scriptPath = scriptMatch[1].startsWith('/') ? scriptMatch[1] : `/${scriptMatch[1]}`;

    const response = await fetch(`${server.origin}${scriptPath}`);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get('content-type') || '',
      /^text\/javascript/,
      '脚本资源必须按扩展名返回 JavaScript Content-Type',
    );

    const body = await response.text();
    assert.ok(body.includes('/api/levels'), '脚本内容必须引用 /api/levels');
    assert.match(body, /['"`]\/api\/levels['"`]/, '脚本必须以相对路径（/api/levels）发起调用');
    assert.doesNotMatch(body, /['"`]https?:\/\/[^'"`]*api\/levels/, '不得以硬编码绝对 URL 调用 /api/levels');
  } finally {
    await server.stop();
  }
});
