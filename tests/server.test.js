'use strict';

// 验收测试：server.js —— 静态白名单路由（仅 node:http / node:fs / node:path / process）。
//
// 覆盖范围：
//   TASK-009 / CT-004 —— 白名单路径到根目录文件的固定映射、PORT 环境变量缺省值与临时端口启动方式；
//   TASK-009 / AC-019 —— 任一请求只通过固定白名单映射读取根目录下三个文件；
//   TASK-010 / AC-017 —— 五子棋页面路由返回状态码 200 且 content-type 为 text/html；
//   TASK-010 / AC-018 —— 白名单外路径返回 404 且不返回任何文件内容。
//
// 依赖仅使用 Node 内置模块（node:test、node:assert、node:fs、node:path、node:http）。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..');
const SERVER_PATH = path.join(ROOT_DIR, 'server.js');

const PAGE_FILE = 'gomoku.html';
const PVE_SCRIPT_FILE = 'gomoku-ai.js';
const RULES_SCRIPT_FILE = 'gomoku-rules.js';
const ALLOWED_FILES = [PAGE_FILE, RULES_SCRIPT_FILE, PVE_SCRIPT_FILE];

// 直接 require 会在缺少实现时抛出，为让 TDD 红灯逐条可读，这里做安全加载。
let serverModule;
try {
  serverModule = require(SERVER_PATH);
} catch (error) {
  serverModule = {};
}

const { createServer, startServer, resolvePort, DEFAULT_PORT, STATIC_ROUTES } = serverModule;

function assertServerContract() {
  assert.equal(typeof createServer, 'function', 'server.js 应通过 module.exports 导出 createServer()');
  assert.equal(typeof startServer, 'function', 'server.js 应通过 module.exports 导出 startServer(port)');
  assert.equal(typeof resolvePort, 'function', 'server.js 应通过 module.exports 导出 resolvePort(rawPort)');
  assert.equal(typeof DEFAULT_PORT, 'number', 'server.js 应导出 PORT 环境变量缺省值 DEFAULT_PORT');
  assert.ok(
    STATIC_ROUTES && typeof STATIC_ROUTES === 'object',
    'server.js 应导出白名单路径到文件映射 STATIC_ROUTES',
  );
}

// 临时端口（port 0）启动：由操作系统分配空闲端口，用例之间互不争用固定端口。
async function withTempServer(run) {
  assertServerContract();
  const started = await startServer(0);
  const { server, port } = started;
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'port 0 应由操作系统分配为合法正整数端口');
  try {
    await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function rawRequest(port, requestPath, method) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, method: method || 'GET' },
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

function readRootFile(fileName) {
  return fs.readFileSync(path.join(ROOT_DIR, fileName), 'utf8');
}

// 记录服务运行期实际读取的文件路径，用于验证“只通过白名单映射读取根目录三个文件”。
function recordFileReads(run) {
  const reads = [];
  const original = {
    readFile: fs.readFile,
    createReadStream: fs.createReadStream,
    promisesReadFile: fs.promises.readFile,
  };
  const track = (file) => { reads.push(String(file)); };
  fs.readFile = function trackedReadFile(file, ...rest) {
    track(file);
    return original.readFile.call(fs, file, ...rest);
  };
  fs.createReadStream = function trackedCreateReadStream(file, ...rest) {
    track(file);
    return original.createReadStream.call(fs, file, ...rest);
  };
  fs.promises.readFile = function trackedPromisesReadFile(file, ...rest) {
    track(file);
    return original.promisesReadFile.call(fs.promises, file, ...rest);
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      fs.readFile = original.readFile;
      fs.createReadStream = original.createReadStream;
      fs.promises.readFile = original.promisesReadFile;
    })
    .then(() => reads);
}

