'use strict';

// WI-003 端到端集成测试（同源 HTTP）：徽标文本与 GET /api/status 的 deploy_channel 逐字一致。
//
// 覆盖（对应 TASK-005 / REQ-007、AC-008、AC-009，并复核 CT-002 交付口径）：
// 1. AC-008：在随机端口启动 server.js 导出工厂，经同一源（同一 host:port）
//    分别取回 GET /status.html 与 GET /api/status，并在服务仍在监听时执行被测页面
//    自身的内联脚本；页面内的 fetch('/api/status') 走真实同源 HTTP，
//    断言渲染出的渠道徽标文本与同源响应中的 deploy_channel 逐字相等；
// 2. AC-009：变更后对比同一 GET /api/status 响应，既有字段键名与语义不变
//    （status 恒为 'ok'、uptimeSeconds 为非负整数），相对既有字段集的差异仅为新增 deploy_channel；
// 3. 同源页面即被测页面：GET /status.html 响应体与仓库根目录 status.html 逐字节一致。
//
// 依赖仅使用 Node 内置模块（node:test / node:assert / node:fs / node:http / node:path / node:vm），
// 不引入 jsdom 或任何外部依赖，保持「生产代码变更面恰为 1 个后端 + 1 个前端文件」的约束不被测试代码破坏。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const { createServer } = require('../server');

const STATUS_PATH = '/api/status';
const PAGE_ENDPOINT = '/status.html';
const PAGE_PATH = path.join(__dirname, '..', 'status.html');
const DEPLOY_CHANNEL_KEY = 'deploy_channel';
const BADGE_NODE_ID = 'channelBadge';

// 前置交付基线（aria/issues/issue_0001 server.js）既有响应字段集：
// 既有响应为 { status, uptimeSeconds }，本次仅做加法式扩展。
const BASELINE_STATUS_FIELDS = ['status', 'uptimeSeconds'];

