'use strict'

/**
 * 关卡选择页脚本（web/level-select.js）。
 *
 * 职责（TASK-009/010/011）：
 * - 导出 initLevelSelect({ document, fetchImpl })，以相对路径调用 GET /api/levels；
 * - 成功路径：先显示加载态，再渲染每关 name 与 difficulty；
 *   unlocked 为 false 的关卡呈现锁定态且不可选择；
 * - 失败路径：fetch 失败 / HTTP 非成功 / 响应字段不满足约束（CT-001~CT-005）时，
 *   在 id 为 error-message 的区域显示可读错误提示，并保留页面框架不白屏。
 *
 * 模块形态：Node 下按 CommonJS 导出供测试注入替身；浏览器下自动引导运行。
 */

/** 关卡数据 API 相对路径契约 */
const API_PATH = '/api/levels'
/** 关卡数据契约要求的固定数量（CT-001） */
const REQUIRED_LEVEL_COUNT = 5
/** difficulty 取值集合契约（CT-004） */
const DIFFICULTY_VALUES = new Set(['简单', '普通', '困难'])

/** 校验响应是否满足关卡数据契约（与服务端校验保持一致：CT-001~CT-005） */
function validateLevels (payload) {
  if (!Array.isArray(payload) || payload.length !== REQUIRED_LEVEL_COUNT) {
    return false
  }
  const seenIds = new Set()
  for (const level of payload) {
    if (level === null || typeof level !== 'object' || Array.isArray(level)) {
      return false
    }
    if (typeof level.id !== 'string' || level.id.length === 0) {
      return false
    }
    if (seenIds.has(level.id)) {
      return false
    }
    seenIds.add(level.id)
    if (typeof level.name !== 'string' || level.name.length === 0) {
      return false
    }
    if (typeof level.difficulty !== 'string' || !DIFFICULTY_VALUES.has(level.difficulty)) {
      return false
    }
    if (typeof level.unlocked !== 'boolean') {
      return false
    }
  }
  return true
}

/** 渲染关卡列表：每项为 li > button；锁定关卡 disabled 且标记锁定样式与文案 */
function renderLevels (doc, levels) {
  const list = doc.getElementById('level-list')
  list.replaceChildren()
  for (const level of levels) {
    const item = doc.createElement('li')
    const button = doc.createElement('button')
    button.type = 'button'
    if (level.unlocked) {
      button.textContent = `${level.name}（难度：${level.difficulty}）`
    } else {
      button.disabled = true
      button.className = 'locked'
      button.textContent = `${level.name}（难度：${level.difficulty}）｜已锁定`
    }
    item.appendChild(button)
    list.appendChild(item)
  }
}

/**
 * 初始化关卡选择页。
 * @param {object} deps
 * @param {Document} deps.document 页面 document（测试可注入替身）
 * @param {typeof fetch} deps.fetchImpl 请求实现（测试可注入替身）
 * @returns {Promise<void>} 渲染或错误展示完成后 resolve
 */
async function initLevelSelect ({ document: doc, fetchImpl } = {}) {
  const loading = doc.getElementById('loading')
  const errorElement = doc.getElementById('error-message')
  const list = doc.getElementById('level-list')

  // 先显示加载态，并收起上一次的错误提示与旧列表
  loading.hidden = false
  errorElement.hidden = true
  errorElement.textContent = ''
  list.replaceChildren()

  function showError (message) {
    loading.hidden = true
    errorElement.textContent = message
    errorElement.hidden = false
  }

  let response
  try {
    response = await fetchImpl(API_PATH)
  } catch (error) {
    showError('加载关卡失败：网络异常，请检查网络后重试')
    return
  }

  if (!response.ok) {
    showError(`加载关卡失败：服务器返回 ${response.status}，请稍后重试`)
    return
  }

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    showError('加载关卡失败：响应数据格式错误，请稍后重试')
    return
  }

  if (!validateLevels(payload)) {
    showError('加载关卡失败：关卡数据校验未通过，请稍后重试')
    return
  }

  loading.hidden = true
  renderLevels(doc, payload)
}

/* Node（CommonJS）下导出供测试注入替身；浏览器（无 module）下自动引导运行 */
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = { initLevelSelect }
} else if (typeof window !== 'undefined' && typeof window.document !== 'undefined') {
  initLevelSelect({
    document: window.document,
    fetchImpl: (...args) => window.fetch(...args)
  })
}
