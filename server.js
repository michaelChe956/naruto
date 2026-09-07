'use strict';

/**
 * 最小 HTTP 服务（TASK-002 + CT-001 错误分支）：
 * - WHEN 客户端请求 GET /api/hello  THE SYSTEM SHALL 返回 200 且 body 恰为 {"message":"hello"}。
 * - WHEN 非 GET 方法访问 /api/hello THE SYSTEM SHALL 返回 405 且 body 恰为 {"error":"method not allowed"}。
 * - WHEN 请求路径未命中           THE SYSTEM SHALL 返回 404 且 body 恰为 {"error":"not found"}。
 *
 * 仅使用 node 内置模块 node:http，监听 127.0.0.1:3000。
 */

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/api/hello') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'hello' }));
      return;
    }
    // 路径命中但方法非 GET：返回 405 与 method not allowed（CT-001）
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  // 路径未命中：返回 404 与 not found，避免连接挂起
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`server listening at http://${HOST}:${PORT}`);
});