describe('TASK-009 / CT-004 白名单映射与启动契约', () => {
  it('STATIC_ROUTES 把固定路径映射到根目录下三个文件并声明内容类型', () => {
    assertServerContract();
    const files = new Set(Object.values(STATIC_ROUTES).map((route) => route.file));
    assert.deepEqual(
      [...files].sort(),
      [...ALLOWED_FILES].sort(),
      '白名单只能涉及 gomoku.html、gomoku-rules.js、gomoku-ai.js 三个根目录文件',
    );
    assert.equal(STATIC_ROUTES['/'].file, PAGE_FILE, '根路径应映射到页面文件');
    assert.equal(STATIC_ROUTES['/gomoku.html'].file, PAGE_FILE, '页面路由应映射到 gomoku.html');
    assert.equal(STATIC_ROUTES['/gomoku-rules.js'].file, RULES_SCRIPT_FILE, '规则脚本路由应映射到 gomoku-rules.js');
    assert.equal(STATIC_ROUTES['/gomoku-ai.js'].file, PVE_SCRIPT_FILE, 'AI 脚本路由应映射到 gomoku-ai.js');

    for (const [routePath, route] of Object.entries(STATIC_ROUTES)) {
      assert.equal(
        path.dirname(route.file),
        '.',
        `${routePath} 只允许映射根目录下的文件名，不得包含子目录或相对跳转`,
      );
      assert.ok(
        typeof route.contentType === 'string' && route.contentType.length > 0,
        `${routePath} 应显式声明 content-type`,
      );
    }
    assert.match(STATIC_ROUTES['/'].contentType, /^text\/html\b/, '页面路由 content-type 应为 text/html');
    assert.match(STATIC_ROUTES['/gomoku-rules.js'].contentType, /javascript/, '规则脚本应为 JavaScript 内容类型');
    assert.match(STATIC_ROUTES['/gomoku-ai.js'].contentType, /javascript/, 'AI 脚本应为 JavaScript 内容类型');
  });

  it('DEFAULT_PORT 缺省为 3000，resolvePort 仅在 PORT 合法时采用该值', () => {
    assertServerContract();
    assert.equal(DEFAULT_PORT, 3000, 'PORT 环境变量缺省值应为 3000');
    assert.equal(resolvePort(undefined), DEFAULT_PORT, 'PORT 未设置时应回落到缺省端口');
    assert.equal(resolvePort(''), DEFAULT_PORT, 'PORT 为空串时应回落到缺省端口');
    assert.equal(resolvePort('   '), DEFAULT_PORT, 'PORT 为空白串时应回落到缺省端口');
    assert.equal(resolvePort('not-a-port'), DEFAULT_PORT, 'PORT 非数字时应回落到缺省端口');
    assert.equal(resolvePort('70000'), DEFAULT_PORT, 'PORT 超出 0..65535 时应回落到缺省端口');
    assert.equal(resolvePort('8123'), 8123, 'PORT 合法时应采用该端口');
  });

  it('未显式传端口时读取 process.env.PORT，并以临时端口启动可连接的 HTTP 服务', async () => {
    assertServerContract();
    const originalPort = process.env.PORT;
    process.env.PORT = '0';
    let envStarted;
    try {
      envStarted = await startServer();
    } finally {
      if (originalPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = originalPort;
      }
    }
    try {
      assert.ok(
        Number.isInteger(envStarted.port) && envStarted.port > 0 && envStarted.port <= 65535,
        'PORT=0 时应以操作系统分配的临时端口启动，证明启动时读取了 process.env.PORT',
      );
    } finally {
      await new Promise((resolve) => envStarted.server.close(resolve));
    }

    await withTempServer(async (port) => {
      const res = await rawRequest(port, '/');
      assert.equal(res.status, 200, '显式临时端口启动后应能正常响应请求');
    });
  });

  it('server.js 只 require node:http、node:fs、node:path 并经 process 读取端口', () => {
    const source = fs.readFileSync(SERVER_PATH, 'utf8');
    const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
    assert.deepEqual(
      [...new Set(required)].sort(),
      ['node:fs', 'node:http', 'node:path'],
      'server.js 只允许依赖 node:http、node:fs、node:path 三个内置模块',
    );
    assert.match(source, /\bprocess\b/, 'server.js 应通过 process 读取 PORT 环境变量');
  });
});

