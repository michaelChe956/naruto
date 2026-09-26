'use strict';

// 集成测试：五子棋页面与两个共享逻辑模块的同源静态取回（TASK-011 / REQ-012）。
//
// 覆盖范围：
//   AC-020 —— 以临时端口启动服务，GET /gomoku.html、/gomoku-rules.js、/gomoku-ai.js 均返回 200，
//             content-type 分别为 text/html 与 text/javascript；白名单外路径返回 404 且不返回文件内容。
//   AC-021 —— 页面仅通过全局名 GomokuRules / GomokuAI 引用两个共享模块，且不内联判胜扫描实现。
//
// 依赖仅使用 Node 内置模块（node:test、node:assert、node:http、node:fs、node:path、node:vm）。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.join(__dirname, '..', '..');
const SERVER_PATH = path.join(ROOT_DIR, 'server.js');

const PAGE_FILE = 'gomoku.html';
const RULES_FILE = 'gomoku-rules.js';
const AI_FILE = 'gomoku-ai.js';

// 三条静态路径的期望契约：请求路径 -> 根目录文件 + content-type（CT-003 / CT-004）。
const STATIC_ROUTE_CONTRACT = [
  { requestPath: `/${PAGE_FILE}`, file: PAGE_FILE, contentType: /^text\/html\b/ },
  { requestPath: `/${RULES_FILE}`, file: RULES_FILE, contentType: /^text\/javascript\b/ },
  { requestPath: `/${AI_FILE}`, file: AI_FILE, contentType: /^text\/javascript\b/ },
];

// 白名单外路径：一律 404 且不得回任何文件内容。
const FORBIDDEN_PATHS = [
  '/package.json',
  '/server.js',
  '/tests/integration/gomoku-page.test.js',
  '/api/state',
  '/api/gomoku',
  '/unknown.txt',
  '/gomoku.html.bak',
  '/sub/gomoku.html',
  '/../package.json',
  '/..%2Fpackage.json',
  '/constructor',
  '/toString',
];

// 判胜扫描实现检测器：先用 gomoku-rules.js 作为正样本证明每个检测器确实能命中真实判胜扫描，
// 再要求页面的内联脚本对这些模式全部不命中，避免“永远为真”的无效否定断言。
const WIN_SCAN_DETECTORS = [
  { name: '五连阈值常量 WIN_LENGTH', pattern: /\bWIN_LENGTH\b/ },
  { name: '四个扫描方向表 DIRECTIONS', pattern: /\bDIRECTIONS\b/ },
  { name: '沿用方向步进的扫描循环', pattern: /\bfor\s*\(\s*const\s+\[\s*rowStep\s*,\s*colStep\s*\]/ },
  { name: '连续长度累加 length += 1', pattern: /\blength\s*\+=\s*1\b/ },
  { name: '长度阈值判定 >= WIN_LENGTH', pattern: />=\s*WIN_LENGTH\b/ },
  { name: '连续段判胜 hasConsecutiveWin', pattern: /\bhasConsecutiveWin\b/ },
  { name: '胜负聚合 findWinner', pattern: /\bfindWinner\b/ },
  { name: '满盘扫描 isBoardFull', pattern: /\bisBoardFull\b/ },
  { name: '越界检查 isInside(', pattern: /\bisInside\s*\(/ },
];

// 落子决策实现检测器：正样本为 gomoku-ai.js（决策的唯一实现）。
const AI_DECISION_DETECTORS = [
  { name: '决策入口 chooseMove', pattern: /\bfunction\s+chooseMove\b/ },
  { name: '一步成五扫描 findFivePoint', pattern: /\bfunction\s+findFivePoint\b/ },
  { name: '空点收集 collectEmptyPoints', pattern: /\bfunction\s+collectEmptyPoints\b/ },
  { name: '随机选点 pickRandomPoint', pattern: /\bfunction\s+pickRandomPoint\b/ },
];

// 直接 require 会在缺少实现时抛出；这里安全加载，让缺失契约以逐条断言的形式失败。
let serverModule;
try {
  serverModule = require(SERVER_PATH);
} catch (error) {
  serverModule = {};
}

const { startServer, STATIC_ROUTES } = serverModule;

function assertServerContract() {
  assert.equal(typeof startServer, 'function', 'server.js 应导出 startServer(port)');
  assert.ok(
    STATIC_ROUTES && typeof STATIC_ROUTES === 'object',
    'server.js 应导出白名单映射 STATIC_ROUTES',
  );
}

function readRootFile(fileName) {
  return fs.readFileSync(path.join(ROOT_DIR, fileName), 'utf8');
}

// 临时端口（port 0）启动服务：由操作系统分配空闲端口，用例之间互不争用固定端口。
async function withTempServer(run) {
  assertServerContract();
  const started = await startServer(0);
  const { server, url } = started;
  assert.ok(
    Number.isInteger(started.port) && started.port > 0 && started.port <= 65535,
    'startServer(0) 应由操作系统分配合法临时端口',
  );
  try {
    await run({ url, port: started.port });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function httpRequest(target, method) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.path,
        method: method || 'GET',
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function getFromServer(origin, requestPath, method) {
  const url = new URL(requestPath, origin);
  return httpRequest(
    { hostname: url.hostname, port: Number(url.port), path: `${url.pathname}${url.search}` },
    method,
  );
}

// 提取页面里的 <script src="...">，按出现顺序返回 src，用于验证同源引用。
function extractScriptSrcs(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]*)"[^>]*>/gi)].map((match) => match[1]);
}

// 提取页面里所有无 src 的内联 <script> 内容并拼接，用于验证“只调用共享实现、不内联实现”。
function extractInlineScripts(html) {
  const inline = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/i.test(match[1])) {
      inline.push(match[2]);
    }
  }
  return inline.join('\n');
}

