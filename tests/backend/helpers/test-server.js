'use strict';

const { start } = require('../../../server/index');

async function startTestServer(options = {}) {
  return start({ port: 0, ...options });
}

async function requestJson(origin, requestPath, init) {
  const response = await fetch(origin + requestPath, init);
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  const body = contentType.startsWith('application/json') ? JSON.parse(text) : null;
  return { status: response.status, contentType, headers: response.headers, text, body };
}

module.exports = { startTestServer, requestJson };
