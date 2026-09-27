'use strict';

// 验收测试：服务端 GET /api/status、GET /status.html 与 404 兜底。
// 覆盖 AC-001（DEPLOYED_AT 为合法 RFC3339 时 last_deployed_at 逐字符透传）、
// AC-002（DEPLOYED_AT 缺省或空字符串时键存在且值为 null）、
// AC-003（DEPLOYED_AT 为非法格式时归一化为 null 而不原样透传）、
// AC-004（JSON 契约、顶层字段集合恰为 last_deployed_at/status/uptimeSeconds）、
// AC-006（页面逐字节一致）、AC-007（未知路径/非 GET 方法 404）、
// AC-008（仅内置模块、未新增依赖）、AC-009（createServer 工厂与 PORT/默认端口监听）。
// 依赖仅使用 Node 内置模块。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const PAGE_PATH = path.join(__dirname, '..', 'status.html');
const PACKAGE_PATH = path.join(__dirname, '..', 'package.json');

const STATUS_PATH = '/api/status';
const PAGE_ENDPOINT = '/status.html';
const PLAIN_TEXT = 'text/plain; charset=utf-8';

function request(port, method, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// 启动 createServer() 工厂产物并返回随机端口，测试结束回收。
async function withServer(run) {
  const server = require(SERVER_PATH).createServer();
  assert.equal(typeof server.listen, 'function', 'createServer() 必须返回 http.Server');
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await run(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function requestWithRetry(port, method, pathname) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await request(port, method, pathname);
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

// 显式管理 DEPLOYED_AT：避免宿主环境残留值污染断言，用例结束后恢复原状。
async function withDeployedAt(value, run) {
  const hadValue = Object.prototype.hasOwnProperty.call(process.env, 'DEPLOYED_AT');
  const previous = process.env.DEPLOYED_AT;
  if (value === undefined) {
    delete process.env.DEPLOYED_AT;
  } else {
    process.env.DEPLOYED_AT = value;
  }
  try {
    return await run();
  } finally {
    if (hadValue) {
      process.env.DEPLOYED_AT = previous;
    } else {
      delete process.env.DEPLOYED_AT;
    }
  }
}

test('TASK-005 createServer 是工厂：导出函数且调用时不监听端口', () => {
  const mod = require(SERVER_PATH);
  assert.equal(typeof mod.createServer, 'function', 'server.js 必须导出 createServer() 工厂');

  const server = mod.createServer();
  try {
    assert.equal(server.listening, false, 'createServer() 调用的瞬间不得开始监听');
  } finally {
    server.close();
  }
});

test('AC-004 GET /api/status 返回 200、JSON 契约且顶层字段集合恰为 last_deployed_at 与 status 与 uptimeSeconds', async () => {
  await withDeployedAt(undefined, async () => {
    await withServer(async (port) => {
      const res = await request(port, 'GET', STATUS_PATH);

      assert.equal(res.statusCode, 200, 'GET /api/status 必须返回 200');
      assert.match(
        res.headers['content-type'] || '',
        /^application\/json/,
        'Content-Type 必须以 application/json 开头',
      );

      const parsed = JSON.parse(res.body.toString('utf8'));
      assert.deepEqual(
        Object.keys(parsed).sort(),
        ['last_deployed_at', 'status', 'uptimeSeconds'],
        '响应体顶层字段集合必须恰为 last_deployed_at 与 status 与 uptimeSeconds',
      );
      assert.equal(parsed.status, 'ok', 'status 必须为 ok');
      assert.ok(Number.isInteger(parsed.uptimeSeconds), 'uptimeSeconds 必须为整数');
      assert.ok(parsed.uptimeSeconds >= 0, 'uptimeSeconds 必须为非负整数');
      assert.ok(
        parsed.uptimeSeconds <= Math.ceil(process.uptime()) + 1,
        'uptimeSeconds 必须来自 process.uptime()',
      );
      assert.equal(parsed.last_deployed_at, null, 'DEPLOYED_AT 缺省时 last_deployed_at 必须为 null');
    });
  });
});

test('AC-001 DEPLOYED_AT 为合法 RFC3339 时 last_deployed_at 逐字符透传', async () => {
  const samples = [
    '2026-09-27T16:00:00Z',
    '2026-09-27T16:00:00.123456Z',
    '2026-09-27T23:59:59+08:00',
    '2024-02-29T00:00:00-05:30',
    '0001-01-01T00:00:00Z',
  ];

  for (const sample of samples) {
    await withDeployedAt(sample, async () => {
      await withServer(async (port) => {
        const res = await request(port, 'GET', STATUS_PATH);
        assert.equal(res.statusCode, 200, `DEPLOYED_AT=${sample} 时必须返回 200`);

        const parsed = JSON.parse(res.body.toString('utf8'));
        assert.equal(
          parsed.last_deployed_at,
          sample,
          `last_deployed_at 必须逐字符等于 DEPLOYED_AT（${sample}）`,
        );
      });
    });
  }
});

test('AC-002 DEPLOYED_AT 缺省或为空字符串时 last_deployed_at 键存在且值为 null', async () => {
  for (const value of [undefined, '']) {
    await withDeployedAt(value, async () => {
      await withServer(async (port) => {
        const res = await request(port, 'GET', STATUS_PATH);
        assert.equal(res.statusCode, 200, `DEPLOYED_AT=${JSON.stringify(value)} 时必须返回 200`);

        const parsed = JSON.parse(res.body.toString('utf8'));
        assert.ok(
          Object.prototype.hasOwnProperty.call(parsed, 'last_deployed_at'),
          'last_deployed_at 键必须存在',
        );
        assert.equal(parsed.last_deployed_at, null, 'last_deployed_at 必须为 null');
      });
    });
  }
});

test('AC-003 DEPLOYED_AT 为非法格式时 last_deployed_at 归一化为 null 而非原样透传', async () => {
  const samples = [
    'not-a-date',
    '2026-09-27',
    '2026-09-27 16:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-09-27T24:00:00Z',
    '2026-09-27T16:00:00',
    '2026-09-27T16:00:00+0800',
    ' 2026-09-27T16:00:00Z',
    '2026-09-27T16:00:00Z ',
    '2026-09-27T16:61:00Z',
    '2026-09-27T16:00:00+24:00',
  ];

  for (const sample of samples) {
    await withDeployedAt(sample, async () => {
      await withServer(async (port) => {
        const res = await request(port, 'GET', STATUS_PATH);
        assert.equal(res.statusCode, 200, `DEPLOYED_AT=${sample} 时必须返回 200`);

        const parsed = JSON.parse(res.body.toString('utf8'));
        assert.equal(
          parsed.last_deployed_at,
          null,
          `非法 DEPLOYED_AT（${sample}）必须归一化为 null 而不能原样透传`,
        );
      });
    });
  }
});

test('AC-006 GET /status.html 返回 200、text/html 且响应体与 status.html 逐字节一致', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', PAGE_ENDPOINT);

    assert.equal(res.statusCode, 200, 'GET /status.html 必须返回 200');
    assert.match(
      res.headers['content-type'] || '',
      /^text\/html/,
      'Content-Type 必须以 text/html 开头',
    );
    const expected = fs.readFileSync(PAGE_PATH);
    assert.ok(res.body.equals(expected), '响应体必须与仓库根目录 status.html 逐字节一致');
    assert.ok(res.body.length > 0, '响应体不得为空');
  });
});

