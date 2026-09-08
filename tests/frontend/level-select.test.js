'use strict';

// tests/frontend/level-select.test.js — AC-007/AC-008 渲染行为验证
//
// 用最小 document 与 fetchImpl 替身驱动 web/level-select.js：
// - 成功路径：相对路径调用 /api/levels，逐项渲染名称与难度，
//   按 unlocked 呈现锁定不可选状态
// - 错误路径：网络失败、非 2xx、非法 JSON、非数组、字段非法
//   均在 error-message 展示可读错误且保留页面框架（不白屏）

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initLevelSelect } = require('../../web/level-select.js');
const {
  createDocument,
  createFetchImpl,
  createFetchImplWithBrokenJson,
  validLevelsPayload,
} = require('./helpers.js');

const CONTAINER_IDS = ['loading', 'level-list', 'error-message'];

/** 断言错误分支的公共结果：可读错误 + 页面框架保留 + loading 收起。 */
function assertErrorShown(document, list) {
  const loading = document.getElementById('loading');
  const errorBox = document.getElementById('error-message');
  assert.equal(loading.hidden, true, '出错后 loading 应隐藏');
  assert.equal(list.children.length, 0, '出错时不应渲染关卡项');
  assert.equal(errorBox.hidden, false, 'error-message 应可见');
  const message = typeof errorBox.textContent === 'string' ? errorBox.textContent.trim() : '';
  assert.ok(message.length > 0, 'error-message 应展示非空的可读错误');
  assert.ok(!message.includes('undefined') && !message.includes('[object'), `错误信息应可读，实际为 ${message}`);
  // 页面框架保留：三个容器仍可获取
  for (const id of CONTAINER_IDS) {
    assert.notEqual(document.getElementById(id), null, `容器 ${id} 应保留`);
  }
}

test('AC-007: 成功响应时以相对路径调用 /api/levels 且只调用一次', async () => {
  const document = createDocument(CONTAINER_IDS);
  const fetchImpl = createFetchImpl({ body: validLevelsPayload() });
  await initLevelSelect({ document, fetchImpl });
  assert.deepEqual(fetchImpl.calls, ['/api/levels'], '应以相对路径 /api/levels 调用一次');
});

test('AC-007: 满足 EXE-006 的五项数组逐项渲染名称与难度并按 unlocked 呈现锁定不可选', async () => {
  const document = createDocument(CONTAINER_IDS);
  const payload = validLevelsPayload();
  const fetchImpl = createFetchImpl({ body: payload });
  await initLevelSelect({ document, fetchImpl });

  const list = document.getElementById('level-list');
  assert.equal(list.children.length, 5, '应渲染 5 个关卡项');

  payload.forEach((level, index) => {
    const item = list.children[index];
    assert.ok(item.textContent.includes(level.name), `第 ${index + 1} 项应包含名称 ${level.name}`);
    assert.ok(item.textContent.includes(level.difficulty), `第 ${index + 1} 项应包含难度 ${level.difficulty}`);
    assert.equal(item.getAttribute('data-level-id'), level.id, '应以 data-level-id 标识关卡');
    if (level.unlocked) {
      assert.ok(item.className.includes('unlocked'), `已解锁关卡 ${level.id} 类名应含 unlocked`);
      assert.equal(item.getAttribute('aria-disabled'), null, `已解锁关卡 ${level.id} 不应为不可选状态`);
    } else {
      assert.ok(item.className.includes('locked'), `未解锁关卡 ${level.id} 类名应含 locked`);
      assert.equal(item.getAttribute('aria-disabled'), 'true', `未解锁关卡 ${level.id} 应呈现不可选状态`);
    }
  });

  assert.equal(document.getElementById('loading').hidden, true, '渲染完成后 loading 应隐藏');
  const errorBox = document.getElementById('error-message');
  assert.equal(errorBox.hidden, true, '成功时 error-message 应保持隐藏');
  assert.equal(errorBox.textContent, '', '成功时 error-message 应为空');
});

test('AC-008: fetchImpl 网络失败时在 error-message 展示可读错误并保留页面框架', async () => {
  const document = createDocument(CONTAINER_IDS);
  const list = document.getElementById('level-list');
  const fetchImpl = createFetchImpl({ rejectWith: new Error('network down') });
  await initLevelSelect({ document, fetchImpl });
  assertErrorShown(document, list);
});

test('AC-008: 非 2xx 响应（500 LEVEL_DATA_UNAVAILABLE）时展示可读错误并保留页面框架', async () => {
  const document = createDocument(CONTAINER_IDS);
  const list = document.getElementById('level-list');
  const fetchImpl = createFetchImpl({
    status: 500,
    body: { error: { code: 'LEVEL_DATA_UNAVAILABLE', message: '关卡数据不可用' } },
  });
  await initLevelSelect({ document, fetchImpl });
  assertErrorShown(document, list);
});

test('AC-008: JSON 解析失败时展示可读错误并保留页面框架', async () => {
  const document = createDocument(CONTAINER_IDS);
  const list = document.getElementById('level-list');
  const fetchImpl = createFetchImplWithBrokenJson();
  await initLevelSelect({ document, fetchImpl });
  assertErrorShown(document, list);
});

test('AC-008: 响应体非数组时展示可读错误并保留页面框架', async () => {
  const document = createDocument(CONTAINER_IDS);
  const list = document.getElementById('level-list');
  const fetchImpl = createFetchImpl({ body: { levels: [] } });
  await initLevelSelect({ document, fetchImpl });
  assertErrorShown(document, list);
});

// EXE-006 字段级约束逐项破坏：任一字段非法均视为非法响应
const invalidPayloadCases = [
  ['id 为空字符串', (item) => ({ ...item, id: '' })],
  ['name 为空字符串', (item) => ({ ...item, name: '' })],
  ['difficulty 非法取值', (item) => ({ ...item, difficulty: '地狱' })],
  ['unlocked 非布尔', (item) => ({ ...item, unlocked: 'yes' })],
  ['元素非对象', () => 'level-1'],
];

for (const [label, mutate] of invalidPayloadCases) {
  test(`AC-008: 字段非法响应（${label}）时展示可读错误并保留页面框架`, async () => {
    const document = createDocument(CONTAINER_IDS);
    const list = document.getElementById('level-list');
    const payload = validLevelsPayload().map((item, index) => (index === 0 ? mutate(item) : item));
    const fetchImpl = createFetchImpl({ body: payload });
    await initLevelSelect({ document, fetchImpl });
    assertErrorShown(document, list);
  });
}
