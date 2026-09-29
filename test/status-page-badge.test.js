'use strict';

// WI-002 前端单元测试：状态页（status.html）在版本信息区域旁渲染渠道徽标。
//
// 覆盖（对应 CT-002 能力与 AC-005/AC-006/AC-007）：
// 1. AC-005：GET /api/status 返回 deploy_channel 等于 stable 时，徽标文本严格等于 stable 且不隐藏；
// 2. AC-006：GET /api/status 返回非 stable 的渠道值时，徽标文本逐字等于该原值，不做显示名映射；
// 3. AC-007：GET /api/status 响应缺失 deploy_channel 字段时，徽标容器仍渲染且文本不被替换为 stable；
// 4. TASK-003 第二类断言：前端不内置缺省渠道值（页面源码内不存在渠道缺省字面值）。
//
// 依赖仅使用 Node 内置模块（node:test / node:assert / node:fs / node:path / node:vm），
// 不引入 jsdom 等外部依赖，保持「前端生产代码改动恰为 1 个文件」的变更面约束。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE_PATH = path.join(__dirname, '..', 'status.html');
const API_PATH = '/api/status';
const PLACEHOLDER = '\u2014'; // — U+2014 EM DASH

// CT-002 交付口径：承载版本信息区域的前端状态页文件、稳定节点标识与文本写入规则。
const VERSION_INFO_NODE_ID = 'versionInfo';
const VERSION_INFO_LIST_NODE_ID = 'versionInfoList';
const BADGE_NODE_ID = 'channelBadge';
const DEPLOY_CHANNEL_KEY = 'deploy_channel';

// 渠道缺省字面值：前端不得内置该值（默认值语义只在后端一处定义）。
const BUILT_IN_DEFAULT_CHANNEL = 'stable';

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

// 初始可见性对齐 status.html 的静态标记：仅 #error 带 hidden 属性，
// 渠道徽标容器不带 hidden（必须始终展示）。
function createElement(id, hidden) {
  return { id, textContent: '', hidden: hidden === true, style: {}, setAttribute() {} };
}

