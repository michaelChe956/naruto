'use strict';

// WI-002 前端展示测试：状态页（status.html）在版本信息区域内、紧邻版本信息列表处
// 展示同源 GET /api/status 响应 build_commit 的前 7 个字符。
//
// 覆盖（对应 TASK-004/TASK-005/TASK-006 与 AC-005/AC-006/AC-007/AC-008/AC-009/AC-010）：
// 1. AC-005（结构，evidence=source_diff）：GET /status.html 返回的页面在 #versionInfo 区域内、
//    紧邻 #versionInfoList 之后含构建提交展示元素，且整页不含 footer 元素；
// 2. AC-006：build_commit 为 abcdef1234567890 时展示元素文本严格等于 abcdef1；
// 3. AC-007：build_commit 为 abc 时展示元素文本严格等于 abc（不足 7 位既不截断也不补齐）；
// 4. AC-008：build_commit 为后端缺省值 unknown 时文本逐字等于 unknown，且 status.html 源码内
//    不存在构建提交缺省字面值（缺省语义只在后端一处定义）；
// 5. AC-009（结构，evidence=source_diff）：构建提交展示元素的字体声明包含等宽字体族 monospace；
// 6. AC-010：build_commit 缺失、非字符串或为空时展示元素仍渲染且可见，文本严格等于 U+2014 占位符；
// 7. CHECK-004/CHECK-005：node --test 非零测试执行；在最小 DOM 与 fetch 沙箱内执行状态页内联脚本，
//    逐项断言短哈希截断口径、异常占位符、缺省值渲染与等宽字体声明。
//
// 继承契约（CT-002，前置交付 aria/issues/issue_0004 的 status.html）：锁定基线 main 树不含
// 状态页前端文件，故交付物按「交付物自包含继承契约」在自身完整承载版本信息区域
// #versionInfo / #versionInfoList 与渠道徽标 #channelBadge 及其文本写入口径，再叠加构建提交展示。
//
// 测试依赖仅使用 Node 内置模块（node:test / node:assert / node:fs / node:http / node:path / node:vm），
// 不引入 jsdom 等外部依赖，保持「前端生产代码改动恰为 1 个文件（status.html）」的变更面约束。
// 最小 DOM/fetch 沙箱口径对齐同仓库既有交付 test/status-page-badge.test.js。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');

const { createServer } = require('../server');

const PAGE_PATH = path.join(__dirname, '..', 'status.html');
const PAGE_ENDPOINT = '/status.html';
const API_PATH = '/api/status';

const PLACEHOLDER = '\u2014'; // — U+2014 EM DASH
const SHORT_LENGTH = 7;
const BUILD_COMMIT_KEY = 'build_commit';
const ENV_BUILD_COMMIT_KEY = 'BUILD_COMMIT';

// CT-002/CT-003 稳定节点标识：版本信息区域、版本信息列表、构建提交展示元素与渠道徽标。
const VERSION_INFO_NODE_ID = 'versionInfo';
const VERSION_INFO_LIST_NODE_ID = 'versionInfoList';
const BUILD_COMMIT_NODE_ID = 'buildCommit';
const CHANNEL_BADGE_NODE_ID = 'channelBadge';

// 构建提交缺省字面值：前端不得内置该值（缺省值语义只在后端一处定义）。
const BUILT_IN_DEFAULT_COMMIT = 'unknown';

// 与真实 GET /api/status 一致的既有字段集（用于构造后端可产生的成功响应）。
const BASE_PAYLOAD = { status: 'ok', uptimeSeconds: 12, deploy_channel: 'stable' };

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'source', 'track', 'wbr',
]);

function readPage() {
  assert.ok(fs.existsSync(PAGE_PATH), `status.html 必须存在（${PAGE_PATH}）`);
  return fs.readFileSync(PAGE_PATH, 'utf8');
}

