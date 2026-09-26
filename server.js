'use strict';

// 五子棋静态服务：仅用 node:http、node:fs、node:path 与 process 建立白名单路由。
//
// 路由策略：
//   - 请求路径先归一出 pathname，再在 STATIC_ROUTES 中查表；查不到一律 404，不回任何文件内容。
//   - 命中后只以映射内的固定文件名在项目根目录（__dirname）读取，
//     绝不把请求路径拼进文件路径，因此不存在目录穿越。
//   - 白名单只有 gomoku.html、gomoku-rules.js、gomoku-ai.js 三个文件，
//     不提供任何对局状态或数据接口。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = __dirname;
const DEFAULT_PORT = 3000;
const HOST = '127.0.0.1';

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const JAVASCRIPT_CONTENT_TYPE = 'text/javascript; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

// 固定白名单：路径 -> { 根目录文件名, 响应内容类型 }。
// 使用无原型对象，避免 '/constructor'、'/toString' 等原型键被误判为已注册路径。
const STATIC_ROUTES = Object.freeze(Object.assign(Object.create(null), {
  '/': { file: 'gomoku.html', contentType: HTML_CONTENT_TYPE },
  '/gomoku.html': { file: 'gomoku.html', contentType: HTML_CONTENT_TYPE },
  '/gomoku-rules.js': { file: 'gomoku-rules.js', contentType: JAVASCRIPT_CONTENT_TYPE },
  '/gomoku-ai.js': { file: 'gomoku-ai.js', contentType: JAVASCRIPT_CONTENT_TYPE },
}));

// PORT 环境变量缺省值 3000；仅接受 0..65535 的十进制整数，其余一律回落缺省值。
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

// 只取 pathname：查询串与锚点不参与路由，归一化后的结果再查白名单。
function resolveRequestPath(requestUrl) {
  try {
    return new URL(requestUrl, `http://${HOST}`).pathname;
  } catch (error) {
    return null;
  }
}

function sendEmpty(res, status, extraHeaders) {
  res.writeHead(status, Object.assign({ 'content-type': TEXT_CONTENT_TYPE, 'content-length': 0 }, extraHeaders));
  res.end();
}

function handleRequest(req, res) {
  const requestPath = resolveRequestPath(req.url);
  const route = requestPath === null ? undefined : STATIC_ROUTES[requestPath];

  if (!route) {
    sendEmpty(res, 404);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendEmpty(res, 405, { allow: 'GET, HEAD' });
    return;
  }

  fs.readFile(path.join(ROOT_DIR, route.file), (error, data) => {
    if (error) {
      sendEmpty(res, 500);
      return;
    }
    res.writeHead(200, { 'content-type': route.contentType, 'content-length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function createServer() {
  return http.createServer(handleRequest);
}

// startServer() 以 process.env.PORT（缺省 3000）启动；startServer(0) 由操作系统分配临时端口。
function startServer(port) {
  const listenPort = port === undefined ? resolvePort(process.env.PORT) : port;
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, HOST, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const boundPort = address && typeof address === 'object' ? address.port : listenPort;
      resolve({ server, port: boundPort, host: HOST, url: `http://${HOST}:${boundPort}` });
    });
  });
}

if (require.main === module) {
  startServer()
    .then(({ url }) => {
      process.stdout.write(`五子棋静态服务已启动：${url}\n`);
    })
    .catch((error) => {
      process.stderr.write(`五子棋静态服务启动失败：${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { createServer, startServer, resolvePort, DEFAULT_PORT, STATIC_ROUTES };
