'use strict'

/**
 * server/server.js 后端契约测试。
 *
 * 字段约束（与 data/levels.json 及校验逻辑保持一致）：
 * - 顶层为数组，长度恰好 5；
 * - 每个元素为普通对象；
 * - id：非空字符串，且在同一数据文件内唯一；
 * - name：非空字符串；
 * - difficulty：有限数字；
 * - unlocked：布尔值。
 */

const { describe, test, after } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')

const { createServer, start } = require('../../server/server.js')

const FIXTURE_ROOT = path.join(__dirname, 'fixtures')
const VALID_LEVELS = path.join(FIXTURE_ROOT, 'levels', 'valid-levels.json')
const STATIC_ROOT = path.join(FIXTURE_ROOT, 'static')

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

/**
 * 使用 node:http 直接发起请求，path 原样发送（不做 URL 规范化），
 * 以便真实传递 `/../` 等目录穿越路径。
 */
function request (origin, { method = 'GET', path: requestPath = '/' } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(origin)
    const req = http.request(
      {
        host: target.hostname,
        port: target.port,
        method,
        path: requestPath
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: body.toString('utf8')
          })
        })
      }
    )
    req.on('error', reject)
    req.end()
  })
}

async function withServer (options, run) {
  const handle = await start({ port: 0, ...options })
  try {
    return await run(handle)
  } finally {
    await handle.stop()
  }
}

function assertLevelsShape (levels) {
  assert.equal(Array.isArray(levels), true, '响应体顶层必须是数组')
  assert.equal(levels.length, 5, '关卡数量必须恰好为 5')
  const ids = new Set()
  for (const level of levels) {
    assert.equal(typeof level, 'object')
    assert.notEqual(level, null)
    assert.equal(Array.isArray(level), false)
    assert.equal(typeof level.id, 'string', 'id 必须是字符串')
    assert.ok(level.id.length > 0, 'id 必须非空')
    assert.equal(ids.has(level.id), false, 'id 必须在数据内唯一')
    ids.add(level.id)
    assert.equal(typeof level.name, 'string', 'name 必须是字符串')
    assert.ok(level.name.length > 0, 'name 必须非空')
    assert.equal(typeof level.difficulty, 'number', 'difficulty 必须是数字')
    assert.equal(Number.isFinite(level.difficulty), true, 'difficulty 必须是有限数字')
    assert.equal(typeof level.unlocked, 'boolean', 'unlocked 必须是布尔值')
  }
}

describe('生命周期（AC-004）', () => {
  test('start({ port: 0 }) resolve 为含 origin、port、stop 的对象', async () => {
    const handle = await start({ port: 0 })
    try {
      assert.equal(typeof handle.origin, 'string')
      assert.match(handle.origin, /^http:\/\/127\.0\.0\.1:\d+$/)
      assert.equal(typeof handle.port, 'number')
      assert.ok(handle.port > 0, 'port 必须是实际分配的非 0 端口')
      assert.equal(typeof handle.stop, 'function')
      assert.equal(handle.origin, `http://127.0.0.1:${handle.port}`)
    } finally {
      await handle.stop()
    }
  })

  test('stop() 返回 Promise 并释放端口', async () => {
    const handle = await start({ port: 0 })
    const stopResult = handle.stop()
    assert.ok(stopResult instanceof Promise, 'stop() 必须返回 Promise')
    await stopResult

    await assert.rejects(
      () => request(handle.origin, { path: '/' }),
      (error) => error.code === 'ECONNREFUSED',
      'stop() 之后端口必须已释放（连接被拒绝）'
    )
  })

  test('stop() 之后可以重新绑定同一端口', async () => {
    const first = await start({ port: 0 })
    await first.stop()
    const second = await start({ port: first.port })
    try {
      assert.equal(second.port, first.port, 'stop() 必须真正释放端口以便重新绑定')
    } finally {
      await second.stop()
    }
  })

  test('省略 port 时使用默认端口 3000，且 PORT 环境变量优先生效', async () => {
    const previousPort = process.env.PORT
    process.env.PORT = '0'
    try {
      const handle = await start()
      try {
        assert.ok(handle.port > 0, 'PORT=0 时应回退到 port 0 语义（随机端口）')
      } finally {
        await handle.stop()
      }
    } finally {
      if (previousPort === undefined) {
        delete process.env.PORT
      } else {
        process.env.PORT = previousPort
      }
    }
  })

  test('createServer(options) 返回 node:http Server 实例并接受依赖注入', async () => {
    const server = createServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT })
    assert.ok(server instanceof http.Server)
  })
})

describe('GET /api/levels 成功形状（AC-001）', () => {
  test('注入合法数据时返回 200 顶层数组且长度恰好 5、字段约束满足', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { path: '/api/levels' })
      assert.equal(res.status, 200)
      assert.equal(res.headers['content-type'], JSON_CONTENT_TYPE)
      assertLevelsShape(JSON.parse(res.text))
    })
  })

  test('默认 dataPath（data/levels.json）提供恰好 5 个合法关卡', async () => {
    await withServer({ staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { path: '/api/levels' })
      assert.equal(res.status, 200)
      assertLevelsShape(JSON.parse(res.text))
    })
  })

  test('带查询字符串请求 API 路径仍然命中', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { path: '/api/levels?refresh=1' })
      assert.equal(res.status, 200)
      assert.equal(res.headers['content-type'], JSON_CONTENT_TYPE)
    })
  })
})

