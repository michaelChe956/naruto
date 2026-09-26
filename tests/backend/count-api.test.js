'use strict';

// 计数读写 API 验收测试（TASK-003 / REQ-013 / AC-001 ~ AC-004）。
// 覆盖：GET 初值 0、POST 连续递增、非白名单方法 405 且不改状态、并发 POST 精确计数。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const { safeLoad, request, listenWithTempPort } = require('./helpers');

const { createCountStore } = safeLoad(path.join(__dirname, '..', '..', 'server', 'count-store.js'));
const { createRequestHandler } = safeLoad(path.join(__dirname, '..', '..', 'server', 'app.js'));

const COUNT_PATH = '/api/count';

function assertHandlerContract() {
  assert.equal(
    typeof createCountStore,
    'function',
    'server/count-store.js 应导出 createCountStore()',
  );
  assert.equal(
    typeof createRequestHandler,
    'function',
    'server/app.js 应导出 createRequestHandler({ countStore, staticRoot })',
  );
}

// 每个用例独享一个进程内服务实例与一份全新的计数状态。
async function withCountServer(run) {
  assertHandlerContract();
  const countStore = createCountStore();
  const server = http.createServer(createRequestHandler({ countStore, staticRoot: null }));
  const started = await listenWithTempPort(server);
  try {
    await run({ port: started.port, countStore });
  } finally {
    await started.close();
  }
}

function readCount(response) {
  assert.equal(
    response.headers['content-type'],
    'application/json; charset=utf-8',
    '计数响应应为 application/json; charset=utf-8',
  );
  const payload = JSON.parse(response.body);
  assert.deepEqual(payload, { count: payload.count }, '响应体应只有 count 字段');
  return payload.count;
}

describe('计数 API /api/count', () => {
  it('AC-001：新进程首次 GET 返回 200 与 {"count": 0}', async () => {
    await withCountServer(async ({ port }) => {
      const response = await request(port, 'GET', COUNT_PATH);
      assert.equal(response.status, 200);
      assert.equal(response.body, '{"count":0}');
      assert.equal(readCount(response), 0);
    });
  });

  it('AC-002：连续三次 POST 依次返回 1、2、3，随后 GET 返回 3', async () => {
    await withCountServer(async ({ port }) => {
      for (const expected of [1, 2, 3]) {
        const response = await request(port, 'POST', COUNT_PATH);
        assert.equal(response.status, 200);
        assert.equal(readCount(response), expected);
      }
      const finalResponse = await request(port, 'GET', COUNT_PATH);
      assert.equal(finalResponse.status, 200);
      assert.equal(finalResponse.body, '{"count":3}');
    });
  });

  it('AC-003：GET 与 POST 之外的方法返回 405 且不触碰计数状态', async () => {
    await withCountServer(async ({ port, countStore }) => {
      await request(port, 'POST', COUNT_PATH);
      const before = countStore.getCount();

      for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const response = await request(port, method, COUNT_PATH);
        assert.equal(response.status, 405, `${method} ${COUNT_PATH} 应返回 405`);
        assert.match(
          String(response.headers.allow || ''),
          /GET/,
          `405 响应的 Allow 头应列出 GET（${method}）`,
        );
        assert.match(
          String(response.headers.allow || ''),
          /POST/,
          `405 响应的 Allow 头应列出 POST（${method}）`,
        );
      }

      assert.equal(countStore.getCount(), before, '405 请求不得改动计数状态');
      const after = await request(port, 'GET', COUNT_PATH);
      assert.equal(readCount(after), before);
    });
  });

  it('AC-004：并发 N 次 POST 完成后 GET 的 count 精确等于 N', async () => {
    await withCountServer(async ({ port }) => {
      const total = 64;
      const responses = await Promise.all(
        Array.from({ length: total }, () => request(port, 'POST', COUNT_PATH)),
      );
      for (const response of responses) {
        assert.equal(response.status, 200);
      }

      const finalResponse = await request(port, 'GET', COUNT_PATH);
      assert.equal(readCount(finalResponse), total);

      const counts = responses.map(readCount).sort((left, right) => left - right);
      assert.deepEqual(
        counts,
        Array.from({ length: total }, (_, index) => index + 1),
        '并发 POST 的返回值应是 1..N 的一个排列',
      );
    });
  });
});
