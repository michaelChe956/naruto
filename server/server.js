'use strict'

/**
 * naruto H5 游戏后端服务。
 *
 * 仅使用 Node 内置模块（node:http、node:fs、node:path）在同一进程内提供：
 * - GET /api/levels 关卡数据契约；
 * - 基于 staticRoot 的静态页面托管；
 * - 可测试编排的启动（start）与停止（stop）生命周期。
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const fsPromises = fs.promises

/** API 路径契约 */
const API_PATH = '/api/levels'
/** API 路径前缀：/api/** 下的未知路径返回 404，而非落入静态托管 */
const API_PREFIX = '/api/'
/** 默认端口与端口环境变量契约 */
const DEFAULT_PORT = 3000
const PORT_ENV = 'PORT'
/** 依赖注入默认值契约 */
const DEFAULT_DATA_PATH = 'data/levels.json'
const DEFAULT_STATIC_ROOT = 'web'

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8'

/** 关卡数据契约要求的固定数量 */
const REQUIRED_LEVEL_COUNT = 5
/** difficulty 取值集合契约（CT-004）：恰为三值 */
const DIFFICULTY_VALUES = new Set(['简单', '普通', '困难'])

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

/** 数据不可用错误：统一映射为 500 / LEVEL_DATA_UNAVAILABLE */
class LevelDataUnavailableError extends Error {
  constructor (message) {
    super(message)
    this.name = 'LevelDataUnavailableError'
  }
}

function sendJson (res, statusCode, payload, extraHeaders) {
  res.writeHead(statusCode, {
    'Content-Type': JSON_CONTENT_TYPE,
    ...extraHeaders
  })
  res.end(JSON.stringify(payload))
}

function sendError (res, statusCode, code, message, extraHeaders) {
  sendJson(res, statusCode, { error: { code, message } }, extraHeaders)
}

function sendText (res, statusCode, message, extraHeaders) {
  res.writeHead(statusCode, {
    'Content-Type': TEXT_CONTENT_TYPE,
    ...extraHeaders
  })
  res.end(message)
}

/**
 * 校验关卡数据契约：
 * - 顶层数组，长度恰好 5；
 * - 元素为普通对象；
 * - id 非空字符串且文件内唯一；name 非空字符串；
 * - difficulty 恰为「简单、普通、困难」三个字符串值之一（CT-004）；
 * - unlocked 为布尔值。
 */