// 取出页面内联脚本正文，并断言页面自带且仅带 1 个无 src 的内联脚本。
function inlineScripts(source) {
  const matches = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(matches.length, 1, 'status.html 必须恰好包含 1 个 <script> 标签');
  const [attrs, body] = [matches[0][1], matches[0][2]];
  assert.ok(!/\bsrc\s*=/i.test(attrs), 'status.html 的 <script> 不得带 src 外部引用');
  assert.ok(body.trim().length > 0, 'status.html 的内联脚本不得为空');
  return body;
}

function stripComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, '');
}

function sectionInner(source, id) {
  const match = new RegExp(
    `<section\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)<\\/section>`,
    'i',
  ).exec(source);
  assert.ok(match, `status.html 必须存在 id="${id}" 的版本信息区域（<section>）`);
  return match[1];
}

// 仅解析给定片段的「直接子元素」序列（深度跟踪，忽略 void 元素）。
function directChildren(inner) {
  const tagPattern = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const children = [];
  const openAtDepthZero = [];
  let depth = 0;
  let match;

  while ((match = tagPattern.exec(inner)) !== null) {
    const isClosing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = match[3] || '';
    const selfClosing = match[4] === '/' || VOID_ELEMENTS.has(tag);
    const end = match.index + match[0].length;

    if (isClosing) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && openAtDepthZero.length > 0) {
        const open = openAtDepthZero.pop();
        children.push({
          tag: open.tag,
          attrs: open.attrs,
          start: open.start,
          end,
          html: inner.slice(open.start, end),
        });
      }
      continue;
    }

    if (depth === 0) {
      if (selfClosing) {
        children.push({ tag, attrs, start: match.index, end, html: match[0] });
      } else {
        openAtDepthZero.push({ tag, attrs, start: match.index });
      }
    }
    if (!selfClosing) {
      depth += 1;
    }
  }

  return children;
}

function attributeValue(attrs, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs || '');
  return match ? match[1] : null;
}

function openingTagOf(source, id) {
  const match = new RegExp(`<[a-z][\\w-]*\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`, 'i').exec(source);
  assert.ok(match, `status.html 必须存在 id="${id}" 的元素`);
  return match[0];
}

// 解析「作用于该元素」的字体声明：匹配元素简单选择器（tag / .class / #id）的样式规则 + 内联 style。
function fontDeclarationsFor(source, openingTag) {
  const tag = /^<\s*([a-z][\w-]*)/i.exec(openingTag)[1].toLowerCase();
  const id = attributeValue(openingTag, 'id');
  const classes = String(attributeValue(openingTag, 'class') || '').split(/\s+/).filter(Boolean);
  const targets = new Set([tag, `#${id}`, ...classes.map((klass) => `.${klass}`)]);

  const parts = [];
  for (const styleBlock of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const chunk of styleBlock[1].split('}')) {
      const braceIndex = chunk.indexOf('{');
      if (braceIndex < 0) {
        continue;
      }
      const selectors = chunk
        .slice(0, braceIndex)
        .split(',')
        .map((selector) => selector.trim().toLowerCase())
        .filter(Boolean);
      if (selectors.some((selector) => targets.has(selector))) {
        parts.push(chunk.slice(braceIndex + 1));
      }
    }
  }

  const inlineStyle = attributeValue(openingTag, 'style');
  if (inlineStyle) {
    parts.push(inlineStyle);
  }
  return parts.join(';');
}

function elementInnerText(source, id) {
  const match = new RegExp(
    `<[a-z][\\w-]*\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)<\\/[a-z][\\w-]*>`,
    'i',
  ).exec(source);
  assert.ok(match, `status.html 必须存在 id="${id}" 的展示元素`);
  return match[1];
}

// 构造最小 DOM / fetch 沙箱并在「解析时」执行页面内联脚本（CHECK-005）。
function createElement(id, hidden) {
  return { id, textContent: '', hidden: hidden === true, style: {}, setAttribute() {} };
}

