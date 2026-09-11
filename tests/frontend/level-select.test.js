'use strict';

// AC-007 / AC-008 / AC-009 / AC-010：关卡选择页骨架、加载态→渲染→锁定态、错误分支。
// 全部以 DOM 替身与注入 fetch 替身运行，不启动浏览器（AC-010）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const { initLevelSelect } = require('../../web/level-select.js');
const { createDomStub } = require('./helpers/dom.js');

const CONTAINER_IDS = ['loading', 'level-list', 'error-message'];
const EXE006_DIFFICULTIES = ['简单', '普通', '困难'];
// CT-001：上游 /api/levels 数据异常 500 的固定可读文案，前端应原样展示。
const LEVEL_DATA_FALLBACK_MESSAGE = '暂时无法加载关卡数据，请稍后重试';

function makeLevel(overrides = {}) {
  return { id: 'level-01', name: '木叶村演习场', difficulty: '简单', unlocked: true, ...overrides };
}

function validLevels() {
  return [
    makeLevel(),
    makeLevel({ id: 'level-02', name: '波之国护送', difficulty: '简单', unlocked: true }),
    makeLevel({ id: 'level-03', name: '中忍考试预选', difficulty: '普通', unlocked: true }),
    makeLevel({ id: 'level-04', name: '大蛇丸研究所', difficulty: '困难', unlocked: false }),
    makeLevel({ id: 'level-05', name: '终末之谷决战', difficulty: '困难', unlocked: false }),
  ];
}

// 与后端 EXE-006 字段约束保持一致（server/index.js validateLevels）。
function isExe006Level(level) {
  return (
    typeof level?.id === 'string' && level.id.length > 0 &&
    typeof level?.name === 'string' && level.name.length > 0 &&
    EXE006_DIFFICULTIES.includes(level?.difficulty) &&
    typeof level?.unlocked === 'boolean'
  );
}

function okFetch(body) {
  return async () => ({ status: 200, json: async () => body });
}

// 错误分支统一断言：保留页面框架三容器、退出加载态、error-message 展示可读文案。
function assertRenderedError(dom) {
  for (const id of CONTAINER_IDS) {
    assert.ok(dom.byId.has(id), `错误分支应保留页面框架容器 #${id}`);
  }
  assert.equal(dom.byId.get('loading').hidden, true, '错误分支应退出加载态');
  const errorMessage = dom.byId.get('error-message');
  assert.equal(errorMessage.hidden, false, '错误分支应展示 error-message 容器');
  assert.ok(typeof errorMessage.textContent === 'string' && errorMessage.textContent.length > 0, 'error-message 应展示可读错误文案');
}

test('AC-007: web/index.html 存在三个容器并以 script 引用 level-select.js', async () => {
  const html = await fs.readFile(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
  for (const id of CONTAINER_IDS) {
    assert.ok(html.includes(`id="${id}"`), `index.html 应包含 id="${id}" 的容器`);
  }
  assert.match(html, /<script[^>]*src="level-select\.js"[^>]*><\/script>/, '应以 script 标签引用 level-select.js');
});

test('AC-008: 先展示加载态，再将合法响应渲染为 5 项名称与难度列表', async (t) => {
  const dom = createDomStub(CONTAINER_IDS);
  const levels = validLevels();
  for (const level of levels) assert.ok(isExe006Level(level));

  let resolveFetch;
  const fetchImpl = (url) => {
    assert.equal(url, '/api/levels', '应请求 /api/levels');
    assert.equal(dom.byId.get('loading').hidden, false, 'fetch 发起时应处于加载态');
    assert.equal(dom.byId.get('level-list').hidden, true, '加载态下列表应隐藏');
    assert.equal(dom.byId.get('error-message').hidden, true, '加载态下错误容器应隐藏');
    return new Promise((resolve) => {
      resolveFetch = () => resolve({ status: 200, json: async () => levels });
    });
  };

  const pending = initLevelSelect({ document: dom, fetchImpl });
  t.after(() => resolveFetch?.());
  assert.equal(typeof resolveFetch, 'function', 'initLevelSelect 应先建立加载态再发起 fetch');
  resolveFetch();
  await assert.doesNotReject(() => pending);

  assert.equal(dom.byId.get('loading').hidden, true, '渲染完成后应退出加载态');
  const list = dom.byId.get('level-list');
  assert.equal(list.hidden, false, '渲染完成后应展示列表容器');
  assert.equal(list.children.length, 5, '应渲染 5 个关卡项');
  levels.forEach((level, index) => {
    const item = list.children[index];
    assert.ok(item.textContent.includes(level.name), `第 ${index + 1} 项应包含名称「${level.name}」`);
    assert.ok(item.textContent.includes(level.difficulty), `第 ${index + 1} 项应包含难度「${level.difficulty}」`);
  });
  const errorMessage = dom.byId.get('error-message');
  assert.equal(errorMessage.hidden, true, '成功渲染后不应展示错误容器');
});

test('AC-008: unlocked=false 的关卡渲染为锁定不可选', async () => {
  const dom = createDomStub(CONTAINER_IDS);
  const levels = validLevels();

  await initLevelSelect({ document: dom, fetchImpl: okFetch(levels) });

  const list = dom.byId.get('level-list');
  assert.equal(list.children.length, 5);
  levels.forEach((level, index) => {
    const item = list.children[index];
    const button = item.children.find((child) => child.tagName === 'BUTTON');
    assert.ok(button, `第 ${index + 1} 项应包含承载选择交互的 button`);
    assert.equal(button.disabled, !level.unlocked, `「${level.name}」的锁定态应为 disabled=${!level.unlocked}`);
  });
});

test('AC-009: fetch 拒绝时进入错误分支、保留页面框架且不抛出未捕获异常', async () => {
  const dom = createDomStub(CONTAINER_IDS);
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };

  await assert.doesNotReject(() => initLevelSelect({ document: dom, fetchImpl }));
  assertRenderedError(dom);
});

