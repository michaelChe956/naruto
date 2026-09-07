'use strict';

const assert = require('node:assert/strict');
const { after, describe, it } = require('node:test');
const { start } = require('../../server/server');

const LEVEL_DIFFICULTIES = new Set(['简单', '普通', '困难']);

async function startServer() {
  const server = await start({ port: 0 });
  after(() => server.stop());
  return server;
}

async function request(origin, requestPath) {
  const response = await fetch(new URL(requestPath, origin));
  const contentType = response.headers.get('content-type');
  const text = await response.text();
  return { response, contentType, text };
}

describe('level selection integration', () => {
  it('serves the level selection page and levels API from one default server', async () => {
    const { origin, port, stop } = await start({ port: 0 });
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(typeof port, 'number');
    assert.equal(typeof stop, 'function');

    try {
      const page = await request(origin, '/');
      assert.equal(page.response.status, 200);
      assert.match(page.contentType, /^text\/html/);
      assert.match(page.text, /<html[\s>]/i);
      assert.match(page.text, /id=["']loading["']/i);
      assert.match(page.text, /id=["']level-list["']/i);
      assert.match(page.text, /id=["']error-message["']/i);
      assert.match(page.text, /<script\s+src=["']level-select\.js["']/i);

      const levelsResponse = await request(origin, '/api/levels');
      assert.equal(levelsResponse.response.status, 200);
      assert.equal(levelsResponse.contentType, 'application/json; charset=utf-8');

      const levels = JSON.parse(levelsResponse.text);
      assert.equal(Array.isArray(levels), true);
      assert.equal(levels.length, 5);

      const ids = new Set();
      for (const level of levels) {
        assert.equal(typeof level.id, 'string');
        assert.ok(level.id.length > 0);
        assert.equal(ids.has(level.id), false);
        ids.add(level.id);
        assert.equal(typeof level.name, 'string');
        assert.ok(level.name.trim().length > 0);
        assert.equal(LEVEL_DIFFICULTIES.has(level.difficulty), true);
        assert.equal(typeof level.unlocked, 'boolean');
      }
    } finally {
      await stop();
    }
  });

  it('serves the level selection script with the relative API path', async () => {
    const { origin } = await startServer();
    const script = await request(origin, '/level-select.js');

    assert.equal(script.response.status, 200);
    assert.match(script.contentType, /^text\/javascript/);
    assert.match(script.text, /["']\/api\/levels["']/);
  });

  it('returns a JSON API error for an unknown API path', async () => {
    const { origin } = await startServer();
    const error = await request(origin, '/api/not-levels');

    assert.equal(error.response.status, 404);
    assert.equal(error.contentType, 'application/json; charset=utf-8');

    const body = JSON.parse(error.text);
    assert.equal(typeof body, 'object');
    assert.notEqual(body, null);
    assert.notEqual(Array.isArray(body), true);
    assert.equal(typeof body.error?.code, 'string');
    assert.ok(body.error.code.length > 0);
    assert.equal(typeof body.error?.message, 'string');
    assert.ok(body.error.message.length > 0);
  });
});
