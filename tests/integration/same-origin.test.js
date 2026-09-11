'use strict';

// 同源集成验证（TASK-010/011/012，AC-011/012/013/014）：以同一 Node 服务的同源
// origin 产出页面入口、静态脚本与 API 契约的 HTTP 可观测证据。
// 与 tests/backend 不同：不注入 staticRoot 夹具，直接集成真实 web/ 与 data/levels.json。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { start } = require('../../server/index.js');

const JSON_UTF8 = 'application/json; charset=utf-8';
const HTML_UTF8 = 'text/html; charset=utf-8';
// CT-001：数据异常 500 的固定 code 与可读文案。
const LEVEL_DATA_FALLBACK_MESSAGE = '暂时无法加载关卡数据，请稍后重试';
const EXE006_DIFFICULTIES = ['简单', '普通', '困难'];

// TASK-010：start({port: 0}) 由系统分配端口，输出示例 origin http://127.0.0.1:49152。
async function startSameOriginServer(t, options = {}) {
  const handle = await start({ ...options, port: 0 });
  t.after(() => handle.stop());
  return handle;
}

// TASK-012/AC-013 夹具：注入非法 JSON 数据文件，触发 CT-001 错误路径。
async function writeBrokenLevelsFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cadence-integration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'levels.json');
  await fs.writeFile(filePath, '{oops: not json', 'utf8');
  return filePath;
}

test('TASK-010: start({port:0}) 产出同源 origin（http://127.0.0.1:<port>）作为后续请求基础', async (t) => {
  const handle = await startSameOriginServer(t);
  assert.match(handle.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(handle.origin, `http://127.0.0.1:${handle.port}`);
  assert.ok(handle.port > 0);
});

test('AC-011: 同一服务实例的同源 GET / 与 /level-select.js 与 /api/levels 均 200 可达', async (t) => {
  const handle = await startSameOriginServer(t);
  for (const endpoint of ['/', '/level-select.js', '/api/levels']) {
    const res = await fetch(`${handle.origin}${endpoint}`);
    assert.equal(res.status, 200, `${endpoint} 应在同源 origin 下 200 可达`);
  }
});

test('TASK-011: GET / 返回 200 HTML，含 loading/level-list/error-message 容器并引用 level-select.js', async (t) => {
  const handle = await startSameOriginServer(t);
  const res = await fetch(`${handle.origin}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), HTML_UTF8);
  const html = await res.text();
  assert.ok(html.includes('id="loading"'), 'HTML 应含 id 为 loading 的容器');
  assert.ok(html.includes('id="level-list"'), 'HTML 应含 id 为 level-list 的容器');
  assert.ok(html.includes('id="error-message"'), 'HTML 应含 id 为 error-message 的容器');
  assert.ok(html.includes('level-select.js'), 'HTML 应引用 level-select.js');
});

test('TASK-011/CT-003: GET /level-select.js 返回 200 脚本且以相对路径 /api/levels 请求数据', async (t) => {
  const handle = await startSameOriginServer(t);
  const res = await fetch(`${handle.origin}/level-select.js`);
  assert.equal(res.status, 200);
  assert.ok(
    res.headers.get('content-type').startsWith('text/javascript'),
    `应为 JS 脚本，实际 Content-Type：${res.headers.get('content-type')}`,
  );
  const script = await res.text();
  assert.ok(script.includes("'/api/levels'"), '脚本应包含相对路径 /api/levels 的数据请求地址');
});

test('TASK-012/AC-012: 同源 GET /api/levels 返回 200 与 JSON UTF-8 及长度 5 的顶层数组', async (t) => {
  const handle = await startSameOriginServer(t);
  const res = await fetch(`${handle.origin}/api/levels`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), JSON_UTF8);
  const body = await res.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 5);
  // TASK-012 数组元素示例：断言元素与示例同形（id/name/difficulty/unlocked 必备字段与类型）。
  // 示例值为形状示意，实际值以 data/levels.json 为准；不锁定示例之外的字段以免阻碍扩展。
  for (const level of body) {
    assert.ok(level && typeof level === 'object' && !Array.isArray(level), `元素应为对象：${JSON.stringify(level)}`);
    for (const key of ['id', 'name', 'difficulty', 'unlocked']) {
      assert.ok(Object.hasOwn(level, key), `元素应含示例字段 ${key}：${JSON.stringify(level)}`);
    }
    assert.equal(typeof level.id, 'string');
    assert.ok(level.id.length > 0);
    assert.equal(typeof level.name, 'string');
    assert.ok(level.name.length > 0);
    assert.ok(EXE006_DIFFICULTIES.includes(level.difficulty), `difficulty 应为「简单」「普通」「困难」之一：${level.difficulty}`);
    assert.equal(typeof level.unlocked, 'boolean');
  }
});

test('TASK-012/AC-013: dataPath 注入损坏夹具时同源 GET /api/levels 返回 500 与 CT-001 错误体', async (t) => {
  const brokenDataPath = await writeBrokenLevelsFixture(t);
  const handle = await startSameOriginServer(t, { dataPath: brokenDataPath });
  const res = await fetch(`${handle.origin}/api/levels`);
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('content-type'), JSON_UTF8);
  const body = await res.json();
  assert.deepEqual(body, {
    error: { code: 'LEVEL_DATA_UNAVAILABLE', message: LEVEL_DATA_FALLBACK_MESSAGE },
  });
});
