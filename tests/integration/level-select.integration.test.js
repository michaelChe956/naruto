'use strict';

// tests/integration/level-select.integration.test.js — 关卡选择同源集成验证（TASK-010 / TASK-011）
//
// 以真实服务默认生产装配（staticRoot=web/、dataPath=data/levels.json）经
// start({ port: 0 }) 启动，全部断言基于同一 origin 的 HTTP 证据：
//   - CT-006/007/008  createServer 工厂 + start({ port: 0 }) 解析 { origin, port, stop }
//   - CT-009/010/011  同源 GET / 返回默认页面：三容器标记 + level-select.js 脚本引入（AC-011）
//   - CT-012          同源脚本响应含 /api/levels 相对路径引用（AC-011）
//   - CT-001          同源 GET /api/levels 返回 200 JSON 顶层数组且恰好五项（AC-010）
//   - CT-003/004/005  dataPath 指向错误夹具时返回 500 与 application/json 错误结构（AC-010）

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createServer } = require('../../server/server.js');

/** 集成错误夹具：顶层非数组，服务端校验失败 → LEVEL_DATA_UNAVAILABLE。 */
const BROKEN_DATA_FIXTURE = path.join(__dirname, 'fixtures', 'levels-unavailable.json');

/**
 * 以 port 0 启动真实服务并注册测试结束后的清理。
 * @param {import('node:test').TestContext} t 当前测试上下文
 * @param {object} [options] createServer 选项覆盖（dataPath/staticRoot）
 * @returns {Promise<{app: object, origin: string, port: number, stop: Function}>}
 */
async function startServerOnEphemeralPort(t, options = {}) {
  const app = createServer(options);
  const info = await app.start({ port: 0 });
  t.after(() => info.stop());
  return { app, ...info };
}

test('start({ port: 0 }) 解析为 127.0.0.1 实际端口的 origin 且服务同源可达', async (t) => {
  const { origin, port, stop } = await startServerOnEphemeralPort(t);

  assert.equal(typeof stop, 'function', 'start 结果必须携带 stop 函数');
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'port 0 必须解析为实际监听端口');
  assert.equal(origin, `http://127.0.0.1:${port}`, 'origin 必须指向实际分配端口');

  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200, '同一 origin 的页面入口必须可达');
  await response.arrayBuffer();
});

test('同源 GET / 返回默认页面：三容器标记与 level-select.js 脚本引入', async (t) => {
  const { origin } = await startServerOnEphemeralPort(t);

  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/, '入口必须以 HTML 返回');

  const html = await response.text();
  for (const marker of ['id="loading"', 'id="level-list"', 'id="error-message"']) {
    assert.ok(html.includes(marker), `页面缺少容器标记：${marker}`);
  }
  assert.match(html, /<script[^>]*src="[^"]*level-select\.js[^"]*"/, '页面必须以 script 标签引入 level-select.js');
});

test('同源脚本响应含 /api/levels 相对路径引用', async (t) => {
  const { origin } = await startServerOnEphemeralPort(t);

  const page = await fetch(`${origin}/`);
  const html = await page.text();
  const scriptMatch = html.match(/<script[^>]*src="([^"]*level-select\.js[^"]*)"/);
  assert.ok(scriptMatch, '页面未引入 level-select.js');

  // 经同一 origin 取回页面实际引用的脚本资源本身
  const scriptResponse = await fetch(new URL(scriptMatch[1], origin));
  assert.equal(scriptResponse.status, 200, '页面引用的脚本必须同源可达');

  const script = await scriptResponse.text();
  assert.ok(script.includes('/api/levels'), '脚本必须以 /api/levels 同源相对路径引用关卡 API');
});

test('同源 GET /api/levels 返回 200 JSON 顶层数组且恰好五项', async (t) => {
  const { origin } = await startServerOnEphemeralPort(t);

  const response = await fetch(`${origin}/api/levels`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/, 'API 成功响应必须为 JSON');

  const payload = await response.json();
  assert.ok(Array.isArray(payload), '响应体顶层必须是数组');
  assert.equal(payload.length, 5, '关卡数据必须恰好五项');
});

test('dataPath 指向错误夹具时 GET /api/levels 返回 500 与 JSON 错误结构', async (t) => {
  const { origin } = await startServerOnEphemeralPort(t, { dataPath: BROKEN_DATA_FIXTURE });

  const response = await fetch(`${origin}/api/levels`);
  assert.equal(response.status, 500);
  assert.equal(
    response.headers.get('content-type'),
    'application/json; charset=utf-8',
    'API 错误响应必须为 application/json; charset=utf-8',
  );

  const payload = await response.json();
  assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload), '错误响应体必须是 JSON 对象');
  assert.equal(payload.error.code, 'LEVEL_DATA_UNAVAILABLE');
  assert.equal(typeof payload.error.message, 'string');
  assert.ok(payload.error.message.length > 0, 'error.message 必须为非空字符串');
});
