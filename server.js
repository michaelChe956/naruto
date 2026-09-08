const http = require('node:http');

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/api/hello') {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ message: 'hello' }));
    return;
  }

  response.statusCode = 404;
  response.end();
});

module.exports = server;

if (require.main === module) {
  const hostname = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT) || 3000;

  server.listen(port, hostname, () => {
    console.log(`Server listening on http://${hostname}:${port}`);
  });
}
