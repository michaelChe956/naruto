'use strict';

const http = require('node:http');

const HOST = '127.0.0.1';
// 默认监听 127.0.0.1:3000；PORT 仅用于测试等场景注入端口，避免共享环境端口冲突
const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/hello') {
      // 错误路径注入开关：仅供测试触发内部错误，验证 CT-001 的 500 错误响应
      if (process.env.HELLO_FAULT === 'injection') {
        throw new Error('注入的内部错误（HELLO_FAULT=injection）');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"message":"hello"}');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  } catch (error) {
    // 内部错误统一响应 CT-001 错误契约：500 且 body 恰为 {"error":"internal"}
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end('{"error":"internal"}');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`server listening at http://${HOST}:${PORT}`);
});
