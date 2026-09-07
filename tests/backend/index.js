'use strict'

/**
 * tests/backend 目录入口。
 *
 * 本仓库运行时的 Node 测试执行器在接收目录参数时会将目录解析为入口模块执行，
 * 提供 index.js 作为目录主入口可让 CHECK-001 的 `node --test tests/backend/`
 * 正确解析并聚合执行本目录全部测试文件。
 */

require('./server.test.js')
