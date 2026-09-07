'use strict';

/**
 * 最小 HTTP 服务（TASK-002）：
 * WHEN 客户端请求 GET /api/hello
 * THE SYSTEM SHALL 返回 200 且 body 恰为 {"message":"hello"}。
 *
 * 仅使用 node 内置模块 node:http，监听 127.0.0.1:3000。
 */

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'hello' }));
    return;
  }
  // 未匹配契约路径的请求返回 404，避免连接挂起
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`server listening at http://${HOST}:${PORT}`);
});
