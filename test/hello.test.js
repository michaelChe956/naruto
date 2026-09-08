const test = require('node:test');
const assert = require('node:assert/strict');

const server = require('../server');

test('GET /api/hello returns the hello response', async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { address, port } = server.address();
    const response = await fetch(`http://${address}:${port}/api/hello`);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), JSON.stringify({ message: 'hello' }));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
