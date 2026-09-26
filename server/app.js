'use strict';

// 同源计数 API + 静态资源投递（REQ-013 / REQ-014 / AC-001 ~ AC-004、AC-008）。
//
// 分派策略：
//   - /api/count 只放行 GET 与 POST；GET 读值、POST 恰好 +1，其余方法返回 405
//     且完全不触碰计数状态（AC-003）。
//   - 其余路径只在“启动时从静态根目录登记的 HTML 文件”白名单内查表；查不到一律 404，
//     命中后只用登记表里的固定文件名读取，绝不把请求路径拼进文件路径（因此无目录穿越）。

const fs = require('node:fs');
const path = require('node:path');

const COUNT_PATH = '/api/count';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const API_ALLOW_METHODS = 'GET, POST';
const STATIC_ALLOW_METHODS = 'GET, HEAD';
const HTML_EXTENSION = '.html';
const INDEX_FILE = 'index.html';

// 只参与路由的是 pathname：查询串与锚点不进入查表键。
function resolvePathname(requestUrl) {
  try {
    return new URL(requestUrl, 'http://127.0.0.1').pathname;
  } catch (error) {
    return null;
  }
}

// 启动时扫描静态根目录，登记其中的 HTML 文件；目录不存在或不可读时登记表为空。
// 使用无原型对象，避免 '/constructor'、'/toString' 等原型键被误判为已登记路径。
function discoverStaticRoutes(staticRoot) {
  const routes = Object.create(null);

  if (typeof staticRoot !== 'string' || staticRoot === '') {
    return routes;
  }

  let entries;
  try {
    entries = fs.readdirSync(staticRoot, { withFileTypes: true });
  } catch (error) {
    return routes;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(HTML_EXTENSION)) {
      continue;
    }
    routes[`/${entry.name}`] = entry.name;
  }

  if (routes[`/${INDEX_FILE}`] !== undefined) {
    routes['/'] = INDEX_FILE;
  }

  return routes;
}

function sendBuffer(res, statusCode, contentType, body, extraHeaders) {
  res.writeHead(
    statusCode,
    Object.assign(
      { 'content-type': contentType, 'content-length': body.length },
      extraHeaders,
    ),
  );
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  sendBuffer(res, statusCode, JSON_CONTENT_TYPE, Buffer.from(JSON.stringify(payload), 'utf8'));
}

function sendEmpty(res, statusCode, extraHeaders) {
  sendBuffer(res, statusCode, TEXT_CONTENT_TYPE, Buffer.alloc(0), extraHeaders);
}

function serveStaticFile(req, res, staticDir, fileName) {
  fs.readFile(path.join(staticDir, fileName), (error, data) => {
    if (error) {
      sendEmpty(res, 404);
      return;
    }
    res.writeHead(200, { 'content-type': HTML_CONTENT_TYPE, 'content-length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function handleCountRequest(req, res, countStore) {
  if (req.method === 'GET') {
    sendJson(res, 200, { count: countStore.getCount() });
    return;
  }

  if (req.method === 'POST') {
    // POST 语义固定为“恰好递增 1”：请求体不参与计数，直接丢弃。
    req.resume();
    sendJson(res, 200, { count: countStore.increment() });
    return;
  }

  req.resume();
  sendEmpty(res, 405, { allow: API_ALLOW_METHODS });
}

function createRequestHandler({ countStore, staticRoot = null } = {}) {
  if (
    !countStore ||
    typeof countStore.getCount !== 'function' ||
    typeof countStore.increment !== 'function'
  ) {
    throw new TypeError('createRequestHandler 需要 countStore 提供 getCount() 与 increment()');
  }

  const staticDir = typeof staticRoot === 'string' && staticRoot !== '' ? staticRoot : null;
  const staticRoutes = discoverStaticRoutes(staticDir);

  return function handleRequest(req, res) {
    const pathname = resolvePathname(req.url);

    if (pathname === COUNT_PATH) {
      handleCountRequest(req, res, countStore);
      return;
    }

    if (staticDir !== null && pathname !== null && staticRoutes[pathname] !== undefined) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendEmpty(res, 405, { allow: STATIC_ALLOW_METHODS });
        return;
      }
      serveStaticFile(req, res, staticDir, staticRoutes[pathname]);
      return;
    }

    sendEmpty(res, 404);
  };
}

module.exports = {
  COUNT_PATH,
  createRequestHandler,
  discoverStaticRoutes,
  resolvePathname,
};
