'use strict';

// server/server.js — 关卡服务入口（仅使用 Node 内置模块：node:http / node:fs / node:path）
//
// 契约（Work Item work_item_revision_1bf89e67eebe54ed83e02e4e）：
//   - GET /api/levels       → 200 JSON 顶层数组（恰好五项，满足字段级约束）
//   - 数据缺失/校验失败      → 500 JSON 错误 LEVEL_DATA_UNAVAILABLE
//   - 未知 API 路径          → 404 JSON 错误 NOT_FOUND
//   - 非允许方法             → 405 JSON 错误 METHOD_NOT_ALLOWED
//   - 静态资源               → GET / 返回根目录默认页面；按扩展名返回 Content-Type；
//                              越界路径与缺失资源返回 404 文本响应
//   - 导出 createServer、start、stop；默认端口 3000，可经 PORT 环境变量覆盖
//     （优先级：start({ port }) > createServer({ port }) > PORT > 3000）
//   - start({ port: 0 }) 解析为 { origin, port, stop }，origin 为 http://127.0.0.1:<实际端口>

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_PORT = 3000;
const DEFAULT_DATA_PATH = path.resolve(__dirname, '..', 'data', 'levels.json');
const DEFAULT_STATIC_ROOT = path.resolve(__dirname, '..', 'web');
const EXACT_LEVEL_COUNT = 5;

const VALID_DIFFICULTIES = new Set(['简单', '普通', '困难']);
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

const STATIC_CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/**
 * 校验关卡数据（TASK-002 / EXE-006 字段级约束）。任一不满足即判定数据无效：
 *   - 顶层数组且恰好五项
 *   - 关卡项为对象
 *   - id 为非空字符串且文件内唯一
 *   - name 为非空字符串
 *   - difficulty 属于 {简单, 普通, 困难}
 *   - unlocked 为布尔
 * @param {*} parsed 已 JSON.parse 的数据
 * @returns {string|null} 无效原因；有效返回 null
 */
function validateLevelsData(parsed) {
  if (!Array.isArray(parsed)) {
    return '关卡数据顶层必须是数组';
  }
  if (parsed.length !== EXACT_LEVEL_COUNT) {
    return `关卡数据必须恰好 ${EXACT_LEVEL_COUNT} 项`;
  }
  const seenIds = new Set();
  for (const item of parsed) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return '关卡项必须是对象';
    }
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      return '关卡 id 必须是非空字符串';
    }
    if (seenIds.has(item.id)) {
      return '关卡 id 必须在文件内唯一';
    }
    seenIds.add(item.id);
    if (typeof item.name !== 'string' || item.name.trim() === '') {
      return '关卡 name 必须是非空字符串';
    }
    if (!VALID_DIFFICULTIES.has(item.difficulty)) {
      return '关卡 difficulty 必须是 简单、普通、困难 之一';
    }
    if (typeof item.unlocked !== 'boolean') {
      return '关卡 unlocked 必须是布尔值';
    }
  }
  return null;
}

/**
 * 读取并校验关卡数据。任何读取/解析/校验失败都归为数据不可用。
 * @param {string} dataPath
 * @returns {Promise<{ ok: true, levels: unknown[] } | { ok: false }>}
 */
async function loadLevels(dataPath) {
  let raw;
  try {
    raw = await fsp.readFile(dataPath, 'utf8');
  } catch {
    return { ok: false };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }

  if (validateLevelsData(parsed) !== null) {
    return { ok: false };
  }
  return { ok: true, levels: parsed };
}

function sendJson(res, status, payload, extraHeaders) {
  res.writeHead(status, { 'Content-Type': JSON_CONTENT_TYPE, ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, code, message, extraHeaders) {
  sendJson(res, status, { error: { code, message } }, extraHeaders);
}

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': TEXT_CONTENT_TYPE });
  res.end(body);
}

function staticContentType(filePath) {
  return STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * 静态资源处理（TASK-004）：
 *   - GET / 返回静态根目录默认页面 index.html
 *   - 以 normalize + resolve 解析请求路径，解析结果必须仍在 staticRoot 之内，
 *     越界路径与缺失资源均返回 404 文本响应
 *   - Content-Type 按文件扩展名返回
 *   - HEAD 与 GET 同路由（无响应体）；其余方法返回 405 JSON 错误
 */
async function serveStatic(req, res, url, staticRoot) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不被允许', { Allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(res, 404, '404 Not Found');
    return;
  }

  if (pathname === '/') {
    pathname = '/index.html';
  }

  const rootAbsolute = path.resolve(staticRoot);
  const targetAbsolute = path.resolve(rootAbsolute, `.${pathname}`);

  // 越界拒绝：normalize + resolve 后的目标必须仍位于 staticRoot 之内（含根自身）
  if (targetAbsolute !== rootAbsolute && !targetAbsolute.startsWith(rootAbsolute + path.sep)) {
    sendText(res, 404, '404 Not Found');
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(targetAbsolute);
  } catch {
    sendText(res, 404, '404 Not Found');
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, '404 Not Found');
    return;
  }

  let content;
  try {
    content = await fsp.readFile(targetAbsolute);
  } catch {
    sendText(res, 404, '404 Not Found');
    return;
  }

  res.writeHead(200, { 'Content-Type': staticContentType(targetAbsolute) });
  res.end(content);
}

