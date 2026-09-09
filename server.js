'use strict';

// TASK-002：仅使用 Node 内置 node:http 在 127.0.0.1:3000 提供服务，使 test/hello.test.js 通过。
// CT-001：GET /api/hello 正常返回 200 且 body 恰为 {"message":"hello"}；
// 处理器内部错误兜底返回 500 且 body 恰为 {"error":"internal"}。

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

// 生成 hello 响应 body；HELLO_INJECT_INTERNAL_ERROR=1 仅供测试注入内部错误。
function renderHelloBody() {
  if (process.env.HELLO_INJECT_INTERNAL_ERROR === '1') {
    throw new Error('测试注入的内部错误');
  }
  return JSON.stringify({ message: 'hello' });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/hello') {
    try {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(renderHelloBody());
    } catch {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'internal' }));
    }
    return;
  }
  res.statusCode = 404;
  res.end();
});

server.listen(PORT, HOST);
