'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const { initLevelSelect, CONTAINER_IDS } = require('../../web/level-select.js');

const WEB_ROOT = path.resolve(__dirname, '..', '..', 'web');
const LEVELS_FIXTURE = [
  { id: 'level-1', name: '木叶村大门', difficulty: 'easy', unlocked: true },
  { id: 'level-3', name: '死亡森林追击', difficulty: 'normal', unlocked: false },
];
const CONTAINER_IDS_EXPECTED = ['level-loading', 'level-list', 'level-error'];

function createElementDouble(tagName) {
  return {
    tagName,
    textContent: '',
    className: '',
    hidden: false,
    disabled: false,
    children: [],
    attributes: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
  };
}

function createDocumentDouble({ omit = [] } = {}) {
  const byId = new Map();
  const containerIds = CONTAINER_IDS_EXPECTED.filter((id) => !omit.includes(id));
  containerIds.forEach((id) => byId.set(id, createElementDouble('div')));
  return {
    byId,
    document: {
      getElementById: (id) => byId.get(id) || null,
      createElement: (tag) => createElementDouble(tag),
    },
  };
}

function createResponseDouble({ ok = true, status = 200, payload = [], jsonError = null } = {}) {
  return {
    ok,
    status,
    json: async () => {
      if (jsonError) {
        throw jsonError;
      }
      return payload;
    },
  };
}

function createFetchDouble(behavior) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return behavior();
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('AC-008 web/index.html 提供三个容器标记并引入 level-select.js 启动脚本', async () => {
  const html = await readFile(path.join(WEB_ROOT, 'index.html'), 'utf8');
  CONTAINER_IDS_EXPECTED.forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `index.html 应包含容器标记 id="${id}"`);
  });
  assert.match(html, /<script\s+src="\/level-select\.js"><\/script>/, '应以相对路径引入 level-select.js');
  assert.match(html, /initLevelSelect/, '应调用 initLevelSelect 启动关卡选择');
  assert.equal(CONTAINER_IDS.loading, 'level-loading');
  assert.equal(CONTAINER_IDS.list, 'level-list');
  assert.equal(CONTAINER_IDS.error, 'level-error');
});

test('AC-009 有效数据时先展示加载状态，完成后渲染名称与难度并隐藏加载与错误容器', async () => {
  const { document, byId } = createDocumentDouble();
  const pending = {};
  const fetchImpl = createFetchDouble(
    () =>
      new Promise((resolve) => {
        pending.resolve = resolve;
      })
  );

  const initPromise = initLevelSelect({ document, fetchImpl });
  assert.equal(fetchImpl.calls[0], '/api/levels', '应以相对路径 /api/levels 请求关卡数据');
  assert.equal(byId.get('level-loading').hidden, false, '等待响应期间应展示加载状态');
  assert.equal(byId.get('level-error').hidden, true, '等待响应期间错误容器应保持隐藏');

  pending.resolve(createResponseDouble({ payload: LEVELS_FIXTURE }));
  const result = await initPromise;

  assert.deepEqual(result, { ok: true, total: 2 });
  assert.equal(byId.get('level-loading').hidden, true, '完成后应隐藏加载状态');
  assert.equal(byId.get('level-error').hidden, true, '成功时错误容器应保持隐藏');
  const list = byId.get('level-list');
  assert.equal(list.hidden, false, '完成后应展示关卡列表');
  assert.equal(list.children.length, 2, '应渲染 2 个关卡条目');

  const first = list.children[0];
  assert.equal(first.children[0].textContent, '木叶村大门', '应渲染关卡名称');
  assert.equal(first.children[1].textContent, '简单', '应渲染可读难度文案');
  assert.equal(first.children[1].attributes['data-difficulty'], 'easy', '应保留原始难度标记');
  const second = list.children[1];
  assert.equal(second.children[0].textContent, '死亡森林追击', '应渲染第二项关卡名称');
  assert.equal(second.children[1].textContent, '普通', '应渲染第二项可读难度文案');
});