// 浏览器式全局环境：无 module/exports/require，只有 window 指向全局，逼出脚本的全局名挂载分支。
function createBrowserLikeContext() {
  const context = vm.createContext({});
  context.window = context;
  context.setTimeout = () => 0;
  context.clearTimeout = () => {};
  return context;
}

function assertSameOrigin(src, pageUrl) {
  assert.doesNotMatch(src, /^(?:[a-z][a-z0-9+.-]*:)?\/\//i, `脚本引用 ${src} 不得指向外部来源`);
  const resolved = new URL(src, pageUrl);
  assert.equal(resolved.origin, pageUrl.origin, `脚本引用 ${src} 必须与页面同源`);
  return resolved;
}

describe('AC-020 临时端口启动服务并同源取回页面与两个共享逻辑模块', () => {
  it('三条静态路径均返回 200，content-type 分别为 text/html 与 text/javascript，正文与根目录文件一致', async () => {
    await withTempServer(async ({ url }) => {
      for (const route of STATIC_ROUTE_CONTRACT) {
        const res = await getFromServer(url, route.requestPath);
        assert.equal(res.status, 200, `${route.requestPath} 应返回状态码 200`);
        assert.match(
          res.headers['content-type'],
          route.contentType,
          `${route.requestPath} 的 content-type 应匹配 ${route.contentType}`,
        );
        const expected = readRootFile(route.file);
        assert.ok(expected.length > 0, `${route.file} 不应为空文件`);
        assert.equal(res.body, expected, `${route.requestPath} 应返回 ${route.file} 的完整内容`);
      }
    });
  });

  it('页面以相对同源 URL 引用两个共享模块，且两个模块都能同源取回完整实现', async () => {
    await withTempServer(async ({ url }) => {
      const pageUrl = new URL(`/${PAGE_FILE}`, url);
      const page = await getFromServer(url, pageUrl.pathname);
      assert.equal(page.status, 200, '页面路由应返回 200');

      const srcs = extractScriptSrcs(page.body);
      assert.deepEqual(
        srcs,
        [RULES_FILE, AI_FILE],
        '页面应恰好按顺序以相对路径引用 gomoku-rules.js 与 gomoku-ai.js',
      );

      for (const src of srcs) {
        const resolved = assertSameOrigin(src, pageUrl);
        const res = await getFromServer(url, `${resolved.pathname}${resolved.search}`);
        assert.equal(res.status, 200, `${resolved.pathname} 应可同源取回并返回 200`);
        assert.match(res.headers['content-type'], /^text\/javascript\b/, `${resolved.pathname} 应为 JavaScript`);
        assert.equal(
          res.body,
          readRootFile(path.basename(resolved.pathname)),
          `${resolved.pathname} 的正文应与根目录共享实现一致`,
        );
      }
    });
  });

  it('按页面顺序在浏览器式全局环境执行两个取回模块后，页面引用的全局名可用且提供判胜与决策能力', async () => {
    await withTempServer(async ({ url }) => {
      const pageUrl = new URL(`/${PAGE_FILE}`, url);
      const page = await getFromServer(url, pageUrl.pathname);
      assert.equal(page.status, 200, '页面路由应返回 200');

      const loadedModules = [];
      const moduleGlobalNames = new Set();
      for (const src of extractScriptSrcs(page.body)) {
        const resolved = assertSameOrigin(src, pageUrl);
        const res = await getFromServer(url, `${resolved.pathname}${resolved.search}`);
        assert.equal(res.status, 200, `${resolved.pathname} 应可同源取回并返回 200`);
        const declaredGlobals = [...res.body.matchAll(/\broot\.([A-Za-z_$][\w$]*)\s*=/g)].map((match) => match[1]);
        assert.ok(
          declaredGlobals.length > 0,
          `${resolved.pathname} 应以 root.<全局名> 形式挂载浏览器全局引用`,
        );
        for (const name of declaredGlobals) {
          moduleGlobalNames.add(name);
        }
        loadedModules.push({ modulePath: resolved.pathname, body: res.body, declaredGlobals });
      }
      assert.equal(loadedModules.length, 2, '页面应引用两个共享逻辑模块');

      const inlineScript = extractInlineScripts(page.body);
      const referencedGlobals = new Set(
        [...inlineScript.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\b/g)].map((match) => match[1]),
      );
      const pageAssignedGlobals = new Set(
        [...inlineScript.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)].map((match) => match[1]),
      );
      assert.ok(referencedGlobals.size > 0, '页面内联脚本应通过 window.<全局名> 引用共享模块');
      // 页面允许直接使用的浏览器平台全局；其余 window.X 必须来自两个共享模块或页面自身定义。
      const PLATFORM_GLOBALS = new Set(['setTimeout', 'clearTimeout', 'requestAnimationFrame']);
      for (const globalName of referencedGlobals) {
        assert.ok(
          moduleGlobalNames.has(globalName)
            || pageAssignedGlobals.has(globalName)
            || PLATFORM_GLOBALS.has(globalName),
          `页面引用的 window.${globalName} 只应来自两个共享模块、页面自身定义或浏览器平台`,
        );
      }
      for (const { modulePath, declaredGlobals } of loadedModules) {
        assert.ok(
          declaredGlobals.some((name) => referencedGlobals.has(name)),
          `${modulePath} 挂载的全局名应至少有一个被页面引用，页面才可能真正调用该共享实现`,
        );
      }

      const context = createBrowserLikeContext();
      for (const { modulePath, body } of loadedModules) {
        vm.runInContext(body, context, { filename: modulePath });
      }
      for (const name of moduleGlobalNames) {
        assert.ok(context[name], `同源取回模块声明的全局名 ${name} 应可挂载`);
      }
      assert.equal(typeof context.GomokuRules.judgeBoard, 'function', 'GomokuRules.judgeBoard 应可用于判胜判定');
      assert.equal(typeof context.GomokuAI.chooseMove, 'function', 'GomokuAI.chooseMove 应可用于落子决策');

      const emptyBoard = Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => 0));
      assert.deepEqual(
        { ...context.GomokuRules.judgeBoard(emptyBoard) },
        { status: 'ongoing', winner: 0 },
        '取回的 GomokuRules 应能对空盘给出“对局未结束”判定',
      );
      const move = context.GomokuAI.chooseMove(emptyBoard, 1);
      assert.ok(
        Number.isInteger(move.row) && move.row >= 0 && move.row < 15
          && Number.isInteger(move.col) && move.col >= 0 && move.col < 15,
        '取回的 GomokuAI 应能在空盘给出合法落子交叉点',
      );
    });
  });

  it('白名单外路径一律返回 404 且不返回任何文件内容', async () => {
    const leakedMarkers = [
      /<!DOCTYPE html/i,
      /module\.exports/,
      /"name":\s*"naruto"/,
      /window\.GomokuRules/,
    ];
    await withTempServer(async ({ url }) => {
      for (const requestPath of FORBIDDEN_PATHS) {
        const res = await getFromServer(url, requestPath);
        assert.equal(res.status, 404, `${requestPath} 应返回状态码 404`);
        assert.equal(res.body, '', `${requestPath} 不得返回任何文件内容`);
        for (const marker of leakedMarkers) {
          assert.doesNotMatch(res.body, marker, `${requestPath} 不得泄漏文件内容`);
        }
      }
    });
  });
});

