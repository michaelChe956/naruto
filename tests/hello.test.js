'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = 3000;
const SERVER_PATH = path.join(__dirname, '..', 'server.js');
const STARTUP_TIMEOUT_MS = 5000;

function getHello() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: PORT, path: '/api/hello' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
  });
}

function waitUntilServerReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      getHello().then(resolve, (err) => {
        if (err.code !== 'ECONNREFUSED' && err.code !== 'ECONNRESET') {
          reject(err);
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error(`server not reachable at ${HOST}:${PORT} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

test('GET /api/hello returns 200 and body exactly {"message":"hello"}', async (t) => {
  const child = spawn(process.execPath, [SERVER_PATH], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => {
    child.kill('SIGTERM');
  });

  let stderrText = '';
  child.stderr.on('data', (chunk) => {
    stderrText += chunk;
  });
  const spawnFailure = new Promise((_, reject) => {
    child.once('error', (err) => {
      reject(new Error(`server process failed to start: ${err.message}\n${stderrText}`));
    });
    child.once('exit', (code) => {
      if (code !== null && code !== 0) {
        reject(new Error(`server exited prematurely with code ${code}\n${stderrText}`));
      }
    });
  });

  const response = await Promise.race([waitUntilServerReady(STARTUP_TIMEOUT_MS), spawnFailure]);

  assert.strictEqual(response.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(response.body), { message: 'hello' });
});
