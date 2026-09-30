'use strict';

// WI-003 同源集成测试（交付验证入口的集成断言）：
// 经同一 host 与 port 分别取回状态页端点（GET /status.html）与状态 API（GET /api/status），
// 在服务监听期执行「端点返回页面」里的内联脚本，断言展示文本严格等于同源响应 build_commit 的前 7 个字符。
//
// 覆盖（对应 TASK-007/TASK-008/TASK-009 与 AC-011/AC-012/AC-013/AC-014/AC-015）：
// 1. TASK-007：在 Makefile 提供 verify-r2-status 目标之前，本文件的入口断言与同源断言必须失败
//    （本文件先于 Makefile 目标写入，构成「先失败测试」证据）。
// 2. TASK-008/AC-011/AC-012/AC-013：Makefile 无条件定义 verify-r2-status 目标，其唯一入口是
//    node --test，串行运行既有后端字段测试、既有前端展示测试与本同源集成测试；任一断言失败时
//    node --test 返回非 0，make 随之以非 0 退出码终止（不得吞并失败退出码）。
// 3. TASK-009/AC-014：同源端到端取数 + 监听期执行页面内联脚本 → 展示文本严格等于同源 build_commit 前 7 字符。
// 4. AC-015：相对基线核对交付改动，生产代码文件集恰为 server.js 与 Makefile 与状态页文件，
//    且不新增运行时或测试外部依赖。
//
// 证据文件（handoff_contract.required_fields）：test/status-build-commit-integration.test.js。
//
// 测试依赖仅使用 Node 内置模块（node:test / node:assert / node:fs / node:http / node:path /
// node:vm / node:child_process），不引入任何外部依赖，保持 AC-015「不新增运行时或测试外部依赖」。

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const { createServer } = require('../server');

const REPO_ROOT = path.join(__dirname, '..');
const MAKEFILE_PATH = path.join(REPO_ROOT, 'Makefile');

const PAGE_ENDPOINT = '/status.html';
const PAGE_FILE = path.join(REPO_ROOT, 'status.html');
const API_PATH = '/api/status';

const PLACEHOLDER = '\u2014'; // — U+2014 EM DASH
const SHORT_LENGTH = 7;
const BUILD_COMMIT_FIELD = 'build_commit';
const ENV_BUILD_COMMIT_KEY = 'BUILD_COMMIT';
const DEFAULT_BUILD_COMMIT = 'unknown';

// 交付验证入口（handoff_contract.required_fields）。
const VERIFY_TARGET = 'verify-r2-status';

// verify-r2-status 必须覆盖的既有行为测试与本同源集成测试。
const BACKEND_FIELD_TEST = 'test/status-build-commit.test.js';
const PAGE_DISPLAY_TEST = 'test/status-build-commit-page.test.js';
const INTEGRATION_TEST = 'test/status-build-commit-integration.test.js';
const REQUIRED_TEST_FILES = [BACKEND_FIELD_TEST, PAGE_DISPLAY_TEST, INTEGRATION_TEST];

// 页面内联脚本可写入的最小 DOM 节点集合（与 status.html 的既有 id 对齐）。
const BUILD_COMMIT_NODE_ID = 'buildCommit';
const CHANNEL_BADGE_NODE_ID = 'channelBadge';
const DOM_NODE_IDS = [
  'status',
  'uptimeSeconds',
  'version',
  BUILD_COMMIT_NODE_ID,
  CHANNEL_BADGE_NODE_ID,
  'error',
];

// /api/status 成功响应所需的既有字段（status、uptimeSeconds、deploy_channel）。
const BASE_PAYLOAD = { status: 'ok', uptimeSeconds: 12, deploy_channel: 'stable' };

// ---------------------------------------------------------------------------
// HTTP 取数与监听期服务夹具
// ---------------------------------------------------------------------------

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: requestPath },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// 在指定环境变量下启动随机端口服务，回调结束后关闭并还原环境变量。
async function withServer(env, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(env || {})) {
    saved.set(
      key,
      Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined,
    );
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Makefile 入口断言（TASK-007/AC-013）
// ---------------------------------------------------------------------------

function readMakefile() {
  assert.ok(fs.existsSync(MAKEFILE_PATH), `Makefile 必须存在（${MAKEFILE_PATH}）`);
  return fs.readFileSync(MAKEFILE_PATH, 'utf8');
}

// 提取目标声明行之后的配方（tab 起始行），忽略空行；遇到非配方行即停止。
function targetRecipe(source, target) {
  const lines = source.split(/\r?\n/);
  const declaration = new RegExp(`^${target}\\s*:(?!=)`);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (declaration.test(lines[i])) {
      start = i;
      break;
    }
  }
  assert.notEqual(start, -1, `Makefile 必须定义目标 ${target}（verify-r2-status 入口缺失即失败）`);

  const recipe = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('\t')) {
      recipe.push(line.slice(1));
      continue;
    }
    if (line.trim() === '') {
      continue;
    }
    break;
  }
  return recipe.join('\n');
}

