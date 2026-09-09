'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const SERVER_ENTRY_PATH = path.join(__dirname, '..', 'server.js');
const HOST = '127.0.0.1';
const PORT = 3000;
const REQUEST_PATH = '/api/hello';
const EXPECTED_BODY = '{"message":"hello"}';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestHello() {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: HOST, port: PORT, path: REQUEST_PATH }, (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body });
      });
    });
    request.setTimeout(1000, () => {
      request.destroy(new Error('单次请求超时'));
    });
    request.on('error', reject);
  });
}

test(`GET ${REQUEST_PATH} 返回 200 且 body 恰为 ${EXPECTED_BODY}`, async (t) => {
  const server = spawn(process.execPath, [SERVER_ENTRY_PATH], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  t.after(() => {
    server.kill();
  });

  let stderrText = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => {
    stderrText += chunk;
  });

  const startupFailure = new Promise((_, reject) => {
    server.once('error', (error) => {
      reject(new Error(`server 进程启动失败：${error.message}`));
    });
    server.once('exit', (code, signal) => {
      reject(new Error(`server 进程提前退出 (code=${code}, signal=${signal})\n${stderrText}`));
    });
  });
  // 成功路径下该 Promise 不会 resolve，挂空 catch 避免 unhandled rejection
  startupFailure.catch(() => {});

  let response = null;
  let lastError = null;
  const deadline = Date.now() + 5000;
  while (response === null && Date.now() < deadline) {
    try {
      response = await Promise.race([requestHello(), sleep(1000).then(() => null)]);
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }

  if (response === null) {
    throw new Error(
      `服务未在 5 秒内就绪：${lastError ? lastError.message : '请求超时'}\n${stderrText}`,
    );
  }

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body, EXPECTED_BODY);
});
