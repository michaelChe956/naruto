const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');

const serverPath = path.join(__dirname, '..', 'server.js');

function startServer({ internalError = false } = {}) {
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      ...(internalError ? { HELLO_FORCE_INTERNAL_ERROR: '1' } : {}),
    },
  });

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('server.js did not emit listen_address within 5 seconds'));
    }, 5000);

    createInterface({ input: child.stdout }).once('line', (line) => {
      try {
        const payload = JSON.parse(line);
        assert.equal(typeof payload.listen_address, 'string');
        assert.match(payload.listen_address, /^http:\/\/127\.0\.0\.1:\d+$/);
        clearTimeout(timeout);
        resolve(payload.listen_address);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });

    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server.js exited before listening (exit code ${code})`));
    });
  });

  return { child, ready };
}

function request(address, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(`${address}/api/hello`, { headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          headers: response.headers,
          statusCode: response.statusCode,
          body: Buffer.concat(chunks),
        });
      });
    }).once('error', reject);
  });
}

test('GET /api/hello returns exactly {"message":"hello"}', async () => {
  const { child, ready } = startServer();

  try {
    const address = await ready;
    const response = await request(address);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, Buffer.from('{"message":"hello"}'));
  } finally {
    child.kill();
  }
});

test('GET /api/hello returns exactly {"error":"internal"} on internal error', async () => {
  const { child, ready } = startServer({ internalError: true });

  try {
    const address = await ready;
    const response = await request(address);

    assert.equal(response.statusCode, 500);
    assert.equal(response.headers['content-type'], 'application/json');
    assert.deepEqual(response.body, Buffer.from('{"error":"internal"}'));
  } finally {
    child.kill();
  }
});
