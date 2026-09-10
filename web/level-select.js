'use strict';

const API_LEVELS_PATH = '/api/levels';

const CONTAINER_IDS = Object.freeze({
  loading: 'level-loading',
  list: 'level-list',
  error: 'level-error',
});

const DIFFICULTY_LABELS = Object.freeze({
  easy: '简单',
  normal: '普通',
  hard: '困难',
});

const MESSAGES = Object.freeze({
  network: '网络异常，无法加载关卡数据，请稍后重试。',
  parse: '关卡数据解析失败，请稍后重试。',
  invalid: '关卡数据格式无效，请稍后重试。',
});

class LevelLoadError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'LevelLoadError';
    this.reason = reason;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidLevelsPayload(payload) {
  if (!Array.isArray(payload)) {
    return false;
  }
  return payload.every(
    (level) =>
      typeof level === 'object' &&
      level !== null &&
      !Array.isArray(level) &&
      isNonEmptyString(level.id) &&
      isNonEmptyString(level.name) &&
      DIFFICULTY_LABELS[level.difficulty] !== undefined &&
      typeof level.unlocked === 'boolean'
  );
}

function createLevelItem(document, level) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = level.unlocked ? 'level-item' : 'level-item level-item--locked';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'level-item__name';
  nameSpan.textContent = level.name;

  const difficultySpan = document.createElement('span');
  difficultySpan.className = 'level-item__difficulty';
  difficultySpan.textContent = DIFFICULTY_LABELS[level.difficulty];
  difficultySpan.setAttribute('data-difficulty', level.difficulty);

  item.appendChild(nameSpan);
  item.appendChild(difficultySpan);
  item.setAttribute('data-level-id', level.id);

  if (!level.unlocked) {
    item.disabled = true;
    item.setAttribute('aria-disabled', 'true');
  }
  return item;
}

function renderLevels(document, list, levels) {
  levels.forEach((level) => {
    list.appendChild(createLevelItem(document, level));
  });
}

async function initLevelSelect({ document, fetchImpl } = {}) {
  if (!document || typeof document.getElementById !== 'function') {
    throw new TypeError('initLevelSelect 需要注入 document');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('initLevelSelect 需要注入 fetchImpl 函数');
  }

  const containers = {
    loading: document.getElementById(CONTAINER_IDS.loading),
    list: document.getElementById(CONTAINER_IDS.list),
    error: document.getElementById(CONTAINER_IDS.error),
  };
  const missing = Object.entries(containers)
    .filter(([, element]) => element === null)
    .map(([name]) => CONTAINER_IDS[name]);
  if (missing.length > 0) {
    throw new Error(`页面缺少关卡容器标记：${missing.join('、')}`);
  }

  const showLoading = () => {
    containers.loading.hidden = false;
    containers.list.hidden = true;
    containers.error.hidden = true;
  };
  const showError = (message) => {
    containers.loading.hidden = true;
    containers.list.hidden = true;
    containers.error.textContent = message;
    containers.error.hidden = false;
  };

  showLoading();
  let levels;
  try {
    const response = await fetchImpl(API_LEVELS_PATH);
    if (!response || typeof response.json !== 'function') {
      throw new LevelLoadError('invalid', MESSAGES.invalid);
    }
    if (!response.ok) {
      throw new LevelLoadError(
        'status',
        `服务器返回 ${response.status}，关卡数据加载失败，请稍后重试。`
      );
    }
    try {
      levels = await response.json();
    } catch (error) {
      throw new LevelLoadError('parse', MESSAGES.parse);
    }
    if (!isValidLevelsPayload(levels)) {
      throw new LevelLoadError('invalid', MESSAGES.invalid);
    }
  } catch (error) {
    if (error instanceof LevelLoadError) {
      showError(error.message);
      return { ok: false, reason: error.reason };
    }
    showError(MESSAGES.network);
    return { ok: false, reason: 'network' };
  }

  renderLevels(document, containers.list, levels);
  containers.loading.hidden = true;
  containers.error.hidden = true;
  containers.list.hidden = false;
  return { ok: true, total: levels.length };
}

const levelSelect = { initLevelSelect, CONTAINER_IDS };

if (typeof module === 'object' && module !== null && module.exports !== undefined) {
  module.exports = levelSelect;
} else {
  globalThis.initLevelSelect = initLevelSelect;
  globalThis.CONTAINER_IDS = CONTAINER_IDS;
}
