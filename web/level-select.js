'use strict';

// 关卡选择页脚本（work_item_revision_f3e13c658babecdbc07fd5e6，TASK-007/008/009）。
// 导出 initLevelSelect({ document, fetchImpl }) 供测试注入 DOM 与 fetch 替身；
// 浏览器环境（无 module）下页面加载时自动初始化（TASK-006）。

const LEVELS_URL = '/api/levels';
const EXE006_DIFFICULTIES = ['简单', '普通', '困难'];
const NETWORK_ERROR_MESSAGE = '网络异常，无法加载关卡列表，请稍后重试';

// EXE-006 字段约束（与 server/index.js validateLevels 一致）：
// 数组；每项含非空 id、非空 name、difficulty（简单/普通/困难）、布尔 unlocked。
function isExe006Level(level) {
  return (
    typeof level?.id === 'string' && level.id.length > 0 &&
    typeof level?.name === 'string' && level.name.length > 0 &&
    EXE006_DIFFICULTIES.includes(level?.difficulty) &&
    typeof level?.unlocked === 'boolean'
  );
}

// 带 isDisplayMessage 标记的错误：message 为可直接展示给玩家的可读文案，
// 与未经包装的技术异常（如 fetch 的 TypeError）在错误分支中区分处理。
function displayError(message) {
  const error = new Error(message);
  error.isDisplayMessage = true;
  return error;
}

// 非 200 响应优先透传上游 error.message（如 CT-001 的 LEVEL_DATA_UNAVAILABLE 固定文案）。
function pickDisplayMessage(payload) {
  const message = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload.error?.message
    : undefined;
  return typeof message === 'string' && message.length > 0 ? message : null;
}

function createLevelItem(doc, level) {
  const item = doc.createElement('li');
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = `${level.name}（难度：${level.difficulty}）`;
  if (!level.unlocked) {
    button.disabled = true;
  }
  item.appendChild(button);
  return item;
}

async function initLevelSelect({ document, fetchImpl, url = LEVELS_URL } = {}) {
  const loading = document.getElementById('loading');
  const levelList = document.getElementById('level-list');
  const errorMessage = document.getElementById('error-message');

  // TASK-008：先展示加载态，再发起请求。
  if (loading) loading.hidden = false;
  if (levelList) {
    levelList.hidden = true;
    levelList.replaceChildren();
  }
  if (errorMessage) {
    errorMessage.hidden = true;
    errorMessage.textContent = '';
  }

  let levels;
  try {
    const response = await fetchImpl(url);
    if (response.status !== 200) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // 错误体不可读（如网关返回 HTML）时走 HTTP 状态兜底文案。
      }
      throw displayError(pickDisplayMessage(payload) ?? `加载关卡列表失败（HTTP ${response.status}），请稍后重试`);
    }
    levels = await response.json();
    if (!Array.isArray(levels) || !levels.every(isExe006Level)) {
      throw displayError('关卡数据格式异常，请稍后重试');
    }
  } catch (error) {
    // TASK-009 错误分支：保留页面框架、展示可读错误、不向外抛出未捕获异常。
    if (loading) loading.hidden = true;
    if (errorMessage) {
      errorMessage.textContent = error?.isDisplayMessage ? error.message : NETWORK_ERROR_MESSAGE;
      errorMessage.hidden = false;
    }
    return;
  }

  if (loading) loading.hidden = true;
  if (levelList) {
    for (const level of levels) {
      levelList.appendChild(createLevelItem(document, level));
    }
    levelList.hidden = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initLevelSelect };
} else {
  // 浏览器：script 位于 body 末尾，DOM 已就绪，页面加载时直接初始化。
  globalThis.initLevelSelect = initLevelSelect;
  initLevelSelect({
    document: window.document,
    fetchImpl: (...args) => fetch(...args),
  });
}
