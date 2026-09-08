'use strict';

// 关卡选择页前端测试：以 DOM 替身与 fetch 替身驱动 initLevelSelect，
// 不启动浏览器、不引入任何 npm 依赖，仅依赖 Node 内置模块。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB_ROOT = path.join(__dirname, '..', '..', 'web');

const { initLevelSelect } = require(path.join(WEB_ROOT, 'level-select.js'));

// —— DOM 替身：仅实现 initLevelSelect 所需的最小 DOM 接口 ——

function createElement(tagName) {
  return {
    tagName: String(tagName).toUpperCase(),
    textContent: '',
    type: undefined,
    disabled: false,
    className: '',
    children: [],
    attributes: {},
    classList: {
      _names: new Set(),
      add(...names) {
        for (const name of names) this._names.add(name);
      },
      remove(...names) {
        for (const name of names) this._names.delete(name);
      },
      contains(name) {
        return this._names.has(name);
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name)
        ? this.attributes[name]
        : null;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}

// 预置 TASK-006 规定的三个容器：id=loading、id=level-list、id=error-message。
function createDocument() {
  const containers = new Map();
  for (const id of ['loading', 'level-list', 'error-message']) {
    containers.set(id, createElement('div'));
  }
  return {
    containers,
    getElementById(id) {
      return containers.get(id) ?? null;
    },
    createElement,
  };
}

// —— fetch 替身 ——

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function createFetchDouble(responder) {
  const calls = [];
  const fetchImpl = (url) => {
    calls.push(url);
    return responder(url);
  };
  return { fetchImpl, calls };
}

const VALID_LEVELS = [
  { id: 'level-1', name: '木叶村演习场', difficulty: '简单', unlocked: true },
  { id: 'level-2', name: '波之国大桥', difficulty: '普通', unlocked: true },
  { id: 'level-3', name: '中忍考试会场', difficulty: '普通', unlocked: false },
  { id: 'level-4', name: '大蛇丸据点', difficulty: '困难', unlocked: false },
  { id: 'level-5', name: '终结之谷', difficulty: '困难', unlocked: false },
];

test('AC-007: initLevelSelect 以相对路径 /api/levels 发起恰好一次请求', async () => {
  const doc = createDocument();
  const { fetchImpl, calls } = createFetchDouble(async () => jsonResponse(200, VALID_LEVELS));

  await initLevelSelect({ document: doc, fetchImpl });

  assert.deepEqual(calls, ['/api/levels']);
});

test('AC-007: web/index.html 提供 loading、level-list、error-message 容器并以 script 加载 level-select.js', () => {
  const html = fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('id="loading"'), '缺少 id=loading 容器');
  assert.ok(html.includes('id="level-list"'), '缺少 id=level-list 容器');
  assert.ok(html.includes('id="error-message"'), '缺少 id=error-message 容器');
  assert.match(html, /<script src="level-select\.js"><\/script>/, '缺少 level-select.js 脚本引用');
});

test('AC-008: 请求期间呈现加载态，完成后隐藏加载提示', async () => {
  const doc = createDocument();
  let resolveFetch;
  const { fetchImpl } = createFetchDouble(
    () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
  );

  const done = initLevelSelect({ document: doc, fetchImpl });
  assert.equal(
    doc.containers.get('loading').classList.contains('hidden'),
    false,
    '请求未完成时加载提示必须可见',
  );

  resolveFetch(jsonResponse(200, VALID_LEVELS));
  await done;
  assert.equal(
    doc.containers.get('loading').classList.contains('hidden'),
    true,
    '完成后加载提示必须隐藏',
  );
});

test('AC-008: 合法响应在 level-list 渲染每项名称与难度', async () => {
  const doc = createDocument();
  const { fetchImpl } = createFetchDouble(async () => jsonResponse(200, VALID_LEVELS));

  await initLevelSelect({ document: doc, fetchImpl });

  const list = doc.containers.get('level-list');
  assert.equal(list.children.length, VALID_LEVELS.length);
  assert.match(list.children[0].textContent, /木叶村演习场/);
  assert.match(list.children[0].textContent, /简单/);
  assert.match(list.children[2].textContent, /中忍考试会场/);
  assert.match(list.children[2].textContent, /普通/);
  assert.match(list.children[4].textContent, /终结之谷/);
  assert.match(list.children[4].textContent, /困难/);
  assert.equal(
    doc.containers.get('error-message').classList.contains('hidden'),
    true,
    '成功路径不得展示错误提示',
  );
});

test('AC-008: unlocked=false 的关卡呈锁定不可选状态，unlocked=true 可选', async () => {
  const doc = createDocument();
  const levels = [
    { id: 'level-1', name: '木叶村演习场', difficulty: '简单', unlocked: true },
    { id: 'level-2', name: '波之国大桥', difficulty: '普通', unlocked: false },
  ];
  const { fetchImpl } = createFetchDouble(async () => jsonResponse(200, levels));

  await initLevelSelect({ document: doc, fetchImpl });

  const list = doc.containers.get('level-list');
  assert.equal(list.children[0].disabled, false, '解锁关卡不得被禁用');
  assert.equal(list.children[1].disabled, true, '锁定关卡必须禁用（不可选）');
  assert.equal(list.children[1].getAttribute('aria-disabled'), 'true');
});

test('AC-009: 请求失败时呈现可读错误、隐藏加载并保留页面框架', async () => {
  const doc = createDocument();
  const { fetchImpl } = createFetchDouble(async () => {
    throw new Error('network down: ECONNREFUSED');
  });

  await assert.doesNotReject(() => initLevelSelect({ document: doc, fetchImpl }));

  const errorMessage = doc.containers.get('error-message');
  assert.equal(errorMessage.classList.contains('hidden'), false, '失败时必须展示错误提示');
  assert.match(errorMessage.textContent, /关卡数据加载失败/);
  assert.ok(!errorMessage.textContent.includes('network down'), '不得泄漏内部错误细节');
  assert.ok(!errorMessage.textContent.includes('ECONNREFUSED'), '不得泄漏系统错误码');
  assert.equal(doc.containers.get('loading').classList.contains('hidden'), true);
  const list = doc.containers.get('level-list');
  assert.ok(list, '页面框架必须保留 level-list 容器');
  assert.equal(list.children.length, 0);
  assert.ok(doc.containers.get('loading'), '页面框架必须保留 loading 容器');
  assert.ok(doc.containers.get('error-message'), '页面框架必须保留 error-message 容器');
});

test('AC-009: 非 200 响应呈现服务端可读错误信息', async () => {
  const doc = createDocument();
  const { fetchImpl } = createFetchDouble(
    async () =>
      jsonResponse(500, {
        error: { code: 'LEVEL_DATA_UNAVAILABLE', message: '关卡数据不可用：无法读取关卡数据文件' },
      }),
  );

  await initLevelSelect({ document: doc, fetchImpl });

  const errorMessage = doc.containers.get('error-message');
  assert.equal(errorMessage.classList.contains('hidden'), false);
  assert.match(errorMessage.textContent, /关卡数据不可用：无法读取关卡数据文件/);
  assert.equal(doc.containers.get('loading').classList.contains('hidden'), true);
});

test('AC-009: 非 200 且错误体非 JSON 时呈现可读降级提示', async () => {
  const doc = createDocument();
  const { fetchImpl } = createFetchDouble(
    async () => ({
      status: 502,
      ok: false,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    }),
  );

  await initLevelSelect({ document: doc, fetchImpl });

  const errorMessage = doc.containers.get('error-message');
  assert.equal(errorMessage.classList.contains('hidden'), false);
  assert.match(errorMessage.textContent, /关卡数据加载失败/);
  assert.ok(!errorMessage.textContent.includes('Unexpected token'), '不得泄漏解析错误细节');
});

test('AC-009: 顶层数组项字段非法（缺 name）呈现可读错误且不渲染列表', async () => {
  const doc = createDocument();
  const { fetchImpl } = createFetchDouble(
    async () => jsonResponse(200, [{ id: 'level-1', difficulty: '简单', unlocked: true }]),
  );

  await initLevelSelect({ document: doc, fetchImpl });

  const errorMessage = doc.containers.get('error-message');
  assert.equal(errorMessage.classList.contains('hidden'), false);
  assert.match(errorMessage.textContent, /关卡数据加载失败/);
  assert.equal(doc.containers.get('level-list').children.length, 0);
});

test('AC-009: 响应不是数组时呈现可读错误', async () => {
  const doc = createDocument();
  const { fetchImpl } = createFetchDouble(async () => jsonResponse(200, { levels: VALID_LEVELS }));

  await initLevelSelect({ document: doc, fetchImpl });

  const errorMessage = doc.containers.get('error-message');
  assert.equal(errorMessage.classList.contains('hidden'), false);
  assert.match(errorMessage.textContent, /关卡数据加载失败/);
  assert.equal(doc.containers.get('level-list').children.length, 0);
});

test('AC-009: 数组项 difficulty 取值非法呈现可读错误', async () => {
  const doc = createDocument();
  const { fetchImpl } = createFetchDouble(
    async () =>
      jsonResponse(200, [{ id: 'level-1', name: '木叶村演习场', difficulty: '地狱', unlocked: true }]),
  );

  await initLevelSelect({ document: doc, fetchImpl });

  const errorMessage = doc.containers.get('error-message');
  assert.equal(errorMessage.classList.contains('hidden'), false);
  assert.match(errorMessage.textContent, /关卡数据加载失败/);
  assert.equal(doc.containers.get('level-list').children.length, 0);
});

test('AC-010 辅助/CHECK-004: web 产物不含 npm 依赖与外部资源引用', () => {
  const files = fs.readdirSync(WEB_ROOT).filter((name) => name.endsWith('.html') || name.endsWith('.js'));
  assert.ok(files.length > 0, 'web/ 目录必须存在页面产物');
  for (const name of files) {
    const content = fs.readFileSync(path.join(WEB_ROOT, name), 'utf8');
    assert.ok(!content.includes('node_modules'), `${name} 不得引用 node_modules`);
    assert.ok(!/require\s*\(/.test(content), `${name} 不得使用 CommonJS 依赖引入`);
    assert.ok(!/^\s*import\s/m.test(content), `${name} 不得使用 ESM 依赖引入`);
    assert.ok(!/https?:\/\//.test(content), `${name} 不得引用外部 http(s) 资源`);
  }
});
