const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 3000;

function handleRequest(req, res) {
  if (process.env.HELLO_FORCE_INTERNAL_ERROR === '1') {
    throw new Error('forced internal error');
  }
  if (req.method === 'GET' && req.url === '/api/hello') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"message":"hello"}');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"error":"not found"}');
}

const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    res.end('{"error":"internal"}');
  }
});

server.listen(PORT, HOST, () => {
  console.log('server listening on http://127.0.0.1:3000');
});
