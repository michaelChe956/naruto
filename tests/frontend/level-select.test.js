'use strict'

/**
 * web/level-select.js 前端契约测试（TASK-007）。
 *
 * 使用最小 document 替身与可注入 fetch 替身，在不启动浏览器的情况下覆盖：
 * - 以相对路径 GET /api/levels 请求（AC-006 / CT-018 侧契约）；
 * - 先显示加载态，成功后渲染每项 name 与 difficulty（AC-006）；
 * - unlocked 为 false 的关卡呈现锁定态且不可选择（AC-006）；
 * - fetch 失败 / HTTP 非成功 / 响应字段无效时显示可读错误且不白屏（AC-007）；
 * - web/index.html 页面入口包含容器标记并引用页面脚本（AC-008）。
 */

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { initLevelSelect } = require('../../web/level-select.js')

/** 与服务端契约（CT-001~CT-005）一致的合法关卡数据 */
const VALID_LEVELS = [
  { id: 'level-1', name: '木叶村入口', difficulty: '简单', unlocked: true },
  { id: 'level-2', name: '训练场', difficulty: '简单', unlocked: true },
  { id: 'level-3', name: '死亡森林', difficulty: '普通', unlocked: false },
  { id: 'level-4', name: '中忍考试会场', difficulty: '困难', unlocked: false },
  { id: 'level-5', name: '终结之谷', difficulty: '困难', unlocked: false }
]

/** 页面入口相对路径（与本目录到 web/index.html 的相对位置一致） */
const PAGE_ENTRY = path.join(__dirname, '..', '..', 'web', 'index.html')

/** 最小元素替身：只覆盖页面脚本会用到的行为 */
function createStubElement (tagName) {
  return {
    tagName: String(tagName).toUpperCase(),
    id: '',
    children: [],
    textContent: '',
    className: '',
    disabled: false,
    hidden: false,
    attributes: {},
    appendChild (child) {
      this.children.push(child)
      return child
    },
    replaceChildren (...nextChildren) {
      this.children = [...nextChildren]
    },
    setAttribute (name, value) {
      this.attributes[name] = String(value)
    },
    getAttribute (name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null
    }
  }
}

/** 最小 document 替身：预置与 web/index.html 一致的三个容器 */
function createStubDocument () {
  const registry = new Map()
  const initialHidden = { loading: false, 'error-message': true }
  for (const id of ['loading', 'level-list', 'error-message']) {
    const element = createStubElement('div')
    element.id = id
    element.hidden = initialHidden[id] ?? false
    registry.set(id, element)
  }
  return {
    registry,
    createElement (tagName) {
      return createStubElement(tagName)
    },
    getElementById (id) {
      return registry.get(id) || null
    }
  }
}

/** 构造 fetch 响应替身 */
function jsonResponse (status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }
}

/** 可控时序的 fetch 替身：先发起请求保持挂起，再由测试决定如何响应 */
function createDeferredFetch () {
  const calls = []
  let settle = () => {}
  const pending = new Promise((resolve) => {
    settle = resolve
  })
  return {
    calls,
    fetchImpl (url) {
      calls.push(url)
      return pending
    },
    resolveWith (responseFactory) {
      settle(Promise.resolve().then(responseFactory))
    }
  }
}

/** 从渲染结果中收集关卡按钮（li > button） */
function renderedButtons (doc) {
  const buttons = []
  for (const item of doc.getElementById('level-list').children) {
    for (const child of item.children) {
      buttons.push(child)
    }
  }
  return buttons
}

/** 断言页面处于错误态：加载态收起、错误可见且可读、页面框架仍在 */
function assertErrorState (doc) {
  const loading = doc.getElementById('loading')
  const error = doc.getElementById('error-message')
  const list = doc.getElementById('level-list')
  assert.equal(loading.hidden, true, '失败后必须收起加载态')
  assert.equal(error.hidden, false, '失败后必须显示错误区域')
  assert.ok(typeof error.textContent === 'string' && error.textContent.length > 0, '错误提示必须可读（非空文本）')
  assert.notEqual(doc.registry.get('level-list'), undefined, '页面框架必须保留，不白屏')
  assert.notEqual(doc.registry.get('loading'), undefined, '页面框架必须保留，不白屏')
}