function okResponse(payload) {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

function runPage(options) {
  const opts = options || {};
  const elements = {
    status: createElement('status'),
    uptimeSeconds: createElement('uptimeSeconds'),
    version: createElement('version'),
    [BUILD_COMMIT_NODE_ID]: createElement(BUILD_COMMIT_NODE_ID),
    [CHANNEL_BADGE_NODE_ID]: createElement(CHANNEL_BADGE_NODE_ID),
    error: createElement('error', true),
  };
  const fetchCalls = [];
  // 记录脚本发起的取数 Promise：settle() 需等真实 HTTP 往返与页面 then 链全部完成，
  // 单靠 setTimeout(0) 无法确定性覆盖同源端到端取数。
  let pendingFetch = null;

  const sandbox = {
    document: { getElementById: (id) => elements[id] || null },
    console,
  };
  if (opts.provideFetch !== false) {
    sandbox.fetch = (url, init) => {
      fetchCalls.push({ url, init });
      if (opts.fetchImpl) {
        pendingFetch = Promise.resolve(opts.fetchImpl(url, init));
        return pendingFetch;
      }
      if (opts.rejection) {
        pendingFetch = Promise.reject(opts.rejection);
        return pendingFetch;
      }
      pendingFetch = Promise.resolve(okResponse(opts.payload));
      return pendingFetch;
    };
  }
  sandbox.window = sandbox;

  const script = inlineScripts(readPage());
  vm.runInNewContext(script, sandbox, { filename: 'status.html' });

  if (opts.provideFetch !== false) {
    assert.equal(fetchCalls.length, 1, '脚本解析时必须立即发起 1 次同源取数');
    assert.equal(fetchCalls[0].url, API_PATH, `取数目标必须是同源路径 ${API_PATH}`);
    assert.ok(!/^https?:\/\//i.test(fetchCalls[0].url), '取数必须是同源相对路径');
    const method = fetchCalls[0].init && fetchCalls[0].init.method;
    assert.ok(
      method === undefined || String(method).toUpperCase() === 'GET',
      '取数必须是同源 GET 请求',
    );
  }

  return {
    elements,
    fetchCalls,
    // 等待取数完成，并排空页面内联脚本在 fetch 解析之后的 then 链（含 catch 分支）。
    settle: async () => {
      if (pendingFetch) {
        await pendingFetch.then(
          () => undefined,
          () => undefined,
        );
      }
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: requestPath },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function withServer(env, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(env || {})) {
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

// 同源取数实现：页面脚本发出的 fetch 走真实 HTTP，请求同一 host:port 的 GET /api/status。
function sameOriginFetch(port) {
  return async (url) => {
    const response = await request(port, url);
    return {
      ok: response.statusCode === 200,
      status: response.statusCode,
      json: () => Promise.resolve(JSON.parse(response.body)),
    };
  };
}

test('AC-005 结构：GET /status.html 返回的页面在 #versionInfo 内紧邻 #versionInfoList 之后含构建提交展示元素，且不含 footer 元素', async () => {
  const source = readPage();

  const served = await withServer({}, async (port) => {
    const response = await request(port, PAGE_ENDPOINT);
    assert.equal(response.statusCode, 200, 'GET /status.html 必须返回 200');
    assert.ok(
      /^text\/html/i.test(String(response.headers['content-type'])),
      '状态页端点必须以 text/html 返回页面',
    );
    return response.body;
  });
  assert.equal(served, source, '端点返回的页面必须与 status.html 交付内容一致');

  const inner = stripComments(sectionInner(served, VERSION_INFO_NODE_ID));
  const children = directChildren(inner);

  assert.equal(children[0] && children[0].tag, 'h2', '版本信息区域必须有标题');
  assert.equal(children[1] && children[1].tag, 'dl', '版本信息列表必须是可定位的 <dl>');
  assert.equal(
    attributeValue(children[1].attrs, 'id'),
    VERSION_INFO_LIST_NODE_ID,
    `版本信息列表必须带 id="${VERSION_INFO_LIST_NODE_ID}"`,
  );

  // 「紧邻 #versionInfoList」的结构口径：列表之后的下一个直接子元素即构建提交展示元素所在的展示单元。
  const buildCommitRow = children[2];
  assert.ok(buildCommitRow, '#versionInfoList 之后必须紧邻承载构建提交展示元素的展示行');
  assert.ok(
    buildCommitRow.html.includes(`id="${BUILD_COMMIT_NODE_ID}"`),
    `紧邻 #${VERSION_INFO_LIST_NODE_ID} 的展示单元必须承载构建提交展示元素 #${BUILD_COMMIT_NODE_ID}`,
  );
  assert.ok(
    !/\bhidden\b/i.test(buildCommitRow.attrs),
    '构建提交展示行不得带 hidden 属性（必须始终渲染并可见）',
  );
  assert.ok(
    !buildCommitRow.html.includes(CHANNEL_BADGE_NODE_ID),
    '构建提交展示行与渠道徽标展示单元必须是相邻但不同的展示单元',
  );

  // 既有渠道徽标（CT-002）在同一区域内仍保留。
  assert.ok(
    children.some((child) => child.html.includes(`id="${CHANNEL_BADGE_NODE_ID}"`)),
    `版本信息区域必须仍保留渠道徽标容器 #${CHANNEL_BADGE_NODE_ID}`,
  );

  // 展示元素在版本信息列表之后（区域内相邻展示单元）。
  assert.ok(
    inner.indexOf(`id="${BUILD_COMMIT_NODE_ID}"`) > inner.indexOf('</dl>'),
    '构建提交展示元素必须位于版本信息列表之后',
  );

  assert.ok(!/<footer\b/i.test(served), '状态页不得含 footer 元素');
  assert.ok(
    !/\b(?:id|class)\s*=\s*["'][^"']*\bfooter\b/i.test(served),
    '状态页不得含以 footer 标识的元素',
  );
});

test('AC-009 结构：构建提交展示元素的字体声明包含等宽字体族 monospace', () => {
  const source = readPage();
  const openingTag = openingTagOf(source, BUILD_COMMIT_NODE_ID);
  const declarations = fontDeclarationsFor(source, openingTag);

  assert.ok(
    /monospace/i.test(declarations),
    `构建提交展示元素的字体声明必须包含等宽字体族 monospace，实际声明：${JSON.stringify(declarations)}`,
  );
});

test('AC-005/AC-010 结构：构建提交展示元素始终渲染、无 hidden 属性、字体声明不隐藏元素，初始文本为占位符', () => {
  const source = readPage();
  const openingTag = openingTagOf(source, BUILD_COMMIT_NODE_ID);

  assert.ok(!/\bhidden\b/i.test(openingTag), '构建提交展示元素不得带 hidden 属性');

  const declarations = fontDeclarationsFor(source, openingTag);
  assert.ok(!/display\s*:\s*none/i.test(declarations), '不得以 display:none 隐藏构建提交展示元素');
  assert.ok(
    !/visibility\s*:\s*hidden/i.test(declarations),
    '不得以 visibility:hidden 隐藏构建提交展示元素',
  );

  assert.equal(
    elementInnerText(source, BUILD_COMMIT_NODE_ID).trim(),
    PLACEHOLDER,
    '构建提交展示元素在脚本执行前也必须已渲染，初始文本为占位符 —',
  );
});

test('TASK-005 口径：页面内联脚本以同源 GET /api/status 取数', async () => {
  const { elements, fetchCalls, settle } = runPage({
    payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: 'abcdef1234567890' }),
  });
  await settle();

  assert.equal(fetchCalls.length, 1, '页面脚本必须只按同源路径取数一次');
  assert.equal(fetchCalls[0].url, API_PATH, `取数路径必须是 ${API_PATH}`);
  assert.equal(
    String(elements[BUILD_COMMIT_NODE_ID].textContent),
    'abcdef1',
    '取数成功后展示元素必须写入响应 build_commit 的前 7 个字符',
  );
});

test('AC-006：build_commit 为 abcdef1234567890 时展示元素文本严格等于 abcdef1', async () => {
  const full = 'abcdef1234567890';
  const { elements, settle } = runPage({
    payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: full }),
  });
  await settle();

  const text = String(elements[BUILD_COMMIT_NODE_ID].textContent);
  assert.equal(text, 'abcdef1', '展示元素文本必须严格等于 build_commit 的前 7 个字符');
  assert.equal(text, full.slice(0, SHORT_LENGTH), '截断口径必须是前 7 个字符');
  assert.ok(text.length <= SHORT_LENGTH, '展示文本长度不得超过 7');
  assert.notEqual(elements[BUILD_COMMIT_NODE_ID].hidden, true, '展示元素必须始终渲染且可见');
  assert.equal(elements.error.hidden, true, '成功取数时既有错误提示必须保持不可见');
});

test('AC-006：40 位提交号与长响应值同样只展示前 7 个字符', async () => {
  const samples = [
    'abcdef1234567890abcdef1234567890abcdef12',
    'deadbeef-cafe-1234-5678-90abcdef1234567',
    '0123456789',
  ];

  for (const sample of samples) {
    const { elements, settle } = runPage({
      payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: sample }),
    });
    await settle();

    assert.equal(
      String(elements[BUILD_COMMIT_NODE_ID].textContent),
      sample.slice(0, SHORT_LENGTH),
      `build_commit=${JSON.stringify(sample)} 时必须只写入前 7 个字符`,
    );
  }
});