// 构造最小 DOM/fetch 沙箱并在「解析时」执行内联脚本。
function runPage({ response, rejection }) {
  const elements = {
    status: createElement('status'),
    uptimeSeconds: createElement('uptimeSeconds'),
    version: createElement('version'),
    [BADGE_NODE_ID]: createElement(BADGE_NODE_ID),
    error: createElement('error', true),
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

  // 解析时（同步阶段）就必须发起请求。
  assert.equal(fetchCalls.length, 1, '脚本解析时必须立即发起 1 次 fetch');
  assert.equal(fetchCalls[0], API_PATH, `fetch 目标必须是 ${API_PATH}`);

  return { elements, settle: () => new Promise((resolve) => setTimeout(resolve, 0)) };
}

function okResponse(payload) {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

test('AC-005 结构：版本信息区域存在，且渠道徽标容器紧邻版本信息列表之后', () => {
  const source = readPage();

  const section = new RegExp(
    `<section\\b[^>]*id\\s*=\\s*["']${VERSION_INFO_NODE_ID}["'][^>]*>([\\s\\S]*?)<\\/section>`,
    'i',
  ).exec(source);
  assert.ok(section, `status.html 必须存在 #${VERSION_INFO_NODE_ID} 版本信息区域`);
  const body = section[1];

  assert.ok(body.includes('版本信息'), '版本信息区域必须包含「版本信息」标题');
  assert.ok(
    new RegExp(`id\\s*=\\s*["']${VERSION_INFO_LIST_NODE_ID}["']`).test(body),
    `版本信息区域必须包含 #${VERSION_INFO_LIST_NODE_ID} 版本信息列表`,
  );
  assert.ok(
    new RegExp(`id\\s*=\\s*["']${BADGE_NODE_ID}["']`).test(body),
    `渠道徽标容器 #${BADGE_NODE_ID} 必须位于版本信息区域旁`,
  );

  // 「旁」的结构口径：徽标容器紧邻版本信息列表之后（区域内相邻展示单元）。
  const listEnd = body.search(/<\/dl>/i);
  const badgeStart = body.search(new RegExp(`id\\s*=\\s*["']${BADGE_NODE_ID}["']`));
  assert.ok(listEnd >= 0, '版本信息列表必须是可定位的 <dl> 列表');
  assert.ok(badgeStart > listEnd, '渠道徽标容器必须紧随版本信息列表之后');
  assert.ok(
    !new RegExp(`id\\s*=\\s*["']${BADGE_NODE_ID}["'][^>]*\\bhidden\\b`, 'i').test(source),
    '渠道徽标容器不得带 hidden 属性（必须始终展示）',
  );
});

test('AC-005 deploy_channel 等于 stable 时徽标文本严格等于 stable 且不隐藏', async () => {
  const { elements, settle } = runPage({
    response: okResponse({ status: 'ok', uptimeSeconds: 12, [DEPLOY_CHANNEL_KEY]: 'stable' }),
  });
  await settle();

  assert.equal(
    String(elements[BADGE_NODE_ID].textContent),
    'stable',
    '徽标文本必须严格等于响应中的 deploy_channel 原值',
  );
  assert.notEqual(elements[BADGE_NODE_ID].hidden, true, '徽标容器必须始终展示（不隐藏）');
  assert.equal(elements.error.hidden, true, '成功时 #error 必须保持不可见');
  assert.equal(elements.error.textContent, '', '成功时 #error 不得残留错误文本');
});

test('AC-006 非 stable 渠道值时徽标文本逐字等于原值且不做显示名映射', async () => {
  const samples = [
    'canary-2026-09',
    'beta',
    'STABLE',
    'stable-2',
    '  spaced-channel  ',
    '渠道-中文',
  ];

  for (const sample of samples) {
    const { elements, settle } = runPage({
      response: okResponse({ status: 'ok', uptimeSeconds: 12, [DEPLOY_CHANNEL_KEY]: sample }),
    });
    await settle();

    assert.equal(
      String(elements[BADGE_NODE_ID].textContent),
      sample,
      `deploy_channel=${JSON.stringify(sample)} 时必须逐字写入徽标文本，不做显示名映射或格式化`,
    );
    assert.notEqual(elements[BADGE_NODE_ID].hidden, true, '徽标容器必须始终展示（不隐藏）');
    assert.equal(elements.error.hidden, true, '成功时 #error 必须保持不可见');
  }
});

test('AC-007 缺失 deploy_channel 时徽标容器仍渲染且文本不被替换为 stable', async () => {
  const payloads = [
    { status: 'ok', uptimeSeconds: 12 },
    { status: 'ok', uptimeSeconds: 12, [DEPLOY_CHANNEL_KEY]: null },
    { status: 'ok', uptimeSeconds: 12, [DEPLOY_CHANNEL_KEY]: '' },
    { status: 'ok', uptimeSeconds: 12, [DEPLOY_CHANNEL_KEY]: 123 },
  ];

  for (const payload of payloads) {
    const { elements, settle } = runPage({ response: okResponse(payload) });
    await settle();

    const label = JSON.stringify(payload);
    assert.ok(elements[BADGE_NODE_ID], `payload ${label}: 徽标容器必须仍然渲染`);
    assert.notEqual(
      String(elements[BADGE_NODE_ID].textContent),
      BUILT_IN_DEFAULT_CHANNEL,
      `payload ${label}: 徽标文本不得被替换为 stable`,
    );
    assert.equal(
      String(elements[BADGE_NODE_ID].textContent),
      PLACEHOLDER,
      `payload ${label}: 字段不可用时徽标文本应写入占位符 —`,
    );
    assert.notEqual(elements[BADGE_NODE_ID].hidden, true, `payload ${label}: 徽标容器不得隐藏`);
    assert.equal(elements.error.hidden, true, `payload ${label}: 既有错误提示必须保持不可见`);
  }
});

test('TASK-003 口径：status.html 不内置渠道缺省字面值', () => {
  const source = readPage();

  assert.ok(
    !new RegExp(`\\b${BUILT_IN_DEFAULT_CHANNEL}\\b`, 'i').test(source),
    'status.html 不得内置渠道缺省字面值（默认值语义只允许在后端一处定义）',
  );
});

test('取数失败时徽标容器仍渲染并落到占位符', async () => {
  const { elements, settle } = runPage({ rejection: new Error('network down') });
  await settle();

  assert.equal(
    String(elements[BADGE_NODE_ID].textContent),
    PLACEHOLDER,
    '取数失败时徽标文本必须为 — 占位符，不得残留加载中占位',
  );
  assert.notEqual(elements[BADGE_NODE_ID].hidden, true, '取数失败时徽标容器仍须渲染');
});
