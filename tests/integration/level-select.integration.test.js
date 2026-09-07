'use strict'

/**
 * 同源 HTTP 集成契约测试（issue_0148 TASK-012~016）。
 *
 * 以真实产物（server/server.js + web/ + data/levels.json）在同一 origin 上验证：
 * - 服务以 port 0 启动后 GET /、GET /level-select.js、GET /api/levels 同源可达（AC-009）；
 * - 页面入口 HTML 含三个容器标记并引用 web/level-select.js，
 *   脚本内容含 GET /api/levels 引用（AC-010）；
 * - 注入无效数据夹具时 GET /api/levels 返回 500 与 LEVEL_DATA_UNAVAILABLE
 *   及 application/json; charset=utf-8（AC-011）；
 * - 真实数据下 GET /api/levels 返回 200 顶层数组长度恰为 5
 *   且元素满足字段约束（AC-012）。
 */

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { start } = require('../../server/server.js')

/** 仓库真实产物路径（数据与静态根目录均按 CT-014 显式注入） */
const REPO_ROOT = path.join(__dirname, '..', '..')
const REAL_DATA = path.join(REPO_ROOT, 'data', 'levels.json')
const WEB_ROOT = path.join(REPO_ROOT, 'web')
/** 本目录自建的无效数据夹具（TASK-016），不得复用上游测试夹具 */
const INVALID_DATA = path.join(__dirname, 'fixtures', 'levels', 'invalid.json')

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

/** 以 port 0 启动服务并保证 stop() 释放端口 */
async function withServer (options, run) {
  const handle = await start({ port: 0, ...options })
  try {
    return await run(handle)
  } finally {
    await handle.stop()
  }
}

/** 同源 GET 请求：返回状态码、Content-Type 与文本体 */
async function get (origin, requestPath) {
  const response = await fetch(`${origin}${requestPath}`)
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    text: await response.text()
  }
}

/** 关卡数据字段约束（CT-002~CT-005） */
function assertLevelsShape (levels) {
  assert.equal(Array.isArray(levels), true, '响应体顶层必须是数组')
  assert.equal(levels.length, 5, '关卡数量必须恰好为 5（CT-001）')
  const seenIds = new Set()
  for (const level of levels) {
    assert.equal(typeof level, 'object', '每个元素必须是对象')
    assert.notEqual(level, null, '元素不得为 null')
    assert.equal(Array.isArray(level), false, '元素不得为数组')
    assert.equal(typeof level.id, 'string', 'id 必须是字符串（CT-002）')
    assert.ok(level.id.length > 0, 'id 必须非空（CT-002）')
    assert.equal(seenIds.has(level.id), false, 'id 必须在数据内唯一（CT-002）')
    seenIds.add(level.id)
    assert.equal(typeof level.name, 'string', 'name 必须是字符串（CT-003）')
    assert.ok(level.name.length > 0, 'name 必须非空（CT-003）')
    assert.equal(
      ['简单', '普通', '困难'].includes(level.difficulty),
      true,
      'difficulty 必须恰为「简单、普通、困难」三值之一（CT-004）'
    )
    assert.equal(typeof level.unlocked, 'boolean', 'unlocked 必须是布尔值（CT-005）')
  }
}

describe('同源可达（AC-009 / CT-014~CT-017）', () => {
  test('port 0 启动后 GET / 与 GET /level-select.js 与 GET /api/levels 在同一 origin 均可达', async () => {
    await withServer({ dataPath: REAL_DATA, staticRoot: WEB_ROOT }, async (handle) => {
      // CT-015 / CT-016：origin 为 http://127.0.0.1:<实际端口>
      assert.match(handle.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
      assert.ok(handle.port > 0, 'port 必须是实际分配的非 0 端口')
      assert.equal(handle.origin, `http://127.0.0.1:${handle.port}`)

      const page = await get(handle.origin, '/')
      assert.equal(page.status, 200, 'GET / 必须可达')
      const script = await get(handle.origin, '/level-select.js')
      assert.equal(script.status, 200, 'GET /level-select.js 必须可达')
      const api = await get(handle.origin, '/api/levels')
      assert.equal(api.status, 200, 'GET /api/levels 必须可达')
    })
  })
})

describe('页面入口与脚本引用（AC-010 / CT-010, CT-011, CT-018~CT-024）', () => {
  test('GET / 返回含三个容器标记并引用 web/level-select.js 的 HTML', async () => {
    await withServer({ dataPath: REAL_DATA, staticRoot: WEB_ROOT }, async (handle) => {
      const page = await get(handle.origin, '/')
      assert.equal(page.status, 200)
      assert.match(page.contentType, /^text\/html/, '页面入口必须是 HTML')
      assert.ok(page.text.includes('id="loading"'), '必须包含 id 为 loading 的容器标记（CT-019）')
      assert.ok(page.text.includes('id="level-list"'), '必须包含 id 为 level-list 的容器标记（CT-020）')
      assert.ok(page.text.includes('id="error-message"'), '必须包含 id 为 error-message 的容器标记（CT-021）')
      assert.match(
        page.text,
        /<script[^>]*src="[^"]*level-select\.js"/,
        '必须以 script 引用 web/level-select.js（CT-022）'
      )
    })
  })

  test('GET /level-select.js 的脚本内容含 GET /api/levels 相对路径引用', async () => {
    await withServer({ dataPath: REAL_DATA, staticRoot: WEB_ROOT }, async (handle) => {
      const script = await get(handle.origin, '/level-select.js')
      assert.equal(script.status, 200)
      assert.match(script.contentType, /^text\/javascript/, '脚本必须是 JavaScript 资源')
      assert.ok(script.text.includes('/api/levels'), '脚本内容必须引用 GET /api/levels（CT-024）')
    })
  })
})

describe('API 错误契约（AC-011 / CT-006, CT-007）', () => {
  test('注入自建无效数据夹具时返回 500 与 LEVEL_DATA_UNAVAILABLE 及 JSON Content-Type', async () => {
    await withServer({ dataPath: INVALID_DATA, staticRoot: WEB_ROOT }, async (handle) => {
      const res = await get(handle.origin, '/api/levels')
      assert.equal(res.status, 500)
      assert.equal(res.contentType, JSON_CONTENT_TYPE, '错误响应 Content-Type 必须为 application/json; charset=utf-8（CT-007）')
      const payload = JSON.parse(res.text)
      assert.equal(payload.error.code, 'LEVEL_DATA_UNAVAILABLE', 'error.code 必须为 LEVEL_DATA_UNAVAILABLE（CT-006）')
      assert.equal(typeof payload.error.message, 'string')
      assert.ok(payload.error.message.length > 0, '错误信息必须可读')
    })
  })
})

describe('API 成功契约（AC-012 / CT-001~CT-005）', () => {
  test('真实数据下返回 200 顶层数组长度恰为 5 且元素满足字段约束', async () => {
    await withServer({ dataPath: REAL_DATA, staticRoot: WEB_ROOT }, async (handle) => {
      const res = await get(handle.origin, '/api/levels')
      assert.equal(res.status, 200)
      assert.equal(res.contentType, JSON_CONTENT_TYPE)
      assertLevelsShape(JSON.parse(res.text))
    })
  })
})