describe('AC-017 页面路由返回 200 且 content-type 为 text/html', () => {
  it('/ 与 /gomoku.html 均返回 200、text/html，正文为 gomoku.html 的完整内容', async () => {
    const html = readRootFile(PAGE_FILE);
    await withTempServer(async (port) => {
      for (const requestPath of ['/', '/gomoku.html', '/gomoku.html?v=1', '/?a=1']) {
        const res = await rawRequest(port, requestPath);
        assert.equal(res.status, 200, `${requestPath} 应返回状态码 200`);
        assert.match(
          res.headers['content-type'],
          /^text\/html\b/,
          `${requestPath} 的 content-type 应为 text/html`,
        );
        assert.equal(res.body, html, `${requestPath} 应返回 gomoku.html 的完整内容`);
      }
    });
  });

  it('页面通过全局名引用的两个脚本路由可被同源加载（CT-003 依赖契约）', async () => {
    const html = readRootFile(PAGE_FILE);
    assert.match(html, /<script src="gomoku-rules\.js"><\/script>/, '页面应以 <script src> 引用 gomoku-rules.js');
    assert.match(html, /<script src="gomoku-ai\.js"><\/script>/, '页面应以 <script src> 引用 gomoku-ai.js');

    await withTempServer(async (port) => {
      for (const scriptFile of [RULES_SCRIPT_FILE, PVE_SCRIPT_FILE]) {
        const requestPath = `/${scriptFile}`;
        const res = await rawRequest(port, requestPath);
        assert.equal(res.status, 200, `${requestPath} 应返回状态码 200`);
        assert.match(res.headers['content-type'], /javascript/, `${requestPath} 的 content-type 应为 JavaScript`);
        assert.equal(res.body, readRootFile(scriptFile), `${requestPath} 应返回对应脚本的完整内容`);
      }
    });
  });
});

describe('AC-018 白名单外路径返回 404 且不返回任何文件内容', () => {
  it('未知路径、越权路径与对局状态接口路径一律返回 404 且空正文', async () => {
    const forbiddenPaths = [
      '/package.json',
      '/server.js',
      '/README.md',
      '/tests/server.test.js',
      '/api/state',
      '/api/gomoku',
      '/unknown.txt',
      '/gomoku.html.bak',
      '/sub/gomoku.html',
      '/../package.json',
      '/..%2Fpackage.json',
      '/gomoku-rules.js/../../package.json',
      '/constructor',
      '/toString',
    ];
    await withTempServer(async (port) => {
      for (const requestPath of forbiddenPaths) {
        const res = await rawRequest(port, requestPath);
        assert.equal(res.status, 404, `${requestPath} 应返回状态码 404`);
        assert.equal(res.body, '', `${requestPath} 不得返回任何文件内容`);
        assert.doesNotMatch(res.body, /<!DOCTYPE html|module\.exports|"name":\s*"naruto"/, `${requestPath} 不得泄漏文件内容`);
      }
    });
  });

  it('白名单路径的非 GET/HEAD 请求不返回页面内容', async () => {
    await withTempServer(async (port) => {
      const res = await rawRequest(port, '/gomoku.html', 'POST');
      assert.equal(res.status, 405, '白名单路径的写请求应返回 405');
      assert.equal(res.body, '', '405 响应不得返回文件内容');
    });
  });
});

describe('AC-019 只通过固定白名单映射读取根目录下三个文件', () => {
  it('运行期读取的文件恰好是白名单三个根目录文件，未知路径不触发任何读取', async () => {
    const requestedPaths = ['/', '/gomoku.html', '/gomoku-rules.js', '/gomoku-ai.js'];
    const forbiddenPaths = ['/package.json', '/api/state', '/unknown.txt', '/../package.json'];
    const reads = await recordFileReads(async () => {
      await withTempServer(async (port) => {
        for (const requestPath of [...requestedPaths, ...forbiddenPaths]) {
          await rawRequest(port, requestPath);
        }
      });
    });

    assert.ok(reads.length > 0, '服务应通过 node:fs 读取白名单文件');
    const readBaseNames = reads.map((file) => path.basename(file));
    assert.deepEqual(
      [...new Set(readBaseNames)].sort(),
      [...ALLOWED_FILES].sort(),
      '运行期读取的文件应恰好是 gomoku.html、gomoku-rules.js、gomoku-ai.js',
    );
    for (const file of reads) {
      assert.equal(
        path.resolve(file),
        path.join(ROOT_DIR, path.basename(file)),
        `读取路径 ${file} 必须直接落在仓库根目录内`,
      );
      assert.ok(ALLOWED_FILES.includes(path.basename(file)), `读取路径 ${file} 必须来自白名单映射`);
    }
  });
});