// 对同一源的随机端口发起一次 GET，完整读取响应体。
function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: pathname },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// 每个用例内以随机端口启动被测服务，并在用例结束后关闭，避免端口冲突与句柄泄漏。
async function withServer(run) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    return await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// 等待页面脚本内的 fetch 链全部落地（同源 HTTP 往返 + then 微任务）。
async function flushPageScript(pendingFetches) {
  await Promise.all(pendingFetches);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

// 同源 fetch：只接受相对路径，解析到被测服务的同一 host:port，返回 Response 形状对象，
// 并把返回的 Promise 记入 pendingFetches，便于在服务关闭前等待页面取数完成。
function sameOriginFetch(port, seenTargets, pendingFetches) {
  return function fetch(input) {
    const target = typeof input === 'string' ? input : String(input && input.url);
    assert.ok(target.startsWith('/'), `页面 fetch 目标必须是同源相对路径，实际 ${target}`);
    seenTargets.push(target);
    const pending = request(port, target).then((res) => ({
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      json: () => Promise.resolve(JSON.parse(res.body.toString('utf8'))),
    }));
    pendingFetches.push(pending);
    return pending;
  };
}

function createElement(id, hidden) {
  return { id, textContent: '', hidden: hidden === true, style: {}, setAttribute() {} };
}

// 从服务实际返回的页面源码中取出唯一内联脚本；被测页面必须自带且仅带 1 段内联脚本。
function inlineScripts(source) {
  const matches = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(matches.length, 1, 'status.html 必须恰好包含 1 个 <script> 标签');
  const [attrs, body] = [matches[0][1], matches[0][2]];
  assert.ok(!/\bsrc\s*=/i.test(attrs), 'status.html 的 <script> 不得带 src 外部引用');
  assert.ok(body.trim().length > 0, 'status.html 的内联脚本不得为空');
  return body;
}

// 构造最小 DOM 沙箱，以同源真实 HTTP 作为 fetch，执行服务返回页面中的内联脚本。
function renderServedPage(html, port) {
  const elements = {
    status: createElement('status'),
    uptimeSeconds: createElement('uptimeSeconds'),
    version: createElement('version'),
    [BADGE_NODE_ID]: createElement(BADGE_NODE_ID),
    error: createElement('error', true),
  };
  const seenTargets = [];
  const pendingFetches = [];

  const sandbox = {
    document: { getElementById: (id) => elements[id] || null },
    console,
    fetch: sameOriginFetch(port, seenTargets, pendingFetches),
  };
  sandbox.window = sandbox;

  vm.runInNewContext(inlineScripts(html), sandbox, { filename: 'status.html' });
  return { elements, seenTargets, pendingFetches };
}

// 在指定 DEPLOY_CHANNEL 环境下，于同一源完成一次端到端观测：
// 先经同源 HTTP 取回 /api/status JSON 与 /status.html，再在服务仍监听时执行页面脚本，
// 最后返回页面渲染结果与同源响应，二者取值来源均为同一 host:port。
async function observe(rawValue) {
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'DEPLOY_CHANNEL');
  const previous = process.env.DEPLOY_CHANNEL;

  if (rawValue === undefined) {
    delete process.env.DEPLOY_CHANNEL;
  } else {
    process.env.DEPLOY_CHANNEL = rawValue;
  }

  try {
    return await withServer(async (port) => {
      const statusRes = await request(port, STATUS_PATH);
      const pageRes = await request(port, PAGE_ENDPOINT);

      assert.equal(statusRes.statusCode, 200, 'GET /api/status 必须返回 200');
      assert.equal(pageRes.statusCode, 200, 'GET /status.html 必须返回 200');
      assert.match(
        statusRes.headers['content-type'] || '',
        /^application\/json/,
        'GET /api/status 的 Content-Type 必须以 application/json 开头',
      );
      assert.match(
        pageRes.headers['content-type'] || '',
        /^text\/html/,
        'GET /status.html 的 Content-Type 必须以 text/html 开头',
      );

      const payload = JSON.parse(statusRes.body.toString('utf8'));
      const page = renderServedPage(pageRes.body.toString('utf8'), port);
      await flushPageScript(page.pendingFetches);

      return {
        port,
        payload,
        pageBody: pageRes.body,
        elements: page.elements,
        seenTargets: page.seenTargets,
      };
    });
  } finally {
    if (hadKey) {
      process.env.DEPLOY_CHANNEL = previous;
    } else {
      delete process.env.DEPLOY_CHANNEL;
    }
  }
}

test('AC-008：同源 HTTP 取回的徽标文本与 GET /api/status 的 deploy_channel 逐字相等', async () => {
  const samples = [
    undefined, // 未设置 DEPLOY_CHANNEL → 后端缺省 stable
    'stable',
    'canary-2026-09',
    'beta',
    'STABLE',
    '渠道-中文',
    '  spaced-channel  ',
  ];

  for (const sample of samples) {
    const { payload, elements } = await observe(sample);
    const label = sample === undefined ? '<未设置>' : JSON.stringify(sample);

    assert.equal(
      typeof payload[DEPLOY_CHANNEL_KEY],
      'string',
      `DEPLOY_CHANNEL=${label}: 同源响应必须携带字符串 deploy_channel`,
    );
    assert.ok(
      payload[DEPLOY_CHANNEL_KEY].length > 0,
      `DEPLOY_CHANNEL=${label}: deploy_channel 不得为空字符串`,
    );
    assert.equal(
      String(elements[BADGE_NODE_ID].textContent),
      payload[DEPLOY_CHANNEL_KEY],
      `DEPLOY_CHANNEL=${label}: 徽标文本必须与同源响应 deploy_channel 逐字相等`,
    );
    assert.notEqual(
      elements[BADGE_NODE_ID].hidden,
      true,
      `DEPLOY_CHANNEL=${label}: 徽标容器必须始终展示（不隐藏）`,
    );
    assert.equal(
      elements.error.hidden,
      true,
      `DEPLOY_CHANNEL=${label}: 成功取数时 #error 必须保持不可见`,
    );
  }
});

