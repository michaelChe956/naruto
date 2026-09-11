'use strict';

// 与 tests/backend/index.js 同理：Node ≥22 起将 `node --test` 的位置参数按 glob/文件
// 入口处理而非目录扫描；本入口文件使 CHECK-002 的字面命令 `node --test tests/frontend/`
// 在各 Node 版本下均能执行全部前端测试（旧版目录扫描语义下本文件不匹配默认测试文件
// 模式，行为一致）。
require('./level-select.test.js');
