'use strict';

const { start } = require('../../../server/index');

// 以 port 0 启动真实服务实例；未注入覆盖项时加载 data/levels.json 与 web/ 生产资产。
function startService(options = {}) {
  return start({ port: 0, ...options });
}

// 仅对 resolve 的 origin 发起真实 HTTP 请求，返回可观测的响应形状。
async function requestHttp(origin, requestPath, init) {
  const response = await fetch(origin + requestPath, init);
  const status = response.status;
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  const body = contentType.startsWith('application/json') ? JSON.parse(text) : null;
  return { status, contentType, text, body };
}

module.exports = { startService, requestHttp };
