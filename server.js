'use strict';

// 最小状态服务：GET /api/status、GET /status.html、未匹配请求 404。
// 仅依赖 node:http、node:fs、node:path 与 process 全局对象，不引入新依赖。
// 导出未监听的 createServer() 工厂；仅在作为入口执行时按 PORT/默认 3000 监听。
//
// 既有响应字段基线来源：本仓库前置交付分支 aria/issues/issue_0001 的 server.js
// （GET /api/status 既有响应为 { status, uptimeSeconds }）；本次仅做加法式扩展，
// 新增 deploy_channel，不重命名、不删除、不改动既有字段的键名与语义。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const STATUS_PATH = '/api/status';
const PAGE_ENDPOINT = '/status.html';
// 固定页面路径基于本入口文件目录解析。
const PAGE_FILE = path.join(__dirname, 'status.html');
const DEFAULT_PORT = 3000;

// 渠道字段默认值：未指定（未设置或去首尾空白后为空）时取该字面值（DEC-002）。
const DEFAULT_DEPLOY_CHANNEL = 'stable';

// DEPLOY_CHANNEL 归一化（每个请求读取，保证运行时可随时改环境变量）：
// 未设置或去除首尾空白后为空 → stable；其余非空白值原样透出（不做枚举校验、不做大小写归一）。
function resolveDeployChannel() {
  const raw = process.env.DEPLOY_CHANNEL;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_DEPLOY_CHANNEL;
  }
  return raw;
}

function send(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': body.length,
  });
  res.end(body);
}

// 既有状态响应字段（status、uptimeSeconds）保持不变，仅新增 deploy_channel。
function sendStatus(res) {
  const payload = {
    status: 'ok',
    uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
    deploy_channel: resolveDeployChannel(),
  };
  send(
    res,
    200,
    'application/json; charset=utf-8',
    Buffer.from(JSON.stringify(payload), 'utf8'),
  );
}

function sendPage(res) {
  fs.readFile(PAGE_FILE, (err, data) => {
    if (err) {
      sendNotFound(res);
      return;
    }
    send(res, 200, 'text/html; charset=utf-8', data);
  });
}

// 404 响应固定文案，不回显请求路径、文件系统路径或错误堆栈。
function sendNotFound(res) {
  send(res, 404, 'text/plain; charset=utf-8', Buffer.from('404 Not Found\n', 'utf8'));
}

function createServer() {
  return http.createServer((req, res) => {
    const method = req.method;
    const pathname = String(req.url || '').split('?')[0].split('#')[0];

    // 仅响应 GET；其余方法（含对已存在路径的请求）统一走 404 兜底。
    if (method !== 'GET') {
      sendNotFound(res);
      return;
    }

    if (pathname === STATUS_PATH) {
      sendStatus(res);
      return;
    }

    if (pathname === PAGE_ENDPOINT) {
      sendPage(res);
      return;
    }

    sendNotFound(res);
  });
}

function resolvePort() {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') {
    return DEFAULT_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_PORT;
  }
  return parsed;
}

if (require.main === module) {
  createServer().listen(resolvePort());
}

module.exports = { createServer };