test('AC-007：build_commit 为 abc 时展示元素文本严格等于 abc（不足 7 位不截断也不补齐）', async () => {
  const samples = ['abc', 'a', 'abcdef'];

  for (const sample of samples) {
    const { elements, settle } = runPage({
      payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: sample }),
    });
    await settle();

    assert.equal(
      String(elements[BUILD_COMMIT_NODE_ID].textContent),
      sample,
      `build_commit=${JSON.stringify(sample)} 不足 7 位时必须逐字展示该值`,
    );
    assert.notEqual(elements[BUILD_COMMIT_NODE_ID].hidden, true, '展示元素必须始终渲染且可见');
  }
});

test('AC-008：build_commit 为后端缺省值 unknown 时文本逐字等于 unknown，且页面源码不内置该缺省字面值', async () => {
  const { elements, settle } = runPage({
    payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: BUILT_IN_DEFAULT_COMMIT }),
  });
  await settle();

  assert.equal(
    String(elements[BUILD_COMMIT_NODE_ID].textContent),
    BUILT_IN_DEFAULT_COMMIT,
    '后端缺省值必须原值透出，不做映射也不替换为占位符',
  );
  assert.notEqual(elements[BUILD_COMMIT_NODE_ID].hidden, true, '展示元素必须始终渲染且可见');

  const source = readPage();
  assert.ok(
    !new RegExp(BUILT_IN_DEFAULT_COMMIT, 'i').test(source),
    'status.html 不得内置构建提交缺省字面值（缺省值语义只允许在后端一处定义）',
  );
});

