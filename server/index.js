'use strict';

const http = require('node:http');
const path = require('node:path');

const { readLevels } = require('./levels-store');
const { handleStaticRequest } = require('./static-files');
const { sendError, sendJson } = require('./responses');

const LEVELS_API_PREFIX = '/api/';
const LEVELS_API_PATH = '/api/levels';

const DEFAULT_PORT = 3000;
const DEFAULT_DATA_PATH = path.join(process.cwd(), 'data', 'levels.json');
const DEFAULT_STATIC_ROOT = path.join(process.cwd(), 'web');

const DATA_UNAVAILABLE_CODE = 'LEVEL_DATA_UNAVAILABLE';
const DATA_UNAVAILABLE_MESSAGE = '暂时无法加载关卡数据，请稍后重试';

// 端口解析顺序：显式端口 > PORT 环境变量（0 表示随机端口）> 默认端口。
function resolvePort(port, env = process.env) {
  if (port !== undefined && port !== null) {
    return port;
  }
  if (env && env.PORT !== undefined && env.PORT !== '') {
    if (/^\d+$/.test(env.PORT)) {
      return Number.parseInt(env.PORT, 10);
    }
  }
  return DEFAULT_PORT;
}

async function handleApiRequest(req, res, pathname, dataPath) {
  if (pathname !== LEVELS_API_PATH) {
    sendError(res, 404, 'NOT_FOUND', '请求的 API 资源不存在');
    return;
  }
  if (req.method !== 'GET') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '不支持的请求方法', { Allow: 'GET' });
    return;
  }
  const result = await readLevels(dataPath);
  if (!result.ok) {
    sendError(res, 500, DATA_UNAVAILABLE_CODE, DATA_UNAVAILABLE_MESSAGE);
    return;
  }
  sendJson(res, 200, result.levels);
}

function createServer({ dataPath, staticRoot } = {}) {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const handle = pathname.startsWith(LEVELS_API_PREFIX)
      ? handleApiRequest(req, res, pathname, dataPath)
      : handleStaticRequest(req, res, pathname, staticRoot);
    handle.catch(() => {
      if (!res.headersSent) {
        sendError(res, 500, DATA_UNAVAILABLE_CODE, DATA_UNAVAILABLE_MESSAGE);
      } else {
        res.end();
      }
    });
  });
}

async function start({ port, dataPath = DEFAULT_DATA_PATH, staticRoot = DEFAULT_STATIC_ROOT } = {}) {
  const server = createServer({ dataPath, staticRoot });
  const listenPort = resolvePort(port);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const { port: actualPort } = server.address();
  return {
    origin: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

module.exports = { DEFAULT_PORT, createServer, resolvePort, start };