test('AC-008：同源取回的页面即仓库根 status.html，且徽标容器存在并渲染', async () => {
  const { pageBody } = await observe('stable');

  const expected = fs.readFileSync(PAGE_PATH);
  assert.ok(expected.length > 0, '仓库根目录 status.html 不得为空');
  assert.ok(pageBody.equals(expected), 'GET /status.html 响应体必须与仓库根目录 status.html 逐字节一致');
  assert.match(
    pageBody.toString('utf8'),
    new RegExp(`id\\s*=\\s*["']${BADGE_NODE_ID}["']`),
    `经同源 HTTP 取回的页面必须包含渠道徽标容器 #${BADGE_NODE_ID}`,
  );
});

test('AC-009：同一 GET /api/status 响应既有字段键名语义不变，差异仅为新增 deploy_channel', async () => {
  const { payload } = await observe('stable');

  const keys = Object.keys(payload).sort();
  assert.deepEqual(
    keys,
    [...BASELINE_STATUS_FIELDS, DEPLOY_CHANNEL_KEY].sort(),
    '顶层字段集应恰为既有字段加 deploy_channel',
  );

  // 既有字段语义：status 恒为 ok，uptimeSeconds 为非负整数。
  assert.equal(payload.status, 'ok', '既有字段 status 语义必须保持为 ok');
  assert.ok(
    Number.isInteger(payload.uptimeSeconds),
    `既有字段 uptimeSeconds 必须为整数，实际 ${JSON.stringify(payload.uptimeSeconds)}`,
  );
  assert.ok(payload.uptimeSeconds >= 0, '既有字段 uptimeSeconds 必须为非负整数');

  const difference = keys.filter((key) => !BASELINE_STATUS_FIELDS.includes(key));
  assert.deepEqual(difference, [DEPLOY_CHANNEL_KEY], '相对既有字段集的差异仅为 deploy_channel');
});

test('AC-009：多渠道取值下同源响应仍只新增 deploy_channel 且既有字段不变', async () => {
  for (const sample of [undefined, 'canary-2026-09', '渠道-中文']) {
    const { payload } = await observe(sample);
    const label = sample === undefined ? '<未设置>' : JSON.stringify(sample);

    for (const field of BASELINE_STATUS_FIELDS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(payload, field),
        `DEPLOY_CHANNEL=${label}: 既有字段 ${field} 必须仍然存在`,
      );
    }
    assert.equal(payload.status, 'ok', `DEPLOY_CHANNEL=${label}: status 必须保持 ok`);
    assert.ok(
      Number.isInteger(payload.uptimeSeconds) && payload.uptimeSeconds >= 0,
      `DEPLOY_CHANNEL=${label}: uptimeSeconds 必须保持非负整数`,
    );
    assert.deepEqual(
      Object.keys(payload).filter((key) => !BASELINE_STATUS_FIELDS.includes(key)),
      [DEPLOY_CHANNEL_KEY],
      `DEPLOY_CHANNEL=${label}: 相对既有字段集的差异仅为 deploy_channel`,
    );
  }
});

test('CT-002：同源页面以 /api/status 为唯一取值来源，且不内置缺省渠道值', async () => {
  const { pageBody, seenTargets, elements } = await observe('canary-2026-09');

  assert.deepEqual(seenTargets, [STATUS_PATH], '页面取数目标必须恰为同源相对路径 /api/status');
  assert.equal(
    String(elements[BADGE_NODE_ID].textContent),
    'canary-2026-09',
    '同源取数后徽标文本必须为响应中的 deploy_channel 原值',
  );
  assert.ok(
    !/\bstable\b/i.test(pageBody.toString('utf8')),
    '页面源码不得内置渠道缺省字面值（默认值语义只在后端一处定义）',
  );
  assert.ok(
    !new RegExp(`id\\s*=\\s*["']${BADGE_NODE_ID}["'][^>]*\\bhidden\\b`, 'i').test(pageBody.toString('utf8')),
    '渠道徽标容器不得带 hidden 属性（必须始终展示）',
  );
});
