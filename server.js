'use strict';

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

const HELLO_BODY = '{"message":"hello"}';
const INTERNAL_ERROR_BODY = '{"error":"internal"}';

function defaultSayHello() {
  return HELLO_BODY;
}

function createServer({ sayHello = defaultSayHello } = {}) {
  return http.createServer((req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/hello') {
        const body = sayHello();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(INTERNAL_ERROR_BODY);
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`server listening at http://${HOST}:${PORT}`);
  });
}

module.exports = { createServer };