test('AC-010：build_commit 缺失、非字符串或为空时展示元素仍渲染且可见，文本严格等于 U+2014 占位符', async () => {
  const samples = [
    { label: '字段缺失', payload: Object.assign({}, BASE_PAYLOAD) },
    { label: '值为 null', payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: null }) },
    { label: '值为 number', payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: 123 }) },
    { label: '值为 boolean', payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: true }) },
    {
      label: '值为 object',
      payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: { short: 'abcdef1' } }),
    },
    { label: '值为空字符串', payload: Object.assign({}, BASE_PAYLOAD, { [BUILD_COMMIT_KEY]: '' }) },
  ];

  for (const sample of samples) {
    const { elements, settle } = runPage({ payload: sample.payload });
    await settle();

    assert.equal(
      String(elements[BUILD_COMMIT_NODE_ID].textContent),
      PLACEHOLDER,
      `${sample.label}：展示元素文本必须严格等于占位符 U+2014`,
    );
    assert.notEqual(
      elements[BUILD_COMMIT_NODE_ID].hidden,
      true,
      `${sample.label}：展示元素必须仍渲染且可见`,
    );
  }
});

test('AC-010：取数失败时展示元素仍渲染且可见，文本严格等于 U+2014 占位符', async () => {
  const { elements, settle } = runPage({ rejection: new Error('network down') });
  await settle();

  assert.equal(
    String(elements[BUILD_COMMIT_NODE_ID].textContent),
    PLACEHOLDER,
    '取数失败时展示文本必须为占位符 U+2014',
  );
  assert.notEqual(elements[BUILD_COMMIT_NODE_ID].hidden, true, '取数失败时展示元素仍须渲染且可见');
});

