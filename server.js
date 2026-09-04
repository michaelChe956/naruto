'use strict';

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

function handleRequest(req, res) {
  try {
    if (req.method === 'GET' && req.url === '/api/hello') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"message":"hello"}');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not_found"}');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"internal"}');
  }
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, HOST);
}

module.exports = { server };
