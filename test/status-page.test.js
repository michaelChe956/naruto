'use strict';

// 验收测试：status.html 单文件状态页
// 覆盖 AC-001（单文件/无外部资源）、AC-002（解析时请求 /api/status 并渲染原值）、
// AC-003（取数失败或数据不合法时的错误分支）、
// AC-006（既有状态项列表区域存在「最近部署」展示项且取数目标仍为 /api/status）、
// AC-007（last_deployed_at 为合法 RFC3339 时逐字写入展示项、不做格式化改写）、
// AC-008（last_deployed_at 为 null 或键缺失时写入占位符 — 且既有错误提示保持不可见）。
// 依赖仅使用 Node 内置模块，避免引入 jsdom 等外部依赖。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE_PATH = path.join(__dirname, '..', 'status.html');
const API_PATH = '/api/status';
const PLACEHOLDER = '\u2014'; // — U+2014 EM DASH

// 「最近部署」展示项的交付契约（CT-002）：稳定节点标识与文本写入规则。
const DEPLOYED_LABEL = '最近部署';
const DEPLOYED_NODE_ID = 'lastDeployedAt';

function readPage() {
  assert.ok(fs.existsSync(PAGE_PATH), 'status.html 必须存在');
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

function inlineScripts(source) {
  const matches = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(matches.length, 1, 'status.html 必须恰好包含 1 个 <script> 标签');
  const [attrs, body] = [matches[0][1], matches[0][2]];
  assert.ok(!/\bsrc\s*=/i.test(attrs), 'status.html 的 <script> 不得带 src 外部引用');
  assert.ok(body.trim().length > 0, 'status.html 的内联脚本不得为空');
  return body;
}

function createElement(id) {
  return { id, textContent: '', hidden: true, style: {}, setAttribute() {} };
}

// 构造最小 DOM/fetch 沙箱并在"解析时"执行内联脚本。
function runPage({ response, rejection }) {
  const elements = {
    status: createElement('status'),
    uptimeSeconds: createElement('uptimeSeconds'),
    lastDeployedAt: createElement(DEPLOYED_NODE_ID),
    error: createElement('error'),
  };
  const fetchCalls = [];

  const sandbox = {
    document: { getElementById: (id) => elements[id] || null },
    console,
    fetch: (url) => {
      fetchCalls.push(url);
      if (rejection) return Promise.reject(rejection);
      return Promise.resolve(response);
    },
  };
  sandbox.window = sandbox;

  const script = inlineScripts(readPage());
  vm.runInNewContext(script, sandbox, { filename: 'status.html' });

  // 解析时（同步阶段）就必须发起请求 —— AC-002
  assert.equal(fetchCalls.length, 1, '脚本解析时必须立即发起 1 次 fetch');
  assert.equal(fetchCalls[0], API_PATH, `fetch 目标必须是 ${API_PATH}`);

  return { elements, settle: () => new Promise((resolve) => setTimeout(resolve, 0)) };
}

function okResponse(payload) {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

test('AC-001 单文件且不含任何外部资源引用', () => {
  const source = readPage();
  const forbidden = [
    { pattern: /<link\b/i, label: '<link> 外部资源引用' },
    { pattern: /<script\b[^>]*\bsrc\s*=/i, label: '<script src> 外部脚本' },
    { pattern: /<img\b/i, label: '<img> 图片资源' },
    { pattern: /@import\b/i, label: 'CSS @import' },
    { pattern: /url\s*\(\s*['"]?(?:https?:)?\/\//i, label: 'CSS url() 绝对地址' },
    { pattern: /https?:\/\//i, label: '绝对 URL（外部请求/构建产物）' },
    { pattern: /(src|href)\s*=\s*['"][^'"]*\.(?:js|css|woff2?|ttf|png|jpe?g|svg|gif)['"]/i, label: '构建产物路径引用' },
  ];
  for (const { pattern, label } of forbidden) {
    assert.ok(!pattern.test(source), `禁止出现${label}: ${pattern}`);
  }

  inlineScripts(source); // 唯一 <script> 且为内联

  // CHECK-002：三个节点存在，#error 默认不可见
  for (const id of ['status', 'uptimeSeconds', 'error']) {
    assert.ok(
      new RegExp(`id\\s*=\\s*["']${id}["']`).test(source),
      `status.html 必须存在 #${id} 节点`,
    );
  }
  assert.ok(
    /id\s*=\s*["']error["'][^>]*\bhidden\b|\bhidden\b[^>]*id\s*=\s*["']error["']/i.test(source),
    '#error 默认必须不可见（hidden）',
  );
  assert.ok(
    !/\bstyle\s*=\s*["'][^"']*display\s*:\s*(?!none)/i.test(source),
    '不得用内联 style 覆盖 #error 的默认隐藏状态',
  );
});

test('AC-002 成功路径：把 status 与 uptimeSeconds 原值写入对应节点', async () => {
  const { elements, settle } = runPage({ response: okResponse({ status: 'ok', uptimeSeconds: 123 }) });
  await settle();

  assert.equal(String(elements.status.textContent), 'ok', '#status 必须写入原始 status 值');
  assert.equal(String(elements.uptimeSeconds.textContent), '123', '#uptimeSeconds 必须写入原始 uptimeSeconds 值');
  assert.equal(elements.error.hidden, true, '成功时 #error 必须保持不可见');
  assert.equal(elements.error.textContent, '', '成功时 #error 不得残留错误文本');
});

test('AC-002 成功路径：原值不做格式化或改写', async () => {
  const { elements, settle } = runPage({
    response: okResponse({ status: 'degraded', uptimeSeconds: 98765.5 }),
  });
  await settle();

  assert.equal(String(elements.status.textContent), 'degraded');
  assert.equal(String(elements.uptimeSeconds.textContent), '98765.5');
});

test('AC-003 网络失败：两位数值替换为 — 且 #error 显示可见错误文本', async () => {
  const { elements, settle } = runPage({ rejection: new Error('network down') });
  await settle();

  assert.equal(String(elements.status.textContent), PLACEHOLDER, '失败时 #status 必须为 —');
  assert.equal(String(elements.uptimeSeconds.textContent), PLACEHOLDER, '失败时 #uptimeSeconds 必须为 —');
  assert.equal(elements.error.hidden, false, '失败时 #error 必须可见');
  assert.ok(elements.error.textContent.trim().length > 0, '失败时 #error 必须显示错误文本');
  assert.ok(!elements.error.textContent.includes('加载中'), '#error 不得为加载中占位');
});

test('AC-003 响应不合法（HTTP 非 2xx）：走错误分支', async () => {
  const { elements, settle } = runPage({
    response: { ok: false, status: 500, json: () => Promise.resolve({ status: 'ok', uptimeSeconds: 1 }) },
  });
  await settle();

  assert.equal(String(elements.status.textContent), PLACEHOLDER);
  assert.equal(String(elements.uptimeSeconds.textContent), PLACEHOLDER);
  assert.equal(elements.error.hidden, false);
  assert.ok(elements.error.textContent.trim().length > 0);
});

// —— 「最近部署」（last_deployed_at）展示项：AC-006 / AC-007 / AC-008 ——

test('AC-006 「最近部署」展示项位于既有状态项列表区域内且带稳定节点标识，取数目标仍为 /api/status', () => {
  const source = readPage();

  const listMatch = /<dl\b[^>]*>([\s\S]*?)<\/dl>/i.exec(source);
  assert.ok(listMatch, 'status.html 必须保留既有状态项列表区域 <dl>');
  const list = listMatch[1];
  assert.ok(list.includes(DEPLOYED_LABEL), `<dl> 内必须存在「${DEPLOYED_LABEL}」展示项`);
  assert.ok(
    new RegExp(`id\\s*=\\s*["']${DEPLOYED_NODE_ID}["']`).test(list),
    `「${DEPLOYED_LABEL}」展示项必须位于 <dl> 内且带 #${DEPLOYED_NODE_ID} 节点标识`,
  );

  // 取数目标不变：解析时仍只发起 1 次 /api/status 请求，且展示项节点可被写入。
  const { elements } = runPage({
    response: okResponse({ status: 'ok', uptimeSeconds: 1, last_deployed_at: null }),
  });
  assert.ok(elements[DEPLOYED_NODE_ID], `status.html 必须提供 #${DEPLOYED_NODE_ID} 节点供文本写入`);
});

test('AC-007 last_deployed_at 为合法 RFC3339 时逐字写入展示项且不做格式化改写，#error 保持不可见', async () => {
  const samples = [
    '2026-09-27T16:00:00Z',
    '2026-09-27T16:00:00.123456Z',
    '2026-09-27T23:59:59+08:00',
    '2024-02-29T00:00:00-05:30',
  ];

  for (const sample of samples) {
    const { elements, settle } = runPage({
      response: okResponse({ status: 'ok', uptimeSeconds: 12, last_deployed_at: sample }),
    });
    await settle();

    assert.equal(
      String(elements[DEPLOYED_NODE_ID].textContent),
      sample,
      `last_deployed_at=${sample} 时必须逐字写入展示项，不做格式化改写`,
    );
    assert.equal(elements.error.hidden, true, `last_deployed_at=${sample} 时 #error 必须保持不可见`);
    assert.equal(elements.error.textContent, '', `last_deployed_at=${sample} 时 #error 不得残留错误文本`);
  }
});

test('AC-008 last_deployed_at 为 null、键缺失或空字符串时写入占位符 — 且既有错误提示保持不可见', async () => {
  const payloads = [
    { status: 'ok', uptimeSeconds: 12, last_deployed_at: null },
    { status: 'ok', uptimeSeconds: 12 },
    { status: 'ok', uptimeSeconds: 12, last_deployed_at: '' },
  ];

  for (const payload of payloads) {
    const { elements, settle } = runPage({ response: okResponse(payload) });
    await settle();

    const label = JSON.stringify(payload);
    assert.equal(
      String(elements[DEPLOYED_NODE_ID].textContent),
      PLACEHOLDER,
      `payload ${label}: 「${DEPLOYED_LABEL}」展示项必须写出占位符 —`,
    );
    assert.equal(elements.error.hidden, true, `payload ${label}: 既有错误提示必须保持不可见`);
    assert.equal(elements.error.textContent, '', `payload ${label}: #error 不得残留错误文本`);
    assert.equal(String(elements.status.textContent), 'ok', `payload ${label}: #status 仍须写入原值`);
    assert.equal(
      String(elements.uptimeSeconds.textContent),
      '12',
      `payload ${label}: #uptimeSeconds 仍须写入原值`,
    );
  }
});

test('AC-003 取数失败时「最近部署」展示项同样落到 — 占位符', async () => {
  const { elements, settle } = runPage({ rejection: new Error('network down') });
  await settle();

  assert.equal(
    String(elements[DEPLOYED_NODE_ID].textContent),
    PLACEHOLDER,
    '取数失败时展示项必须为 — 占位符，不得残留加载中…',
  );
});

test('AC-003 响应数据不合法：缺字段/类型错误时走错误分支', async () => {
  const invalidPayloads = [
    null,
    {},
    { status: 'ok' },
    { uptimeSeconds: 12 },
    { status: 123, uptimeSeconds: 12 },
    { status: 'ok', uptimeSeconds: '12' },
    { status: 'ok', uptimeSeconds: NaN },
    { status: '', uptimeSeconds: 12 },
  ];

  for (const payload of invalidPayloads) {
    const { elements, settle } = runPage({ response: okResponse(payload) });
    await settle();

    const label = JSON.stringify(payload);
    assert.equal(String(elements.status.textContent), PLACEHOLDER, `payload ${label}: #status 必须为 —`);
    assert.equal(String(elements.uptimeSeconds.textContent), PLACEHOLDER, `payload ${label}: #uptimeSeconds 必须为 —`);
    assert.equal(elements.error.hidden, false, `payload ${label}: #error 必须可见`);
    assert.ok(
      !String(elements.status.textContent).includes('加载中') &&
        !String(elements.uptimeSeconds.textContent).includes('加载中'),
      `payload ${label}: 不得残留加载中占位`,
    );
  }
});
