'use strict';

/**
 * Hello API 契约测试（node --test）。
 *
 * 契约（AC-001）：
 *   WHEN config/hello.json 就位（如 {"message":"hello"}）
 *   且客户端请求 GET /api/hello
 *   THEN 返回 200，且 body 恰为该文件的完整 JSON 内容。
 *
 * 约束：
 *   - 本测试不得创建或修改 config/ 下任何文件；
 *     config/hello.json 属于验证环境就位的前置条件（AC-001 WHEN 条款），
 *     未就位时本测试以明确的断言失败报告前置条件缺失。
 *   - 期望值在测试运行时从仓库根目录 config/hello.json 读取，
 *     以验证 server 在运行时读取该文件而非返回硬编码内容。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const SERVER_PATH = path.join(REPO_ROOT, 'server.js');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'hello.json');
const BASE_URL = 'http://127.0.0.1:3000';

/**
 * 轮询 GET /api/hello 直至服务就绪或超时。
 * 仅在连接被接受（服务已监听）后才返回响应。
 */
async function requestOnceServerReady(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = new Error('request not attempted');
  while (Date.now() < deadline) {
    try {
      return await fetch(`${BASE_URL}/api/hello`);
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.fail(
    `server at ${BASE_URL} did not become ready within ${timeoutMs}ms: ${lastError.message}`
  );
}

test('GET /api/hello returns 200 with the exact content of config/hello.json', async (t) => {
  // 前置条件：config/hello.json 必须由验证环境就位（本测试不创建/不修改 config/）。
  assert.ok(
    fs.existsSync(CONFIG_PATH),
    `precondition not met: ${CONFIG_PATH} must be in place before running this test (see AC-001)`
  );

  // 期望值：测试运行时读取仓库根目录 config/hello.json 的完整内容。
  const expected = fs.readFileSync(CONFIG_PATH, 'utf8');

  // 启动被测服务（仅使用 node:http，监听 127.0.0.1:3000）。
  const server = spawn(process.execPath, [SERVER_PATH], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    server.kill('SIGTERM');
  });

  const response = await requestOnceServerReady();

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body, expected);
});
