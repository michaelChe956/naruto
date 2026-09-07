'use strict';

// web/level-select.js — 关卡选择页渲染逻辑（TASK-009 / TASK-010）
//
// initLevelSelect({ document, fetchImpl }):
//   - 请求期显示 id=loading
//   - 成功：以文本节点在 id=level-list 渲染每个关卡的 name 与 difficulty；
//     unlocked=false 项带 data-locked="true" 与 aria-disabled="true"（锁定不可选择）
//   - fetch 抛异常 / 非 2xx / 结构无效：在 id=error-message 显示可读提示，
//     保留页面框架不白屏
// 导出采用双模式：Node（module.exports）供测试加载；浏览器挂载全局
// initLevelSelect 并在 script 加载后自动初始化页面。

(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }

  root.initLevelSelect = api.initLevelSelect;

  // 浏览器自动引导：index.html 以普通 script 标签加载本文件，加载即渲染。
  if (typeof document !== 'undefined') {
    const bootstrap = function () {
      api.initLevelSelect({
        document: document,
        fetchImpl: function callFetch(url) {
          return fetch(url);
        },
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
      bootstrap();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LEVELS_API_PATH = '/api/levels';

  /**
   * 校验关卡响应结构：顶层数组且每项含非空 name、非空 difficulty 与布尔 unlocked。
   * @param {*} value 已 JSON.parse 的响应体
   * @returns {boolean}
   */
  function isValidLevelsPayload(value) {
    if (!Array.isArray(value)) {
      return false;
    }
    return value.every(function isLevelItem(item) {
      return (
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof item.name === 'string' &&
        item.name.trim() !== '' &&
        typeof item.difficulty === 'string' &&
        item.difficulty.trim() !== '' &&
        typeof item.unlocked === 'boolean'
      );
    });
  }

  /**
   * 尝试从错误响应体读取后端 message（CT-001：{ error: { code, message } }）。
   * @param {{ json: Function }} response
   * @returns {Promise<string|null>}
   */
  async function readBackendErrorMessage(response) {
    try {
      const payload = await response.json();
      const message = payload && payload.error && payload.error.message;
      if (typeof message === 'string' && message.trim() !== '') {
        return message;
      }
    } catch {
      // 响应体不是 JSON 时忽略，回退到状态码提示
    }
    return null;
  }

  /**
   * 渲染单个关卡项：name 与 difficulty 以文本节点呈现；
   * 未解锁项显示锁定态并标记为不可选择。
   */
  function renderLevelItem(doc, listEl, level) {
    const itemEl = doc.createElement('li');
    itemEl.textContent = level.unlocked
      ? `${level.name}（难度：${level.difficulty}）`
      : `${level.name}（难度：${level.difficulty}）🔒 已锁定`;
    if (!level.unlocked) {
      itemEl.setAttribute('data-locked', 'true');
      itemEl.setAttribute('aria-disabled', 'true');
    }
    listEl.appendChild(itemEl);
  }

  /**
   * 初始化关卡选择页（TASK-009 / TASK-010）。
   * @param {{ document: Document, fetchImpl: Function }} context
   * @returns {Promise<void>} 永不 reject：失败以页面内错误提示呈现
   */
  async function initLevelSelect(context) {
    const doc = context.document;
    const fetchImpl = context.fetchImpl;
    const loadingEl = doc.getElementById('loading');
    const listEl = doc.getElementById('level-list');
    const errorEl = doc.getElementById('error-message');

    loadingEl.removeAttribute('hidden');

    try {
      const response = await fetchImpl(LEVELS_API_PATH);
      if (!response.ok) {
        const backendMessage = await readBackendErrorMessage(response);
        throw new Error(backendMessage || `服务器返回状态码 ${response.status}`);
      }
      const payload = await response.json();
      if (!isValidLevelsPayload(payload)) {
        throw new TypeError('返回数据格式无效');
      }
      for (const level of payload) {
        renderLevelItem(doc, listEl, level);
      }
    } catch (error) {
      const reason = error && error.message ? error.message : '未知错误';
      errorEl.textContent = `关卡加载失败：${reason}`;
      errorEl.removeAttribute('hidden');
    } finally {
      loadingEl.setAttribute('hidden', '');
    }
  }

  return { initLevelSelect, isValidLevelsPayload, LEVELS_API_PATH };
});
