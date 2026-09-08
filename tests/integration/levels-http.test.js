'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createServer, start } = require('../../server/server.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const INVALID_JSON_FIXTURE = path.join(FIXTURES_DIR, 'levels-invalid-json.json');
const MISSING_FIXTURE = path.join(FIXTURES_DIR, 'does-not-exist.json');

const VALID_DIFFICULTIES = ['简单', '普通', '困难'];

/** 以 start({port:0}) 启动同源服务（默认 dataPath 与 staticRoot），用后 stop() 释放。 */
async function withStartedServer(run) {
  const instance = await start({ port: 0 });
  try {
    return await run(instance);
  } finally {
    await instance.stop();
  }
}

/** 以 createServer({dataPath}) 注入夹具并监听临时端口，用后关闭。 */
async function withInjectedServer(serverOptions, run) {
  const server = createServer(serverOptions);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(origin);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** 断言 CT-002 统一错误结构与内容安全（无堆栈、绝对路径、内部实现细节）。 */
function assertUnifiedErrorBody(body, label) {
  assert.ok(body && typeof body === 'object', `${label}：响应体必须是 JSON 对象`);
  assert.ok(body.error && typeof body.error === 'object', `${label}：必须包含 error 对象`);
  assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE', `${label}：错误码应为 LEVEL_DATA_UNAVAILABLE`);
  assert.equal(typeof body.error.message, 'string', `${label}：message 必须为字符串`);
  assert.notEqual(body.error.message, '', `${label}：message 必须非空`);
  assert.ok(
    !/\n\s*at /.test(body.error.message) && !body.error.message.includes('    at '),
    `${label}：message 不得包含堆栈（CT-002），实际: ${body.error.message}`
  );
}

test('AC-011 同源页面入口：GET / 返回三容器标记与 level-select.js 脚本引用，且 /level-select.js 内容引用 /api/levels', async () => {
  await withStartedServer(async (instance) => {
    // 页面入口（CT-003 / CT-011）
    const pageResponse = await fetch(`${instance.origin}/`);
    assert.equal(pageResponse.status, 200, 'GET / 应返回 200');
    assert.equal(
      pageResponse.headers.get('content-type'),
      'text/html; charset=utf-8',
      '页面入口 Content-Type 应为 text/html; charset=utf-8'
    );

    const html = await pageResponse.text();
    for (const marker of ['id="loading"', 'id="level-list"', 'id="error-message"']) {
      assert.ok(html.includes(marker), `页面入口应包含容器标记 ${marker}（CT-011）`);
    }
    assert.match(
      html,
      /<script[^>]+src="[^"]*level-select\.js"/,
      '页面入口应以 script 引用 web/level-select.js（CT-011）'
    );

    // 同源静态脚本（CT-004 / CT-011）
    const scriptResponse = await fetch(`${instance.origin}/level-select.js`);
    assert.equal(scriptResponse.status, 200, 'GET /level-select.js 应返回 200');
    assert.equal(
      scriptResponse.headers.get('content-type'),
      'text/javascript; charset=utf-8',
      '脚本 Content-Type 应为 text/javascript; charset=utf-8'
    );

    const scriptBody = await scriptResponse.text();
    assert.ok(
      scriptBody.includes('/api/levels'),
      '经 HTTP 获取的 /level-select.js 内容必须以相对路径引用 /api/levels（CT-011）'
    );
  });
});

test('AC-012 同源 API 契约：GET /api/levels 返回顶层数组、恰 5 项且字段约束完整', async () => {
  await withStartedServer(async (instance) => {
    const response = await fetch(`${instance.origin}/api/levels`);
    assert.equal(response.status, 200, 'GET /api/levels 应返回 200');
    assert.match(
      response.headers.get('content-type'),
      /^application\/json/,
      'API 响应 Content-Type 应为 JSON'
    );

    const body = await response.json();
    assert.equal(Array.isArray(body), true, '响应体必须是顶层数组（CT-001）');
    assert.equal(body.length, 5, '数组必须恰为 5 项（CT-001）');

    const seenIds = new Set();
    for (const level of body) {
      assert.equal(typeof level.id, 'string', 'id 必须为字符串（CT-006）');
      assert.notEqual(level.id.trim(), '', 'id 必须为非空字符串（CT-006）');
      assert.ok(!seenIds.has(level.id), `id 必须在文件内唯一，重复: ${level.id}（CT-006）`);
      seenIds.add(level.id);

      assert.equal(typeof level.name, 'string', 'name 必须为字符串（CT-006）');
      assert.notEqual(level.name.trim(), '', 'name 必须为非空字符串（CT-006）');

      assert.ok(
        VALID_DIFFICULTIES.includes(level.difficulty),
        `difficulty 必须属于 简单/普通/困难，实际: ${level.difficulty}（CT-006）`
      );

      assert.equal(typeof level.unlocked, 'boolean', 'unlocked 必须为布尔值（CT-006）');
    }
  });
});

test('AC-012 错误结构：createServer({dataPath}) 注入错误夹具时返回 500 统一错误体与 JSON Content-Type', async () => {
  const cases = [
    ['数据文件缺失', MISSING_FIXTURE],
    ['JSON 解析失败', INVALID_JSON_FIXTURE],
  ];

  for (const [label, dataPath] of cases) {
    await withInjectedServer({ dataPath }, async (origin) => {
      const response = await fetch(`${origin}/api/levels`);

      assert.equal(response.status, 500, `${label}：应返回 500（CT-002）`);
      assert.equal(
        response.headers.get('content-type'),
        'application/json; charset=utf-8',
        `${label}：错误响应 Content-Type 应为 application/json; charset=utf-8`
      );

      const body = await response.json();
      assertUnifiedErrorBody(body, label);
      assert.ok(
        !body.error.message.includes(dataPath) && !body.error.message.includes(REPO_ROOT),
        `${label}：message 不得泄露绝对路径（CT-002），实际: ${body.error.message}`
      );
      assert.ok(
        !body.error.message.includes(path.basename(dataPath)),
        `${label}：message 不得泄露数据文件名等内部实现细节（CT-002），实际: ${body.error.message}`
      );
      assert.ok(
        !body.error.message.includes('ENOENT') &&
          !body.error.message.includes('SyntaxError') &&
          !body.error.message.includes('Unexpected'),
        `${label}：message 不得包含系统错误细节（CT-002），实际: ${body.error.message}`
      );
    });
  }
});
