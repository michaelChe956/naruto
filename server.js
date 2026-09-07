'use strict';

const http = require('node:http');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('{"message":"hello"}');
    return;
  }
  res.writeHead(404);
  res.end();
});

if (require.main === module) {
  server.listen(3000, '127.0.0.1', () => {
    console.log('hello api listening on http://127.0.0.1:3000');
  });
}

module.exports = server;
