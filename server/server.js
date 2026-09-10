'use strict';

const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_PORT = 3000;
const PORT_ENV_VAR = 'PORT';
const API_LEVELS_PATH = '/api/levels';
const INDEX_FILE = 'index.html';
const DIFFICULTY_VALUES = new Set(['easy', 'normal', 'hard']);
const DEFAULT_DATA_PATH = path.resolve(__dirname, '..', 'data', 'levels.json');
const DEFAULT_STATIC_ROOT = path.resolve(__dirname, '..', 'web');

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function assertValidLevel(level, where) {
  if (typeof level !== 'object' || level === null || Array.isArray(level)) {
    throw new Error(`${where} 应为对象`);
  }
  ['id', 'name'].forEach((field) => {
    const value = level[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${where}.${field} 应为非空字符串`);
    }
  });
  if (!DIFFICULTY_VALUES.has(level.difficulty)) {
    throw new Error(`${where}.difficulty 应为 easy/normal/hard 之一`);
  }
  if (typeof level.unlocked !== 'boolean') {
    throw new Error(`${where}.unlocked 应为布尔值`);
  }
}

function validateLevels(raw) {
  if (!Array.isArray(raw)) {
    throw new Error('关卡数据顶层数组应为数组');
  }
  raw.forEach((level, index) => assertValidLevel(level, `levels[${index}]`));
  return raw;
}

async function loadLevels(dataPath) {
  const text = await readFile(dataPath, 'utf8');
  return validateLevels(JSON.parse(text));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

async function handleApiLevels(res, dataPath) {
  try {
    const levels = await loadLevels(dataPath);
    sendJson(res, 200, levels);
  } catch (error) {
    sendJson(res, 500, {
      code: 'LEVEL_DATA_UNAVAILABLE',
      message: '关卡数据缺失、不可读、解析失败或校验失败',
    });
  }
}

function resolveStaticPath(staticRoot, pathname) {
  const relative = pathname === '/' ? `/${INDEX_FILE}` : pathname;
  const resolved = path.resolve(staticRoot, `.${relative}`);
  if (resolved !== staticRoot && !resolved.startsWith(staticRoot + path.sep)) {
    return null;
  }
  return resolved;
}

async function handleStatic(res, pathname, staticRoot) {
  const filePath = resolveStaticPath(staticRoot, pathname);
  if (filePath === null) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  try {
    const content = await readFile(filePath);
    const contentType = CONTENT_TYPES.get(path.extname(filePath).toLowerCase())
      || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (error) {
    sendText(res, 404, 'Not Found');
  }
}

function createRequestHandler(config) {
  return async function handleRequest(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (error) {
      sendText(res, 400, 'Bad Request');
      return;
    }
    if (req.method === 'GET') {
      if (pathname === API_LEVELS_PATH) {
        await handleApiLevels(res, config.dataPath);
      } else {
        await handleStatic(res, pathname, config.staticRoot);
      }
      return;
    }
    sendText(res, 404, 'Not Found');
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeAllConnections();
  });
}

async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    stop: () => closeServer(server),
  };
}

function resolvePort(port) {
  if (port !== undefined && port !== null) {
    return port;
  }
  const fromEnv = Number(process.env[PORT_ENV_VAR]);
  if (Number.isInteger(fromEnv) && fromEnv >= 0) {
    return fromEnv;
  }
  return DEFAULT_PORT;
}

function createServer(options = {}) {
  const config = {
    dataPath: path.resolve(options.dataPath || DEFAULT_DATA_PATH),
    staticRoot: path.resolve(options.staticRoot || DEFAULT_STATIC_ROOT),
  };
  const server = http.createServer(createRequestHandler(config));
  server.start = ({ port } = {}) => listen(server, resolvePort(port));
  return server;
}

async function start(options = {}) {
  const { port, dataPath, staticRoot } = options;
  return createServer({ dataPath, staticRoot }).start({ port });
}

module.exports = {
  createServer,
  start,
};
