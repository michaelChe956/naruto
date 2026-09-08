'use strict';

// 关卡选择页逻辑：仅依赖原生 JavaScript，不引入任何 npm 包与外部资源。
// 通过依赖注入（document、fetchImpl）驱动，测试中以替身运行、无需浏览器。

const LEVELS_API_PATH = '/api/levels';
const VALID_DIFFICULTIES = ['简单', '普通', '困难'];

const HIDDEN_CLASS = 'hidden';

// 由本模块主动构造、信息可读且不泄漏内部细节的错误。
class LevelLoadError extends Error {}

// 校验响应形状：顶层数组，且每项具备非空 id/name、合法 difficulty、布尔 unlocked。
// 形状非法时返回可读中文描述，合法时返回 null。
function validateLevelsPayload(value) {
  if (!Array.isArray(value)) {
    return '关卡数据必须是数组';
  }
  for (let index = 0; index < value.length; index += 1) {
    const level = value[index];
    const label = `第 ${index + 1} 项`;
    if (level === null || typeof level !== 'object' || Array.isArray(level)) {
      return `${label}必须是对象`;
    }
    if (typeof level.id !== 'string' || level.id.trim() === '') {
      return `${label}的 id 必须是非空字符串`;
    }
    if (typeof level.name !== 'string' || level.name.trim() === '') {
      return `${label}的 name 必须是非空字符串`;
    }
    if (!VALID_DIFFICULTIES.includes(level.difficulty)) {
      return `${label}的 difficulty 取值必须是：${VALID_DIFFICULTIES.join('、')}`;
    }
    if (typeof level.unlocked !== 'boolean') {
      return `${label}的 unlocked 必须是布尔值`;
    }
  }
  return null;
}

function show(element) {
  element.classList.remove(HIDDEN_CLASS);
}

function hide(element) {
  element.classList.add(HIDDEN_CLASS);
}

// 渲染关卡列表：每项展示名称与难度；unlocked=false 的关卡锁定且不可选。
function renderLevels(document, levels) {
  const list = document.getElementById('level-list');
  for (const level of levels) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = level.unlocked ? 'level-item' : 'level-item level-locked';
    item.textContent = `${level.name}（难度：${level.difficulty}）`;
    if (!level.unlocked) {
      item.disabled = true;
      item.setAttribute('aria-disabled', 'true');
    }
    list.appendChild(item);
  }
  show(list);
}

// 展示可读错误：隐藏加载提示，在 error-message 呈现信息，保留页面基本框架不白屏。
function showReadableError(errorMessage, message) {
  errorMessage.textContent = message;
  show(errorMessage);
}

// initLevelSelect({ document, fetchImpl })：
// 加载期间呈现加载态；成功后在 level-list 渲染名称与难度；
// 请求失败、非 200 或结构非法时降级为可读错误提示，不抛出、不白屏。
async function initLevelSelect({ document, fetchImpl }) {
  const loading = document.getElementById('loading');
  const list = document.getElementById('level-list');
  const errorMessage = document.getElementById('error-message');

  show(loading);
  hide(list);
  hide(errorMessage);

  let levels;
  try {
    const response = await fetchImpl(LEVELS_API_PATH);
    if (!response.ok) {
      let detail = `服务返回异常状态 ${response.status}`;
      try {
        const body = await response.json();
        if (
          body &&
          typeof body === 'object' &&
          body.error &&
          typeof body.error.message === 'string' &&
          body.error.message.trim() !== ''
        ) {
          detail = body.error.message;
        }
      } catch (error) {
        // 错误体不是 JSON：保留默认状态描述即可。
      }
      throw new LevelLoadError(`关卡数据加载失败（HTTP ${response.status}）：${detail}`);
    }
    const payload = await response.json();
    const problem = validateLevelsPayload(payload);
    if (problem !== null) {
      throw new LevelLoadError(`关卡数据加载失败：${problem}`);
    }
    levels = payload;
  } catch (error) {
    hide(loading);
    if (error instanceof LevelLoadError) {
      showReadableError(errorMessage, error.message);
    } else {
      showReadableError(errorMessage, '关卡数据加载失败：网络异常或服务不可用，请稍后重试');
    }
    return;
  }

  hide(loading);
  renderLevels(document, levels);
}

// 仅在浏览器环境（非 require/测试）自动初始化页面。
if (typeof document !== 'undefined' && typeof module === 'undefined') {
  initLevelSelect({ document, fetchImpl: (...args) => fetch(...args) });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { initLevelSelect };
}
