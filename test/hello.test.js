'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('GET /api/hello 返回 200 且响应体恰为 {"message":"hello"}', async () => {
  const server = require('../server.js');

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3000, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  try {
    const response = await fetch('http://127.0.0.1:3000/api/hello');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"message":"hello"}');
  } finally {
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
