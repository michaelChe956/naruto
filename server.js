'use strict';

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

function respondInternalError(res) {
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end('{"error":"internal"}');
}

const server = http.createServer((req, res) => {
  try {
    if (process.env.HELLO_FAULT === 'internal') {
      throw new Error('simulated internal error');
    }
    if (req.method === 'GET' && req.url === '/api/hello') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"message":"hello"}');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  } catch (err) {
    respondInternalError(res);
  }
});

server.listen(PORT, HOST);
