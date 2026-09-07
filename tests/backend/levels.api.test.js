'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, dataFixture } = require('./helpers.js');

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const VALID_DIFFICULTIES = new Set(['简单', '普通', '困难']);

function assertLevelsPayload(body) {
  assert.ok(Array.isArray(body), '顶层必须是数组');
  assert.equal(body.length, 5, '数组必须恰好 5 项');
  const ids = new Set();
  for (const item of body) {
    assert.equal(typeof item, 'object');
    assert.notEqual(item, null);
    assert.equal(typeof item.id, 'string');
    assert.ok(item.id.trim() !== '', 'id 必须非空');
    assert.ok(!ids.has(item.id), 'id 必须唯一');
    ids.add(item.id);
    assert.equal(typeof item.name, 'string');
    assert.ok(item.name.trim() !== '', 'name 必须非空');
    assert.ok(VALID_DIFFICULTIES.has(item.difficulty), `difficulty 必须属于 简单/普通/困难，实际: ${item.difficulty}`);
    assert.equal(typeof item.unlocked, 'boolean', 'unlocked 必须是布尔值');
  }
}

test('AC-002: GET /api/levels（默认 dataPath）返回 200 且恰好 5 项合法关卡', async () => {
  const server = await startTestServer({ dataPath: undefined, staticRoot: undefined });
  try {
    const response = await fetch(`${server.origin}/api/levels`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE);
    assertLevelsPayload(await response.json());
  } finally {
    await server.stop();
  }
});

test('AC-002: GET /api/levels（dataPath 指向有效五项夹具）返回 200 顶层数组恰 5 项', async () => {
  const server = await startTestServer({ dataPath: dataFixture('levels-valid.json') });
  try {
    const response = await fetch(`${server.origin}/api/levels`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE);
    assertLevelsPayload(await response.json());
  } finally {
    await server.stop();
  }
});

test('AC-004: POST /api/levels 返回 405 统一 JSON 错误', async () => {
  const server = await startTestServer({ dataPath: dataFixture('levels-valid.json') });
  try {
    const response = await fetch(`${server.origin}/api/levels`, { method: 'POST' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE);
    const body = await response.json();
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(typeof body.error.message, 'string');
    assert.ok(body.error.message.length > 0);
    assert.ok((response.headers.get('allow') || '').includes('GET'), '405 应包含 Allow: GET');
  } finally {
    await server.stop();
  }
});

test('AC-004: DELETE /api/levels 返回 405 统一 JSON 错误', async () => {
  const server = await startTestServer({ dataPath: dataFixture('levels-valid.json') });
  try {
    const response = await fetch(`${server.origin}/api/levels`, { method: 'DELETE' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE);
    const body = await response.json();
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
  } finally {
    await server.stop();
  }
});

test('AC-004: GET 未知 API 路径返回 404 统一 JSON 错误', async () => {
  const server = await startTestServer({ dataPath: dataFixture('levels-valid.json') });
  try {
    const response = await fetch(`${server.origin}/api/does-not-exist`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE);
    const body = await response.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(typeof body.error.message, 'string');
    assert.ok(body.error.message.length > 0);
  } finally {
    await server.stop();
  }
});

test('AC-004: 未知 API 路径上使用非 GET 方法同样返回 404 统一 JSON 错误', async () => {
  const server = await startTestServer({ dataPath: dataFixture('levels-valid.json') });
  try {
    const response = await fetch(`${server.origin}/api/does-not-exist`, { method: 'POST' });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-type'), JSON_CONTENT_TYPE);
    const body = await response.json();
    assert.equal(body.error.code, 'NOT_FOUND');
  } finally {
    await server.stop();
  }
});
