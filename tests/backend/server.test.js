'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const net = require('node:net');
const path = require('node:path');
const { createServer, start } = require('../../server/server');

const fixturesRoot = path.join(__dirname, 'fixtures');
const repositoryRoot = path.join(__dirname, '..', '..');

async function request(server, requestPath, options = {}) {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(new URL(requestPath, origin), options);
  const contentType = response.headers.get('content-type');
  const text = await response.text();
  return { response, contentType, text };
}

function withServer(options, test) {
  return async () => {
    const server = createServer(options);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      await test(server);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}

function rawRequest(server, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const socket = net.connect(server.address().port, '127.0.0.1');
    let rawResponse = '';
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.on('connect', () => {
      socket.write(
        `${method} ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`
      );
    });
    socket.on('data', (chunk) => {
      rawResponse += chunk;
    });
    socket.on('end', () => {
      const [head, ...bodyParts] = rawResponse.split('\r\n\r\n');
      const headers = head.split('\r\n');
      const [statusLine] = headers;
      const contentType = headers
        .find((header) => header.toLowerCase().startsWith('content-type:'))
        ?.slice('content-type:'.length)
        .trim();
      resolve({
        response: { status: Number(statusLine.split(' ')[1]) },
        contentType,
        text: bodyParts.join('\r\n\r\n')
      });
    });
  });
}

describe('GET /api/levels', () => {
  it(
    'returns five levels as JSON when data is valid',
    withServer({ dataPath: path.join(repositoryRoot, 'data', 'levels.json') }, async (server) => {
      const { response, contentType, text } = await request(server, '/api/levels');
      const body = JSON.parse(text);

      assert.equal(response.status, 200);
      assert.equal(contentType, 'application/json; charset=utf-8');
      assert.equal(Array.isArray(body), true);
      assert.equal(body.length, 5);
      const ids = new Set();
      for (const level of body) {
        assert.equal(typeof level.id, 'string');
        assert.ok(level.id.length > 0);
        assert.equal(ids.has(level.id), false);
        ids.add(level.id);
        assert.equal(typeof level.name, 'string');
        assert.ok(level.name.length > 0);
        assert.ok(['简单', '普通', '困难'].includes(level.difficulty));
        assert.equal(typeof level.unlocked, 'boolean');
      }
    })
  );

  for (const fixture of ['absent', 'invalid-json', 'invalid-schema']) {
    it(
      `returns LEVEL_DATA_UNAVAILABLE when data ${fixture.replaceAll('-', ' ')}`,
      withServer(
        {
          dataPath:
            fixture === 'absent'
              ? path.join(fixturesRoot, 'levels-absent.json')
              : path.join(fixturesRoot, `levels-${fixture}.json`)
        },
        async (server) => {
          const { response, contentType, text } = await request(server, '/api/levels');
          const body = JSON.parse(text);

          assert.equal(response.status, 500);
          assert.equal(contentType, 'application/json; charset=utf-8');
          assert.equal(body.error.code, 'LEVEL_DATA_UNAVAILABLE');
          assert.equal(typeof body.error.message, 'string');
          assert.ok(body.error.message.length > 0);
          assert.equal(body.error.stack, undefined);
          assert.equal(
            body.error.message.includes(fixturesRoot),
            false,
            'error message must not expose internal paths'
          );
        }
      )
    );
  }
});

describe('API routing errors', () => {
  it(
    'returns JSON 404 for an unknown API path',
    withServer({ dataPath: path.join(fixturesRoot, 'levels-valid.json') }, async (server) => {
      const { response, contentType, text } = await request(server, '/api/unknown');
      const body = JSON.parse(text);

      assert.equal(response.status, 404);
      assert.equal(contentType, 'application/json; charset=utf-8');
      assert.ok(body.error.code.length > 0);
      assert.ok(body.error.message.length > 0);
    })
  );

  it(
    'returns JSON 405 for a disallowed method',
    withServer({ dataPath: path.join(fixturesRoot, 'levels-valid.json') }, async (server) => {
      const { response, contentType, text } = await request(server, '/api/levels', {
        method: 'POST',
        body: '{}'
      });
      const body = JSON.parse(text);

      assert.equal(response.status, 405);
      assert.equal(contentType, 'application/json; charset=utf-8');
      assert.ok(body.error.code.length > 0);
      assert.ok(body.error.message.length > 0);
    })
  );

  it(
    'returns JSON 405 for HEAD',
    withServer({ dataPath: path.join(fixturesRoot, 'levels-valid.json') }, async (server) => {
      const { response, contentType, text } = await rawRequest(server, '/api/levels', 'HEAD');

      assert.equal(response.status, 405);
      assert.equal(contentType, 'application/json; charset=utf-8');
      assert.equal(text, '');
    })
  );
});

describe('static files', () => {
  const staticRoot = path.join(fixturesRoot, 'static');
  const dataPath = path.join(fixturesRoot, 'levels-valid.json');

  it(
    'serves the page entry',
    withServer({ staticRoot, dataPath }, async (server) => {
      const { response, contentType, text } = await request(server, '/');

      assert.equal(response.status, 200);
      assert.equal(contentType, 'text/html; charset=utf-8');
      assert.ok(text.includes('木叶村'));
    })
  );

  it(
    'serves a nested static asset',
    withServer({ staticRoot, dataPath }, async (server) => {
      const { response, contentType, text } = await request(server, '/styles/main.css');

      assert.equal(response.status, 200);
      assert.equal(contentType, 'text/css; charset=utf-8');
      assert.ok(text.includes('color:'));
    })
  );

  it(
    'rejects a path escaping staticRoot',
    withServer({ staticRoot, dataPath }, async (server) => {
      const { response, text } = await rawRequest(
        server,
        '/%2e%2e/%2e%2e/server/server.js'
      );

      assert.equal(response.status, 403);
      assert.ok(text.includes('Forbidden'));
    })
  );

  it(
    'returns text 404 for a missing static asset',
    withServer({ staticRoot, dataPath }, async (server) => {
      const { response, contentType, text } = await request(server, '/missing.css');

      assert.equal(response.status, 404);
      assert.equal(contentType, 'text/plain; charset=utf-8');
      assert.ok(text.includes('Not Found'));
    })
  );
});

describe('lifecycle', () => {
  it('starts on port zero, reports the bound port and stops listening', async () => {
    const lifecycle = await start({ port: 0, staticRoot: path.join(fixturesRoot, 'static') });

    try {
      assert.equal(lifecycle.port > 0, true);
      assert.equal(lifecycle.origin, `http://127.0.0.1:${lifecycle.port}`);
      assert.equal(typeof lifecycle.stop, 'function');
      const response = await fetch(`${lifecycle.origin}/`);
      assert.equal(response.status, 200);
    } finally {
      await lifecycle.stop();
    }

    await assert.rejects(() => fetch(`${lifecycle.origin}/`), TypeError);
  });

  it('uses PORT from the environment when no explicit port is provided', async () => {
    const previousPort = process.env.PORT;
    process.env.PORT = '0';
    try {
      const lifecycle = await start({
        staticRoot: path.join(fixturesRoot, 'static')
      });
      try {
        assert.equal(lifecycle.port > 0, true);
        assert.notEqual(lifecycle.port, 3000);
      } finally {
        await lifecycle.stop();
      }
    } finally {
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
    }
  });
});
