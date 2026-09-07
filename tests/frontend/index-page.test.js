'use strict';

// tests/frontend/index-page.test.js — 页面骨架静态断言（TASK-007 / TASK-008）
// 覆盖 AC-010：web/index.html 必须包含三个容器标记并以 script 标签加载 level-select.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML_PATH = path.resolve(__dirname, '..', '..', 'web', 'index.html');
const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

test('AC-010: index.html 包含 loading / level-list / error-message 三个容器标记', () => {
  assert.match(html, /id="loading"/, '必须存在 id=loading 容器');
  assert.match(html, /id="level-list"/, '必须存在 id=level-list 容器');
  assert.match(html, /id="error-message"/, '必须存在 id=error-message 容器');
});

test('AC-010: index.html 以 script 标签加载 web/level-select.js', () => {
  assert.match(
    html,
    /<script[^>]*src="[^"]*level-select\.js"[^>]*><\/script>/,
    '必须以 script 标签加载 level-select.js'
  );
});
