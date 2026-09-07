'use strict';

// tests/frontend 测试套件入口。
// 与 tests/backend/index.js 同构：Node v21+ 的 test runner 将目录参数按 glob
// 处理（nodejs/node#64555）并提供目录入口兜底，这里显式加载全部 *.test.js；
// 目录零测试时抛错判定失败（AC-011）。

const fs = require('node:fs');
const path = require('node:path');

const testFiles = fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (testFiles.length === 0) {
  throw new Error('tests/frontend/ 未发现任何 *.test.js 测试文件，判定失败');
}

for (const name of testFiles) {
  require(path.join(__dirname, name));
}
