'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ORIGIN_PATTERN = /http:\/\/127\.0\.0\.1:\d+/;

function waitForOrigin(child, output) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`启动超时：未输出监听地址，输出为：${output.text}`)), 5000);
    const check = () => {
      const match = output.text.match(ORIGIN_PATTERN);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    child.stdout.on('data', (chunk) => {
      output.text += chunk;
      check();
    });
    child.stderr.on('data', (chunk) => {
      output.text += chunk;
      check();
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务进程提前退出（code=${code}），输出为：${output.text}`));
    });
  });
}

test('node server/main.js 以默认配置启动并提供关卡数据 API', async () => {
  const child = spawn(process.execPath, [path.join('server', 'main.js')], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { text: '' };
  // 立即注册退出监听，避免子进程提前退出时错失 exit 事件。
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    const origin = await waitForOrigin(child, output);
    const response = await fetch(`${origin}/api/levels`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.length, 5);
    assert.deepEqual(body.map((level) => level.id), [1, 2, 3, 4, 5]);
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
});
