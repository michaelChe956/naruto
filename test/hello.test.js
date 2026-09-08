const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const READY_LINE = 'server listening on http://127.0.0.1:3000';

function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`server 未在 5s 内就绪。stdout=${stdout} stderr=${stderr}`));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.includes(READY_LINE)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server 提前退出 code=${code} stdout=${stdout} stderr=${stderr}`));
    });
  });

  return { child, ready };
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  await new Promise((resolve) => child.on('close', resolve));
}

test('GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}', async () => {
  const { child, ready } = startServer();
  try {
    await ready;

    const res = await fetch('http://127.0.0.1:3000/api/hello');
    assert.strictEqual(res.status, 200);

    const body = await res.text();
    assert.strictEqual(body, '{"message":"hello"}');
  } finally {
    await stopServer(child);
  }
});

test('内部错误返回 500 且 body 恰为 {"error":"internal"}', async () => {
  const { child, ready } = startServer({ HELLO_FORCE_INTERNAL_ERROR: '1' });
  try {
    await ready;

    const res = await fetch('http://127.0.0.1:3000/api/hello');
    assert.strictEqual(res.status, 500);

    const body = await res.text();
    assert.strictEqual(body, '{"error":"internal"}');
  } finally {
    await stopServer(child);
  }
});
