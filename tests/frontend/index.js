'use strict';

// 目录入口聚合器：使 `node --test tests/frontend` 在目录参数被当作模块执行的
// Node 运行时（nodejs/node#64555 回归，v21~v24.17，后续版本已修复）下仍可执行。
// 在支持目录扫描的 Node 上，index.js 不匹配默认测试文件模式（*.test.js 等），
// 不会被重复执行，仅扫描下方测试文件。

require('./level-select.test.js');
