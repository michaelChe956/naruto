'use strict';

/**
 * Hello API 服务（仅使用 Node 内置模块）。
 *
 * 契约（TASK-002 / AC-001）：
 *   - 监听 127.0.0.1:3000；
 *   - GET /api/hello：在运行时读取仓库根目录 config/hello.json，
 *     成功则返回 200 与文件完整 JSON 内容；
 *     读取失败则返回 500，body 为 {"error":"internal"}。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = 3000;
const CONFIG_PATH = path.join(__dirname, 'config', 'hello.json');

function sendJsonError(res, statusCode) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'internal' }));
}

function handleHello(req, res) {
  let content;
  try {
    // 运行时（每次请求）读取，文件内容变更无需重启即可生效。
    content = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch {
    sendJsonError(res, 500);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(content);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/hello') {
    handleHello(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, HOST);
