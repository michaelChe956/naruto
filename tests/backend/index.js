'use strict';

// Node ≥22 起将 `node --test` 的位置参数按 glob/文件入口处理而非目录扫描；
// 本入口文件使 CHECK-001 的字面命令 `node --test tests/backend/` 在各 Node 版本下
// 均能执行全部后端测试（旧版目录扫描语义下本文件不匹配默认测试文件模式，行为一致）。
require('./api.test.js');
require('./static.test.js');
require('./lifecycle.test.js');
