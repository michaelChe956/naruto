const http = require('node:http');

function createServer() {
  return http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/api/hello') {
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/json');
      response.end('{"message":"hello"}');
      return;
    }

    response.statusCode = 404;
    response.end();
  });
}

if (require.main === module) {
  createServer().listen(3000, '127.0.0.1');
}

module.exports = { createServer };
