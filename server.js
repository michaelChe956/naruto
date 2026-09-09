'use strict';

// GET /api/hello 服务入口：
// 直接运行时监听 127.0.0.1:3000，GET /api/hello 返回 200 且 body 恰为 {"message":"hello"}。
// 输出契约 CT-001：处理路径异常时返回 500 且 body 恰为 {"error":"internal"}，
// 而非依赖 Node 默认行为直接断开连接。

const http = require('node:http');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;

// 创建请求处理器。helloProvider 默认返回 'hello'，供测试注入失败场景以覆盖内部错误分支。
function createRequestHandler({ helloProvider } = {}) {
  const getMessage = typeof helloProvider === 'function' ? helloProvider : () => 'hello';

  return function requestHandler(req, res) {
    try {
      if (req.method === 'GET' && req.url === '/api/hello') {
        // 先求值响应体再写头：getMessage() 抛错时头部尚未发出，才能在兜底分支改为 500。
        const body = JSON.stringify({ message: getMessage() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
    } catch (err) {
      // 内部错误兜底：返回 500 与 {"error":"internal"}，避免未捕获异常导致连接被直接断开。
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end('{"error":"internal"}');
    }
  };
}

// 创建服务器实例；依赖注入仅用于测试触发内部错误分支。
function createServer(dependencies) {
  return http.createServer(createRequestHandler(dependencies));
}

module.exports = { createRequestHandler, createServer, DEFAULT_HOST, DEFAULT_PORT };

// 仅在作为入口直接运行时才监听，避免测试引入本模块时产生占用端口的副作用。
if (require.main === module) {
  const host = process.env.HOST || DEFAULT_HOST;
  const port = Number.parseInt(process.env.PORT, 10) || DEFAULT_PORT;
  const server = createServer();

  // 监听失败（如端口被占用）时输出清晰错误并以非零状态退出，
  // 而非因未处理的 error 事件抛出未捕获异常直接崩溃。
  server.on('error', (err) => {
    console.error(`server 启动或运行失败：${err.message}`);
    process.exitCode = 1;
  });

  server.listen(port, host);
}
