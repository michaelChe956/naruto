'use strict';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': JSON_CONTENT_TYPE, ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, code, message, extraHeaders = {}) {
  sendJson(res, statusCode, { error: { code, message } }, extraHeaders);
}

function sendText(res, statusCode, text, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': TEXT_CONTENT_TYPE, ...extraHeaders });
  res.end(text);
}

module.exports = { JSON_CONTENT_TYPE, TEXT_CONTENT_TYPE, sendJson, sendError, sendText };
