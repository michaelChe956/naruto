'use strict';

// tests/integration/helpers.js — 集成测试共用工具（TASK-011 / AC-016）
//
// 以 port 为 0 启动真实服务（server/server.js 的 createServer），
// 默认不覆盖 dataPath/staticRoot，即直接使用仓库真实产物：
//   - dataPath  → data/levels.json
//   - staticRoot → web/
// 在同一 origin（http://127.0.0.1:<实际端口>）上完成页面结构与 API 的同源验证；
// 需要注入集成自有夹具时显式传 options.dataPath。

const path = require('node:path');
const { createServer } = require('../../server/server.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/**
 * 以 port 为 0 启动集成验证服务。
 * @param {object} [options] 覆盖 createServer 选项（dataPath/staticRoot/port）
 * @returns {Promise<{app: object, origin: string, port: number, stop: Function}>}
 */
async function startIntegrationServer(options = {}) {
  const app = createServer({ port: 0, ...options });
  const info = await app.start();
  return { app, ...info };
}

/**
 * 构造 tests/integration/fixtures/ 下的集成自有夹具绝对路径。
 * @param {string} name 夹具文件名
 * @returns {string}
 */
function integrationFixture(name) {
  return path.join(FIXTURES_DIR, name);
}

module.exports = {
  REPO_ROOT,
  FIXTURES_DIR,
  createServer,
  startIntegrationServer,
  integrationFixture,
};
