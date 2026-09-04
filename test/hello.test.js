'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { server } = require('../server.js');

const HOST = '127.0.0.1';
const PORT = 3000;

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });

  try {
    await new Promise((resolve, reject) => {
      http.get({ host: HOST, port: PORT, path: '/api/hello' }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            assert.strictEqual(res.statusCode, 200);
            assert.strictEqual(body, '{"message":"hello"}');
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', reject);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
