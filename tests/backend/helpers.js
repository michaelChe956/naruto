'use strict';

// tests/backend/helpers.js — 测试共享辅助（非 *.test.js，不会被测试运行器执行）
//
// - startTestServer(options)：以 port 0 启动绑定夹具目录的服务器实例
// - dataFixture(name)：构造 tests/backend/fixtures/ 下夹具绝对路径
// - request(options)：基于 node:http 的原始请求（不做客户端路径规范化，
//   用于触发路径穿越等分支）

const http = require('node:http');
const path = require('node:path');
const { createServer, loadLevels } = require('../../server/server.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const STATIC_FIXTURES_DIR = path.join(FIXTURES_DIR, 'static');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const serverModule = path.join(REPO_ROOT, 'server', 'server.js');

/**
 * 启动一个绑定随机端口的测试服务器。
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
 * 构造 fixtures 目录下夹具的绝对路径。
 * @param {string} name 夹具文件名
 * @returns {string}
 */
function dataFixture(name) {
  return path.join(FIXTURES_DIR, name);
}

/**
 * 发送原始 HTTP 请求并收集响应。
 * @param {object} options
 * @param {string} options.port 目标端口
 * @param {string} options.path 请求路径（原样发送，不做规范化）
 * @param {string} [options.method] 请求方法，默认 GET
 * @returns {Promise<{status: number, headers: http.IncomingHttpHeaders, body: Buffer}>}
 */
function request({ port, path: requestPath, method = 'GET' }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, method },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * 期望请求失败（服务已停止）。不限定具体 TCP 错误码：
 * 内核可能对停止瞬间仍在 backlog 中的连接完成握手后发 RST，
 * 客户端表现为 ECONNRESET 而非 ECONNREFUSED；契约只要求服务不再响应。
 * @param {object} options 同 request()
 * @returns {Promise<string>} 实际连接错误码
 */
async function expectConnectionFailure(options) {
  try {
    await request(options);
  } catch (error) {
    if (error instanceof Error && error.code) {
      return error.code;
    }
    throw error;
  }
  throw new Error('期望连接失败，但请求成功了');
}

module.exports = {
  FIXTURES_DIR,
  STATIC_FIXTURES_DIR,
  REPO_ROOT,
  serverModule,
  createServer,
  loadLevels,
  startTestServer,
  dataFixture,
  request,
  expectConnectionFailure,
};
