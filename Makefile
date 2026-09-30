# naruto 交付验证入口
#
# 目标：verify-r2-status（REQ-007 / REQ-008，AC-011 / AC-012 / AC-013）
#
# 语义：
#   - 串行运行既有后端字段测试（GET /api/status 的 build_commit 契约）、
#     既有前端展示测试（状态页在版本信息区域展示构建提交短哈希）与本同源集成测试
#     （同一 host 与 port 分别取回状态页端点与状态 API，并在服务监听期执行页面内联脚本）。
#   - 退出码语义：仅当三组断言全部通过时退出码为 0；任一断言失败时 node --test 返回非 0，
#     make 随之以非 0 退出码终止，不吞并失败结果。
#   - 仅使用 Node 内置测试运行器（node:test）与 GNU Make，不新增运行时或测试外部依赖（AC-015）。
#
# 用法：
#   make verify-r2-status

.PHONY: verify-r2-status

verify-r2-status:
	node --test test/status-build-commit.test.js test/status-build-commit-page.test.js test/status-build-commit-integration.test.js
