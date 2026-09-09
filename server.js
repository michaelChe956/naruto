'use strict';

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

const server = http.createServer((req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/hello') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"message":"hello"}');
      return;
    }
    // 未匹配路由：返回 404（约定俗成的兜底，非验收范围）
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not_found"}');
  } catch (err) {
    // 内部错误契约：500 且 body 为 {"error":"internal"}
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end('{"error":"internal"}');
  }
});

server.listen(PORT, HOST);
