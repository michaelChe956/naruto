'use strict';

// 单进程服务入口：仅依赖 Node 内置模块。
// 提供 GET /api/levels 关卡数据接口与 staticRoot 静态页面托管。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PORT = 3000;
const REQUIRED_LEVEL_COUNT = 5;
const VALID_DIFFICULTIES = ['简单', '普通', '困难'];

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': JSON_CONTENT_TYPE,
  '.txt': TEXT_CONTENT_TYPE,
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

class LevelDataUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LevelDataUnavailableError';
    this.code = 'LEVEL_DATA_UNAVAILABLE';
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': JSON_CONTENT_TYPE });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, code, message) {
  sendJson(res, statusCode, { error: { code, message } });
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': TEXT_CONTENT_TYPE });
  res.end(body);
}

// 校验关卡数组：恰好 5 项、id 非空且唯一、name 非空、difficulty 枚举、unlocked 布尔。
// 不满足时返回可读的中文问题描述，满足时返回 null。
function validateLevels(value) {
  if (!Array.isArray(value)) {
    return '关卡数据必须是数组';
  }
  if (value.length !== REQUIRED_LEVEL_COUNT) {
    return `关卡数量必须为 ${REQUIRED_LEVEL_COUNT}，实际为 ${value.length}`;
  }
  const seenIds = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const level = value[index];
    const label = `第 ${index + 1} 项`;
    if (level === null || typeof level !== 'object' || Array.isArray(level)) {
      return `${label}必须是对象`;
    }
    if (typeof level.id !== 'string' || level.id.trim() === '') {
      return `${label}的 id 必须是非空字符串`;
    }
    if (seenIds.has(level.id)) {
      return `${label}的 id 与其他关卡重复`;
    }
    seenIds.add(level.id);
    if (typeof level.name !== 'string' || level.name.trim() === '') {
      return `${label}的 name 必须是非空字符串`;
    }
    if (!VALID_DIFFICULTIES.includes(level.difficulty)) {
      return `${label}的 difficulty 取值必须是：${VALID_DIFFICULTIES.join('、')}`;
    }
    if (typeof level.unlocked !== 'boolean') {
      return `${label}的 unlocked 必须是布尔值`;
    }
  }
  return null;
}

// 读取并校验关卡数据；任何失败都归一为 LEVEL_DATA_UNAVAILABLE，
// 且错误信息保持可读、不含堆栈与内部路径。
function loadLevels(dataPath) {
  let raw;
  try {
    raw = fs.readFileSync(dataPath, 'utf8');
  } catch (error) {
    throw new LevelDataUnavailableError('关卡数据不可用：无法读取关卡数据文件');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new LevelDataUnavailableError('关卡数据不可用：关卡数据不是有效的 JSON');
  }
  const problem = validateLevels(parsed);
  if (problem !== null) {
    throw new LevelDataUnavailableError(`关卡数据不可用：${problem}`);
  }
  return parsed;
}

function handleApiRequest(pathname, req, res, dataPath) {
  if (pathname !== '/api/levels') {
    sendError(res, 404, 'NOT_FOUND', '未知的 API 路径');
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '该 API 路径仅支持 GET 方法');
    return;
  }
  let levels;
  try {
    levels = loadLevels(dataPath);
  } catch (error) {
    if (error instanceof LevelDataUnavailableError) {
      sendError(res, 500, error.code, error.message);
    } else {
      sendError(res, 500, 'LEVEL_DATA_UNAVAILABLE', '关卡数据不可用：服务内部错误');
    }
    return;
  }
  sendJson(res, 200, levels);
}

function serveStaticFile(staticRoot, pathname, res) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (error) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const resolvedRoot = path.resolve(staticRoot);
  // 用 node:path 规范化解析并与 staticRoot 前缀比对，拒绝一切越界路径。
  const resolvedTarget = path.resolve(resolvedRoot, `.${path.sep}${decodedPath}`);
  const withinRoot =
    resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
  if (!withinRoot) {
    sendText(res, 404, 'Not Found');
    return;
  }

  let targetPath = resolvedTarget;
  try {
    let stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      targetPath = path.join(targetPath, 'index.html');
      stats = fs.statSync(targetPath);
    }
    if (!stats.isFile()) {
      sendText(res, 404, 'Not Found');
      return;
    }
    const content = fs.readFileSync(targetPath);
    const contentType = MIME_TYPES[path.extname(targetPath).toLowerCase()] || TEXT_CONTENT_TYPE;
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (error) {
    sendText(res, 404, 'Not Found');
  }
}

function createRequestHandler({ dataPath, staticRoot }) {
  const resolvedStaticRoot = path.resolve(staticRoot);
  return function handleRequest(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (error) {
      sendText(res, 400, 'Bad Request');
      return;
    }

    if (pathname === '/api/levels' || pathname.startsWith('/api/')) {
      handleApiRequest(pathname, req, res, dataPath);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, 405, 'METHOD_NOT_ALLOWED', '静态资源仅支持 GET 方法');
      return;
    }
    serveStaticFile(resolvedStaticRoot, pathname, res);
  };
}

// createServer({ dataPath, staticRoot }) 返回服务实例，
// 实例暴露 start({ port }) 生命周期：返回 Promise，
// 结果为 { origin, port, stop }；stop() 关闭服务。
function createServer({ dataPath, staticRoot }) {
  const handler = createRequestHandler({ dataPath, staticRoot });

  function start({ port } = {}) {
    const listenPort = port !== undefined ? port : Number(process.env.PORT || DEFAULT_PORT);
    return new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      server.once('error', reject);
      server.listen(listenPort, () => {
        const { port: actualPort } = server.address();
        const origin = `http://127.0.0.1:${actualPort}`;
        resolve({
          origin,
          port: actualPort,
          stop() {
            return new Promise((resolveStop, rejectStop) => {
              server.close((error) => (error ? rejectStop(error) : resolveStop()));
              server.closeAllConnections();
            });
          },
        });
      });
    });
  }

  return { start };
}

module.exports = { createServer };
