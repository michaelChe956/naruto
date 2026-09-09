'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

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
