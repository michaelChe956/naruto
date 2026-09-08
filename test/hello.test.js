const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');

test('GET /api/hello returns the exact hello body', async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    stdio: 'ignore',
  });
  const exited = once(server, 'close').then(() => ({ exited: true }));

  try {
    const { address, port } = await waitForListening(server);
    const response = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: address,
        port,
        path: '/api/hello',
        method: 'GET',
      }, (response) => {
        response.setEncoding('utf8');

        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, body });
        });
      });

      request.on('error', reject);
      request.end();
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, '{"message":"hello"}');
  } finally {
    server.kill();
    await exited;
  }
});

async function waitForListening(server) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) {
      assert.fail(`server exited before responding (exit code ${server.exitCode})`);
    }
    if (await canConnect()) {
      return { address: '127.0.0.1', port: 3000 };
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('server did not become ready');
}

function canConnect() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 3000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}
