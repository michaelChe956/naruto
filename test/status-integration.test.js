'use strict';

// 集成验收测试：以随机端口启动服务，核对状态页契约与静态托管交付物。
//
// 覆盖范围：
//   TASK-010 / AC-010 —— createServer().listen(0) 取得随机端口，每个用例结束后 close 服务；
//                        GET /api/status 返回 200、status=ok、uptimeSeconds 为非负整数；
//                        GET /status.html 返回 200 且 Content-Type 为 text/html。
//   CT-001            —— GET /api/status 成功响应顶层字段集合恰为 last_deployed_at、
//                        status、uptimeSeconds 三个字段；last_deployed_at 为 null 或可被
//                        RFC3339 解析（DEPLOYED_AT 缺省时为 null，合法 RFC3339 时逐字符透传）。
//   TASK-011 / AC-011 —— GET /status.html 响应体与仓库根目录 status.html 逐字节一致；
//                        GET /unknown 与 POST /api/status 返回 404。
//   CT-002            —— 未匹配请求返回 404 且 Content-Type 为 text/plain; charset=utf-8。
//
// 依赖仅使用 Node 内置模块（node:test、node:assert、node:fs、node:http、node:path）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const PAGE_PATH = path.join(__dirname, '..', 'status.html');

const STATUS_PATH = '/api/status';
const PAGE_ENDPOINT = '/status.html';
const UNKNOWN_PATH = '/unknown';
const PLAIN_TEXT = 'text/plain; charset=utf-8';
// CT-001：成功响应顶层字段集合必须恰为这三个字段（排序后比较，避免依赖序列化顺序）。
const STATUS_FIELDS = ['last_deployed_at', 'status', 'uptimeSeconds'];
// 用于覆盖 last_deployed_at 的 RFC3339 透传分支。
const DEPLOYED_AT_SAMPLE = '2026-04-14T09:30:00Z';

// RFC3339 date-time 的独立判定，不复用 server.js 内部实现，避免同源错误掩盖契约破坏。
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

