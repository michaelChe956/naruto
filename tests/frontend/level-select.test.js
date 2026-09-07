'use strict';

// tests/frontend/level-select.test.js — 关卡选择渲染逻辑测试（TASK-007）
// 覆盖 AC-008（渲染/锁定态）与 AC-009（错误分支：抛异常/非 2xx/结构无效）。

const test = require('node:test');
const assert = require('node:assert/strict');

const { initLevelSelect } = require('../../web/level-select.js');
const {
  FIVE_LEVELS,
  createFakeDocument,
  okJsonResponse,
  statusResponse,
  findRenderedItem,
  listText,
} = require('./helpers.js');

test('AC-008: 成功响应以文本渲染每个关卡的 name 与 difficulty', async () => {
  const doc = createFakeDocument();
  const fetchImpl = async () => okJsonResponse(FIVE_LEVELS);

  await initLevelSelect({ document: doc, fetchImpl });

  const text = listText(doc.containers['level-list']);
  for (const level of FIVE_LEVELS) {
    assert.ok(
      text.includes(level.name),
      `渲染结果必须包含关卡名 ${level.name}`
    );
    assert.ok(
      text.includes(level.difficulty),
      `渲染结果必须包含难度 ${level.difficulty}`
    );
  }
  assert.equal(doc.containers['level-list'].children.length, FIVE_LEVELS.length);
});

test('AC-008: 请求期显示 id=loading，成功后隐藏且不出现错误提示', async () => {
  const doc = createFakeDocument();
  let loadingVisibleDuringFetch = null;
  const fetchImpl = async () => {
    loadingVisibleDuringFetch = !doc.containers.loading.hasAttribute('hidden');
    return okJsonResponse(FIVE_LEVELS);
  };

  await initLevelSelect({ document: doc, fetchImpl });

  assert.equal(loadingVisibleDuringFetch, true, '请求进行中 loading 必须处于显示态');
  assert.equal(
    doc.containers.loading.hasAttribute('hidden'),
    true,
    '完成后 loading 必须隐藏'
  );
  assert.equal(
    doc.containers['error-message'].hasAttribute('hidden'),
    true,
    '成功时错误提示必须保持隐藏'
  );
});

test('AC-008: unlocked=false 项显示锁定且不可选择，unlocked=true 项不受限', async () => {
  const doc = createFakeDocument();
  const fetchImpl = async () => okJsonResponse(FIVE_LEVELS);

  await initLevelSelect({ document: doc, fetchImpl });

  const listEl = doc.containers['level-list'];
  const locked = findRenderedItem(listEl, '波之国大桥');
  assert.ok(locked, '必须渲染锁定关卡 波之国大桥');
  assert.equal(locked.getAttribute('data-locked'), 'true', '锁定项必须带 data-locked 标记');
  assert.equal(locked.getAttribute('aria-disabled'), 'true', '锁定项必须不可选择');
  assert.ok(locked.textContent.includes('锁定'), '锁定项文本必须体现锁定态');

  const unlocked = findRenderedItem(listEl, '木叶演习场');
  assert.ok(unlocked, '必须渲染解锁关卡 木叶演习场');
  assert.equal(unlocked.hasAttribute('data-locked'), false, '解锁项不得带锁定标记');
  assert.equal(unlocked.hasAttribute('aria-disabled'), false, '解锁项必须可选择');
});

test('AC-009: fetchImpl 抛出异常时显示可读提示且保留页面框架', async () => {
  const doc = createFakeDocument();
  const fetchImpl = async () => {
    throw new Error('network down');
  };

  await initLevelSelect({ document: doc, fetchImpl });

  const errorEl = doc.containers['error-message'];
  assert.equal(errorEl.hasAttribute('hidden'), false, '错误提示必须显示');
  assert.ok(
    errorEl.textContent.includes('关卡加载失败'),
    `错误提示必须可读，实际为：${errorEl.textContent}`
  );
  assert.equal(doc.containers.loading.hasAttribute('hidden'), true, '错误后 loading 必须隐藏');
  assert.ok(doc.getElementById('loading'), '页面框架必须保留 loading 容器');
  assert.ok(doc.getElementById('level-list'), '页面框架必须保留 level-list 容器');
  assert.ok(doc.getElementById('error-message'), '页面框架必须保留 error-message 容器');
});

test('AC-009: 非 2xx 响应（500 LEVEL_DATA_UNAVAILABLE）进入错误分支', async () => {
  const doc = createFakeDocument();
  const fetchImpl = async () =>
    statusResponse(500, {
      error: { code: 'LEVEL_DATA_UNAVAILABLE', message: '关卡数据不可用' },
    });

  await initLevelSelect({ document: doc, fetchImpl });

  const errorEl = doc.containers['error-message'];
  assert.equal(errorEl.hasAttribute('hidden'), false, '错误提示必须显示');
  assert.ok(
    errorEl.textContent.includes('关卡数据不可用'),
    `错误提示必须可读，实际为：${errorEl.textContent}`
  );
  assert.equal(doc.containers.loading.hasAttribute('hidden'), true, '错误后 loading 必须隐藏');
  assert.ok(doc.getElementById('level-list'), '页面框架必须保留');
});

test('AC-009: 200 但结构无效（非数组）进入错误分支', async () => {
  const doc = createFakeDocument();
  const fetchImpl = async () => okJsonResponse({ levels: FIVE_LEVELS });

  await initLevelSelect({ document: doc, fetchImpl });

  const errorEl = doc.containers['error-message'];
  assert.equal(errorEl.hasAttribute('hidden'), false, '错误提示必须显示');
  assert.ok(
    errorEl.textContent.includes('关卡加载失败'),
    `错误提示必须可读，实际为：${errorEl.textContent}`
  );
  assert.equal(doc.containers.loading.hasAttribute('hidden'), true, '错误后 loading 必须隐藏');
  assert.ok(doc.getElementById('error-message'), '页面框架必须保留');
});

test('AC-009: 200 数组但关卡项字段无效（unlocked 缺失）进入错误分支', async () => {
  const doc = createFakeDocument();
  const invalidLevels = FIVE_LEVELS.map(({ unlocked, ...rest }) => rest);
  const fetchImpl = async () => okJsonResponse(invalidLevels);

  await initLevelSelect({ document: doc, fetchImpl });

  const errorEl = doc.containers['error-message'];
  assert.equal(errorEl.hasAttribute('hidden'), false, '错误提示必须显示');
  assert.ok(
    errorEl.textContent.includes('关卡加载失败'),
    `错误提示必须可读，实际为：${errorEl.textContent}`
  );
  assert.equal(doc.containers['level-list'].children.length, 0, '无效数据不得渲染关卡项');
});
