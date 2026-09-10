'use strict';

// 最小 document 替身：仅支持 level-select.js 用到的 DOM 能力
// （getElementById / createElement / createTextNode / appendChild / textContent）。
function createTextNode(text) {
  return {
    text,
    get textContent() {
      return this.text;
    },
  };
}

function createElement(tagName) {
  const element = {
    tagName,
    childNodes: [],
    ownText: '',
    appendChild(child) {
      element.childNodes.push(child);
      return child;
    },
    get textContent() {
      if (element.childNodes.length > 0) {
        return element.childNodes.map((node) => node.textContent).join('');
      }
      return element.ownText;
    },
    set textContent(value) {
      element.childNodes = [];
      element.ownText = value;
    },
  };
  return element;
}

// 与 web/index.html 页面契约一致的三个容器；未登记的 id 与真实 DOM 一致返回 null。
function createDocumentStub() {
  const elements = new Map();
  const doc = {
    createElement,
    createTextNode,
    getElementById(id) {
      return elements.get(id) || null;
    },
    registerElement(id) {
      const element = createElement('div');
      elements.set(id, element);
      return element;
    },
  };
  return doc;
}

module.exports = { createDocumentStub };
