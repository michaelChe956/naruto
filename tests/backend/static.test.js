'use strict';

// AC-003：静态托管（夹具 staticRoot）、缺失文本 404、越界拒绝；非 GET 静态 405。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { start } = require('../../server/index.js');

const TEXT_UTF8_PREFIX = 'text/plain';

async function writeStaticFixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cadence-static-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  return root;
}

async function startStatic(t, root) {
  const handle = await start({ staticRoot: root, port: 0 });
  t.after(() => handle.stop());
  return handle;
}

// fetch 会把 URL 中的 ../ 规范化掉，越界用例需以原始请求行发送。
function rawRequest(origin, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(origin);
    const req = http.request({ hostname, port, path: requestPath, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

test('AC-003: GET / 返回夹具 staticRoot 的 index.html 与 text/html Content-Type', async (t) => {
  const root = await writeStaticFixture(t, { 'index.html': '<!doctype html><title>木叶村</title>' });
  const handle = await startStatic(t, root);

  const res = await fetch(`${handle.origin}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.ok((await res.text()).includes('木叶村'));
});

test('AC-003: 静态资源按扩展名返回 Content-Type（css 与嵌套 js）', async (t) => {
  const root = await writeStaticFixture(t, {
    'style.css': 'body { color: orange; }',
    'assets/app.js': 'console.log("naruto");',
  });
  const handle = await startStatic(t, root);

  const css = await fetch(`${handle.origin}/style.css`);
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.ok((await css.text()).includes('orange'));

  const js = await fetch(`${handle.origin}/assets/app.js`);
  assert.equal(js.status, 200);
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.ok((await js.text()).includes('naruto'));
});

test('AC-003: 缺失静态资源返回文本 404', async (t) => {
  const root = await writeStaticFixture(t, { 'index.html': '<!doctype html>' });
  const handle = await startStatic(t, root);

  const res = await rawRequest(handle.origin, '/missing.txt');
  assert.equal(res.status, 404);
  assert.ok(res.headers['content-type'].startsWith(TEXT_UTF8_PREFIX), `应为文本 404，实际 Content-Type：${res.headers['content-type']}`);
  assert.ok(res.body.includes('Not Found'));
});

test('AC-003: 原始 ../ 越界路径拒绝解析到 staticRoot 之外', async (t) => {
  const root = await writeStaticFixture(t, { 'index.html': '<!doctype html>' });
  await fs.writeFile(path.join(path.dirname(root), 'secret.txt'), 'TOPSECRET-LEVEL-DATA', 'utf8');
  t.after(() => fs.rm(path.join(path.dirname(root), 'secret.txt'), { force: true }));
  const handle = await startStatic(t, root);

  const res = await rawRequest(handle.origin, '/../secret.txt');
  assert.equal(res.status, 403);
  assert.ok(!res.body.includes('TOPSECRET-LEVEL-DATA'), '越界响应不得泄露 staticRoot 之外的内容');
});

test('AC-003: URL 编码的 %2e%2e 越界路径同样拒绝', async (t) => {
  const root = await writeStaticFixture(t, { 'index.html': '<!doctype html>' });
  await fs.writeFile(path.join(path.dirname(root), 'secret.txt'), 'TOPSECRET-LEVEL-DATA', 'utf8');
  t.after(() => fs.rm(path.join(path.dirname(root), 'secret.txt'), { force: true }));
  const handle = await startStatic(t, root);

  const res = await rawRequest(handle.origin, '/%2e%2e/secret.txt');
  assert.equal(res.status, 403);
  assert.ok(!res.body.includes('TOPSECRET-LEVEL-DATA'), '越界响应不得泄露 staticRoot 之外的内容');
});

test('非 GET 方法请求静态路径返回 405 文本', async (t) => {
  const root = await writeStaticFixture(t, { 'index.html': '<!doctype html>' });
  const handle = await startStatic(t, root);

  const res = await rawRequest(handle.origin, '/', 'POST');
  assert.equal(res.status, 405);
  assert.ok(res.headers['content-type'].startsWith(TEXT_UTF8_PREFIX));
});