// ---------------------------------------------------------------------------
// 最小 DOM / fetch 沙箱：在服务监听期执行「端点返回页面」的内联脚本
// ---------------------------------------------------------------------------

function createElement(id, hidden) {
  return { id, textContent: '', hidden: hidden === true, style: {}, setAttribute() {} };
}

function createDocument() {
  const elements = {};
  for (const id of DOM_NODE_IDS) {
    elements[id] = createElement(id, id === 'error');
  }
  return { elements, document: { getElementById: (id) => elements[id] || null } };
}

function inlineScripts(source) {
  const matches = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(matches.length, 1, '状态页必须恰好包含 1 个 <script> 标签');
  const [attrs, body] = [matches[0][1], matches[0][2]];
  assert.ok(!/\bsrc\s*=/i.test(attrs), '状态页的 <script> 不得带 src 外部引用');
  assert.ok(body.trim().length > 0, '状态页的内联脚本不得为空');
  return body;
}

// 同源取数：页面脚本发出的 fetch 走真实 HTTP，请求同一 host:port。
function sameOriginFetch(port) {
  const calls = [];
  const fetch = (url, init) => {
    calls.push({ url, init });
    return request(port, url).then((response) => ({
      ok: response.statusCode === 200,
      status: response.statusCode,
      json: () => Promise.resolve(JSON.parse(response.body)),
    }));
  };
  return { fetch, calls };
}

