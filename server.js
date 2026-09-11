'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = 3000;
const CONFIG_PATH = path.join(__dirname, 'config', 'hello.json');

function readHelloMessage() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  return config.message;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/hello') {
    try {
      sendJson(res, 200, { message: readHelloMessage() });
    } catch (err) {
      sendJson(res, 500, { error: 'internal' });
    }
    return;
  }
  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`server listening at http://${HOST}:${PORT}\n`);
});
