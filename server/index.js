'use strict';

// 进程入口（REQ-014 / AC-006、AC-007、AC-008）。
//
// 用法：
//   node server/index.js [--static-root <目录> | <目录>]
//
// 契约：
//   - 监听端口取 PORT 环境变量（缺省 3000），PORT=0 时由操作系统分配临时端口；
//   - 静态根目录取命令行参数（--static-root/--root 或首个位置参数），其次 STATIC_ROOT，
//     最后回落仓库内 web/ 目录；目录不存在时静态路径一律 404；
//   - 启动成功后向标准输出打印一行 `COUNT_SERVER_LISTENING <实际监听地址>`；
//   - 计数状态只在内存中，进程重启后回到 0。

const http = require('node:http');
const path = require('node:path');

const { createCountStore } = require('./count-store');
const { createRequestHandler } = require('./app');

const HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_STATIC_ROOT_NAME = 'web';
const LISTENING_MARKER = 'COUNT_SERVER_LISTENING';
const STATIC_ROOT_FLAGS = new Set(['--static-root', '--root']);

// PORT 只接受 0..65535 的十进制整数；缺省或非法值一律回落 DEFAULT_PORT。
function resolvePort(rawPort) {
  if (rawPort === undefined || rawPort === null) {
    return DEFAULT_PORT;
  }
  const text = String(rawPort).trim();
  if (!/^\d+$/.test(text)) {
    return DEFAULT_PORT;
  }
  const port = Number.parseInt(text, 10);
  return port >= 0 && port <= 65535 ? port : DEFAULT_PORT;
}

// 从命令行取出静态根目录：先认 --static-root/--root（含 --flag=value 形式），再认位置参数。
function parseStaticRootArg(argv) {
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const separator = arg.indexOf('=');
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    if (!STATIC_ROOT_FLAGS.has(flag)) {
      continue;
    }
    if (separator !== -1) {
      const inlineValue = arg.slice(separator + 1);
      return inlineValue === '' ? null : inlineValue;
    }
    const nextValue = args[index + 1];
    return nextValue === undefined || nextValue.startsWith('--') ? null : nextValue;
  }

  const positional = args.find((arg) => !arg.startsWith('--'));
  return positional === undefined || positional === '' ? null : positional;
}

function resolveStaticRoot(argv = process.argv, env = process.env) {
  const fromArg = parseStaticRootArg(argv);
  if (fromArg !== null) {
    return path.resolve(process.cwd(), fromArg);
  }

  const fromEnv = typeof env.STATIC_ROOT === 'string' ? env.STATIC_ROOT.trim() : '';
  if (fromEnv !== '') {
    return path.resolve(process.cwd(), fromEnv);
  }

  return path.join(__dirname, '..', DEFAULT_STATIC_ROOT_NAME);
}

// 启动同一进程内的同一端口：计数 API 与静态资源由同一个 http server 提供。
function startServer({ port, staticRoot } = {}) {
  const listenPort = port === undefined ? resolvePort(process.env.PORT) : port;
  const serveRoot = staticRoot === undefined ? resolveStaticRoot() : staticRoot;

  const countStore = createCountStore();
  const server = http.createServer(createRequestHandler({ countStore, staticRoot: serveRoot }));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, HOST, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const boundPort = address && typeof address === 'object' ? address.port : listenPort;
      const origin = `http://${HOST}:${boundPort}`;
      resolve({
        server,
        countStore,
        port: boundPort,
        host: HOST,
        origin,
        staticRoot: serveRoot,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (require.main === module) {
  startServer()
    .then(({ origin }) => {
      process.stdout.write(`${LISTENING_MARKER} ${origin}\n`);
    })
    .catch((error) => {
      process.stderr.write(`count server 启动失败：${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  HOST,
  DEFAULT_PORT,
  LISTENING_MARKER,
  resolvePort,
  parseStaticRootArg,
  resolveStaticRoot,
  startServer,
};