test('AC-010：取数响应 JSON 非对象时展示元素仍渲染且可见，文本严格等于 U+2014 占位符', async () => {
  const { elements, settle } = runPage({ payload: 'not-an-object' });
  await settle();

  assert.equal(
    String(elements[BUILD_COMMIT_NODE_ID].textContent),
    PLACEHOLDER,
    '响应体不是对象时展示文本必须为占位符 U+2014',
  );
  assert.notEqual(elements[BUILD_COMMIT_NODE_ID].hidden, true, '展示元素必须仍渲染且可见');
});

test('AC-006/TASK-005：展示口径仅依赖 build_commit 字段本身（其它字段无效不影响构建提交展示）', async () => {
  const { elements, settle } = runPage({
    payload: { [BUILD_COMMIT_KEY]: 'abcdef1234567890' },
  });
  await settle();

  assert.equal(
    String(elements[BUILD_COMMIT_NODE_ID].textContent),
    'abcdef1',
    '构建提交展示只依赖 build_commit，不得因其它字段缺失而落回占位符',
  );
  assert.notEqual(elements[BUILD_COMMIT_NODE_ID].hidden, true, '展示元素必须始终渲染且可见');
});

test('AC-010：环境不具备 fetch 时展示元素仍渲染且可见，文本保持占位符 U+2014', async () => {
  const { elements, settle } = runPage({ provideFetch: false });
  await settle();

  assert.equal(
    String(elements[BUILD_COMMIT_NODE_ID].textContent),
    PLACEHOLDER,
    '无法取数时展示文本必须为占位符 U+2014',
  );
  assert.notEqual(elements[BUILD_COMMIT_NODE_ID].hidden, true, '展示元素必须仍渲染且可见');
});

test('同源端到端：页面脚本经真实 GET /api/status 渲染 build_commit 前 7 个字符', async () => {
  await withServer({ [ENV_BUILD_COMMIT_KEY]: undefined }, async (port) => {
    const cases = ['abcdef1234567890', 'abc', 'abcdef1234567890abcdef1234567890abcdef12'];

    for (const value of cases) {
      process.env[ENV_BUILD_COMMIT_KEY] = value;

      const payload = JSON.parse((await request(port, API_PATH)).body);
      assert.equal(payload.build_commit, value, '后端必须原值透出 BUILD_COMMIT');

      const { elements, settle } = runPage({ fetchImpl: sameOriginFetch(port) });
      await settle();

      assert.equal(
        String(elements[BUILD_COMMIT_NODE_ID].textContent),
        payload.build_commit.slice(0, SHORT_LENGTH),
        `同源端到端：build_commit=${JSON.stringify(value)} 时展示元素必须等于其前 7 个字符`,
      );
    }

    delete process.env[ENV_BUILD_COMMIT_KEY];
    const fallback = JSON.parse((await request(port, API_PATH)).body);
    assert.equal(fallback.build_commit, BUILT_IN_DEFAULT_COMMIT);

    const { elements, settle } = runPage({ fetchImpl: sameOriginFetch(port) });
    await settle();
    assert.equal(
      String(elements[BUILD_COMMIT_NODE_ID].textContent),
      BUILT_IN_DEFAULT_COMMIT,
      '同源端到端：后端缺省值必须原样展示',
    );
  });
});
