const http = require('node:http');
const forceInternalError = process.env.HELLO_FORCE_INTERNAL_ERROR === '1';

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/api/hello') {
    try {
      if (forceInternalError) {
        throw new Error('injected internal error');
      }

      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength('{"message":"hello"}'),
      });
      response.end('{"message":"hello"}');
    } catch (error) {
      const body = '{"error":"internal"}';
      response.writeHead(500, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      response.end(body);
    }

    return;
  }

  response.destroy();
});

server.listen(0, '127.0.0.1', () => {
  const { address, port } = server.address();
  process.stdout.write(`${JSON.stringify({ listen_address: `http://${address}:${port}` })}\n`);
});
