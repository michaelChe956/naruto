'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const { loadLevels, LevelDataError, LEVEL_DATA_ERROR_CODE } = require('./levels');

// 交付契约常量（handoff：api_path / default_port / port_env）
const API_PATH = '/api/levels';
const DEFAULT_PORT = 3000;
const PORT_ENV = 'PORT';

const DEFAULT_DATA_PATH = path.join(__dirname, '..', 'data', 'levels.json');
const DEFAULT_STATIC_ROOT = path.join(__dirname, '..', 'web');
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': TEXT_CONTENT_TYPE,
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': JSON_CONTENT_TYPE, ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, code, message, extraHeaders = {}) {
  sendJson(res, statusCode, { error: { code, message } }, extraHeaders);
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': TEXT_CONTENT_TYPE });
  res.end(message);
}

function handleApiRequest(res, pathname, options) {
  if (pathname !== API_PATH) {
    sendError(res, 404, 'NOT_FOUND', `未知 API 路径：${pathname}`);
    return;
  }
  try {
    const levels = loadLevels(options.dataPath);
    sendJson(res, 200, levels);
  } catch (error) {
    if (error instanceof LevelDataError) {
      sendError(res, 500, LEVEL_DATA_ERROR_CODE, error.message);
    } else {
      throw error;
    }
  }
}

function parseRawPathname(rawUrl) {
  // 直接取原始请求路径（仅剥离 query 与 hash），不做 URL 层规范化，
  // 以便后续由 node:path 统一规范化并显式拒绝越界访问
  return (rawUrl || '/').split('?')[0].split('#')[0];
}

function serveStatic(res, rawPathname, options) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch (error) {
    sendText(res, 400, '非法的请求路径');
    return;
  }

  const rootPath = path.resolve(options.staticRoot);
  // 拼接后由 path.resolve 做 node:path 规范化并真实解算 ..，
  // 随后强制校验目标落在静态根之内，越界即显式拒绝
  const targetPath = path.resolve(rootPath, `.${decoded}`);
  if (targetPath !== rootPath && !targetPath.startsWith(rootPath + path.sep)) {
    sendText(res, 403, '禁止访问静态根之外的资源');
    return;
  }

  let filePath = targetPath;
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    stat = null;
  }
  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      stat = null;
    }
  }
  if (!stat || !stat.isFile()) {
    sendText(res, 404, '资源不存在');
    return;
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

function createRequestHandler(options) {
  return (req, res) => {
    try {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET') {
        sendError(res, 405, 'METHOD_NOT_ALLOWED', `不支持的 HTTP 方法：${method}`, { Allow: 'GET' });
        return;
      }

      const pathname = parseRawPathname(req.url);
      if (pathname === API_PATH || pathname.startsWith('/api/')) {
        handleApiRequest(res, pathname, options);
        return;
      }

      serveStatic(res, pathname, options);
    } catch (error) {
      sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
    }
  };
}

function resolvePort(port) {
  if (port !== undefined) {
    if (!Number.isInteger(port) || port < 0) {
      throw new TypeError(`port 必须是非负整数，实际为：${String(port)}`);
    }
    return port;
  }

  const envValue = process.env[PORT_ENV];
  if (envValue !== undefined && envValue !== '') {
    const parsed = Number(envValue);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_PORT;
}

function createServer(options = {}) {
  const resolvedOptions = {
    dataPath: options.dataPath ?? DEFAULT_DATA_PATH,
    staticRoot: options.staticRoot ?? DEFAULT_STATIC_ROOT,
  };
  const httpServer = http.createServer(createRequestHandler(resolvedOptions));

  function stop() {
    if (!httpServer.listening) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
      // 释放 keep-alive 空闲连接，保证 stop 后端口立即可复用
      httpServer.closeIdleConnections();
      httpServer.closeAllConnections();
    });
  }

  async function start({ port } = {}) {
    const listenPort = resolvePort(port);
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(listenPort, () => {
        httpServer.removeListener('error', reject);
        resolve();
      });
    });

    const address = httpServer.address();
    const actualPort = address !== null && typeof address === 'object' ? address.port : listenPort;
    return {
      port: actualPort,
      origin: `http://127.0.0.1:${actualPort}`,
      stop,
    };
  }

  return { start, stop };
}

async function start(options = {}) {
  const { port, ...serverOptions } = options;
  const instance = createServer(serverOptions);
  return instance.start({ port });
}

module.exports = {
  API_PATH,
  DEFAULT_PORT,
  PORT_ENV,
  createServer,
  start,
};

if (require.main === module) {
  start({})
    .then((handle) => {
      process.on('SIGINT', () => {
        handle.stop().then(() => process.exit(0));
      });
      console.log(`naruto 服务已启动：${handle.origin}`);
    })
    .catch((error) => {
      console.error(`naruto 服务启动失败：${error.message}`);
      process.exitCode = 1;
    });
}
