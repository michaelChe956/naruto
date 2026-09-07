const http = require('node:http');

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/api/hello') {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength('{"message":"hello"}'),
    });
    response.end('{"message":"hello"}');
    return;
  }

  response.destroy();
});

server.listen(0, '127.0.0.1', () => {
  const { address, port } = server.address();
  process.stdout.write(`${JSON.stringify({ listen_address: `http://${address}:${port}` })}\n`);
});
