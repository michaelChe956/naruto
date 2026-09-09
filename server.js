'use strict';

const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"message":"hello"}');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"error":"not found"}');
});

server.listen(PORT, HOST, () => {
  console.log(`server listening at http://${HOST}:${PORT}`);
});
