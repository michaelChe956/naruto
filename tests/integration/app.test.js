'use strict';

// 集成测试：在真实 HTTP origin 上验证「页面入口 + 关卡 API + 错误分支」的
// 可观测契约（AC-010/AC-011/AC-012，兼容契约 CT-002）。
// 被测实现为 server/index.js 暴露的 createServer / start({port:0}) / stop；
// 本目录仅做验证，不修改任何实现（write_policy：tests/integration/** 之外全部禁改）。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { createServer } = require('../../server');

const LEVELS_API_PATH = '/api/levels';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const DEFAULT_DATA_PATH = path.join(__dirname, '..', '..', 'data', 'levels.json');

// 以 start({port:0}) 返回的 origin 发起 GET 请求
function get(origin, pathname) {
  return fetch(new URL(pathname, `${origin}/`));
}

// AC-010「恰含五项完整记录」：id/name/difficulty/unlocked 均为合法完整字段
function assertCompleteLevelRecords(records) {
  assert.ok(Array.isArray(records), '响应体顶层应为数组');
  assert.equal(records.length, 5, '关卡数组应恰含五项记录');
  const seenIds = new Set();
  for (const record of records) {
    assert.equal(typeof record.id, 'string', '记录应有字符串 id');
    assert.ok(record.id.length > 0, '记录 id 不应为空');
    assert.ok(!seenIds.has(record.id), `记录 id 不应重复：${record.id}`);
    seenIds.add(record.id);
    assert.equal(typeof record.name, 'string', '记录应有字符串 name');
    assert.ok(record.name.length > 0, '记录 name 不应为空');
    assert.ok(['简单', '普通', '困难'].includes(record.difficulty), `difficulty 应为合法枚举：${record.difficulty}`);
    assert.equal(typeof record.unlocked, 'boolean', '记录应有布尔 unlocked');
  }
}

// TASK-010 / AC-010：createServer + start({port:0}) 启动服务，
// 对返回的同一 origin 发起 GET / 与 GET /api/levels，结束后 stop 释放端口
test('同一 origin：页面入口 200，关卡 API 返回恰含五项完整记录的 200 数组', async () => {
  const instance = createServer({});
  const handle = await instance.start({ port: 0 });

  try {
    assert.equal(handle.origin, `http://127.0.0.1:${handle.port}`, '应返回实际监听端口的 origin');

    const pageResponse = await get(handle.origin, '/');
    assert.equal(pageResponse.status, 200, '页面入口 GET / 应返回 200');
    await pageResponse.arrayBuffer(); // 排空响应体，避免 keep-alive 连接悬挂

    const apiResponse = await get(handle.origin, LEVELS_API_PATH);
    assert.equal(apiResponse.status, 200, '关卡 API GET /api/levels 应返回 200');
    assert.ok((apiResponse.headers.get('content-type') || '').startsWith('application/json'), '关卡 API 应以 JSON 响应');
    assertCompleteLevelRecords(await apiResponse.json());
  } finally {
    await handle.stop();
  }
});

// TASK-011 / AC-011：同源页面证据——三个容器标记、脚本引用、脚本静态响应含
// 相对路径 /api/levels；只断言静态可观测结构，不断言动态渲染结果
test('同源页面：HTML 含三个容器标记与脚本引用，脚本源中含相对路径 /api/levels', async () => {
  const instance = createServer({});
  const handle = await instance.start({ port: 0 });

  try {
    const pageResponse = await get(handle.origin, '/');
    assert.equal(pageResponse.status, 200);
    assert.ok((pageResponse.headers.get('content-type') || '').includes('text/html'), '页面入口应以 HTML 响应');
    const html = await pageResponse.text();

    assert.ok(html.includes('id="loading"'), '页面应含 id="loading" 容器标记');
    assert.ok(html.includes('id="level-list"'), '页面应含 id="level-list" 容器标记');
    assert.ok(html.includes('id="error-message"'), '页面应含 id="error-message" 容器标记');

    const scriptMatch = html.match(/<script[^>]*\ssrc="([^"]+)"/);
    assert.ok(scriptMatch, '页面应包含带 src 的脚本引用');
    assert.equal(scriptMatch[1], './level-select.js', '页面应引用 level-select.js 脚本');

    // 脚本静态响应来自同一 origin（./level-select.js 相对页面根解析为 /level-select.js）
    const scriptResponse = await get(handle.origin, scriptMatch[1]);
    assert.equal(scriptResponse.status, 200, '脚本静态资源应可访问');
    assert.ok(
      (scriptResponse.headers.get('content-type') || '').startsWith('text/javascript'),
      '脚本静态资源应以 JS MIME 响应',
    );
    const scriptSource = await scriptResponse.text();
    assert.ok(scriptSource.includes(LEVELS_API_PATH), '脚本源中应包含相对路径 /api/levels');
  } finally {
    await handle.stop();
  }
});

// TASK-012 / AC-012 + CT-002：以注入 dataPath 指向不存在数据路径的独立实例
// 请求关卡 API，断言 500、LEVEL_DATA_UNAVAILABLE 错误信封与
// Content-Type application/json; charset=utf-8，且不改写 data/levels.json
test('错误分支：dataPath 不存在时关卡 API 返回 500 与 LEVEL_DATA_UNAVAILABLE 信封，且不修改 data/levels.json', async () => {
  const dataBefore = fs.readFileSync(DEFAULT_DATA_PATH, 'utf8');

  const missingDataPath = path.join(__dirname, 'fixtures', 'missing', 'levels.json');
  assert.equal(fs.existsSync(missingDataPath), false, '注入的 dataPath 应确实不存在');

  const instance = createServer({ dataPath: missingDataPath });
  const handle = await instance.start({ port: 0 });

  try {
    const response = await get(handle.origin, LEVELS_API_PATH);
    assert.equal(response.status, 500, '数据不可用时应返回 500');
    assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE, '错误响应 Content-Type 应为 application/json; charset=utf-8');

    const body = await response.json();
    assert.ok(body.error, '错误响应应含 error 信封');
    assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE', '错误信封应含 LEVEL_DATA_UNAVAILABLE 错误码');
    assert.equal(typeof body.error.message, 'string');
    assert.ok(body.error.message.length > 0, '错误信封应含非空 message');
  } finally {
    await handle.stop();
  }

  assert.equal(fs.readFileSync(DEFAULT_DATA_PATH, 'utf8'), dataBefore, '错误分支不得修改 data/levels.json');
});
