# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作提供指导。

## 强制规则

> **🔴 必须遵守 - 无例外**
> 详细规则见 `.claude/rules/` 目录下的各规则文件。
> 用户自定义规则见 `cadence/project-rules/` 目录。

### 1. 语言规则
- **必须使用中文回答** → 详见 `.claude/rules/language.md`

### 2. 代码使用规则
- **遵循 TDD 和代码规范** → 详见 `.claude/rules/code-usage.md`

### 3. 文档存储规则
- **Cadence 产物文档必须存放在 `cadence` 目录下；Claude Code 框架规则保留在 `.claude/rules` 目录下** → 详见 `.claude/rules/document-storage.md`

### 4. Markdown 格式规则
- **代码块嵌套使用 4 反引号/3 反引号** → 详见 `.claude/rules/markdown-format.md`

### 5. Serena 使用规则
- **禁止分析 .git 目录** → 详见 `.claude/rules/serena-usage.md`

### 6. MCP Server 使用规则
- **各 MCP 工具的使用规范** → 详见 `.claude/rules/mcp-servers.md`

### 7. 项目个性化规则（强制规则）
- **用户自定义规则只能存放在 `cadence/project-rules/` 目录**
- 禁止在 `rules/` 目录中添加用户自定义规则
- 禁止直接修改 `rules/` 目录下的框架内置规则文件
- 详见 `cadence/project-rules/README.md`

### 8. Playwright CLI 使用规则
- **浏览器自动化工具规范** → 详见 `.claude/rules/playwright.md`

## 项目配置

> 以下内容由初始化脚本根据项目环境自动检测生成，非通用规则。

### 包管理器规则
- **前端项目**：必须使用 `pnpm` 作为包管理器
- **Python 项目**：必须使用 `uv` 作为包管理器
- **禁止使用**：npm（前端）、pip（Python）、yarn（前端）

### 项目技术栈
- **语言**：待确认
- **包管理器**：待确认
- **测试命令**：待确认
- **检查命令**：待确认
- **格式化命令**：待确认
- **覆盖率阈值**：80%

## 项目信息
# currentDate
Today's date is 2026/04/14。
