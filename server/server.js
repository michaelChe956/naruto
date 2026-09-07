'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const LEVEL_DIFFICULTIES = new Set(['简单', '普通', '困难']);

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  });
  response.end(payload);
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  response.end(body);
}

function sendApiError(response, statusCode, code, message) {
  sendJson(response, statusCode, { error: { code, message } });
}

async function readLevels(dataPath) {
  const source = await fs.readFile(dataPath, 'utf8');
  const levels = JSON.parse(source);

  if (!Array.isArray(levels) || levels.length !== 5) {
    throw new Error('Levels must be an array containing exactly 5 items.');
  }

  const seen = new Set();
  for (const level of levels) {
    if (level === null || typeof level !== 'object' || Array.isArray(level)) {
      throw new Error('Each level must be an object.');
    }
    if (typeof level.id !== 'string' || level.id.length === 0 || seen.has(level.id)) {
      throw new Error('Each level must have a unique non-empty id.');
    }
    if (typeof level.name !== 'string' || level.name.trim().length === 0) {
      throw new Error('Each level must have a non-empty name.');
    }
    if (!LEVEL_DIFFICULTIES.has(level.difficulty)) {
      throw new Error('Each level must have a supported difficulty.');
    }
    if (typeof level.unlocked !== 'boolean') {
      throw new Error('Each level must have an unlocked boolean.');
    }
    seen.add(level.id);
  }

  return levels;
}

const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml'
};

function resolveStaticPath(requestPath, staticRoot) {
  const rawPath = requestPath.split('?', 1)[0];
  const relativePath = rawPath === '/' ? 'index.html' : rawPath;
  const decodedPath = decodeURIComponent(relativePath);
  const root = path.resolve(staticRoot);
  const filePath = path.resolve(root, `.${path.sep}${decodedPath}`);
  const relative = path.relative(root, filePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return filePath;
}

async function serveStatic(requestPath, staticRoot, response) {
  const filePath = resolveStaticPath(requestPath, staticRoot);
  if (!filePath) {
    sendText(response, 403, 'Forbidden\n');
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const charset = contentType === 'application/octet-stream' ? '' : '; charset=utf-8';
    response.writeHead(200, {
      'content-type': `${contentType}${charset}`,
      'content-length': file.length
    });
    response.end(file);
  } catch {
    sendText(response, 404, 'Not Found\n');
  }
}

function createServer(options = {}) {
  const dataPath = options.dataPath || path.join(__dirname, '..', 'data', 'levels.json');
  const staticRoot = options.staticRoot || path.join(__dirname, '..', 'web');

  const server = http.createServer(async (request, response) => {
    try {
      const pathname = (request.url || '/').split('?', 1)[0];

      if (pathname.startsWith('/api/')) {
        if (pathname !== '/api/levels') {
          sendApiError(response, 404, 'API_NOT_FOUND', '未找到请求的 API。');
          return;
        }
        if (request.method !== 'GET') {
          sendApiError(response, 405, 'METHOD_NOT_ALLOWED', '该 API 不支持此请求方法。');
          return;
        }

        const levels = await readLevels(dataPath);
        sendJson(response, 200, levels);
        return;
      }

      if (!staticRoot) {
        sendText(response, 404, 'Not Found\n');
        return;
      }
      await serveStatic(pathname, staticRoot, response);
    } catch {
      sendApiError(response, 500, 'LEVEL_DATA_UNAVAILABLE', '关卡数据当前不可用，请稍后重试。');
    }
  });

  return server;
}

async function start(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const server = createServer(options);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const boundPort = server.address().port;
  return {
    origin: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    stop: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}

if (require.main === module) {
  start()
    .then(({ origin }) => {
      console.log(`Server listening at ${origin}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { createServer, start };
