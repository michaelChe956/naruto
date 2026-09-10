'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { initLevelSelect } = require('../../web/level-select');
const { createDocumentStub } = require('./helpers/dom-stub');

const WEB_DIR = path.join(__dirname, '..', '..', 'web');
const INDEX_HTML_PATH = path.join(WEB_DIR, 'index.html');

// 与 WI-001 契约一致的响应：恰好五项，字段为 id/name/difficulty/enemies（无 unlocked）。
const REAL_API_LEVELS = [
  { id: 1, name: '木叶村门口', difficulty: 1, enemies: ['下忍逃兵'] },
  { id: 2, name: '死亡森林', difficulty: 2, enemies: ['雨忍斥候', '毒蛇'] },
  { id: 3, name: '中忍考试第三场', difficulty: 3, enemies: ['砂隐傀儡师'] },
  { id: 4, name: '终结之谷', difficulty: 4, enemies: ['咒印状态佐助'] },
  { id: 5, name: '大蛇丸地下研究所', difficulty: 5, enemies: ['音忍四人众', '大蛇丸'] },
];

const DATA_UNAVAILABLE_MESSAGE = '暂时无法加载关卡数据，请稍后重试';

function jsonResponse({ ok = true, status = 200, body }) {
  return { ok, status, json: async () => body };
}

async function runLevelSelect(fetchImpl) {
  const doc = createDocumentStub();
  doc.registerElement('loading');
  doc.registerElement('level-list');
  doc.registerElement('error-message');
  await initLevelSelect({ document: doc, fetchImpl });
  return doc;
}

function renderedItemTexts(doc) {
  return doc.getElementById('level-list').childNodes.map((node) => node.textContent);
}

function assertContainersPreserved(doc) {
  for (const id of ['loading', 'level-list', 'error-message']) {
    assert.notEqual(doc.getElementById(id), null, `容器 #${id} 应保留`);
  }
}

test('web/index.html 提供三个容器并以 script 引用 level-select.js', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.match(html, /id="loading"/);
  assert.match(html, /id="level-list"/);
  assert.match(html, /id="error-message"/);
  assert.match(html, /<script src="level-select\.js"><\/script>/);
});

test('initLevelSelect 成功时以文本节点渲染每项名称与难度', async () => {
  const doc = await runLevelSelect(() => jsonResponse({ body: REAL_API_LEVELS }));
  const texts = renderedItemTexts(doc);
  assert.equal(texts.length, REAL_API_LEVELS.length);
  assert.match(texts[0], /木叶村门口/);
  assert.match(texts[0], /难度 1/);
  assert.match(texts[4], /大蛇丸地下研究所/);
  assert.match(texts[4], /难度 5/);
  assert.equal(doc.getElementById('error-message').textContent, '');
  assert.equal(doc.getElementById('loading').textContent, '');
});

test('initLevelSelect 按 unlocked 呈现锁定态', async () => {
  const levels = [
    { id: 1, name: '木叶村门口', difficulty: 1, enemies: ['下忍逃兵'], unlocked: true },
    { id: 2, name: '死亡森林', difficulty: 2, enemies: ['雨忍斥候'], unlocked: false },
    { id: 3, name: '中忍考试第三场', difficulty: 3, enemies: ['砂隐傀儡师'] },
  ];
  const doc = await runLevelSelect(() => jsonResponse({ body: levels }));
  const texts = renderedItemTexts(doc);
  assert.equal(texts.length, levels.length);
  assert.doesNotMatch(texts[0], /未解锁/);
  assert.match(texts[1], /死亡森林/);
  assert.match(texts[1], /未解锁/);
  assert.doesNotMatch(texts[2], /未解锁/);
});

test('fetch 网络失败时展示可读错误且三个容器保留', async () => {
  const doc = await runLevelSelect(() => {
    throw new Error('network down');
  });
  const message = doc.getElementById('error-message').textContent;
  assert.match(message, /关卡加载失败/);
  assertContainersPreserved(doc);
  assert.equal(doc.getElementById('loading').textContent, '');
});

test('非 2xx 响应时展示可读错误且三个容器保留', async () => {
  const doc = await runLevelSelect(() =>
    jsonResponse({
      ok: false,
      status: 500,
      body: { error: { code: 'LEVEL_DATA_UNAVAILABLE', message: DATA_UNAVAILABLE_MESSAGE } },
    })
  );
  const message = doc.getElementById('error-message').textContent;
  assert.match(message, /关卡加载失败/);
  assert.match(message, new RegExp(DATA_UNAVAILABLE_MESSAGE));
  assertContainersPreserved(doc);
});

test('结构不满足字段约束时展示可读错误且三个容器保留', async () => {
  for (const invalidBody of [
    { notAnArray: true },
    [{ name: '缺难度的关卡' }],
    [{ name: '', difficulty: 2 }],
    [{ name: '难度越界', difficulty: 9 }],
  ]) {
    const doc = await runLevelSelect(() => jsonResponse({ body: invalidBody }));
    const message = doc.getElementById('error-message').textContent;
    assert.match(message, /关卡加载失败/, `无效结构 ${JSON.stringify(invalidBody)} 应产生可读错误`);
    assert.equal(doc.getElementById('level-list').textContent, '');
    assertContainersPreserved(doc);
  }
});

test('响应 JSON 不可解析时展示可读错误且三个容器保留', async () => {
  const doc = await runLevelSelect(() => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error('Unexpected token < in JSON');
    },
  }));
  assert.match(doc.getElementById('error-message').textContent, /关卡加载失败/);
  assertContainersPreserved(doc);
});