test('AC-009 unlocked 为 false 的关卡呈现为锁定且不可选，解锁关卡保持可选', () => {
  const { document, byId } = createDocumentDouble();
  const fetchImpl = createFetchDouble(() =>
    createResponseDouble({ payload: LEVELS_FIXTURE })
  );

  return initLevelSelect({ document, fetchImpl }).then(() => {
    const list = byId.get('level-list');
    const unlockedItem = list.children[0];
    const lockedItem = list.children[1];

    assert.equal(unlockedItem.disabled, false, '解锁关卡按钮应保持可选');
    assert.equal(unlockedItem.attributes['aria-disabled'], undefined);
    assert.ok(!unlockedItem.className.includes('level-item--locked'), '解锁关卡不应带锁定样式');

    assert.equal(lockedItem.disabled, true, '锁定关卡应不可选');
    assert.equal(lockedItem.attributes['aria-disabled'], 'true', '锁定关卡应带 aria-disabled');
    assert.ok(
      lockedItem.className.includes('level-item--locked'),
      '锁定关卡应带锁定样式类'
    );
  });
});

test('AC-010 请求失败（fetch 拒绝）时展示可读错误并保留页面框架', async () => {
  const { document, byId } = createDocumentDouble();
  const fetchImpl = createFetchDouble(() => {
    throw new Error('network down');
  });

  const result = await initLevelSelect({ document, fetchImpl });

  assert.equal(result.ok, false, '请求失败时应返回失败结果');
  const errorBox = byId.get('level-error');
  assert.equal(errorBox.hidden, false, '失败时应展示错误容器');
  assert.ok(errorBox.textContent.includes('关卡'), '错误提示应与关卡相关且可读');
  assert.ok(errorBox.textContent.trim().length > 0, '错误提示不应为空');
  assert.equal(byId.get('level-loading').hidden, true, '失败后应隐藏加载状态');
  const list = byId.get('level-list');
  assert.equal(list.children.length, 0, '失败时不应渲染关卡条目');
  CONTAINER_IDS_EXPECTED.forEach((id) => {
    assert.ok(byId.get(id), `页面框架应保留容器 ${id} 不白屏`);
  });
});

test('AC-010 非成功状态（HTTP 500）时进入错误提示分支', async () => {
  const { document, byId } = createDocumentDouble();
  const fetchImpl = createFetchDouble(() =>
    createResponseDouble({ ok: false, status: 500, payload: { code: 'LEVEL_DATA_UNAVAILABLE' } })
  );

  const result = await initLevelSelect({ document, fetchImpl });

  assert.equal(result.ok, false);
  const errorBox = byId.get('level-error');
  assert.equal(errorBox.hidden, false, '非成功状态应展示错误容器');
  assert.ok(errorBox.textContent.includes('500'), '错误提示应包含状态码便于阅读');
  assert.equal(byId.get('level-loading').hidden, true);
  assert.equal(byId.get('level-list').children.length, 0);
});

test('AC-010 响应结构无效时进入错误提示分支', async () => {
  const { document, byId } = createDocumentDouble();
  const fetchImpl = createFetchDouble(() =>
    createResponseDouble({ payload: { code: 'not-an-array' } })
  );

  const result = await initLevelSelect({ document, fetchImpl });

  assert.equal(result.ok, false);
  const errorBox = byId.get('level-error');
  assert.equal(errorBox.hidden, false, '结构无效应展示错误容器');
  assert.ok(errorBox.textContent.length > 0, '结构无效应展示可读提示');
  assert.equal(byId.get('level-loading').hidden, true);
  assert.equal(byId.get('level-list').children.length, 0);
});

test('AC-010 响应 JSON 解析失败时进入错误提示分支', async () => {
  const { document, byId } = createDocumentDouble();
  const fetchImpl = createFetchDouble(() =>
    createResponseDouble({ jsonError: new SyntaxError('Unexpected token') })
  );

  const result = await initLevelSelect({ document, fetchImpl });

  assert.equal(result.ok, false);
  const errorBox = byId.get('level-error');
  assert.equal(errorBox.hidden, false, '解析失败应展示错误容器');
  assert.ok(errorBox.textContent.length > 0, '解析失败应展示可读提示');
  assert.equal(byId.get('level-loading').hidden, true);
});

test('AC-008 页面缺少容器标记时给出明确错误', async () => {
  const { document } = createDocumentDouble({ omit: ['level-error'] });
  const fetchImpl = createFetchDouble(() => createResponseDouble({ payload: [] }));

  await assert.rejects(
    initLevelSelect({ document, fetchImpl }),
    /容器/,
    '缺少容器标记应抛出明确错误'
  );
});
