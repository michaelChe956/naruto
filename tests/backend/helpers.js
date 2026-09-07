'use strict';

const path = require('node:path');
const { createServer } = require('../../server/server.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const STATIC_FIXTURES_DIR = path.join(FIXTURES_DIR, 'static');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * 启动一个绑定到随机端口的测试服务器。
 * @param {object} [options] 覆盖 createServer 选项（dataPath/staticRoot/port）
 * @returns {Promise<{app: object, origin: string, port: number, stop: Function}>}
 */
async function startTestServer(options = {}) {
  const app = createServer({
    port: 0,
    staticRoot: STATIC_FIXTURES_DIR,
    ...options,
  });
  const info = await app.start();
  return { app, ...info };
}

/**
 * 构造 tests/backend/fixtures/ 下的夹具绝对路径。
 * @param {string} name 夹具文件名
 * @returns {string}
 */
function dataFixture(name) {
  return path.join(FIXTURES_DIR, name);
}

module.exports = {
  FIXTURES_DIR,
  STATIC_FIXTURES_DIR,
  REPO_ROOT,
  createServer,
  startTestServer,
  dataFixture,
};