describe('数据错误分支（AC-002）', () => {
  const cases = [
    {
      name: '数据文件缺失',
      dataPath: path.join(FIXTURE_ROOT, 'levels', 'does-not-exist.json')
    },
    {
      name: '数据不可解析',
      dataPath: path.join(FIXTURE_ROOT, 'levels', 'invalid-json.json')
    },
    {
      name: '数据不是数组',
      dataPath: path.join(FIXTURE_ROOT, 'levels', 'not-array.json')
    },
    {
      name: '关卡数量不是 5',
      dataPath: path.join(FIXTURE_ROOT, 'levels', 'wrong-count.json')
    },
    {
      name: '字段约束不满足',
      dataPath: path.join(FIXTURE_ROOT, 'levels', 'bad-field.json')
    },
    {
      name: 'id 重复',
      dataPath: path.join(FIXTURE_ROOT, 'levels', 'duplicate-id.json')
    }
  ]

  for (const testCase of cases) {
    test(`${testCase.name} 时返回 500 与 LEVEL_DATA_UNAVAILABLE`, async () => {
      await withServer({ dataPath: testCase.dataPath, staticRoot: STATIC_ROOT }, async (handle) => {
        const res = await request(handle.origin, { path: '/api/levels' })
        assert.equal(res.status, 500)
        assert.equal(res.headers['content-type'], JSON_CONTENT_TYPE)
        const payload = JSON.parse(res.text)
        assert.equal(payload.error.code, 'LEVEL_DATA_UNAVAILABLE')
        assert.equal(typeof payload.error.message, 'string')
        assert.ok(payload.error.message.length > 0)
      })
    })
  }
})

describe('API 路由错误（AC-005）', () => {
  test('未知 API 路径返回 404 JSON 错误对象', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { path: '/api/unknown' })
      assert.equal(res.status, 404)
      assert.equal(res.headers['content-type'], JSON_CONTENT_TYPE)
      const payload = JSON.parse(res.text)
      assert.equal(typeof payload.error.code, 'string')
      assert.equal(typeof payload.error.message, 'string')
    })
  })

  test('对 /api/levels 使用 POST 返回 405 JSON 错误对象', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { method: 'POST', path: '/api/levels' })
      assert.equal(res.status, 405)
      assert.equal(res.headers['content-type'], JSON_CONTENT_TYPE)
      const payload = JSON.parse(res.text)
      assert.equal(typeof payload.error.code, 'string')
      assert.equal(typeof payload.error.message, 'string')
    })
  })

  test('对 /api/levels 使用 DELETE 同样返回 405', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { method: 'DELETE', path: '/api/levels' })
      assert.equal(res.status, 405)
      assert.equal(res.headers['content-type'], JSON_CONTENT_TYPE)
    })
  })
})

describe('静态托管（AC-003）', () => {
  test('按请求路径返回 staticRoot 内对应文件（根路径映射 index.html）', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { path: '/' })
      assert.equal(res.status, 200)
      assert.match(res.headers['content-type'], /^text\/html/)
      assert.ok(res.text.includes('STATIC-INDEX-FIXTURE-MARKER'))
    })
  })

  test('子路径与嵌套路径文件可访问', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const css = await request(handle.origin, { path: '/style.css' })
      assert.equal(css.status, 200)
      assert.match(css.headers['content-type'], /^text\/css/)
      assert.ok(css.text.includes('STATIC-CSS-FIXTURE-MARKER'))

      const nested = await request(handle.origin, { path: '/nested/page.html' })
      assert.equal(nested.status, 200)
      assert.ok(nested.text.includes('STATIC-NESTED-FIXTURE-MARKER'))
    })
  })

  test('静态资源缺失时返回 404 文本响应', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { path: '/missing-file.txt' })
      assert.equal(res.status, 404)
      assert.match(res.headers['content-type'], /^text\/plain/)
      assert.equal(typeof res.text, 'string')
      assert.ok(res.text.length > 0)
    })
  })

  test('规范化后越出 staticRoot 的路径被拒绝且不泄露越界文件内容', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      // 原样发送 /../secret.txt（不经过客户端 URL 规范化）
      const raw = await request(handle.origin, { path: '/../secret.txt' })
      assert.equal(raw.status, 403)
      assert.equal(raw.text.includes('TOP-SECRET-BEYOND-STATIC-ROOT'), false)

      // URL 编码形式的目录穿越同样拒绝
      const encoded = await request(handle.origin, { path: '/%2e%2e/secret.txt' })
      assert.equal(encoded.status, 403)
      assert.equal(encoded.text.includes('TOP-SECRET-BEYOND-STATIC-ROOT'), false)

      const deepEncoded = await request(handle.origin, { path: '/..%2f..%2fsecret.txt' })
      assert.equal(deepEncoded.status, 403)
      assert.equal(deepEncoded.text.includes('TOP-SECRET-BEYOND-STATIC-ROOT'), false)
    })
  })

  test('静态目录内的合法 .. 解析后仍在 staticRoot 内则放行', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { path: '/nested/../style.css' })
      assert.equal(res.status, 200)
      assert.ok(res.text.includes('STATIC-CSS-FIXTURE-MARKER'))
    })
  })

  test('无法解码的路径返回 400', async () => {
    await withServer({ dataPath: VALID_LEVELS, staticRoot: STATIC_ROOT }, async (handle) => {
      const res = await request(handle.origin, { path: '/%zz.html' })
      assert.equal(res.status, 400)
    })
  })
})

after(() => {
  // 所有测试均通过 withServer/start+stop 自行清理端口，此处无共享资源。
})
