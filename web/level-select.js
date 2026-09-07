'use strict';

const LEVEL_COUNT = 5;
const LEVEL_DIFFICULTIES = new Set(['简单', '普通', '困难']);

function isValidLevels(levels) {
  if (!Array.isArray(levels) || levels.length !== LEVEL_COUNT) {
    return false;
  }

  const seen = new Set();
  return levels.every((level) => {
    if (level === null || typeof level !== 'object' || Array.isArray(level)) {
      return false;
    }
    if (typeof level.id !== 'string' || level.id.length === 0 || seen.has(level.id)) {
      return false;
    }
    if (typeof level.name !== 'string' || level.name.trim().length === 0) {
      return false;
    }
    if (!LEVEL_DIFFICULTIES.has(level.difficulty) || typeof level.unlocked !== 'boolean') {
      return false;
    }
    seen.add(level.id);
    return true;
  });
}

function showError(document, message) {
  const loading = document.getElementById('loading');
  const error = document.getElementById('error-message');

  if (loading) {
    loading.hidden = true;
  }
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
}

async function initLevelSelect({ document, fetchImpl = fetch } = {}) {
  const loading = document.getElementById('loading');
  const levelList = document.getElementById('level-list');

  try {
    const response = await fetchImpl('/api/levels');
    if (!response.ok) {
      throw new Error('LEVEL_REQUEST_FAILED');
    }
    const levels = await response.json();
    if (!isValidLevels(levels)) {
      throw new Error('INVALID_LEVEL_DATA');
    }

    levelList.textContent = '';
    for (const level of levels) {
      const item = document.createElement('li');
      item.className = level.unlocked ? 'level-item' : 'level-item locked';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = level.unlocked ? 'level-button' : 'level-button locked';
      button.textContent = `${level.name}（${level.difficulty}）`;
      button.disabled = !level.unlocked;
      item.appendChild(button);
      levelList.appendChild(item);
    }

    loading.hidden = true;
  } catch {
    showError(document, '关卡加载失败，请稍后重试。');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initLevelSelect };
}

if (typeof globalThis.document !== 'undefined') {
  initLevelSelect({ document: globalThis.document, fetchImpl: globalThis.fetch });
}
