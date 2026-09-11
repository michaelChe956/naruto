'use strict';

// 页面级 DOM 替身：仅实现 level-select.js 所需的 getElementById/createElement 与
// textContent/hidden/disabled/children 等最小面，使测试在 node --test 下
// 运行且不启动浏览器（AC-010）。
// textContent 与真实 DOM 同语义：读取时聚合后代文本，写入时替换全部子节点为纯文本。
function createElement(tagName) {
  const element = {
    tagName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    hidden: false,
    disabled: false,
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...nextChildren) {
      this.children = nextChildren;
      this._ownText = undefined;
    },
  };
  Object.defineProperty(element, 'textContent', {
    get() {
      if (this.children.length > 0) {
        return this.children.map((child) => child.textContent).join('');
      }
      return this._ownText ?? '';
    },
    set(value) {
      this.children = [];
      this._ownText = String(value);
    },
  });
  return element;
}

function createDomStub(containerIds) {
  const byId = new Map();
  for (const id of containerIds) {
    const element = createElement('div');
    element.id = id;
    byId.set(id, element);
  }
  return {
    byId,
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tagName) => createElement(tagName),
  };
}

module.exports = { createDomStub, createElement };
