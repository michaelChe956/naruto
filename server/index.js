'use strict';

// 关卡服务入口（work_item_revision_d9c22cc01fc1b5cbb327337f）。
// 仅依赖 Node 内置模块，单进程同时提供 GET /api/levels 与静态页面托管。
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const JSON_UTF8 = 'application/json; charset=utf-8';
const TEXT_UTF8 = 'text/plain; charset=utf-8';
const LEVEL_DATA_ERROR = 'LEVEL_DATA_UNAVAILABLE';
const LEVEL_DIFFICULTIES = ['简单', '普通', '困难'];
const DEFAULT_PORT = 3000;

function levelDataError(message) {
  const error = new Error(message);
  error.code = LEVEL_DATA_ERROR;
  return error;
}

// EXE-006 字段约束：数组；每项含非空唯一 id、非空 name、difficulty（简单/普通/困难）、布尔 unlocked。
function validateLevels(value) {
  if (!Array.isArray(value)) {
    throw levelDataError('关卡数据必须是数组');
  }
  const seenIds = new Set();
  value.forEach((level, index) => {
    const where = `第 ${index + 1} 个关卡`;
    if (!level || typeof level !== 'object' || Array.isArray(level)) {
      throw levelDataError(`${where}必须是对象`);
    }
    if (typeof level.id !== 'string' || level.id.length === 0) {
      throw levelDataError(`${where}的 id 必须是非空字符串`);
    }
    if (seenIds.has(level.id)) {
      throw levelDataError(`${where}的 id「${level.id}」重复`);
    }
    seenIds.add(level.id);
    if (typeof level.name !== 'string' || level.name.length === 0) {
      throw levelDataError(`${where}的 name 必须是非空字符串`);
    }
    if (!LEVEL_DIFFICULTIES.includes(level.difficulty)) {
      throw levelDataError(`${where}的 difficulty 必须是「简单」「普通」「困难」之一`);
    }
    if (typeof level.unlocked !== 'boolean') {
      throw levelDataError(`${where}的 unlocked 必须是布尔值`);
    }
  });
  return value;
}

async function readLevels(dataPath) {
  let raw;
  try {
    raw = await fs.readFile(dataPath, 'utf8');
  } catch (error) {
    throw levelDataError(`关卡数据文件不可读：${error.code ?? error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw levelDataError(`关卡数据不是合法 JSON：${error.message}`);
  }
  return validateLevels(parsed);
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': JSON_UTF8, ...extraHeaders });
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': TEXT_UTF8 });
  res.end(`${body}\n`);
}

// API-002 错误结构：{ error: { code, message } }
function apiError(code, message) {
  return { error: { code, message } };
}

async function handleApiRequest(req, res, pathname, dataPath) {
  if (pathname === '/api/levels') {
    if (req.method !== 'GET') {
      return sendJson(res, 405, apiError('METHOD_NOT_ALLOWED', `方法 ${req.method} 不被支持，请使用 GET`), { Allow: 'GET' });
    }
    try {
      const levels = await readLevels(dataPath);
      return sendJson(res, 200, levels);
    } catch (error) {
      return sendJson(res, 500, apiError(LEVEL_DATA_ERROR, error.message));
    }
  }
  return sendJson(res, 404, apiError('NOT_FOUND', `未知 API 路径：${pathname}`));
}

const STATIC_CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// 以 node:path 规范化解析请求路径并与 staticRoot 前缀比对；返回 null 表示越界/非法，拒绝解析到根之外。
function resolveStaticTarget(staticRoot, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '');
  const target = path.resolve(staticRoot, relative === '' ? 'index.html' : relative);
  const normalizedRoot = staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`;
  if (target !== staticRoot && !target.startsWith(normalizedRoot)) {
    return null;
  }
  return target;
}

async function serveStatic(req, res, pathname, staticRoot) {
  if (req.method !== 'GET') {
    return sendText(res, 405, 'Method Not Allowed');
  }
  const target = resolveStaticTarget(staticRoot, pathname);
  if (target === null) {
    return sendText(res, 403, 'Forbidden');
  }
  let content;
  try {
    content = await fs.readFile(target);
  } catch (error) {
    if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) {
      return sendText(res, 404, 'Not Found');
    }
    throw error;
  }
  const contentType = STATIC_CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}

// 直接取原始请求路径（去掉 query）。不用 new URL 解析：它会将 /../ 段静默规范化，
// 使越界请求伪装成根内路径，绕过 TASK-003 要求的越界拒绝。
function requestPathname(url) {
  const raw = url ?? '/';
  const queryIndex = raw.indexOf('?');
  return queryIndex === -1 ? raw : raw.slice(0, queryIndex);
}

function createServer(options = {}) {
  const dataPath = options.dataPath ?? path.join(__dirname, '..', 'data', 'levels.json');
  const staticRoot = path.resolve(options.staticRoot ?? path.join(__dirname, '..', 'web'));
  return http.createServer((req, res) => {
    Promise.resolve()
      .then(() => {
        const pathname = requestPathname(req.url);
        if (pathname.startsWith('/api/')) {
          return handleApiRequest(req, res, pathname, dataPath);
        }
        return serveStatic(req, res, pathname, staticRoot);
      })
      .catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': TEXT_UTF8 });
        }
        res.end('Internal Server Error\n');
      });
  });
}

function resolveDefaultPort() {
  const parsed = Number.parseInt(process.env.PORT, 10);
  return Number.isInteger(parsed) ? parsed : DEFAULT_PORT;
}

// start({ port, ...createServer 选项 }) → { server, port, origin, stop() }；
// port 缺省取 PORT 环境变量，再缺省 3000；port 0 由系统分配并在结果中回带实际端口。
function start(options = {}) {
  const port = Object.hasOwn(options, 'port') ? options.port : resolveDefaultPort();
  const { port: _ignored, ...serverOptions } = options;
  const server = createServer(serverOptions);
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return listening.then(() => {
    const { port: actualPort } = server.address();
    return {
      server,
      port: actualPort,
      origin: `http://127.0.0.1:${actualPort}`,
      stop: () =>
        new Promise((resolve, reject) => {
          if (!server.listening) {
            return resolve();
          }
          server.closeIdleConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    };
  });
}

module.exports = { createServer, start, validateLevels, LEVEL_DIFFICULTIES };
