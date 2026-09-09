'use strict';

const http = require('node:http');

function respondInternalError(res) {
  try {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end('{"error":"internal"}');
  } catch {
    res.destroy();
  }
}

const server = http.createServer((req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/hello') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end('{"message":"hello"}');
      return;
    }

    res.statusCode = 404;
    res.end();
  } catch {
    respondInternalError(res);
  }
});

server.listen(3000, '127.0.0.1');

module.exports = server;
