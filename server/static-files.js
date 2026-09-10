'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { sendError, sendText } = require('./responses');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const NOT_FOUND_MESSAGE = 'Not Found';

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || DEFAULT_CONTENT_TYPE;
}

// 将 URL 路径解析到 staticRoot 内；解析结果越界或编码非法时返回 null。
function resolveStaticTarget(staticRoot, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const root = path.resolve(staticRoot);
  const target = path.resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return null;
  }
  return target;
}

async function sendFile(res, filePath) {
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypeFor(filePath), 'Content-Length': content.length });
    res.end(content);
  } catch {
    sendText(res, 404, NOT_FOUND_MESSAGE);
  }
}

async function handleStaticRequest(req, res, urlPath, staticRoot) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', '不支持的请求方法', { Allow: 'GET' });
    return;
  }
  const target = resolveStaticTarget(staticRoot, urlPath);
  if (target === null) {
    sendText(res, 404, NOT_FOUND_MESSAGE);
    return;
  }
  const stat = await fs.stat(target).catch(() => null);
  if (stat === null) {
    sendText(res, 404, NOT_FOUND_MESSAGE);
    return;
  }
  if (stat.isDirectory()) {
    await sendFile(res, path.join(target, 'index.html'));
    return;
  }
  if (!stat.isFile()) {
    sendText(res, 404, NOT_FOUND_MESSAGE);
    return;
  }
  await sendFile(res, target);
}

module.exports = { handleStaticRequest, resolveStaticTarget };