function isRfc3339Parseable(value) {
  return (
    typeof value === 'string' &&
    RFC3339_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

// 对随机端口发起一次请求，完整读取响应体。
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

// 每个用例内以随机端口（listen(0)）启动服务，并在用例结束后关闭，避免端口冲突与句柄泄漏。
async function withServer(run) {
  const server = require(SERVER_PATH).createServer();
  assert.equal(typeof server.listen, 'function', 'createServer() 必须返回可监听的 http.Server');

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  try {
    await run(port, server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// 在受控的 DEPLOYED_AT 下运行断言并在结束后恢复原值。
// server.js 每个请求读取一次 process.env.DEPLOYED_AT，因此本进程内改环境变量即可覆盖两条分支。
async function withDeployedAt(value, run) {
  const previous = process.env.DEPLOYED_AT;
  if (value === undefined) {
    delete process.env.DEPLOYED_AT;
  } else {
    process.env.DEPLOYED_AT = value;
  }

  try {
    await run();
  } finally {
    if (previous === undefined) {
      delete process.env.DEPLOYED_AT;
    } else {
      process.env.DEPLOYED_AT = previous;
    }
  }
}

test('TASK-010 每个用例以 listen(0) 取得随机端口，并在用例结束后关闭服务', async () => {
  const ports = [];
  const servers = [];

  for (let i = 0; i < 2; i += 1) {
    await withServer(async (port, server) => {
      assert.ok(Number.isInteger(port) && port > 0 && port < 65536, `listen(0) 必须分配有效端口，实际 ${port}`);
      servers.push(server);
      ports.push(port);
    });
  }

  // 固定端口无法在第二次监听时复用，因此"两次取得不同端口"即随机端口分配的证据。
  assert.notEqual(ports[0], ports[1], '两次 listen(0) 必须取得互不相同的随机端口');
  for (const server of servers) {
    assert.equal(server.listening, false, '用例结束后服务必须已 close');
  }
});

test('AC-010 GET /api/status 返回 200 且 status=ok、uptimeSeconds 为非负整数', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', STATUS_PATH);

    assert.equal(res.statusCode, 200, 'GET /api/status 必须返回 200');
    assert.match(
      res.headers['content-type'] || '',
      /^application\/json/,
      'Content-Type 必须以 application/json 开头',
    );

    const payload = JSON.parse(res.body.toString('utf8'));
    assert.equal(payload.status, 'ok', 'status 必须为 ok');
    assert.ok(
      Number.isInteger(payload.uptimeSeconds),
      `uptimeSeconds 必须为整数，实际 ${JSON.stringify(payload.uptimeSeconds)}`,
    );
    assert.ok(payload.uptimeSeconds >= 0, 'uptimeSeconds 必须为非负整数');
  });
});

test('AC-010 顶层字段集合恰为 last_deployed_at、status、uptimeSeconds，且 last_deployed_at 为 null 或可被 RFC3339 解析', async () => {
  await withDeployedAt(undefined, async () => {
    await withServer(async (port) => {
      const res = await request(port, 'GET', STATUS_PATH);
      assert.equal(res.statusCode, 200, 'GET /api/status 必须返回 200');

      const payload = JSON.parse(res.body.toString('utf8'));
      assert.deepEqual(
        Object.keys(payload).sort(),
        STATUS_FIELDS,
        `成功响应顶层字段必须恰为 ${STATUS_FIELDS.join('、')}`,
      );
      assert.equal(payload.status, 'ok', 'status 必须为非空字符串 ok');
      assert.ok(
        Number.isInteger(payload.uptimeSeconds) && payload.uptimeSeconds >= 0,
        'uptimeSeconds 必须为非负整数',
      );

      const deployedAt = payload.last_deployed_at;
      assert.ok(
        deployedAt === null || isRfc3339Parseable(deployedAt),
        `last_deployed_at 必须为 null 或可被 RFC3339 解析，实际 ${JSON.stringify(deployedAt)}`,
      );
      assert.equal(deployedAt, null, 'DEPLOYED_AT 缺省时 last_deployed_at 必须为 null');
    });
  });
});

test('CT-001 DEPLOYED_AT 为合法 RFC3339 时 last_deployed_at 逐字符透传且字段集合不变', async () => {
  await withDeployedAt(DEPLOYED_AT_SAMPLE, async () => {
    await withServer(async (port) => {
      const res = await request(port, 'GET', STATUS_PATH);
      assert.equal(res.statusCode, 200, 'GET /api/status 必须返回 200');

      const payload = JSON.parse(res.body.toString('utf8'));
      assert.deepEqual(
        Object.keys(payload).sort(),
        STATUS_FIELDS,
        '合法 RFC3339 下顶层字段集合必须保持恰为三个字段',
      );
      assert.equal(
        payload.last_deployed_at,
        DEPLOYED_AT_SAMPLE,
        '合法 RFC3339 必须逐字符透传原始字符串',
      );
      assert.ok(
        isRfc3339Parseable(payload.last_deployed_at),
        'last_deployed_at 必须可被 RFC3339 解析',
      );
    });
  });
});

test('AC-010 GET /status.html 返回 200 且 Content-Type 为 text/html', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', PAGE_ENDPOINT);

    assert.equal(res.statusCode, 200, 'GET /status.html 必须返回 200');
    assert.match(
      res.headers['content-type'] || '',
      /^text\/html/,
      'Content-Type 必须以 text/html 开头',
    );
  });
});

test('AC-011 GET /status.html 响应体与仓库根目录 status.html 逐字节一致', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', PAGE_ENDPOINT);
    const expected = fs.readFileSync(PAGE_PATH);

    assert.ok(expected.length > 0, '仓库根目录 status.html 不得为空');
    assert.ok(res.body.equals(expected), 'GET /status.html 响应体必须与仓库根目录 status.html 逐字节一致');
  });
});

test('AC-011 / CT-002 GET /unknown 返回 404 且 Content-Type 为 text/plain; charset=utf-8', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', UNKNOWN_PATH);

    assert.equal(res.statusCode, 404, 'GET /unknown 必须返回 404');
    assert.equal(res.headers['content-type'], PLAIN_TEXT, `Content-Type 必须为 ${PLAIN_TEXT}`);
  });
});

test('AC-011 / CT-002 POST /api/status 返回 404 且 Content-Type 为 text/plain; charset=utf-8', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'POST', STATUS_PATH);

    assert.equal(res.statusCode, 404, 'POST /api/status 必须返回 404');
    assert.equal(res.headers['content-type'], PLAIN_TEXT, `Content-Type 必须为 ${PLAIN_TEXT}`);
  });
});
