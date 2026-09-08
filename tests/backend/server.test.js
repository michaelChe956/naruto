'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const {
  createServer,
  start,
  API_PATH,
  DEFAULT_PORT,
  PORT_ENV,
} = require('../../server');

const fixture = (name) => path.join(__dirname, 'fixtures', name);
const STATIC_ROOT = fixture('static');

function serverOptions(overrides = {}) {
  return {
    dataPath: fixture('levels.valid.json'),
    staticRoot: STATIC_ROOT,
    ...overrides,
  };
}

async function withServer(options, run) {
  const instance = createServer(options);
  const handle = await instance.start({ port: 0 });
  try {
    return await run(handle);
  } finally {
    await handle.stop();
  }
}

function assertValidLevelRecords(records) {
  assert.ok(Array.isArray(records), '响应体顶层应为数组');
  assert.equal(records.length, 5);
  const seenIds = new Set();
  for (const record of records) {
    assert.equal(typeof record.id, 'string');
    assert.ok(record.id.length > 0);
    assert.ok(!seenIds.has(record.id), `id 不应重复：${record.id}`);
    seenIds.add(record.id);
    assert.equal(typeof record.name, 'string');
    assert.ok(record.name.length > 0);
    assert.ok(['简单', '普通', '困难'].includes(record.difficulty));
    assert.equal(typeof record.unlocked, 'boolean');
  }
}

test('导出交付契约常量：api_path、default_port、port_env', () => {
  assert.equal(API_PATH, '/api/levels');
  assert.equal(typeof DEFAULT_PORT, 'number');
  assert.ok(DEFAULT_PORT > 0);
  assert.equal(PORT_ENV, 'PORT');
});

test('createServer 工厂与 start({port:0}) 返回含 origin、实际端口与 stop 的句柄，stop 后释放端口', async () => {
  const instance = createServer(serverOptions());
  const handle = await instance.start({ port: 0 });

  try {
    assert.ok(Number.isInteger(handle.port));
    assert.ok(handle.port > 0, 'port 为 0 时应返回操作系统分配的实际端口');
    assert.equal(handle.origin, `http://127.0.0.1:${handle.port}`);
    assert.equal(typeof handle.stop, 'function');
  } finally {
    await handle.stop();
  }

  await new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('listening', () => {
      probe.close(() => resolve());
    });
    probe.once('error', reject);
    probe.listen(handle.port);
  });
});

test('模块级 start({port:0}) 可直接启动服务并返回句柄', async () => {
  const handle = await start({ port: 0, ...serverOptions() });
  try {
    assert.ok(handle.port > 0);
    assert.equal(typeof handle.stop, 'function');
  } finally {
    await handle.stop();
  }
});

test('start 未显式传 port 时读取 PORT 环境变量', async () => {
  const previous = process.env[PORT_ENV];
  process.env[PORT_ENV] = '0';
  try {
    const handle = await start(serverOptions());
    try {
      assert.ok(handle.port > 0);
    } finally {
      await handle.stop();
    }
  } finally {
    if (previous === undefined) {
      delete process.env[PORT_ENV];
    } else {
      process.env[PORT_ENV] = previous;
    }
  }
});

test('GET /api/levels 返回 200 与 application/json; charset=utf-8 的五项顶层数组', async () => {
  await withServer(serverOptions(), async (handle) => {
    const response = await fetch(`${handle.origin}${API_PATH}`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assertValidLevelRecords(await response.json());
  });
});

test('关卡数据文件缺失时 GET /api/levels 返回 500 与 LEVEL_DATA_UNAVAILABLE 错误信封', async () => {
  await withServer(serverOptions({ dataPath: fixture('levels.not-exist.json') }), async (handle) => {
    const response = await fetch(`${handle.origin}${API_PATH}`);

    assert.equal(response.status, 500);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await response.json();
    assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
  });
});

test('关卡数据 JSON 解析失败时 GET /api/levels 返回 500 与 LEVEL_DATA_UNAVAILABLE 错误信封', async () => {
  await withServer(serverOptions({ dataPath: fixture('levels.bad-json.json') }), async (handle) => {
    const response = await fetch(`${handle.origin}${API_PATH}`);

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
  });
});

test('关卡数据结构校验失败时 GET /api/levels 返回 500 与 LEVEL_DATA_UNAVAILABLE 错误信封', async () => {
  await withServer(serverOptions({ dataPath: fixture('levels.bad-difficulty.json') }), async (handle) => {
    const response = await fetch(`${handle.origin}${API_PATH}`);

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
  });
});

test('未知 API 路径返回 404 的 JSON 错误响应', async () => {
  await withServer(serverOptions(), async (handle) => {
    const response = await fetch(`${handle.origin}/api/does-not-exist`);

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await response.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  });
});

test('对 /api/levels 使用 POST 返回 405 的 JSON 错误响应', async () => {
  await withServer(serverOptions(), async (handle) => {
    const response = await fetch(`${handle.origin}${API_PATH}`, { method: 'POST' });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('allow'), 'GET');
    const body = await response.json();
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
  });
});

test('静态托管对根路径返回 index.html 与 text/html; charset=utf-8', async () => {
  await withServer(serverOptions(), async (handle) => {
    const response = await fetch(`${handle.origin}/`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await response.text(), fs.readFileSync(fixture('static/index.html'), 'utf8'));
  });
});

test('静态托管对根内资源返回正确 Content-Type 与文件内容', async () => {
  await withServer(serverOptions(), async (handle) => {
    const cssResponse = await fetch(`${handle.origin}/style.css`);
    assert.equal(cssResponse.status, 200);
    assert.equal(cssResponse.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(await cssResponse.text(), fs.readFileSync(fixture('static/style.css'), 'utf8'));

    const jsResponse = await fetch(`${handle.origin}/app.js`);
    assert.equal(jsResponse.status, 200);
    assert.equal(jsResponse.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(await jsResponse.text(), fs.readFileSync(fixture('static/app.js'), 'utf8'));
  });
});

test('静态托管对缺失资源返回 404 文本响应', async () => {
  await withServer(serverOptions(), async (handle) => {
    const response = await fetch(`${handle.origin}/missing.txt`);

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.notEqual(await response.text(), '');
  });
});

function rawGet(origin, rawPath) {
  // 以 options 对象形式发送请求，path 原样上线路，不经 WHATWG URL 规范化
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname, port, method: 'GET', path: rawPath }, resolve);
    request.on('error', reject);
    request.end();
  });
}

function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

test('静态托管拒绝越界访问且不泄露静态根之外的文件', async () => {
  await withServer(serverOptions(), async (handle) => {
    for (const rawPath of [
      '/../outside-secret.txt',
      '/%2e%2e/outside-secret.txt',
      '/sub/%2e%2e/%2e%2e/outside-secret.txt',
    ]) {
      const response = await rawGet(handle.origin, rawPath);
      assert.equal(response.statusCode, 403, `越界路径 ${rawPath} 应被拒绝`);
      assert.match(response.headers['content-type'], /^text\/plain/);
      const body = await readStream(response);
      assert.ok(!body.includes('绝密'), '越界响应不得包含静态根之外的文件内容');
    }
  });
});
