'use strict';

// tests/frontend/helpers.js — 前端测试共享辅助（非 *.test.js，不会被测试运行器执行）
//
// - createElement()/createDocument()：最小 document 替身，仅实现
//   web/level-select.js 所依赖的 DOM 面（getElementById/createElement/
//   appendChild/textContent/className/hidden/setAttribute）
// - createFetchImpl()：最小 fetchImpl 替身，可注入成功响应、非 2xx
//   响应、json 解析失败与网络拒绝四种分支，并记录调用 URL
// - validLevelsPayload()：满足 EXE-006 字段级约束的五项关卡数组夹具

/**
 * 创建最小元素替身。
 * textContent 赋值语义与真实 DOM 一致：清空全部子节点。
 * @param {string} tagName 标签名
 * @returns {object} 最小元素替身
 */
function createElement(tagName) {
  const element = {
    tagName: String(tagName).toUpperCase(),
    className: '',
    hidden: false,
    children: [],
    attributes: {},
    parentNode: null,
    /** @type {string} 实际存储的文本内容 */
    textContentValue: '',
    appendChild(child) {
      child.parentNode = element;
      element.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.hasOwn(element.attributes, name) ? element.attributes[name] : null;
    },
  };
  Object.defineProperty(element, 'textContent', {
    get() {
      return element.textContentValue;
    },
    set(value) {
      element.textContentValue = String(value);
      element.children = [];
    },
  });
  return element;
}

/**
 * 创建最小 document 替身，预置页面三个容器。
 * @param {string[]} [containerIds] 容器 id 列表，默认与 TASK-007 一致
 * @returns {object} 含 getElementById/createElement 的 document 替身
 */
function createDocument(containerIds = ['loading', 'level-list', 'error-message']) {
  const containers = new Map(containerIds.map((id) => [id, createElement('div')]));
  return {
    containers,
    getElementById(id) {
      return containers.get(id) ?? null;
    },
    createElement(tagName) {
      return createElement(tagName);
    },
  };
}

/**
 * 创建记录调用 URL 的 fetchImpl 替身。
 * @param {object} [options]
 * @param {number} [options.status] 响应状态码，默认 200
 * @param {unknown} [options.body] response.json() 的返回值
 * @param {Error|null} [options.rejectWith] 非 null 时让 fetch 直接拒绝（模拟网络失败）
 * @param {string[]} [options.calls] 收集调用 URL 的数组
 * @returns {Function} fetchImpl 替身
 */
function createFetchImpl({ status = 200, body, rejectWith = null, calls = [] } = {}) {
  const fetchImpl = (url) => {
    calls.push(url);
    if (rejectWith) {
      return Promise.reject(rejectWith);
    }
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/**
 * 创建 json() 必定拒绝的响应替身场景（模拟非法 JSON 报文）。
 * @param {string[]} [calls] 收集调用 URL 的数组
 * @returns {Function} fetchImpl 替身
 */
function createFetchImplWithBrokenJson(calls = []) {
  const fetchImpl = (url) => {
    calls.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token < in JSON')),
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/**
 * 满足 EXE-006 字段级约束的五项关卡数组夹具（与 data/levels.json 结构一致）。
 * @returns {Array<object>} 深拷贝后的五项关卡数组
 */
function validLevelsPayload() {
  return [
    { id: 'level-1', name: '木叶村演习场', difficulty: '简单', unlocked: true },
    { id: 'level-2', name: '死亡森林', difficulty: '简单', unlocked: true },
    { id: 'level-3', name: '中忍考试会场', difficulty: '普通', unlocked: false },
    { id: 'level-4', name: '终结之谷', difficulty: '普通', unlocked: false },
    { id: 'level-5', name: '大蛇丸据点', difficulty: '困难', unlocked: false },
  ];
}

module.exports = {
  createElement,
  createDocument,
  createFetchImpl,
  createFetchImplWithBrokenJson,
  validLevelsPayload,
};
