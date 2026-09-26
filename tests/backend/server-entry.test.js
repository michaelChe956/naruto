'use strict';

// 进程入口验收测试（TASK-004 / REQ-014 / AC-005 ~ AC-008）。
// 覆盖：PORT 环境变量启动并打印 COUNT_SERVER_LISTENING 监听标记、重启后计数归零、
//       测试静态根目录参数投递资源、package.json 声明的启动脚本与验收测试脚本。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROOT_DIR, STATIC_FIXTURE_ROOT, request, startEntry } = require('./helpers');

const COUNT_PATH = '/api/count';
const LISTENING_MARKER = 'COUNT_SERVER_LISTENING';

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
}

describe('进程入口 server/index.js', () => {
  it('REQ-014：package.json 声明单条启动脚本与 pnpm test 验收测试脚本', () => {
    const pkg = readPackageJson();
    assert.equal(typeof pkg.scripts, 'object', 'package.json 应声明 scripts');
    assert.equal(
      pkg.scripts.start,
      'node server/index.js',
      'scripts.start 应是单条同源启动命令',
    );
    assert.match(
      String(pkg.scripts.test || ''),
      /^node --test "tests\/backend\/\*\.test\.js"$/,
      'scripts.test 应通过 node --test 运行 tests/backend 验收测试',
    );
  });

  it('AC-006：PORT=0 启动后打印实际监听地址并可被 HTTP 客户端访问', async () => {
    const entry = startEntry();
    try {
      const { origin, port } = await entry.ready;
      assert.ok(Number.isInteger(port) && port > 0, `监听标记应包含实际端口：${entry.getStdout()}`);
      assert.equal(new URL(origin).hostname, '127.0.0.1');

      const listeningLines = entry
        .getStdout()
        .split('\n')
        .filter((line) => line.startsWith(LISTENING_MARKER));
      assert.equal(listeningLines.length, 1, '标准输出应恰好有一行监听标记');
      assert.ok(listeningLines[0].includes(origin), '监听标记行应包含实际监听地址');

      const response = await request(port, 'GET', COUNT_PATH);
      assert.equal(response.status, 200);
      assert.equal(response.body, '{"count":0}');
    } finally {
      await entry.stop();
    }
  });

  it('AC-007：计数非 0 时重启服务进程，重启后 GET 返回 {"count": 0}', async () => {
    const first = startEntry();
    let firstPort;
    try {
      ({ port: firstPort } = await first.ready);
      for (const expected of [1, 2, 3]) {
        const response = await request(firstPort, 'POST', COUNT_PATH);
        assert.equal(JSON.parse(response.body).count, expected);
      }
    } finally {
      await first.stop();
    }

    const second = startEntry();
    try {
      const { port: secondPort } = await second.ready;
      assert.notEqual(secondPort, undefined);
      const response = await request(secondPort, 'GET', COUNT_PATH);
      assert.equal(response.status, 200);
      assert.equal(response.body, '{"count":0}');
    } finally {
      await second.stop();
    }
  });

  it('AC-008：以测试静态根目录参数启动时同源投递 HTML 资源并对未登记路径返回 404', async () => {
    for (const args of [
      ['--static-root', STATIC_FIXTURE_ROOT],
      [STATIC_FIXTURE_ROOT],
    ]) {
      const entry = startEntry(args);
      try {
        const { port } = await entry.ready;
        const page = await request(port, 'GET', '/about.html');
        assert.equal(page.status, 200, `args=${JSON.stringify(args)} 应投递静态根目录内的 HTML`);
        assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
        assert.match(page.body, /COUNT_FIXTURE_ABOUT/);

        const missing = await request(port, 'GET', '/missing.html');
        assert.equal(missing.status, 404, `args=${JSON.stringify(args)} 未登记路径应返回 404`);

        const api = await request(port, 'GET', COUNT_PATH);
        assert.equal(api.status, 200);
        assert.equal(api.body, '{"count":0}');
      } finally {
        await entry.stop();
      }
    }
  });
});
