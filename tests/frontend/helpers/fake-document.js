'use strict';

// 前端测试替身：最小化 fake DOM，仅覆盖 web/level-select.js 所需接口
// （getElementById / createElement / appendChild / replaceChildren 与
// textContent、className、disabled、hidden 属性），不启动浏览器。

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.type = '';
    this.parentNode = null;
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  replaceChildren(...nodes) {
    for (const existing of this.children) {
      existing.parentNode = null;
    }
    this.children = [];
    for (const node of nodes) {
      this.appendChild(node);
    }
  }
}

// 按 className 递归查找后代元素（className 以空格分隔多值）
function findByClassName(root, className) {
  const found = [];
  for (const child of root.children) {
    if (child.className.split(/\s+/).includes(className)) {
      found.push(child);
    }
    found.push(...findByClassName(child, className));
  }
  return found;
}

// 构造含关卡选择页三个容器（loading / level-list / error-message）的 fake document
function createFakeDocument() {
  const body = new FakeElement('body');
  const registry = new Map();
  for (const id of ['loading', 'level-list', 'error-message']) {
    const element = new FakeElement(id === 'level-list' ? 'ul' : 'p');
    element.id = id;
    body.appendChild(element);
    registry.set(id, element);
  }
  return {
    body,
    getElementById: (id) => registry.get(id) ?? null,
    createElement: (tagName) => new FakeElement(tagName),
  };
}

module.exports = { createFakeDocument, findByClassName };
