'use strict';

// 关卡选择页数据消费模块。
//
// 设计约束（TASK-007 / TASK-008 / TASK-009）：
// - 以注入 { document, fetchImpl } 的方式运行，便于 node --test 用替身验证，不启动浏览器；
// - 以相对路径请求 GET /api/levels（契约见 server/index.js：恰五项、
//   difficulty ∈ 简单/普通/困难、unlocked 为布尔；失败返回 500 + LEVEL_DATA_UNAVAILABLE）；
// - 请求失败、非成功状态或响应结构非法时，在错误容器展示可读提示并保留页面框架不白屏；
// - unlocked 为 false 的关卡渲染为锁定不可选。
//
// 双端导出：Node（CommonJS 测试）走 module.exports；浏览器挂载 globalThis，
// 由 web/index.html 内联脚本调用启动。

const LEVELS_API_PATH = '/api/levels';
const REQUIRED_LEVEL_COUNT = 5;
const VALID_DIFFICULTIES = ['简单', '普通', '困难'];

const ERROR_MESSAGES = {
  NETWORK: '关卡数据加载失败，请检查网络后重试。',
  HTTP: (status) => `关卡数据加载失败（HTTP ${status}），请稍后重试。`,
  INVALID: '关卡数据格式不正确，请稍后重试或联系管理员。',
};

class LevelSelectError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LevelSelectError';
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidLevelRecord(record) {
  return (
    isPlainObject(record) &&
    isNonEmptyString(record.id) &&
    isNonEmptyString(record.name) &&
    VALID_DIFFICULTIES.includes(record.difficulty) &&
    typeof record.unlocked === 'boolean'
  );
}

function isValidLevelsPayload(payload) {
  return (
    Array.isArray(payload) &&
    payload.length === REQUIRED_LEVEL_COUNT &&
    payload.every(isValidLevelRecord)
  );
}

async function fetchLevels(fetchImpl) {
  let response;
  try {
    response = await fetchImpl(LEVELS_API_PATH);
  } catch (error) {
    throw new LevelSelectError(ERROR_MESSAGES.NETWORK);
  }

  if (!isPlainObject(response) || !response.ok) {
    const status = isPlainObject(response) && response.status !== undefined ? response.status : '未知';
    throw new LevelSelectError(ERROR_MESSAGES.HTTP(status));
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new LevelSelectError(ERROR_MESSAGES.INVALID);
  }

  if (!isValidLevelsPayload(payload)) {
    throw new LevelSelectError(ERROR_MESSAGES.INVALID);
  }
  return payload;
}

function createLevelItem(doc, level) {
  const item = doc.createElement('li');
  item.className = level.unlocked ? 'level-item' : 'level-item level-item-locked';

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'level-select';
  button.disabled = !level.unlocked;

  const nameSpan = doc.createElement('span');
  nameSpan.className = 'level-name';
  nameSpan.textContent = level.name;

  const difficultySpan = doc.createElement('span');
  difficultySpan.className = 'level-difficulty';
  difficultySpan.textContent = level.difficulty;

  button.appendChild(nameSpan);
  button.appendChild(difficultySpan);
  item.appendChild(button);
  return item;
}

function renderLevels(doc, listContainer, levels) {
  listContainer.replaceChildren(...levels.map((level) => createLevelItem(doc, level)));
}

// 启动关卡选择页数据加载与渲染；返回 Promise，渲染或错误分支落定后 resolve。
async function initLevelSelect({ document: doc, fetchImpl }) {
  const loadingContainer = doc.getElementById('loading');
  const listContainer = doc.getElementById('level-list');
  const errorContainer = doc.getElementById('error-message');

  errorContainer.hidden = true;
  errorContainer.textContent = '';
  loadingContainer.hidden = false;

  try {
    const levels = await fetchLevels(fetchImpl);
    renderLevels(doc, listContainer, levels);
  } catch (error) {
    // 保留页面框架：清空列表容器，仅以错误容器提示，不白屏
    listContainer.replaceChildren();
    errorContainer.textContent =
      error instanceof LevelSelectError ? error.message : ERROR_MESSAGES.NETWORK;
    errorContainer.hidden = false;
  } finally {
    loadingContainer.hidden = true;
  }
}

if (typeof module !== 'undefined' && module.exports !== undefined) {
  module.exports = { initLevelSelect, LEVELS_API_PATH };
}

if (typeof globalThis !== 'undefined') {
  globalThis.initLevelSelect = initLevelSelect;
}
