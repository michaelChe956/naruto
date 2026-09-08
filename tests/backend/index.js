'use strict';

// 目录入口垫片：Node v21 起的 test runner 对目录位置参数不再递归搜索，
// 而是把目录当作模块直接执行（nodejs/node#64555，v24.17.0 仍受影响）。
// 本入口保证 `node --test tests/backend/` 的语义成立：运行本目录全部测试。
// 待 Node 恢复目录搜索后，本文件不匹配默认测试发现模式，不会被重复执行。
require('./server.test.js');
require('./static.test.js');