describe('AC-021 页面只引用两个共享实现且不内联判胜扫描', () => {
  it('页面以两条相对 <script src> 引用共享模块，且不存在其他来源的脚本', async () => {
    await withTempServer(async ({ url }) => {
      const res = await getFromServer(url, `/${PAGE_FILE}`);
      assert.equal(res.status, 200, '页面路由应返回 200');
      const pageUrl = new URL(`/${PAGE_FILE}`, url);
      const srcs = extractScriptSrcs(res.body);
      assert.deepEqual(srcs, [RULES_FILE, AI_FILE], '页面应只引用两个共享模块');
      for (const src of srcs) {
        assertSameOrigin(src, pageUrl);
        assert.doesNotMatch(src, /^[/\\]|\.\./, `脚本引用 ${src} 应是页面同目录的相对路径`);
      }
      assert.equal(res.body, readRootFile(PAGE_FILE), '页面正文应与根目录 gomoku.html 一致');
    });
  });

  it('页面内联脚本只经 window.GomokuRules / window.GomokuAI 调用共享实现，不直接调用同名全局函数', async () => {
    await withTempServer(async ({ url }) => {
      const res = await getFromServer(url, `/${PAGE_FILE}`);
      const inlineScript = extractInlineScripts(res.body);
      assert.ok(inlineScript.length > 200, '页面应包含承载渲染与回合编排的内联脚本');

      assert.match(inlineScript, /\bwindow\.GomokuRules\b/, '页面应经 window.GomokuRules 引用规则模块');
      assert.match(inlineScript, /\bwindow\.GomokuAI\b/, '页面应经 window.GomokuAI 引用 AI 模块');
      assert.match(inlineScript, /\brules\.judgeBoard\s*\(/, '页面的判胜应调用共享实现 rules.judgeBoard()');
      assert.match(inlineScript, /\bai\.chooseMove\s*\(/, '页面的决策应调用共享实现 ai.chooseMove()');

      const bareCalls = [
        { name: 'judgeBoard', pattern: /(^|[^.\w$])judgeBoard\s*\(/ },
        { name: 'checkWin', pattern: /(^|[^.\w$])checkWin\s*\(/ },
        { name: 'isDraw', pattern: /(^|[^.\w$])isDraw\s*\(/ },
        { name: 'chooseMove', pattern: /(^|[^.\w$])chooseMove\s*\(/ },
      ];
      for (const call of bareCalls) {
        assert.doesNotMatch(
          inlineScript,
          call.pattern,
          `页面不得绕过共享模块直接调用全局函数 ${call.name}()`,
        );
      }

      const forbiddenDeclarations = [
        'judgeBoard', 'checkWin', 'isDraw', 'chooseMove', 'hasConsecutiveWin', 'findWinner',
      ];
      for (const name of forbiddenDeclarations) {
        assert.doesNotMatch(
          inlineScript,
          new RegExp(`function\\s+${name}\\b`),
          `页面不得内联声明 ${name}()`,
        );
        assert.doesNotMatch(
          inlineScript,
          new RegExp(`\\b(?:var|let|const)\\s+${name}\\b`),
          `页面不得内联声明变量 ${name}`,
        );
      }
      assert.doesNotMatch(inlineScript, /\brequire\s*\(/, '页面内联脚本不得自行加载模块');
    });
  });

  it('页面内联脚本不含任何判胜扫描或落子决策实现（检测器先以共享实现为正样本）', async () => {
    const rulesSource = readRootFile(RULES_FILE);
    const aiSource = readRootFile(AI_FILE);
    for (const detector of WIN_SCAN_DETECTORS) {
      assert.match(
        rulesSource,
        detector.pattern,
        `检测器“${detector.name}”应能命中 gomoku-rules.js 的真实判胜实现，否则其否定断言无意义`,
      );
    }
    for (const detector of AI_DECISION_DETECTORS) {
      assert.match(
        aiSource,
        detector.pattern,
        `检测器“${detector.name}”应能命中 gomoku-ai.js 的真实决策实现，否则其否定断言无意义`,
      );
    }

    await withTempServer(async ({ url }) => {
      const res = await getFromServer(url, `/${PAGE_FILE}`);
      const inlineScript = extractInlineScripts(res.body);
      assert.ok(inlineScript.length > 200, '页面应包含承载渲染与回合编排的内联脚本');
      for (const detector of WIN_SCAN_DETECTORS) {
        assert.doesNotMatch(
          inlineScript,
          detector.pattern,
          `页面内联脚本不得内联判胜扫描实现：${detector.name}`,
        );
      }
      for (const detector of AI_DECISION_DETECTORS) {
        assert.doesNotMatch(
          inlineScript,
          detector.pattern,
          `页面内联脚本不得内联落子决策实现：${detector.name}`,
        );
      }
    });
  });
});
