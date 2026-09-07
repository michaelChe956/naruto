'use strict';

// tests/backend 测试套件入口。
// 说明：Node v21+ 的 test runner 将目录参数按 glob 处理（nodejs/node#64555），
// `node --test tests/backend/` 会对目录本身执行 require，因此提供 index.js
// 作为套件入口显式加载全部 *.test.js。在不把目录当模块加载的 Node 版本上，
// index.js 不匹配默认测试文件模式，各 *.test.js 会被 runner 直接发现，不会重复执行。

const fs = require('node:fs');
const path = require('node:path');

const testFiles = fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (testFiles.length === 0) {
  throw new Error('tests/backend/ 未发现任何 *.test.js 测试文件，判定失败');
}

for (const name of testFiles) {
  require(path.join(__dirname, name));
}
