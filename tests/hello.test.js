'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const SERVER_SCRIPT = path.join(__dirname, '..', 'server.js');
const TARGET_URL = 'http://127.0.0.1:3000/api/hello';
const STARTUP_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await requestOnce(url);
    } catch (err) {
      lastError = err;
      await sleep(POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    `server not reachable at ${url} within ${timeoutMs}ms: ${lastError ? lastError.message : 'unknown error'}`
  );
}

function startServer(extraEnv) {
  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    stdio: 'ignore',
    env: { ...process.env, ...extraEnv },
  });
  let spawnError = null;
  child.on('error', (err) => {
    spawnError = err;
  });
  return {
    child,
    getSpawnError: () => spawnError,
  };
}

async function stopServer(child) {
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', resolve);
  });
}

function assertStarted(server) {
  const err = server.getSpawnError();
  assert.ok(err === null, `server.js failed to start${err ? `: ${err.message}` : ''}`);
}

test('GET /api/hello returns 200 with exact body {"message":"hello"}', async (t) => {
  const server = startServer();
  t.after(() => stopServer(server.child));

  const response = await waitForServer(TARGET_URL, STARTUP_TIMEOUT_MS);
  assertStarted(server);
  assert.equal(response.status, 200);
  assert.equal(response.body, '{"message":"hello"}');
});

test('GET /api/hello returns 500 with exact body {"error":"internal"} on internal error', async (t) => {
  const server = startServer({ HELLO_FORCE_INTERNAL_ERROR: '1' });
  t.after(() => stopServer(server.child));

  const response = await waitForServer(TARGET_URL, STARTUP_TIMEOUT_MS);
  assertStarted(server);
  assert.equal(response.status, 500);
  assert.equal(response.body, '{"error":"internal"}');
});
