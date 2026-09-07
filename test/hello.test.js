'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { start, server } = require('../server.js');

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async (t) => {
  await start(3000, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { statusCode, body } = await new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:3000/api/hello', (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
  });

  assert.strictEqual(statusCode, 200);
  assert.strictEqual(body, '{"message":"hello"}');
});
