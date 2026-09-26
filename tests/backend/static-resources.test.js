'use strict';

// 静态资源投递验收测试（TASK-004 / REQ-014 / AC-008）。
// 覆盖：静态根目录内登记的 HTML 资源在同源可访问，未登记路径与非 HTML 文件一律 404。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const { safeLoad, request, listenWithTempPort, STATIC_FIXTURE_ROOT } = require('./helpers');

const { createCountStore } = safeLoad(path.join(__dirname, '..', '..', 'server', 'count-store.js'));
const { createRequestHandler } = safeLoad(path.join(__dirname, '..', '..', 'server', 'app.js'));

const COUNT_PATH = '/api/count';
const MISSING_STATIC_ROOT = path.join(__dirname, 'fixtures', 'does-not-exist');

function assertHandlerContract() {
  assert.equal(
    typeof createRequestHandler,
    'function',
    'server/app.js 应导出 createRequestHandler({ countStore, staticRoot })',
  );
}

async function withStaticServer(staticRoot, run) {
  assertHandlerContract();
  const countStore = createCountStore();
  const server = http.createServer(createRequestHandler({ countStore, staticRoot }));
  const started = await listenWithTempPort(server);
  try {
    await run({ port: started.port });
  } finally {
    await started.close();
  }
}

describe('静态根目录资源投递', () => {
  it('AC-008：登记的 HTML 资源在同源路径返回 200 与 text/html', async () => {
    await withStaticServer(STATIC_FIXTURE_ROOT, async ({ port }) => {
      const about = await request(port, 'GET', '/about.html');
      assert.equal(about.status, 200);
      assert.equal(about.headers['content-type'], 'text/html; charset=utf-8');
      assert.match(about.body, /COUNT_FIXTURE_ABOUT/);
    });
  });

  it('AC-008：根路径投递该目录内的 index.html', async () => {
    await withStaticServer(STATIC_FIXTURE_ROOT, async ({ port }) => {
      const index = await request(port, 'GET', '/');
      assert.equal(index.status, 200);
      assert.equal(index.headers['content-type'], 'text/html; charset=utf-8');
      assert.match(index.body, /COUNT_FIXTURE_INDEX/);
    });
  });

  it('AC-008：未登记路径与非 HTML 文件返回 404 且不回显文件内容', async () => {
    await withStaticServer(STATIC_FIXTURE_ROOT, async ({ port }) => {
      for (const requestPath of ['/missing.html', '/notes.txt', '/package.json', '/../package.json']) {
        const response = await request(port, 'GET', requestPath);
        assert.equal(response.status, 404, `${requestPath} 应返回 404`);
        assert.doesNotMatch(response.body, /COUNT_FIXTURE_UNREGISTERED/, `${requestPath} 不得泄露未登记文件内容`);
      }
    });
  });

  it('静态根目录不存在时静态路径 404，但计数 API 仍可用', async () => {
    await withStaticServer(MISSING_STATIC_ROOT, async ({ port }) => {
      const missing = await request(port, 'GET', '/index.html');
      assert.equal(missing.status, 404);

      const api = await request(port, 'GET', COUNT_PATH);
      assert.equal(api.status, 200);
      assert.equal(api.body, '{"count":0}');
    });
  });

  it('静态资源与计数 API 由同一实例同一端口提供（同源）', async () => {
    await withStaticServer(STATIC_FIXTURE_ROOT, async ({ port }) => {
      const page = await request(port, 'GET', '/about.html');
      const api = await request(port, 'POST', COUNT_PATH);
      assert.equal(page.status, 200);
      assert.equal(api.status, 200);
      assert.equal(api.body, '{"count":1}');
    });
  });
});
