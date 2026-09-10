'use strict';

const LEVELS_API_PATH = '/api/levels';

const GENERIC_ERROR_MESSAGE = '关卡加载失败：暂时无法获取关卡数据，请稍后重试';
const INVALID_DATA_MESSAGE = '关卡加载失败：返回的关卡数据格式不正确';
const NETWORK_ERROR_MESSAGE = '关卡加载失败：网络请求异常，请检查网络后重试';

class LevelsLoadError extends Error {}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 校验并归一化 /api/levels 响应；unlocked 缺省视为解锁（上游契约不强制携带该字段）。
function normalizeLevels(payload) {
  if (!Array.isArray(payload)) {
    throw new LevelsLoadError(INVALID_DATA_MESSAGE);
  }
  return payload.map((item, index) => {
    const label = `第 ${index + 1} 项关卡`;
    if (!isPlainObject(item)) {
      throw new LevelsLoadError(`${INVALID_DATA_MESSAGE}（${label}不是对象）`);
    }
    if (typeof item.name !== 'string' || item.name.trim().length === 0) {
      throw new LevelsLoadError(`${INVALID_DATA_MESSAGE}（${label}的 name 必须是非空字符串）`);
    }
    if (!Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > 5) {
      throw new LevelsLoadError(`${INVALID_DATA_MESSAGE}（${label}的 difficulty 必须是 1~5 的整数）`);
    }
    if (item.unlocked !== undefined && typeof item.unlocked !== 'boolean') {
      throw new LevelsLoadError(`${INVALID_DATA_MESSAGE}（${label}的 unlocked 必须是布尔值）`);
    }
    return {
      name: item.name.trim(),
      difficulty: item.difficulty,
      unlocked: item.unlocked === undefined ? true : item.unlocked,
    };
  });
}

async function loadLevels(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(LEVELS_API_PATH);
  } catch {
    throw new LevelsLoadError(NETWORK_ERROR_MESSAGE);
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const apiMessage =
      isPlainObject(payload) && isPlainObject(payload.error) && typeof payload.error.message === 'string'
        ? payload.error.message.trim()
        : '';
    throw new LevelsLoadError(
      apiMessage.length > 0 ? `关卡加载失败：${apiMessage}` : `关卡加载失败（HTTP ${response.status}）`
    );
  }
  return normalizeLevels(payload);
}

// 仅以文本节点渲染关卡信息，避免将响应数据拼入 HTML 造成 XSS。
function renderLevelItem(doc, level) {
  const item = doc.createElement('li');
  item.appendChild(doc.createTextNode(`${level.name} · 难度 ${level.difficulty}`));
  if (!level.unlocked) {
    item.appendChild(doc.createTextNode('（未解锁）'));
  }
  return item;
}

function renderLevels(doc, levels) {
  const list = doc.getElementById('level-list');
  list.textContent = '';
  for (const level of levels) {
    list.appendChild(renderLevelItem(doc, level));
  }
}

async function initLevelSelect({ document: doc, fetchImpl } = {}) {
  const loading = doc.getElementById('loading');
  const list = doc.getElementById('level-list');
  const errorMessage = doc.getElementById('error-message');
  try {
    const levels = await loadLevels(fetchImpl);
    renderLevels(doc, levels);
    errorMessage.textContent = '';
  } catch (error) {
    list.textContent = '';
    errorMessage.textContent = error instanceof LevelsLoadError ? error.message : GENERIC_ERROR_MESSAGE;
  }
  loading.textContent = '';
}

const levelSelectApi = { initLevelSelect };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = levelSelectApi;
}

// 浏览器环境加载本脚本时自动初始化；Node 测试环境无 document，不触发。
if (typeof document !== 'undefined' && typeof fetch === 'function') {
  initLevelSelect({ document, fetchImpl: fetch });
}
