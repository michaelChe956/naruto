'use strict';

// 最小状态服务：GET /api/status、GET /status.html、未匹配请求 404。
// 仅依赖 node:http、node:fs、node:path 与 process 全局对象。
// 导出未监听的 createServer() 工厂；仅在作为入口执行时按 PORT/默认 3000 监听。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const STATUS_PATH = '/api/status';
const PAGE_ENDPOINT = '/status.html';
// 固定页面路径基于本入口文件目录解析（TASK-007）。
const PAGE_FILE = path.join(__dirname, 'status.html');
const DEFAULT_PORT = 3000;

// RFC3339 date-time：YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)。
// 依据 RFC3339 第 5.6 节，T/Z 允许小写；秒允许 60（闰秒）；小数秒至少 1 位。
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

// 仅接受语法与日历字段均合法的 RFC3339 时间戳（拒绝 13 月、2 月 30 日、24 时等）。
function isValidRfc3339(value) {
  const match = RFC3339_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 60) {
    return false;
  }

  // 日历合法性：越界日期会被 Date 归一化滚动（如 2 月 30 日→3 月 2 日），滚动后不一致即非法。
  const utcDate = new Date(0);
  utcDate.setUTCHours(0, 0, 0, 0);
  utcDate.setUTCFullYear(year, month - 1, day);
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return false;
  }

  if (match[7] !== undefined) {
    const offsetHour = Number(match[8]);
    const offsetMinute = Number(match[9]);
    if (offsetHour > 23 || offsetMinute > 59) {
      return false;
    }
  }

  return true;
}

// DEPLOYED_AT 归一化（每个请求读取，保证测试/运行时可随时改环境变量）：
// 缺省或空字符串 → null；合法 RFC3339 → 原字符串逐字符透传；其余格式 → null。
function resolveLastDeployedAt() {
  const raw = process.env.DEPLOYED_AT;
  if (raw === undefined || raw === '') {
    return null;
  }
  return isValidRfc3339(raw) ? raw : null;
}

function send(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': body.length,
  });
  res.end(body);
}

function sendStatus(res) {
  const payload = {
    status: 'ok',
    uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
    last_deployed_at: resolveLastDeployedAt(),
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

// 404 响应固定文案，不回显请求路径、文件系统路径或错误堆栈（TASK-008）。
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
