'use strict';

// tests/frontend/page-entry.test.js — AC-006 页面入口静态结构验证
//
// 验证 web/index.html 提供页面骨架与 loading/level-list/error-message
// 三个容器，并以相对路径 script 引入 web/level-select.js。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INDEX_PATH = path.join(REPO_ROOT, 'web', 'index.html');

test('AC-006: web/index.html 存在且含 loading/level-list/error-message 三个容器', () => {
  assert.equal(fs.existsSync(INDEX_PATH), true, 'web/index.html 应存在');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  assert.ok(html.includes('id="loading"'), '应包含 loading 容器');
  assert.ok(html.includes('id="level-list"'), '应包含 level-list 容器');
  assert.ok(html.includes('id="error-message"'), '应包含 error-message 容器');
});

test('AC-006: web/index.html 以相对路径 script 引入 level-select.js', () => {
  assert.equal(fs.existsSync(INDEX_PATH), true, 'web/index.html 应存在');
  const html = fs.readFileSync(INDEX_PATH, 'utf8');
  const match = html.match(/<script[^>]*\ssrc="([^"]+)"/);
  assert.ok(match, '应存在带 src 属性的 script 标签');
  const src = match[1];
  assert.match(src, /level-select\.js$/, 'script src 应指向 level-select.js');
  assert.ok(!src.startsWith('/') && !src.includes('://'), `script src 必须是相对路径，实际为 ${src}`);
});
