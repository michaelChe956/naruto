'use strict';

// tests/frontend/helpers.js — 前端测试共用工具（TASK-007）
// 提供最小 DOM 替身与 fetch 响应构造器，不依赖任何第三方库。

/** 与 data/levels.json 一致的有效五项关卡数据。 */
const FIVE_LEVELS = [
  { id: 'level-1', name: '木叶演习场', difficulty: '简单', unlocked: true },
  { id: 'level-2', name: '死亡森林', difficulty: '普通', unlocked: true },
  { id: 'level-3', name: '波之国大桥', difficulty: '普通', unlocked: false },
  { id: 'level-4', name: '中忍考试会场', difficulty: '困难', unlocked: false },
  { id: 'level-5', name: '终结之谷', difficulty: '困难', unlocked: false },
];

/**
 * 创建最小元素替身：仅支持实现中约定使用的 DOM API。
 * @param {string} tagName 标签名
 */
function createFakeElement(tagName) {
  const element = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    textContent: '',
    attributes: {},
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(element.attributes, name)
        ? element.attributes[name]
        : null;
    },
    removeAttribute(name) {
      delete element.attributes[name];
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(element.attributes, name);
    },
  };
  return element;
}

/**
 * 创建最小 document 替身。
 * 三容器初始态与 web/index.html 一致：loading 可见，error-message 隐藏。
 */
function createFakeDocument() {
  const containers = {
    loading: createFakeElement('div'),
    'level-list': createFakeElement('ul'),
    'error-message': createFakeElement('div'),
  };
  containers['error-message'].setAttribute('hidden', '');

  const registry = new Map(Object.entries(containers));
  const doc = {
    containers,
    createdElements: [],
    getElementById(id) {
      return registry.get(id) || null;
    },
    createElement(tag) {
      const el = createFakeElement(tag);
      doc.createdElements.push(el);
      return el;
    },
  };
  return doc;
}

/** 2xx 成功响应替身。 */
function okJsonResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

/** 任意状态码响应替身。 */
function statusResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

/** 在列表替身中按关卡名查找渲染项。 */
function findRenderedItem(listEl, levelName) {
  return listEl.children.find((child) => child.textContent.includes(levelName));
}

/** 拼接列表全部渲染文本，便于整体断言。 */
function listText(listEl) {
  return listEl.children.map((child) => child.textContent).join('\n');
}

module.exports = {
  FIVE_LEVELS,
  createFakeElement,
  createFakeDocument,
  okJsonResponse,
  statusResponse,
  findRenderedItem,
  listText,
};
