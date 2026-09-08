'use strict';

/**
 * web/level-select.js — 关卡选择页渲染逻辑（原生 JS，无依赖）。
 *
 * 导出 initLevelSelect({ document, fetchImpl })：
 * - 以相对路径 GET /api/levels；
 * - 响应体为满足 EXE-006 字段级约束的数组时，逐项渲染名称、难度，
 *   并按 unlocked 呈现锁定不可选状态；
 * - 请求失败、非 2xx、JSON 非法、响应体非数组或字段非法时，在
 *   error-message 容器展示可读错误，保留页面框架（不白屏）。
 *
 * 返回值：Promise，首次加载处理完成后 resolve（错误已被吸收，不会
 * reject），便于浏览器引导与测试确定性等待。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = api;
    return;
  }
  root.initLevelSelect = api.initLevelSelect;
  // 浏览器环境自动引导（Node 测试环境无 document，不会触发）。
  // script 置于 body 末尾，容器此时已存在。
  if (root.document) {
    api.initLevelSelect({ document: root.document, fetchImpl: root.fetch.bind(root) });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LEVELS_API_PATH = '/api/levels';
  const VALID_DIFFICULTIES = ['简单', '普通', '困难'];
  const ERROR_MESSAGE = '关卡数据加载失败，请稍后重试。';

  /**
   * 校验单个关卡对象是否满足 EXE-006 字段级约束。
   * @param {unknown} item 待校验的数组元素
   * @returns {boolean} 是否合法
   */
  function isValidLevelItem(item) {
    if (item === null || typeof item !== 'object') {
      return false;
    }
    return (
      typeof item.id === 'string' && item.id.length > 0 &&
      typeof item.name === 'string' && item.name.length > 0 &&
      VALID_DIFFICULTIES.includes(item.difficulty) &&
      typeof item.unlocked === 'boolean'
    );
  }

  /**
   * 校验响应体是否为元素全部满足 EXE-006 的数组。
   * @param {unknown} payload 响应体
   * @returns {boolean} 是否合法
   */
  function isValidLevelsPayload(payload) {
    return Array.isArray(payload) && payload.every(isValidLevelItem);
  }

  /**
   * 初始化关卡选择页：拉取 /api/levels 并渲染，失败时展示可读错误。
   * @param {object} deps 依赖注入
   * @param {Document} deps.document 页面 document（真实 DOM 或测试替身）
   * @param {Function} deps.fetchImpl fetch 实现（真实 fetch 或测试替身）
   * @returns {Promise<void>} 首次加载处理完成后 resolve
   */
  function initLevelSelect({ document, fetchImpl }) {
    const loading = document.getElementById('loading');
    const list = document.getElementById('level-list');
    const errorBox = document.getElementById('error-message');

    const finish = () => {
      loading.hidden = true;
    };

    const showError = () => {
      list.textContent = '';
      errorBox.textContent = ERROR_MESSAGE;
      errorBox.hidden = false;
      finish();
    };

    return Promise.resolve()
      .then(() => fetchImpl(LEVELS_API_PATH))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        if (!isValidLevelsPayload(payload)) {
          throw new Error('INVALID_LEVELS_PAYLOAD');
        }
        list.textContent = '';
        payload.forEach((level) => {
          const item = document.createElement('li');
          item.setAttribute('data-level-id', level.id);
          if (level.unlocked) {
            item.className = 'level-item unlocked';
            item.textContent = `${level.name}（难度：${level.difficulty}）`;
          } else {
            item.className = 'level-item locked';
            item.textContent = `${level.name}（难度：${level.difficulty}）—— 已锁定`;
            item.setAttribute('aria-disabled', 'true');
          }
          list.appendChild(item);
        });
        errorBox.textContent = '';
        errorBox.hidden = true;
        finish();
      })
      .catch(showError);
  }

  return { initLevelSelect };
});
