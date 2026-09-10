'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { startService, requestHttp } = require('./helpers/service');

// 联调针对生产资产：默认数据文件与静态根目录均指向仓库内的真实 data/ 与 web/。
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const WEB_ROOT = path.join(PROJECT_ROOT, 'web');

test('以 port 0 启动后 resolve 的 origin 携带随机端口与 stop 入口', async () => {
  const instance = await startService({ staticRoot: WEB_ROOT });
  try {
    assert.ok(Number.isInteger(instance.port) && instance.port > 0, 'port 0 应解析为实际监听端口');
    assert.equal(instance.origin, `http://127.0.0.1:${instance.port}`);
    assert.equal(typeof instance.stop, 'function');
  } finally {
    await instance.stop();
  }
});

test('GET / 返回 200 且 HTML 含三个容器标记与 level-select.js 引用', async () => {
  const instance = await startService({ staticRoot: WEB_ROOT });
  try {
    const { status, contentType, text } = await requestHttp(instance.origin, '/');
    assert.equal(status, 200);
    assert.ok(contentType.startsWith('text/html'), '页面入口应为 HTML 响应');
    assert.ok(text.includes('id="loading"'), 'HTML 应包含 loading 容器标记');
    assert.ok(text.includes('id="level-list"'), 'HTML 应包含 level-list 容器标记');
    assert.ok(text.includes('id="error-message"'), 'HTML 应包含 error-message 容器标记');
    assert.match(text, /<script src="level-select\.js"><\/script>/, 'HTML 应引用 level-select.js');
  } finally {
    await instance.stop();
  }
});

test('GET /level-select.js 返回 200 且脚本含 /api/levels 相对路径引用', async () => {
  const instance = await startService({ staticRoot: WEB_ROOT });
  try {
    const { status, contentType, text } = await requestHttp(instance.origin, '/level-select.js');
    assert.equal(status, 200);
    assert.ok(contentType.startsWith('text/javascript'), '脚本应为 JavaScript 响应');
    assert.ok(text.includes("'/api/levels'"), '脚本应以相对路径引用 /api/levels');
  } finally {
    await instance.stop();
  }
});
