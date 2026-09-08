'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const { createServer } = require('../../server/server.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const STATIC_ROOT = path.join(FIXTURES, 'static');

function startServer() {
  const app = createServer({
    dataPath: path.join(FIXTURES, 'levels', 'missing.json'),
    staticRoot: STATIC_ROOT,
  });
  return app.start({ port: 0 });
}

// 使用原始 http 请求发送未规范化路径，避免客户端 URL 规范化吞掉 ../
function rawGet(origin, requestPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: requestPath, method: 'GET' },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('AC-005: 请求页面入口 / 返回夹具 index.html 内容', async () => {
  const instance = await startServer();
  try {
    const res = await fetch(`${instance.origin}/`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      await res.text(),
      fs.readFileSync(path.join(STATIC_ROOT, 'index.html'), 'utf8'),
    );
  } finally {
    await instance.stop();
  }
});

test('AC-005: 请求静态资源 /app.js 返回夹具文件内容', async () => {
  const instance = await startServer();
  try {
    const res = await fetch(`${instance.origin}/app.js`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      await res.text(),
      fs.readFileSync(path.join(STATIC_ROOT, 'app.js'), 'utf8'),
    );
  } finally {
    await instance.stop();
  }
});

test('AC-005: 越界路径被拒绝且不泄露 staticRoot 外文件内容', async () => {
  const instance = await startServer();
  try {
    const traversalPaths = [
      '/../outside-secret.txt',
      '/..%2foutside-secret.txt',
      '/%2e%2e/outside-secret.txt',
      '/static/../../outside-secret.txt',
    ];
    for (const requestPath of traversalPaths) {
      const res = await rawGet(instance.origin, requestPath);
      assert.strictEqual(res.status, 404, `路径 ${requestPath} 应被拒绝`);
      assert.ok(
        !res.body.includes('outside-secret-content'),
        `路径 ${requestPath} 不得泄露夹具外文件内容`,
      );
    }
  } finally {
    await instance.stop();
  }
});

test('AC-005: 缺失静态资源返回 404 文本', async () => {
  const instance = await startServer();
  try {
    const res = await fetch(`${instance.origin}/does-not-exist.txt`);
    assert.strictEqual(res.status, 404);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.startsWith('text/plain'), '404 响应必须是文本');
    const body = await res.text();
    assert.ok(body.length > 0);
  } finally {
    await instance.stop();
  }
});
