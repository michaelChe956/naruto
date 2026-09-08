'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { initLevelSelect, LEVELS_API_PATH } = require('../../web/level-select');
const { createFakeDocument, findByClassName } = require('./helpers/fake-document');

// 与 data/levels.json 交付数据一致的合法五项载荷（对齐 server/levels.js 契约）
const VALID_LEVELS = [
  { id: 'level-001', name: '木叶村入门试炼', difficulty: '简单', unlocked: true },
  { id: 'level-002', name: '死亡森林生存演习', difficulty: '简单', unlocked: true },
  { id: 'level-003', name: '中忍考试笔试', difficulty: '普通', unlocked: true },
  { id: 'level-004', name: '大蛇丸的袭击', difficulty: '困难', unlocked: false },
  { id: 'level-005', name: '一尾守鹤暴走', difficulty: '困难', unlocked: false },
];

function okResponse(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

function errorResponse(status) {
  return { ok: false, status, json: async () => ({}) };
}

function assertErrorBranchShown(doc, listContainer) {
  const errorBox = doc.getElementById('error-message');
  assert.equal(errorBox.hidden, false, '错误容器应可见');
  assert.equal(typeof errorBox.textContent, 'string');
  assert.ok(errorBox.textContent.includes('关卡'), `错误提示应可读，实际为：${errorBox.textContent}`);
  assert.equal(doc.getElementById('loading').hidden, true, 'loading 应已隐藏');
  assert.equal(
    findByClassName(listContainer, 'level-item').length,
    0,
    '错误分支不得渲染关卡列表'
  );
  // 页面框架保留：三个容器仍在文档中且可达，不白屏
  for (const id of ['loading', 'level-list', 'error-message']) {
    assert.notEqual(doc.getElementById(id), null, `容器 ${id} 应保留`);
  }
}

test('web/level-select.js 导出 initLevelSelect 接口并相对引用 /api/levels', () => {
  assert.equal(typeof initLevelSelect, 'function');
  assert.equal(LEVELS_API_PATH, '/api/levels');
});

test('web/index.html 包含三个容器标记与 level-select.js 脚本引用', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
  assert.match(html, /id="loading"/);
  assert.match(html, /id="level-list"/);
  assert.match(html, /id="error-message"/);
  assert.match(html, /<script[^>]*src="\.\/level-select\.js"/);
  assert.match(html, /initLevelSelect\s*\(/, '页面应调用 initLevelSelect 启动数据加载');
});

test('加载成功时以相对路径请求 /api/levels 并渲染五项名称与难度', async () => {
  const doc = createFakeDocument();
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return okResponse(VALID_LEVELS);
  };

  await initLevelSelect({ document: doc, fetchImpl });

  assert.deepEqual(requestedUrls, ['/api/levels'], '应以相对路径请求 /api/levels');
  const list = doc.getElementById('level-list');
  const items = findByClassName(list, 'level-item');
  assert.equal(items.length, 5);
  assert.deepEqual(
    findByClassName(list, 'level-name').map((el) => el.textContent),
    VALID_LEVELS.map((level) => level.name)
  );
  assert.deepEqual(
    findByClassName(list, 'level-difficulty').map((el) => el.textContent),
    VALID_LEVELS.map((level) => level.difficulty)
  );
});

test('unlocked 为 false 的关卡呈锁定不可选，unlocked 为 true 可选', async () => {
  const doc = createFakeDocument();
  await initLevelSelect({ document: doc, fetchImpl: async () => okResponse(VALID_LEVELS) });

  const list = doc.getElementById('level-list');
  const buttons = findByClassName(list, 'level-select');
  assert.equal(buttons.length, 5);
  assert.equal(buttons[0].disabled, false, '已解锁关卡应可选');
  assert.equal(buttons[2].disabled, false, '已解锁关卡应可选');
  assert.equal(buttons[3].disabled, true, '未解锁关卡应不可选');
  assert.equal(buttons[4].disabled, true, '未解锁关卡应不可选');

  const items = findByClassName(list, 'level-item');
  assert.ok(items[3].className.includes('locked'), '未解锁项应带锁定标记');
  assert.ok(!items[0].className.includes('locked'), '已解锁项不带锁定标记');
});

test('加载成功后隐藏 loading 且错误提示保持隐藏', async () => {
  const doc = createFakeDocument();
  await initLevelSelect({ document: doc, fetchImpl: async () => okResponse(VALID_LEVELS) });

  assert.equal(doc.getElementById('loading').hidden, true);
  assert.equal(doc.getElementById('error-message').hidden, true);
  assert.equal(doc.getElementById('error-message').textContent, '');
});

test('fetchImpl 拒绝时展示可读错误并保留页面框架不白屏', async () => {
  const doc = createFakeDocument();
  const fetchImpl = async () => {
    throw new Error('network down');
  };

  await initLevelSelect({ document: doc, fetchImpl });

  assertErrorBranchShown(doc, doc.getElementById('level-list'));
});

test('响应为非成功状态（500）时进入错误分支', async () => {
  const doc = createFakeDocument();
  await initLevelSelect({ document: doc, fetchImpl: async () => errorResponse(500) });

  const errorBox = doc.getElementById('error-message');
  assertErrorBranchShown(doc, doc.getElementById('level-list'));
  assert.match(errorBox.textContent, /500/, '错误提示应包含状态码以便排查');
});

test('响应 JSON 解析失败时进入错误分支', async () => {
  const doc = createFakeDocument();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('Unexpected token');
    },
  });

  await initLevelSelect({ document: doc, fetchImpl });

  assertErrorBranchShown(doc, doc.getElementById('level-list'));
});

test('响应结构非法时进入错误分支且不渲染列表', async () => {
  const invalidCases = [
    ['顶层非数组', { message: 'not an array' }],
    ['少于五项', VALID_LEVELS.slice(0, 4)],
    ['多于五项', [...VALID_LEVELS, { id: 'extra', name: '多出来的', difficulty: '简单', unlocked: true }]],
    ['difficulty 越界', VALID_LEVELS.map((level, i) => (i === 0 ? { ...level, difficulty: '地狱' } : level))],
    ['unlocked 非布尔', VALID_LEVELS.map((level, i) => (i === 1 ? { ...level, unlocked: 'yes' } : level))],
    ['id 为空字符串', VALID_LEVELS.map((level, i) => (i === 2 ? { ...level, id: '' } : level))],
    ['记录非对象', VALID_LEVELS.map((level, i) => (i === 3 ? 'not-an-object' : level))],
  ];

  for (const [label, payload] of invalidCases) {
    const doc = createFakeDocument();
    await initLevelSelect({ document: doc, fetchImpl: async () => okResponse(payload) });
    assertErrorBranchShown(doc, doc.getElementById('level-list'));
  }
});
