const http = require('node:http');

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/api/hello') {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.end('{"message":"hello"}');
    return;
  }

  response.statusCode = 404;
  response.end();
});

server.listen(3000);
