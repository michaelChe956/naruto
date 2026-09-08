'use strict';

// 集成测试：以 start({ port: 0 }) 启动真实服务（临时端口，支持并行隔离），
// 全部请求发往同一 origin，以真实 HTTP 同源请求验证：
//   1. GET /api/levels 契约形状（AC-011）
//   2. 页面入口结构、脚本加载与脚本内 /api/levels 相对路径引用（AC-012）
//   3. 未知 API 路径 404 JSON、API 不支持方法 405 JSON、缺失静态资源 404 文本（AC-013）
// 本文件只做验证，不修改 server/、web/ 与 data/levels.json。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createServer } = require('../../server/server.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_PATH = path.join(REPO_ROOT, 'data', 'levels.json');
const WEB_ROOT = path.join(REPO_ROOT, 'web');
const VALID_DIFFICULTIES = ['简单', '普通', '困难'];

// 以 port 0 启动真实服务，在回调中以同一 origin 发起同源请求，结束后关闭服务。
async function withServer(run) {
  const instance = await createServer({ dataPath: DATA_PATH, staticRoot: WEB_ROOT }).start({
    port: 0,
  });
  try {
    return await run(instance);
  } finally {
    await instance.stop();
  }
}

test('AC-011: start({ port: 0 }) 启动真实服务后 GET /api/levels 同源返回 200 与恰好 5 项且字段满足约束的顶层数组', async () => {
  await withServer(async ({ origin, port }) => {
    assert.ok(Number.isInteger(port) && port > 0, 'port 0 应绑定临时端口');
    const res = await fetch(`${origin}/api/levels`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.ok(Array.isArray(body), '响应体必须是顶层数组');
    assert.strictEqual(body.length, 5, '关卡数量必须恰好为 5');
    const seenIds = new Set();
    for (const [index, level] of body.entries()) {
      const label = `第 ${index + 1} 项`;
      assert.ok(
        level !== null && typeof level === 'object' && !Array.isArray(level),
        `${label}必须是对象`,
      );
      assert.strictEqual(typeof level.id, 'string', `${label}的 id 必须是字符串`);
      assert.ok(level.id.trim() !== '', `${label}的 id 必须是非空字符串`);
      assert.ok(!seenIds.has(level.id), `${label}的 id 必须唯一`);
      seenIds.add(level.id);
      assert.strictEqual(typeof level.name, 'string', `${label}的 name 必须是字符串`);
      assert.ok(level.name.trim() !== '', `${label}的 name 必须是非空字符串`);
      assert.ok(
        VALID_DIFFICULTIES.includes(level.difficulty),
        `${label}的 difficulty 取值必须是：${VALID_DIFFICULTIES.join('、')}`,
      );
      assert.strictEqual(typeof level.unlocked, 'boolean', `${label}的 unlocked 必须是布尔值`);
    }
  });
});

test('AC-012: GET / 同源返回含 loading/level-list/error-message 容器并加载 level-select.js 的 HTML，脚本同源可达且引用相对路径 /api/levels', async () => {
  await withServer(async ({ origin }) => {
    const page = await fetch(`${origin}/`);
    assert.strictEqual(page.status, 200);
    assert.match(page.headers.get('content-type') || '', /^text\/html/);
    const html = await page.text();
    for (const marker of ['id="loading"', 'id="level-list"', 'id="error-message"']) {
      assert.ok(html.includes(marker), `页面必须包含容器标记 ${marker}`);
    }
    assert.match(
      html,
      /<script[^>]*src="level-select\.js"/,
      '页面必须通过 script 标签加载 level-select.js',
    );

    // 页面位于 / 下，相对 src 解析为同源 /level-select.js。
    const script = await fetch(`${origin}/level-select.js`);
    assert.strictEqual(script.status, 200);
    assert.match(script.headers.get('content-type') || '', /^text\/javascript/);
    const source = await script.text();
    assert.ok(source.includes('/api/levels'), '脚本必须引用相对路径 /api/levels');
  });
});

test('AC-013: 未知 API 路径返回 JSON 404 错误体', async () => {
  await withServer(async ({ origin }) => {
    const res = await fetch(`${origin}/api/no-such-path`);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.ok(body && typeof body === 'object', '错误体必须是 JSON 对象');
    assert.ok(body.error && typeof body.error === 'object', '错误体必须包含 error 对象');
    assert.strictEqual(typeof body.error.code, 'string', 'error.code 必须是字符串');
    assert.strictEqual(typeof body.error.message, 'string', 'error.message 必须是字符串');
  });
});

test('AC-013: 对 API 使用不支持方法返回 Content-Type 为 application/json; charset=utf-8 的 JSON 405', async () => {
  await withServer(async ({ origin }) => {
    const res = await fetch(`${origin}/api/levels`, { method: 'POST' });
    assert.strictEqual(res.status, 405);
    assert.strictEqual(res.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await res.json();
    assert.ok(body && typeof body === 'object', '错误体必须是 JSON 对象');
    assert.ok(body.error && typeof body.error === 'object', '错误体必须包含 error 对象');
    assert.strictEqual(typeof body.error.code, 'string', 'error.code 必须是字符串');
    assert.strictEqual(typeof body.error.message, 'string', 'error.message 必须是字符串');
    assert.strictEqual(res.headers.get('allow'), 'GET', '405 响应必须通过 Allow 头声明支持的方法');
  });
});

test('AC-013: 缺失静态资源返回 404 文本响应', async () => {
  await withServer(async ({ origin }) => {
    const res = await fetch(`${origin}/no-such-static-resource.txt`);
    assert.strictEqual(res.status, 404);
    assert.match(res.headers.get('content-type') || '', /^text\/plain/);
    const body = await res.text();
    assert.ok(body.trim().length > 0, '404 文本响应必须有非空文本内容');
  });
});

test('CT-006 规范示例: 缺失静态资源 GET /missing.html 返回 404 纯文本 Not Found', async () => {
  await withServer(async ({ origin }) => {
    const res = await fetch(`${origin}/missing.html`);
    assert.strictEqual(res.status, 404);
    assert.match(res.headers.get('content-type') || '', /^text\/plain/);
    const body = await res.text();
    assert.strictEqual(body, 'Not Found');
  });
});
