'use strict';

// WI-001 后端单元测试：GET /api/status 在既有响应字段之外新增 deploy_channel。
//
// 覆盖（对应 CT-001 能力与 AC-001/AC-002/AC-003）：
// 1. DEPLOY_CHANNEL 未设置 → deploy_channel === 'stable'；
// 2. DEPLOY_CHANNEL 去首尾空白后为空 → deploy_channel === 'stable'；
// 3. DEPLOY_CHANNEL 为非空白值 → deploy_channel 逐字等于该值；
// 4. 既有响应字段键名与语义不变，相对既有字段集的差异仅为新增 deploy_channel。
//
// 既有字段基线来源：本仓库前置交付分支 aria/issues/issue_0001 的 server.js
// （GET /api/status 既有响应为 { status, uptimeSeconds }）。见交付说明中的基线核查结论。

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createServer } = require('../server');

// 前置交付基线（aria/issues/issue_0001 server.js）的既有响应字段集。
const BASELINE_STATUS_FIELDS = ['status', 'uptimeSeconds'];

function requestJson(port) {
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

// 在指定 DEPLOY_CHANNEL 环境下启动未监听端口上的服务，回调结束后关闭并还原环境变量。
async function withDeployChannel(rawValue, fn) {
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'DEPLOY_CHANNEL');
  const previous = process.env.DEPLOY_CHANNEL;

  if (rawValue === undefined) {
    delete process.env.DEPLOY_CHANNEL;
  } else {
    process.env.DEPLOY_CHANNEL = rawValue;
  }

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (hadKey) {
      process.env.DEPLOY_CHANNEL = previous;
    } else {
      delete process.env.DEPLOY_CHANNEL;
    }
  }
}

async function fetchStatusPayload(rawValue) {
  return withDeployChannel(rawValue, async (port) => {
    const response = await requestJson(port);
    assert.equal(response.statusCode, 200);
    return JSON.parse(response.body);
  });
}

test('AC-001：未设置 DEPLOY_CHANNEL 时 deploy_channel 为字符串且等于 stable', async () => {
  const payload = await fetchStatusPayload(undefined);

  assert.equal(typeof payload.deploy_channel, 'string');
  assert.equal(payload.deploy_channel, 'stable');
});

test('AC-001/设计归一化：DEPLOY_CHANNEL 去首尾空白后为空时回退 stable', async () => {
  const payload = await fetchStatusPayload('   ');

  assert.equal(typeof payload.deploy_channel, 'string');
  assert.equal(payload.deploy_channel, 'stable');
});

test('AC-002：非空白 DEPLOY_CHANNEL 值原样透出为 deploy_channel', async () => {
  const payload = await fetchStatusPayload('canary-2026-09');

  assert.equal(typeof payload.deploy_channel, 'string');
  assert.equal(payload.deploy_channel, 'canary-2026-09');
});

test('AC-003：既有字段键名与语义不变，相对既有字段集差异仅为新增 deploy_channel', async () => {
  const payload = await fetchStatusPayload(undefined);

  const keys = Object.keys(payload).sort();
  assert.deepEqual(
    keys,
    [...BASELINE_STATUS_FIELDS, 'deploy_channel'].sort(),
    '顶层字段集应恰为既有字段加 deploy_channel',
  );

  // 既有字段语义：status 为 ok，uptimeSeconds 为非负数值。
  assert.equal(payload.status, 'ok');
  assert.equal(typeof payload.uptimeSeconds, 'number');
  assert.ok(payload.uptimeSeconds >= 0);

  const difference = keys.filter((key) => !BASELINE_STATUS_FIELDS.includes(key));
  assert.deepEqual(difference, ['deploy_channel'], '相对既有字段集的差异仅为 deploy_channel');
});
