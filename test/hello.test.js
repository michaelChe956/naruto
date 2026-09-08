const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createServer } = require('../server.js');

test('GET /api/hello returns exactly the hello payload', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3000, '127.0.0.1', resolve);
  });

  try {
    const response = await fetch('http://127.0.0.1:3000/api/hello');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"message":"hello"}');
    assert.equal(response.headers.get('content-type'), 'application/json');
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
});
