'use strict';

const http = require('node:http');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/hello') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end('{"message":"hello"}');
    return;
  }

  res.statusCode = 404;
  res.end();
});

server.listen(3000, '127.0.0.1');

module.exports = server;
