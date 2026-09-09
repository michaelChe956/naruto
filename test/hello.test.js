'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const server = require('../server.js');

function onceListening(srv) {
  if (srv.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve) => srv.once('listening', resolve));
}

test.after(() => new Promise((resolve) => server.close(resolve)));

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async () => {
  await onceListening(server);

  const response = await fetch('http://127.0.0.1:3000/api/hello');

  assert.strictEqual(response.status, 200);
  assert.strictEqual(await response.text(), '{"message":"hello"}');
});

test('GET /api/hello 处理过程注入内部错误时返回 500 且 body 恰为 {"error":"internal"}', async () => {
  const originalSetHeader = http.ServerResponse.prototype.setHeader;
  let injected = false;
  http.ServerResponse.prototype.setHeader = function injectInternalError(...args) {
    if (!injected) {
      injected = true;
      http.ServerResponse.prototype.setHeader = originalSetHeader;
      throw new Error('注入的内部错误');
    }
    return originalSetHeader.apply(this, args);
  };

  try {
    const response = await fetch('http://127.0.0.1:3000/api/hello');

    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.headers.get('content-type'), 'application/json');
    assert.strictEqual(await response.text(), '{"error":"internal"}');
  } finally {
    http.ServerResponse.prototype.setHeader = originalSetHeader;
  }
});