test('AC-009: 响应 500 且为 LEVEL_DATA_UNAVAILABLE 时展示上游可读文案', async () => {
  const dom = createDomStub(CONTAINER_IDS);
  const fetchImpl = async () => ({
    status: 500,
    json: async () => ({ error: { code: 'LEVEL_DATA_UNAVAILABLE', message: LEVEL_DATA_FALLBACK_MESSAGE } }),
  });

  await assert.doesNotReject(() => initLevelSelect({ document: dom, fetchImpl }));
  assertRenderedError(dom);
  assert.equal(dom.byId.get('error-message').textContent, LEVEL_DATA_FALLBACK_MESSAGE);
});

test('AC-009: 响应非 200 且错误体不可读时展示兜底可读文案', async () => {
  const dom = createDomStub(CONTAINER_IDS);
  const fetchImpl = async () => ({
    status: 502,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  });

  await assert.doesNotReject(() => initLevelSelect({ document: dom, fetchImpl }));
  assertRenderedError(dom);
});

test('AC-009: 响应 200 但非数组时进入错误分支', async () => {
  const dom = createDomStub(CONTAINER_IDS);

  await assert.doesNotReject(() => initLevelSelect({ document: dom, fetchImpl: okFetch({ data: [] }) }));
  assertRenderedError(dom);
});

test('AC-009: 关卡字段不满足 EXE-006 时进入错误分支', async () => {
  const dom = createDomStub(CONTAINER_IDS);
  const invalid = validLevels().map((level, index) => (index === 3 ? { ...level, difficulty: '地狱' } : level));
  assert.ok(!isExe006Level(invalid[3]), '夹具第 4 项应确实违反 EXE-006');

  await assert.doesNotReject(() => initLevelSelect({ document: dom, fetchImpl: okFetch(invalid) }));
  assertRenderedError(dom);
});

// TASK-006：无 module 的浏览器环境下，script 加载时应自动调用 initLevelSelect。
// 以 node:vm 沙盒执行页面脚本源码（沙盒无 module，走浏览器分支），仍不启动浏览器。
test('TASK-006: 浏览器环境加载脚本时自动调用 initLevelSelect 并完成渲染', async () => {
  const dom = createDomStub(CONTAINER_IDS);
  const levels = validLevels();
  const script = await fs.readFile(path.join(__dirname, '..', '..', 'web', 'level-select.js'), 'utf8');

  const sandbox = {
    window: { document: dom },
    fetch: async () => ({ status: 200, json: async () => levels }),
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);

  // 排空事件循环直至自动初始化的异步渲染完成（上限保护避免死等）。
  for (let i = 0; i < 50 && dom.byId.get('level-list').children.length === 0; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  const list = dom.byId.get('level-list');
  assert.equal(list.children.length, 5, '自动初始化应渲染 5 个关卡项');
  assert.equal(dom.byId.get('loading').hidden, true, '自动初始化完成后应退出加载态');
  assert.equal(typeof sandbox.initLevelSelect, 'function', '应向全局暴露 initLevelSelect');
});
