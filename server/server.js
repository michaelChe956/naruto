'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_DATA_PATH = path.join(REPO_ROOT, 'data', 'levels.json');
const DEFAULT_STATIC_ROOT = path.join(REPO_ROOT, 'web');
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

const STATIC_CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const VALID_DIFFICULTIES = ['简单', '普通', '困难'];

class LevelDataUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LevelDataUnavailableError';
  }
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': JSON_CONTENT_TYPE, ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, code, message, extraHeaders = {}) {
  sendJson(res, statusCode, { error: { code, message } }, extraHeaders);
}

function loadLevels(dataPath) {
  let raw;
  try {
    raw = fs.readFileSync(dataPath, 'utf8');
  } catch (err) {
    throw new LevelDataUnavailableError('关卡数据暂不可用，请稍后重试');
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LevelDataUnavailableError('关卡数据格式错误，请稍后重试');
  }

  validateLevels(parsed);
  return parsed;
}

function validateLevels(data) {
  if (!Array.isArray(data)) {
    throw new LevelDataUnavailableError('关卡数据必须是数组');
  }

  const seenIds = new Set();
  data.forEach((level, index) => {
    const where = `第 ${index + 1} 项`;
    if (level === null || typeof level !== 'object' || Array.isArray(level)) {
      throw new LevelDataUnavailableError(`${where}必须是关卡对象`);
    }
    if (typeof level.id !== 'string' || level.id.trim() === '') {
      throw new LevelDataUnavailableError(`${where} id 必须为非空字符串`);
    }
    if (seenIds.has(level.id)) {
      throw new LevelDataUnavailableError(`${where} id 重复: ${level.id}`);
    }
    seenIds.add(level.id);
    if (typeof level.name !== 'string' || level.name.trim() === '') {
      throw new LevelDataUnavailableError(`${where} name 必须为非空字符串`);
    }
    if (!VALID_DIFFICULTIES.includes(level.difficulty)) {
      throw new LevelDataUnavailableError(
        `${where} difficulty 必须属于 简单/普通/困难，实际: ${level.difficulty}`
      );
    }
    if (typeof level.unlocked !== 'boolean') {
      throw new LevelDataUnavailableError(`${where} unlocked 必须为布尔值`);
    }
  });
}

function handleApiLevels(req, res, context) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '仅支持 GET 方法', { Allow: 'GET' });
    return;
  }
  try {
    const levels = loadLevels(context.dataPath);
    sendJson(res, 200, levels);
  } catch (err) {
    const message =
      err instanceof LevelDataUnavailableError ? err.message : '关卡数据暂不可用，请稍后重试';
    sendError(res, 500, 'LEVEL_DATA_UNAVAILABLE', message);
  }
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': TEXT_CONTENT_TYPE });
  res.end(message);
}

function serveStatic(req, res, pathname, staticRoot) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '静态资源仅支持 GET 方法', { Allow: 'GET' });
    return;
  }

  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch (err) {
    sendText(res, 400, 'Bad Request');
    return;
  }

  const relativePath = decodedPathname === '/' ? 'index.html' : decodedPathname.replace(/^\//, '');
  const filePath = path.normalize(path.join(staticRoot, relativePath));
  const normalizedStaticRoot = path.normalize(staticRoot);
  const withinStaticRoot =
    filePath === normalizedStaticRoot || filePath.startsWith(normalizedStaticRoot + path.sep);
  if (!withinStaticRoot) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') {
        sendText(res, 404, 'Not Found');
      } else {
        sendError(res, 500, 'INTERNAL_ERROR', '静态资源服务暂时不可用');
      }
      return;
    }
    const contentType =
      STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

function handleRequest(req, res, context) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/levels') {
    handleApiLevels(req, res, context);
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    sendError(res, 404, 'NOT_FOUND', '未知 API 路径');
    return;
  }
  serveStatic(req, res, url.pathname, context.staticRoot);
}

function createServer(options = {}) {
  const context = {
    dataPath: options.dataPath || DEFAULT_DATA_PATH,
    staticRoot: options.staticRoot || DEFAULT_STATIC_ROOT,
  };
  return http.createServer((req, res) => {
    handleRequest(req, res, context);
  });
}

function resolvePort(port) {
  if (port !== undefined) {
    return port;
  }
  const envPort = Number(process.env.PORT);
  if (Number.isInteger(envPort) && envPort > 0) {
    return envPort;
  }
  return DEFAULT_PORT;
}

function start(options = {}) {
  const port = resolvePort(options.port);
  const server = createServer(options);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, DEFAULT_HOST, () => {
      const actualPort = server.address().port;
      resolve({
        origin: `http://${DEFAULT_HOST}:${actualPort}`,
        port: actualPort,
        stop() {
          return new Promise((resolveStop, rejectStop) => {
            server.close((err) => {
              if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
                rejectStop(err);
                return;
              }
              resolveStop();
            });
          });
        },
      });
    });
  });
}

module.exports = {
  createServer,
  start,
};

if (require.main === module) {
  start().then(
    ({ origin }) => {
      process.stdout.write(`naruto h5 服务已启动: ${origin}\n`);
    },
    (err) => {
      process.stderr.write(`服务启动失败: ${err.message}\n`);
      process.exitCode = 1;
    }
  );
}