/**
 * 请求路由：
 *   - GET /api/levels  → 200 关卡数组 / 数据无效 500 / 其余方法 405
 *   - 其余 /api/*      → 404 JSON 错误
 *   - 其余路径         → 静态托管
 */
function createRequestHandler(options) {
  return async function requestHandler(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
    } catch {
      sendError(res, 404, 'NOT_FOUND', '请求路径非法');
      return;
    }

    try {
      const { pathname } = url;

      if (pathname === '/api/levels') {
        if (req.method !== 'GET') {
          sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不被允许', { Allow: 'GET' });
          return;
        }
        const result = await loadLevels(options.dataPath);
        if (!result.ok) {
          sendError(res, 500, 'LEVEL_DATA_UNAVAILABLE', '关卡数据不可用');
          return;
        }
        sendJson(res, 200, result.levels);
        return;
      }

      if (pathname === '/api' || pathname.startsWith('/api/')) {
        sendError(res, 404, 'NOT_FOUND', '请求的 API 资源不存在');
        return;
      }

      await serveStatic(req, res, url, options.staticRoot);
    } catch {
      // 兜底：未预期异常不得泄漏堆栈或绝对路径
      if (!res.headersSent) {
        sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
      } else {
        res.end();
      }
    }
  };
}

function parsePortCandidate(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const port = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (Number.isInteger(port) && port >= 0 && port <= 65535) {
    return port;
  }
  return undefined;
}

/**
 * 创建关卡服务实例（TASK-003）。
 * @param {object} [options]
 * @param {string} [options.dataPath]   关卡数据文件路径，默认 data/levels.json
 * @param {string} [options.staticRoot] 静态资源根目录，默认 web/
 * @param {number|string} [options.port] 默认监听端口
 * @returns {{ start: Function, stop: Function, server: http.Server, dataPath: string, staticRoot: string }}
 */
function createServer(options = {}) {
  const resolved = {
    dataPath: options.dataPath != null ? path.resolve(options.dataPath) : DEFAULT_DATA_PATH,
    staticRoot: options.staticRoot != null ? path.resolve(options.staticRoot) : DEFAULT_STATIC_ROOT,
  };
  const defaultPort = options.port;

  const server = http.createServer(createRequestHandler(resolved));

  let started = false;
  let currentInfo = null;

  function resolveListenPort(explicitPort) {
    const candidates = [explicitPort, defaultPort, parsePortCandidate(process.env.PORT), DEFAULT_PORT];
    for (const candidate of candidates) {
      const port = parsePortCandidate(candidate);
      if (port !== undefined) {
        return port;
      }
    }
    return DEFAULT_PORT;
  }

  /** 关闭服务器与全部连接；幂等。 */
  function stop() {
    if (!server.listening) {
      return Promise.resolve();
    }
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        started = false;
        currentInfo = null;
        resolve();
      });
    });
  }

  /**
   * 启动监听。以 port 0 调用时解析为实际分配端口。
   * @param {object} [startOptions]
   * @param {number|string} [startOptions.port] 显式端口，优先于 createServer({ port }) 与 PORT
   * @returns {Promise<{ origin: string, port: number, stop: Function }>}
   */
  function start(startOptions = {}) {
    if (started) {
      return Promise.resolve(currentInfo);
    }
    return new Promise((resolve, reject) => {
      const listenPort = resolveListenPort(startOptions.port);
      const onError = (error) => reject(error);
      server.once('error', onError);
      server.listen(listenPort, '127.0.0.1', () => {
        server.off('error', onError);
        const address = server.address();
        const actualPort = typeof address === 'object' && address !== null ? address.port : listenPort;
        started = true;
        currentInfo = {
          origin: `http://127.0.0.1:${actualPort}`,
          port: actualPort,
          stop,
        };
        resolve(currentInfo);
      });
    });
  }

  return { start, stop, server, dataPath: resolved.dataPath, staticRoot: resolved.staticRoot };
}

// 默认实例：支撑模块级 start / stop 导出（懒创建，避免加载即占资源）
let defaultServer = null;
function getDefaultServer() {
  if (defaultServer === null) {
    defaultServer = createServer();
  }
  return defaultServer;
}

/** 以默认配置启动服务（等效 createServer().start(startOptions)）。 */
function start(startOptions) {
  return getDefaultServer().start(startOptions);
}

/** 关闭默认实例服务；幂等。 */
function stop() {
  if (defaultServer === null) {
    return Promise.resolve();
  }
  return defaultServer.stop();
}

module.exports = {
  createServer,
  start,
  stop,
  validateLevelsData,
  loadLevels,
  DEFAULT_PORT,
  DEFAULT_DATA_PATH,
  DEFAULT_STATIC_ROOT,
  VALID_DIFFICULTIES,
};