test('AC-007 未知路径返回 404、text/plain; charset=utf-8 且不回显路径或堆栈', async () => {
  await withServer(async (port) => {
    const unknown = '/nope/secret.js';
    const res = await request(port, 'GET', unknown);

    assert.equal(res.statusCode, 404, '未知路径必须返回 404');
    assert.equal(res.headers['content-type'], PLAIN_TEXT, `Content-Type 必须为 ${PLAIN_TEXT}`);

    const body = res.body.toString('utf8');
    assert.ok(!body.includes(unknown), '响应体不得回显请求路径');
    assert.ok(!/server\.js|__dirname|\/home\/|at\s+\S+\s+\(/.test(body), '响应体不得回显文件系统路径或错误堆栈');
  });
});

test('AC-007 非 GET 方法请求已存在路径返回 404、text/plain; charset=utf-8', async () => {
  await withServer(async (port) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      const res = await request(port, method, STATUS_PATH);
      assert.equal(res.statusCode, 404, `${method} ${STATUS_PATH} 必须返回 404`);
      if (method !== 'HEAD') {
        assert.equal(res.headers['content-type'], PLAIN_TEXT, `${method} 的 Content-Type 必须为 ${PLAIN_TEXT}`);
      }
    }

    const page = await request(port, 'POST', PAGE_ENDPOINT);
    assert.equal(page.statusCode, 404, `POST ${PAGE_ENDPOINT} 必须返回 404`);
    assert.equal(page.headers['content-type'], PLAIN_TEXT, `POST ${PAGE_ENDPOINT} 的 Content-Type 必须为 ${PLAIN_TEXT}`);
  });
});

test('AC-008 server.js 仅引用 node:http、node:fs、node:path，且 package.json 未新增依赖', () => {
  const source = fs.readFileSync(SERVER_PATH, 'utf8');
  const required = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...required].sort(),
    ['node:fs', 'node:http', 'node:path'],
    'server.js 仅可引用 node:http、node:fs、node:path',
  );

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  assert.deepEqual(pkg.dependencies || {}, {}, 'package.json 不得新增 dependencies');
  assert.deepEqual(pkg.devDependencies || {}, {}, 'package.json 不得新增 devDependencies');
});

test('AC-009 执行 node server.js 时按 PORT 指定端口监听且可被 HTTP 访问', async () => {
  const source = fs.readFileSync(SERVER_PATH, 'utf8');
  assert.match(source, /require\.main\s*===\s*module/, '必须仅在 require.main === module 时监听');
  assert.match(source, /3000/, '默认端口必须为 3000');

  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

  try {
    const res = await requestWithRetry(port, 'GET', STATUS_PATH);
    assert.equal(res.statusCode, 200, `node server.js 必须在 PORT=${port} 监听并提供 /api/status`);
  } finally {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }

  assert.ok(
    child.exitCode !== null || child.signalCode !== null,
    `子进程必须已退出（exitCode=${child.exitCode}, signalCode=${child.signalCode}, stderr: ${stderr}）`,
  );
});
