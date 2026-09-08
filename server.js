'use strict';

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/hello') {
      // 测试故障注入缝：仅供 tests/hello.test.js 构造内部错误分支，正常路径不受影响
      if (process.env.HELLO_FORCE_INTERNAL_ERROR === '1') {
        throw new Error('forced internal error for tests');
      }
      sendJson(res, 200, '{"message":"hello"}');
      return;
    }
    sendJson(res, 404, '{"error":"not_found"}');
  } catch (err) {
    sendJson(res, 500, '{"error":"internal"}');
  }
});

server.listen(PORT, HOST);