function validateLevels (levels) {
  if (!Array.isArray(levels) || levels.length !== REQUIRED_LEVEL_COUNT) {
    return false
  }
  const seenIds = new Set()
  for (const level of levels) {
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

/** 读取并校验关卡数据；任何失败都归一为 LevelDataUnavailableError */
async function loadLevels (dataPath) {
  let raw
  try {
    raw = await fsPromises.readFile(dataPath, 'utf8')
  } catch (error) {
    throw new LevelDataUnavailableError(`无法读取关卡数据文件: ${error.message}`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new LevelDataUnavailableError(`关卡数据不可解析: ${error.message}`)
  }

  if (!validateLevels(parsed)) {
    throw new LevelDataUnavailableError('关卡数据未通过结构校验')
  }
  return parsed
}

/** GET /api/levels 及 /api/** 路由处理 */
async function handleApi (req, res, pathname, dataPath) {
  if (pathname !== API_PATH) {
    sendError(res, 404, 'NOT_FOUND', `未知 API 路径: ${pathname}`)
    return
  }
  if (req.method !== 'GET') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} 不被允许，仅支持 GET`, {
      Allow: 'GET'
    })
    return
  }
  try {
    const levels = await loadLevels(dataPath)
    sendJson(res, 200, levels)
  } catch (error) {
    if (error instanceof LevelDataUnavailableError) {
      sendError(res, 500, 'LEVEL_DATA_UNAVAILABLE', error.message)
      return
    }
    throw error
  }
}

/**
 * 静态托管：路径规范化并限定在 staticRoot 之内。
 * - 规范化后越出 staticRoot → 403；
 * - 路径无法解码 → 400；
 * - 资源缺失 → 404 文本响应；
 * - 目录 → 依次尝试目录下 index.html。
 */
async function serveStatic (req, res, staticRoot) {
  const rawPath = req.url.split('?')[0]

  let decodedPath
  try {
    decodedPath = decodeURIComponent(rawPath)
  } catch (error) {
    sendText(res, 400, 'Bad Request')
    return
  }

  if (decodedPath.includes('\0')) {
    sendText(res, 400, 'Bad Request')
    return
  }

  const safeRoot = path.resolve(staticRoot)
  // 去掉开头的 '/' 后与 root 拼接，防止绝对路径直接替换 root；path.resolve 负责规范化 ..
  const resolved = path.resolve(safeRoot, decodedPath.replace(/^[/\\]+/, ''))

  if (resolved !== safeRoot && !resolved.startsWith(safeRoot + path.sep)) {
    sendText(res, 403, 'Forbidden')
    return
  }

  let targetPath = resolved
  try {
    const stat = await fsPromises.stat(targetPath)
    if (stat.isDirectory()) {
      targetPath = path.join(targetPath, 'index.html')
    }
  } catch (error) {
    // stat 失败时保持 targetPath，交由 readFile 统一返回 404
  }

  let content
  try {
    content = await fsPromises.readFile(targetPath)
  } catch (error) {
    sendText(res, 404, 'Not Found')
    return
  }

  const contentType = MIME_TYPES[path.extname(targetPath).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': contentType })
  res.end(content)
}

function createRequestHandler (options) {
  const dataPath = options.dataPath || DEFAULT_DATA_PATH
  const staticRoot = options.staticRoot || DEFAULT_STATIC_ROOT

  return function requestHandler (req, res) {
    const pathname = req.url.split('?')[0]
    if (pathname === API_PATH || pathname.startsWith(API_PREFIX)) {
      handleApi(req, res, pathname, dataPath).catch((error) => {
        sendError(res, 500, 'INTERNAL_ERROR', error.message)
      })
      return
    }
    serveStatic(req, res, staticRoot)
  }
}

/**
 * 创建 HTTP 服务器实例。
 * @param {object} [options]
 * @param {string} [options.dataPath] 关卡数据文件路径，默认 data/levels.json
 * @param {string} [options.staticRoot] 静态资源根目录，默认 web/
 * @returns {http.Server}
 */
function createServer (options = {}) {
  return http.createServer(createRequestHandler(options))
}

/** 显式 port > 端口环境变量 PORT > 默认端口 3000 */
function resolvePort (port) {
  if (port !== undefined && port !== null) {
    return port
  }
  const envPort = process.env[PORT_ENV]
  if (envPort !== undefined && envPort !== '') {
    const parsed = Number(envPort)
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return DEFAULT_PORT
}

/**
 * 以可编排的方式启动服务。
 * @param {object} [options]
 * @param {number} [options.port] 默认取 PORT 环境变量，否则 3000；0 表示随机端口
 * @param {string} [options.dataPath] 透传 createServer
 * @param {string} [options.staticRoot] 透传 createServer
 * @returns {Promise<{origin: string, port: number, stop: () => Promise<void>}>}
 */
function start (options = {}) {
  const { port, ...serverOptions } = options
  const server = createServer(serverOptions)
  const resolvedPort = resolvePort(port)

  const listening = new Promise((resolve, reject) => {
    const onError = (error) => reject(error)
    server.once('error', onError)
    server.listen(resolvedPort, '127.0.0.1', () => {
      server.removeListener('error', onError)
      resolve()
    })
  })

  return listening.then(() => {
    const { port: actualPort } = server.address()

    function stop () {
      return new Promise((resolve, reject) => {
        if (!server.listening) {
          resolve()
          return
        }
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }

    return {
      origin: `http://127.0.0.1:${actualPort}`,
      port: actualPort,
      stop
    }
  })
}

module.exports = {
  createServer,
  start
}