// 执行端点返回页面的内联脚本，并把 fetch 绑定到同一 host:port（同源端到端）。
function runServedPageScript(pageSource, port) {
  const { elements, document } = createDocument();
  const { fetch, calls } = sameOriginFetch(port);
  const pending = [];

  const sandbox = {
    document,
    console,
    fetch: (url, init) => {
      const promise = fetch(url, init);
      pending.push(promise);
      return promise;
    },
  };
  sandbox.window = sandbox;

  const script = inlineScripts(pageSource);
  vm.runInNewContext(script, sandbox, { filename: PAGE_ENDPOINT });

  assert.equal(calls.length, 1, '脚本解析时必须立即发起 1 次同源取数');
  assert.equal(calls[0].url, API_PATH, `取数目标必须是同源路径 ${API_PATH}`);
  assert.ok(!/^https?:\/\//i.test(calls[0].url), '取数必须是同源相对路径');
  const method = calls[0].init && calls[0].init.method;
  assert.ok(
    method === undefined || String(method).toUpperCase() === 'GET',
    '取数必须是同源 GET 请求',
  );

  return {
    elements,
    fetchCalls: calls,
    // 等服务监听期内的真实 HTTP 往返与页面 then 链全部排空。
    settle: async () => {
      await Promise.all(pending.map((promise) => promise.then(() => undefined, () => undefined)));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

// ---------------------------------------------------------------------------
// TASK-007 / TASK-008：verify-r2-status 入口与退出码语义
// ---------------------------------------------------------------------------

test('TASK-007/AC-013：Makefile 无条件定义 verify-r2-status 目标，配方以 node --test 覆盖既有后端字段测试、既有前端展示测试与同源集成测试', () => {
  const source = readMakefile();
  const recipe = targetRecipe(source, VERIFY_TARGET);

  assert.ok(recipe.trim().length > 0, `${VERIFY_TARGET} 目标必须有无条件配方`);

  // 入口为 Node 内置测试运行器，仅使用交付物自身测试文件。
  assert.match(recipe, /node\s+--test\b/, `${VERIFY_TARGET} 的入口必须是 node --test`);
  for (const file of REQUIRED_TEST_FILES) {
    assert.ok(
      recipe.includes(file),
      `${VERIFY_TARGET} 必须覆盖 ${file}（后端字段测试 / 前端展示测试 / 同源集成测试）`,
    );
  }

  // 无条件执行：声明为 .PHONY，避免被同名文件短路。
  assert.match(
    source,
    new RegExp(`^\\.PHONY\\s*:[^\\n]*\\b${VERIFY_TARGET}\\b`, 'm'),
    `${VERIFY_TARGET} 必须是无条件目标（.PHONY）`,
  );

  // 不得吞并失败退出码，也不得递归调用自身（递归会让验证入口无法终止）。
  assert.ok(!/(^|\n)\s*-\s*node\b/.test(recipe), '配方不得用前导 - 忽略失败');
  assert.ok(!/\|\|\s*true\b/.test(recipe), '配方不得用 || true 吞并失败退出码');
  assert.ok(!/\bexit\s+0\b/.test(recipe), '配方不得硬编码成功退出码');
  assert.ok(
    !new RegExp(`\\bmake\\b[^\\n]*\\b${VERIFY_TARGET}\\b`).test(recipe),
    `${VERIFY_TARGET} 配方不得递归调用自身`,
  );
});

test('TASK-008/AC-011/AC-012：make -n verify-r2-status 解析出的唯一入口是 node --test，退出码由断言结果决定', () => {
  let dryRun = '';
  try {
    dryRun = execFileSync('make', ['-n', VERIFY_TARGET], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch (error) {
    assert.fail(`无法解析 ${VERIFY_TARGET} 目标（make 入口缺失）：${error && error.message}`);
  }

  assert.match(dryRun, /node\s+--test\b/, `${VERIFY_TARGET} 解析后必须以 node --test 执行`);
  for (const file of REQUIRED_TEST_FILES) {
    assert.ok(dryRun.includes(file), `${VERIFY_TARGET} 解析后必须覆盖 ${file}`);
  }
});

// ---------------------------------------------------------------------------
// TASK-009 / AC-014：同源集成端到端断言
// ---------------------------------------------------------------------------

test('AC-014：经同一 host 与 port 取回状态页与状态 API，并在监听期执行页面内联脚本时展示文本严格等于同源 build_commit 前 7 个字符', async () => {
  await withServer({ [ENV_BUILD_COMMIT_KEY]: undefined }, async (port) => {
    const samples = [
      'abcdef1234567890',
      'abcdef1',
      'abc',
      'a',
      'abcdef1234567890abcdef1234567890abcdef12',
    ];

    for (const value of samples) {
      process.env[ENV_BUILD_COMMIT_KEY] = value;

      const page = await request(port, PAGE_ENDPOINT);
      assert.equal(page.statusCode, 200, 'GET /status.html 必须返回 200');
      assert.ok(
        /^text\/html/i.test(String(page.headers['content-type'])),
        '状态页端点必须以 text/html 返回页面',
      );

      const api = await request(port, API_PATH);
      assert.equal(api.statusCode, 200, 'GET /api/status 必须返回 200');
      assert.ok(
        /^application\/json/i.test(String(api.headers['content-type'])),
        '状态 API 端点必须以 application/json 返回',
      );
      const payload = JSON.parse(api.body);

      // 同一 host:port 上的两次取回：页面来源即端点返回内容。
      assert.equal(payload[BUILD_COMMIT_FIELD], value, '后端必须原值透出 BUILD_COMMIT');

      const { elements, fetchCalls, settle } = runServedPageScript(page.body, port);
      assert.equal(fetchCalls[0].url, API_PATH, '监听期执行的内联脚本必须走同源 API 路径');
      await settle();

      assert.equal(
        String(elements[BUILD_COMMIT_NODE_ID].textContent),
        payload[BUILD_COMMIT_FIELD].slice(0, SHORT_LENGTH),
        `AC-014：build_commit=${JSON.stringify(value)} 时展示文本必须严格等于同源响应前 7 个字符`,
      );
      assert.notEqual(
        elements[BUILD_COMMIT_NODE_ID].hidden,
        true,
        '构建提交展示元素必须始终渲染且可见',
      );
    }

    // 缺省语义：BUILD_COMMIT 未设置时后端透出 unknown，展示文本为 unknown 的短哈希。
    delete process.env[ENV_BUILD_COMMIT_KEY];
    const page = await request(port, PAGE_ENDPOINT);
    const api = await request(port, API_PATH);
    const payload = JSON.parse(api.body);
    assert.equal(payload[BUILD_COMMIT_FIELD], DEFAULT_BUILD_COMMIT);

    const { elements, settle } = runServedPageScript(page.body, port);
    await settle();

    assert.equal(
      String(elements[BUILD_COMMIT_NODE_ID].textContent),
      DEFAULT_BUILD_COMMIT.slice(0, SHORT_LENGTH),
      'AC-014：后端缺省值必须原样取前 7 个字符展示',
    );
    assert.notEqual(elements[BUILD_COMMIT_NODE_ID].hidden, true, '展示元素必须始终渲染且可见');
  });
});

test('AC-014：监听期执行内联脚本期间可改 BUILD_COMMIT，展示文本始终跟随同源响应（无需重启）', async () => {
  await withServer({ [ENV_BUILD_COMMIT_KEY]: 'first-commit' }, async (port) => {
    const firstPage = await request(port, PAGE_ENDPOINT);
    const firstApi = JSON.parse((await request(port, API_PATH)).body);
    const first = runServedPageScript(firstPage.body, port);
    await first.settle();
    assert.equal(
      String(first.elements[BUILD_COMMIT_NODE_ID].textContent),
      firstApi[BUILD_COMMIT_FIELD].slice(0, SHORT_LENGTH),
      '运行期改前必须与同源响应一致',
    );

    process.env[ENV_BUILD_COMMIT_KEY] = 'second-commit';
    const secondPage = await request(port, PAGE_ENDPOINT);
    const secondApi = JSON.parse((await request(port, API_PATH)).body);
    const second = runServedPageScript(secondPage.body, port);
    await second.settle();

    assert.equal(
      String(second.elements[BUILD_COMMIT_NODE_ID].textContent),
      secondApi[BUILD_COMMIT_FIELD].slice(0, SHORT_LENGTH),
      '运行期改 BUILD_COMMIT 后必须与新的同源响应一致',
    );
    assert.equal(String(first.elements[BUILD_COMMIT_NODE_ID].textContent), 'first-c');
    assert.equal(String(second.elements[BUILD_COMMIT_NODE_ID].textContent), 'second-');
  });
});

// ---------------------------------------------------------------------------
// AC-015：生产代码文件集与依赖面
// ---------------------------------------------------------------------------

test('AC-015：生产代码文件集恰为 server.js 与 Makefile 与状态页文件', () => {
  const rootFiles = fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const jsFiles = rootFiles.filter((name) => /\.(?:js|mjs|cjs)$/.test(name)).sort();
  assert.deepEqual(jsFiles, ['server.js'], '生产 JavaScript 文件必须恰为 server.js');

  const htmlFiles = rootFiles.filter((name) => /\.html?$/.test(name)).sort();
  assert.deepEqual(htmlFiles, ['status.html'], '生产状态页文件必须恰为 status.html');

  assert.ok(rootFiles.includes('Makefile'), '交付必须包含 Makefile（verify-r2-status 入口）');
  assert.ok(fs.existsSync(PAGE_FILE), `状态页文件必须存在（${PAGE_FILE}）`);

  // 不得新增运行时/测试外部依赖。
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const block = pkg[key];
    assert.ok(
      block === undefined || Object.keys(block).length === 0,
      `package.json 不得新增 ${key}`,
    );
  }

  // 生产入口与测试文件只允许依赖 Node 内置模块或相对路径。
  const testDir = path.join(REPO_ROOT, 'test');
  const testFiles = fs
    .readdirSync(testDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(testDir, name));
  const sources = [path.join(REPO_ROOT, 'server.js'), ...testFiles];

  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const specifier = match[1];
      assert.ok(
        specifier.startsWith('node:') || specifier.startsWith('.') || specifier.startsWith('/'),
        `${path.relative(REPO_ROOT, file)} 不得依赖外部包，实际依赖：${specifier}`,
      );
    }
  }
});

test('AC-015：状态页不新增 footer 元素且构建提交展示元素存在于端点返回页面', async () => {
  await withServer({}, async (port) => {
    const page = await request(port, PAGE_ENDPOINT);
    assert.equal(page.statusCode, 200);
    assert.ok(!/<footer\b/i.test(page.body), '状态页不得含 footer 元素');
    assert.ok(
      page.body.includes(`id="${BUILD_COMMIT_NODE_ID}"`),
      `端点返回页面必须含构建提交展示元素 #${BUILD_COMMIT_NODE_ID}`,
    );
    assert.equal(
      page.body,
      fs.readFileSync(PAGE_FILE, 'utf8'),
      '端点返回页面必须与状态页交付内容一致',
    );
  });
});

test('AC-014 基线对齐：占位符口径为 U+2014，短哈希长度口径为 7', () => {
  assert.equal(PLACEHOLDER, '\u2014');
  assert.equal(SHORT_LENGTH, 7);
  assert.equal(DEFAULT_BUILD_COMMIT.slice(0, SHORT_LENGTH), 'unknown');
  assert.equal(
    Object.prototype.hasOwnProperty.call(BASE_PAYLOAD, BUILD_COMMIT_FIELD),
    false,
    '既有字段基线集合不含 build_commit（新增字段必须由后端补齐）',
  );
});
