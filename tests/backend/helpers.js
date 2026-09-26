'use strict';

// 后端验收测试共用工具：只用 Node 内置模块发起真实 HTTP 请求与启动真实进程。

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const SERVER_ENTRY = path.join(ROOT_DIR, 'server', 'index.js');
const STATIC_FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'static');

// 实现缺失时保留可读的断言失败，而不是不可读的模块加载错误（TDD 红灯可逐条阅读）。
function safeLoad(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    return {};
  }
}

function request(port, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: requestPath },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

// 以临时端口（0）在进程内启动一个服务实例，返回端口与关闭函数。
async function listenWithTempPort(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// 以进程入口启动真实子进程，等待标准输出出现 COUNT_SERVER_LISTENING 标记行后返回。
function startEntry(args = [], env = {}) {
  const child = spawn(process.execPath, [SERVER_ENTRY, ...args], {
    cwd: ROOT_DIR,
    env: Object.assign({}, process.env, { PORT: '0' }, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`进程入口未在超时前打印监听标记。stdout=${stdout} stderr=${stderr}`));
    }, 10000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const match = stdout.match(/^COUNT_SERVER_LISTENING\s+(\S+)\s*$/m);
      if (match) {
        clearTimeout(timer);
        const origin = match[1];
        resolve({ origin, port: Number.parseInt(new URL(origin).port, 10) });
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`进程入口提前退出 code=${code} signal=${signal} stderr=${stderr}`));
    });
  });

  return {
    child,
    ready,
    getStdout: () => stdout,
    getStderr: () => stderr,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}

module.exports = {
  ROOT_DIR,
  SERVER_ENTRY,
  STATIC_FIXTURE_ROOT,
  safeLoad,
  request,
  listenWithTempPort,
  startEntry,
};
