'use strict';

// WI-001 后端字段测试：GET /api/status 在既有响应字段之外新增 build_commit。
//
// 覆盖（对应 TASK-001/TASK-002/TASK-003 与 AC-001/AC-002/AC-003/AC-004）：
// 1. CHECK-003：响应 JSON 含 build_commit 字段，且该字段为字符串；
// 2. AC-001：BUILD_COMMIT 未设置 → build_commit 严格等于 'unknown'；
// 3. AC-003：BUILD_COMMIT 去除首尾空白后为空 → build_commit 等于 'unknown'；
// 4. AC-002：BUILD_COMMIT 为非空白值 → build_commit 逐字等于该原值（不截断、不改写）；
// 5. CT-001 能力：每个请求读取 BUILD_COMMIT，运行期可改且无需重启；
// 6. AC-004：既有字段键名与语义不变，响应字段集相对 {status, uptimeSeconds, deploy_channel}
//    的差异仅为新增 build_commit。
//
// 既有字段基线来源：本仓库前置交付分支 aria/issues/issue_0004 的 server.js
// （GET /api/status 既有响应为 { status, uptimeSeconds, deploy_channel }）。
// 因锁定基线 main 树不含 server.js，交付物按设计 [DEC-001]「交付物自包含继承契约」
// 在自身完整承载既有字段集，再叠加 build_commit。

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createServer } = require('../server');

// 前置交付基线（aria/issues/issue_0004 server.js）的既有响应字段集。
const BASELINE_STATUS_FIELDS = ['status', 'uptimeSeconds', 'deploy_channel'];

const BUILD_COMMIT_KEY = 'BUILD_COMMIT';

function requestStatus(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: '/api/status' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// 在指定 BUILD_COMMIT 环境下启动随机端口服务，回调结束后关闭并还原环境变量。
async function withBuildCommit(rawValue, fn) {
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, BUILD_COMMIT_KEY);
  const previous = process.env[BUILD_COMMIT_KEY];

  if (rawValue === undefined) {
    delete process.env[BUILD_COMMIT_KEY];
  } else {
    process.env[BUILD_COMMIT_KEY] = rawValue;
  }

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (hadKey) {
      process.env[BUILD_COMMIT_KEY] = previous;
    } else {
      delete process.env[BUILD_COMMIT_KEY];
    }
  }
}

async function fetchStatusPayload(rawValue) {
  return withBuildCommit(rawValue, async (port) => {
    const response = await requestStatus(port);
    assert.equal(response.statusCode, 200);
    return JSON.parse(response.body);
  });
}

test('CHECK-003：GET /api/status 响应 JSON 含 build_commit 字段且该字段为字符串', async () => {
  const payload = await fetchStatusPayload(undefined);

  assert.ok(
    Object.prototype.hasOwnProperty.call(payload, 'build_commit'),
    '响应 JSON 必须含 build_commit 字段',
  );
  assert.equal(typeof payload.build_commit, 'string');
});

test('AC-001：未设置 BUILD_COMMIT 时 build_commit 严格等于 unknown', async () => {
  const payload = await fetchStatusPayload(undefined);

  assert.equal(payload.build_commit, 'unknown');
});

test('AC-003：BUILD_COMMIT 去首尾空白后为空时 build_commit 等于 unknown', async () => {
  const payload = await fetchStatusPayload('   ');

  assert.equal(payload.build_commit, 'unknown');
});

test('AC-003：BUILD_COMMIT 仅为制表符与换行等空白字符时 build_commit 等于 unknown', async () => {
  const payload = await fetchStatusPayload('\t\n  ');

  assert.equal(payload.build_commit, 'unknown');
});

test('AC-002：非空白 BUILD_COMMIT 值逐字透出为 build_commit（40 位提交号不截断不改写）', async () => {
  const rawCommit = 'abcdef1234567890abcdef1234567890abcdef12';
  const payload = await fetchStatusPayload(rawCommit);

  assert.equal(payload.build_commit, rawCommit);
});

test('AC-002：含首尾空白但去空白后非空的 BUILD_COMMIT 值原样透出（不归一、不裁剪）', async () => {
  const payload = await fetchStatusPayload('  deadbeef  ');

  assert.equal(payload.build_commit, '  deadbeef  ');
});

test('CT-001：每个请求读取 BUILD_COMMIT，运行期可改且无需重启', async () => {
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, BUILD_COMMIT_KEY);
  const previous = process.env[BUILD_COMMIT_KEY];

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    process.env[BUILD_COMMIT_KEY] = 'first-commit';
    const first = JSON.parse((await requestStatus(port)).body);

    process.env[BUILD_COMMIT_KEY] = 'second-commit';
    const second = JSON.parse((await requestStatus(port)).body);

    assert.equal(first.build_commit, 'first-commit');
    assert.equal(second.build_commit, 'second-commit');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (hadKey) {
      process.env[BUILD_COMMIT_KEY] = previous;
    } else {
      delete process.env[BUILD_COMMIT_KEY];
    }
  }
});

test('AC-004：既有字段键名与语义不变，相对既有字段集差异仅为新增 build_commit', async () => {
  const payload = await fetchStatusPayload(undefined);

  const keys = Object.keys(payload).sort();
  assert.deepEqual(
    keys,
    [...BASELINE_STATUS_FIELDS, 'build_commit'].sort(),
    '顶层字段集应恰为既有字段加 build_commit',
  );

  // 既有字段语义：status 恒为 ok，uptimeSeconds 为非负整数，deploy_channel 为字符串。
  assert.equal(payload.status, 'ok');
  assert.equal(typeof payload.uptimeSeconds, 'number');
  assert.ok(Number.isInteger(payload.uptimeSeconds), 'uptimeSeconds 应为整数');
  assert.ok(payload.uptimeSeconds >= 0, 'uptimeSeconds 应为非负整数');
  assert.equal(typeof payload.deploy_channel, 'string');

  const difference = keys.filter((key) => !BASELINE_STATUS_FIELDS.includes(key));
  assert.deepEqual(difference, ['build_commit'], '相对既有字段集的差异仅为 build_commit');
});
