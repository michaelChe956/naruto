'use strict';

// TASK-002：仅使用 Node 内置 node:http 在 127.0.0.1:3000 提供服务，
// 使 test/hello.test.js 的唯一测试通过（AC-001）。

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/hello') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'hello' }));
    return;
  }
  res.statusCode = 404;
  res.end();
});

server.listen(PORT, HOST);
