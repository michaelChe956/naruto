'use strict';

const LEVELS_API_PATH = '/api/levels';
const VALID_DIFFICULTIES = ['简单', '普通', '困难'];
const EXPECTED_LEVEL_COUNT = 5;
const LOAD_ERROR_MESSAGE = '关卡数据加载失败，请稍后重试';

/** 响应结构不满足契约时抛出的内部错误（信息不对外展示）。 */
class LevelResponseError extends Error {}

/**
 * 关卡选择页入口。
 *
 * @param {Object} options
 * @param {Document} options.document 页面文档对象（可注入替身）。
 * @param {Function} [options.fetchImpl] fetch 实现（默认使用全局 fetch，可注入替身）。
 * @returns {Promise<void>} 页面加载流程结束（渲染完成或错误展示后）即 resolve。
 */
function initLevelSelect({ document: doc, fetchImpl = globalThis.fetch } = {}) {
  const loadingEl = doc.getElementById('loading');
  const listEl = doc.getElementById('level-list');
  const errorEl = doc.getElementById('error-message');

  loadingEl.hidden = false;
  listEl.hidden = true;
  errorEl.hidden = true;

  return fetchLevels(fetchImpl)
    .then((levels) => {
      renderLevels(doc, listEl, levels);
      loadingEl.hidden = true;
      listEl.hidden = false;
    })
    .catch(() => {
      showLoadError(doc, loadingEl, listEl, errorEl);
    });
}

async function fetchLevels(fetchImpl) {
  const response = await fetchImpl(LEVELS_API_PATH);
  if (!response.ok) {
    throw new LevelResponseError('关卡接口响应为非成功状态');
  }
  const bodyText = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    throw new LevelResponseError('关卡接口响应不是合法 JSON');
  }
  validateLevelsPayload(parsed);
  return parsed;
}

function validateLevelsPayload(data) {
  if (!Array.isArray(data)) {
    throw new LevelResponseError('关卡数据必须是顶层数组');
  }
  if (data.length !== EXPECTED_LEVEL_COUNT) {
    throw new LevelResponseError(`关卡数据必须包含 ${EXPECTED_LEVEL_COUNT} 项`);
  }

  const seenIds = new Set();
  data.forEach((level, index) => {
    const where = `第 ${index + 1} 项`;
    if (level === null || typeof level !== 'object' || Array.isArray(level)) {
      throw new LevelResponseError(`${where}必须是关卡对象`);
    }
    if (typeof level.id !== 'string' || level.id.trim() === '') {
      throw new LevelResponseError(`${where} id 必须为非空字符串`);
    }
    if (seenIds.has(level.id)) {
      throw new LevelResponseError(`${where} id 重复`);
    }
    seenIds.add(level.id);
    if (typeof level.name !== 'string' || level.name.trim() === '') {
      throw new LevelResponseError(`${where} name 必须为非空字符串`);
    }
    if (!VALID_DIFFICULTIES.includes(level.difficulty)) {
      throw new LevelResponseError(`${where} difficulty 必须属于 简单/普通/困难`);
    }
    if (typeof level.unlocked !== 'boolean') {
      throw new LevelResponseError(`${where} unlocked 必须为布尔值`);
    }
  });
}

function showLoadError(doc, loadingEl, listEl, errorEl) {
  loadingEl.hidden = true;
  listEl.hidden = true;
  errorEl.appendChild(doc.createTextNode(LOAD_ERROR_MESSAGE));
  errorEl.hidden = false;
}

function renderLevels(doc, listEl, levels) {
  for (const level of levels) {
    listEl.appendChild(createLevelItem(doc, level));
  }
}

function createLevelItem(doc, level) {
  const itemEl = doc.createElement('li');
  const buttonEl = doc.createElement('button');
  buttonEl.setAttribute('type', 'button');
  buttonEl.disabled = !level.unlocked;
  buttonEl.appendChild(doc.createTextNode(`${level.name} · 难度：${level.difficulty}`));
  itemEl.appendChild(buttonEl);
  return itemEl;
}

module.exports = { initLevelSelect };