describe('initLevelSelect 成功渲染（AC-006）', () => {
  test('以相对路径 GET /api/levels 发起请求', async () => {
    const doc = createStubDocument()
    const fetcher = createDeferredFetch()
    const initPromise = initLevelSelect({ document: doc, fetchImpl: fetcher.fetchImpl })
    fetcher.resolveWith(() => jsonResponse(200, VALID_LEVELS))
    await initPromise

    assert.equal(fetcher.calls.length, 1, 'initLevelSelect 必须且只发起一次请求')
    assert.equal(fetcher.calls[0], '/api/levels', '必须以相对路径调用 GET /api/levels')
  })

  test('先显示加载态，成功后收起加载态并渲染每项 name 与 difficulty', async () => {
    const doc = createStubDocument()
    const fetcher = createDeferredFetch()
    const initPromise = initLevelSelect({ document: doc, fetchImpl: fetcher.fetchImpl })

    assert.equal(doc.getElementById('loading').hidden, false, '请求挂起期间必须显示加载态')
    assert.equal(doc.getElementById('level-list').children.length, 0, '请求挂起期间不得渲染关卡')

    fetcher.resolveWith(() => jsonResponse(200, VALID_LEVELS))
    await initPromise

    assert.equal(doc.getElementById('loading').hidden, true, '成功后必须收起加载态')
    const buttons = renderedButtons(doc)
    assert.equal(buttons.length, VALID_LEVELS.length, '必须渲染全部关卡')
    for (let i = 0; i < VALID_LEVELS.length; i++) {
      assert.ok(buttons[i].textContent.includes(VALID_LEVELS[i].name), `第 ${i + 1} 项必须渲染关卡名称`)
      assert.ok(buttons[i].textContent.includes(VALID_LEVELS[i].difficulty), `第 ${i + 1} 项必须渲染难度`)
    }
  })

  test('unlocked 为 false 的关卡呈现锁定态且不可选择', async () => {
    const doc = createStubDocument()
    const fetcher = createDeferredFetch()
    const initPromise = initLevelSelect({ document: doc, fetchImpl: fetcher.fetchImpl })
    fetcher.resolveWith(() => jsonResponse(200, VALID_LEVELS))
    await initPromise

    const buttons = renderedButtons(doc)
    for (let i = 0; i < VALID_LEVELS.length; i++) {
      const expectedDisabled = !VALID_LEVELS[i].unlocked
      assert.equal(buttons[i].disabled, expectedDisabled, `第 ${i + 1} 项的可选择性必须与 unlocked 相反`)
      if (expectedDisabled) {
        assert.ok(buttons[i].className.includes('locked'), '锁定关卡必须标记锁定样式类')
        assert.ok(buttons[i].textContent.includes('已锁定'), '锁定关卡必须带有可读的锁定文案')
      }
    }
  })
})

describe('initLevelSelect 错误分支（AC-007）', () => {
  test('fetch 请求失败（网络异常）时显示可读错误并保留页面框架', async () => {
    const doc = createStubDocument()
    const initPromise = initLevelSelect({
      document: doc,
      fetchImpl () {
        return Promise.reject(new Error('network down'))
      }
    })
    await initPromise
    assertErrorState(doc)
  })

  test('HTTP 非成功（500 LEVEL_DATA_UNAVAILABLE）时显示可读错误', async () => {
    const doc = createStubDocument()
    const fetcher = createDeferredFetch()
    const initPromise = initLevelSelect({ document: doc, fetchImpl: fetcher.fetchImpl })
    fetcher.resolveWith(() => jsonResponse(500, {
      error: { code: 'LEVEL_DATA_UNAVAILABLE', message: '关卡数据不可用' }
    }))
    await initPromise
    assertErrorState(doc)
  })

  test('响应体无法解析为 JSON 时显示可读错误', async () => {
    const doc = createStubDocument()
    const fetcher = createDeferredFetch()
    const initPromise = initLevelSelect({ document: doc, fetchImpl: fetcher.fetchImpl })
    fetcher.resolveWith(() => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      }
    }))
    await initPromise
    assertErrorState(doc)
  })

  test('响应字段不满足约束（CT-001~CT-005）时显示可读错误', async () => {
    const invalidPayloads = [
      { case: '关卡数量不是 5', payload: VALID_LEVELS.slice(0, 4) },
      { case: 'name 为空字符串', payload: VALID_LEVELS.map((l, i) => i === 0 ? { ...l, name: '' } : l) },
      { case: 'difficulty 不在取值集合内', payload: VALID_LEVELS.map((l, i) => i === 1 ? { ...l, difficulty: '地狱' } : l) },
      { case: 'unlocked 不是布尔值', payload: VALID_LEVELS.map((l, i) => i === 2 ? { ...l, unlocked: 'yes' } : l) },
      { case: 'id 在数据内重复', payload: VALID_LEVELS.map((l, i) => i === 3 ? { ...l, id: 'level-1' } : l) },
      { case: '响应不是数组', payload: { levels: VALID_LEVELS } }
    ]
    for (const { case: caseName, payload } of invalidPayloads) {
      const doc = createStubDocument()
      const fetcher = createDeferredFetch()
      const initPromise = initLevelSelect({ document: doc, fetchImpl: fetcher.fetchImpl })
      fetcher.resolveWith(() => jsonResponse(200, payload))
      await initPromise
      assertErrorState(doc)
      assert.ok(doc.getElementById('level-list').children.length === 0, `${caseName}：无效数据不得渲染关卡列表`)
    }
  })
})

describe('页面入口（AC-008）', () => {
  test('web/index.html 包含 loading/level-list/error-message 容器并引用 level-select.js', () => {
    const html = fs.readFileSync(PAGE_ENTRY, 'utf8')
    assert.ok(html.includes('id="loading"'), '必须包含 id 为 loading 的容器标记')
    assert.ok(html.includes('id="level-list"'), '必须包含 id 为 level-list 的容器标记')
    assert.ok(html.includes('id="error-message"'), '必须包含 id 为 error-message 的容器标记')
    assert.match(html, /<script[^>]*src="[^"]*level-select\.js"/, '必须以 script 引用 web/level-select.js')
  })
})
