'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const WEB_DIR = path.join(REPO_ROOT, 'web');

const VALID_LEVELS = [
  { id: 'level-01', name: '波之国护送任务', difficulty: '简单', unlocked: true },
  { id: 'level-02', name: '中忍考试预选赛', difficulty: '普通', unlocked: true },
  { id: 'level-03', name: '寻找纲手之旅', difficulty: '困难', unlocked: true },
  { id: 'level-04', name: '终结之谷对决', difficulty: '普通', unlocked: false },
  { id: 'level-05', name: '佩恩袭击木叶', difficulty: '困难', unlocked: false },
];

// ---------- 最小 DOM 替身 ----------

function createFakeText(text) {
  return { nodeType: 3, textContent: String(text) };
}

function createFakeElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    children: [],
    attributes: {},
    className: '',
    disabled: false,
    hidden: false,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function createFakeDocument() {
  const containers = {
    loading: createFakeElement('div'),
    'level-list': createFakeElement('ul'),
    'error-message': createFakeElement('div'),
  };
  return {
    containers,
    getElementById(id) {
      return Object.prototype.hasOwnProperty.call(containers, id) ? containers[id] : null;
    },
    createElement(tagName) {
      return createFakeElement(tagName);
    },
    createTextNode(text) {
      return createFakeText(text);
    },
  };
}

function makeOkResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

function collectText(el) {
  if (el.nodeType === 3) {
    return el.textContent;
  }
  return el.children.map(collectText).join('');
}

function findDescendants(el, tagName) {
  const found = [];
  for (const child of el.children) {
    if (child.nodeType === 1) {
      if (child.tagName === tagName.toUpperCase()) {
        found.push(child);
      }
      found.push(...findDescendants(child, tagName));
    }
  }
  return found;
}

// ---------- 正常渲染（TASK-008 / AC-007）----------

describe('关卡选择页正常渲染', () => {
  test('加载期间展示加载态并隐藏列表与错误容器', async () => {
    const { initLevelSelect } = require('../../web/level-select.js');
    const fakeDocument = createFakeDocument();
    let resolveFetch;
    const pendingResponse = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    const done = initLevelSelect({
      document: fakeDocument,
      fetchImpl: () => pendingResponse,
    });

    assert.equal(fakeDocument.containers.loading.hidden, false, '加载中应展示加载态');
    assert.equal(fakeDocument.containers['level-list'].hidden, true, '加载中应隐藏关卡列表');
    assert.equal(fakeDocument.containers['error-message'].hidden, true, '加载中应隐藏错误容器');

    resolveFetch(makeOkResponse(JSON.stringify(VALID_LEVELS)));
    await done;

    assert.equal(fakeDocument.containers.loading.hidden, true, '渲染后应隐藏加载态');
  });

  test('加载成功后经相对路径 /api/levels 渲染 5 项名称与难度', async () => {
    const { initLevelSelect } = require('../../web/level-select.js');
    const fakeDocument = createFakeDocument();
    const requestedUrls = [];
    const fetchImpl = (url) => {
      requestedUrls.push(url);
      return Promise.resolve(makeOkResponse(JSON.stringify(VALID_LEVELS)));
    };

    await initLevelSelect({ document: fakeDocument, fetchImpl });

    assert.deepEqual(requestedUrls, ['/api/levels'], '必须经相对路径 /api/levels 获取数据');

    const listEl = fakeDocument.containers['level-list'];
    const items = findDescendants(listEl, 'li');
    assert.equal(items.length, 5, '应渲染 5 个关卡项');

    const renderedTexts = items.map((item) => collectText(item));
    VALID_LEVELS.forEach((level) => {
      const matched = renderedTexts.filter((text) => text.includes(level.name));
      assert.equal(matched.length, 1, `应渲染关卡名称: ${level.name}`);
      assert.match(matched[0], new RegExp(level.difficulty), `应渲染难度: ${level.difficulty}`);
    });
  });

  test('unlocked=false 的关卡呈锁定不可选，unlocked=true 可选', async () => {
    const { initLevelSelect } = require('../../web/level-select.js');
    const fakeDocument = createFakeDocument();
    const fetchImpl = () => Promise.resolve(makeOkResponse(JSON.stringify(VALID_LEVELS)));

    await initLevelSelect({ document: fakeDocument, fetchImpl });

    const items = findDescendants(fakeDocument.containers['level-list'], 'li');
    assert.equal(items.length, 5);

    VALID_LEVELS.forEach((level, index) => {
      const buttons = findDescendants(items[index], 'button');
      assert.equal(buttons.length, 1, `关卡 ${level.id} 应提供可选择入口`);
      assert.equal(
        buttons[0].disabled,
        !level.unlocked,
        `关卡 ${level.id}（unlocked=${level.unlocked}）锁定状态应一致`
      );
    });
  });
});

// ---------- 错误分支（TASK-010 / AC-008）----------

describe('关卡选择页错误分支', () => {
  function assertPageFramePreserved(fakeDocument) {
    assert.equal(fakeDocument.containers.loading.hidden, true, '错误时应隐藏加载态');
    assert.equal(fakeDocument.containers['level-list'].hidden, true, '错误时应保持列表隐藏');
    assert.equal(
      fakeDocument.containers['level-list'].children.length,
      0,
      '错误时不应渲染任何关卡'
    );
    assert.equal(
      fakeDocument.containers['error-message'].hidden,
      false,
      '错误容器应展示'
    );
    const errorText = collectText(fakeDocument.containers['error-message']);
    assert.notEqual(errorText.trim(), '', '错误提示应为可读文本');
  }

  test('fetchImpl 模拟网络失败时保留页面框架并展示可读错误', async () => {
    const { initLevelSelect } = require('../../web/level-select.js');
    const fakeDocument = createFakeDocument();
    const fetchImpl = () => Promise.reject(new Error('network down'));

    await initLevelSelect({ document: fakeDocument, fetchImpl });

    assertPageFramePreserved(fakeDocument);
    const errorText = collectText(fakeDocument.containers['error-message']);
    assert.doesNotMatch(errorText, /network down/, '错误提示不应透传内部异常细节');
  });

  test('fetchImpl 模拟非成功状态时保留页面框架并展示可读错误', async () => {
    const { initLevelSelect } = require('../../web/level-select.js');
    const fakeDocument = createFakeDocument();
    const fetchImpl = () =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: async () =>
          JSON.stringify({ error: { code: 'LEVEL_DATA_UNAVAILABLE', message: '关卡数据暂不可用，请稍后重试' } }),
      });

    await initLevelSelect({ document: fakeDocument, fetchImpl });

    assertPageFramePreserved(fakeDocument);
  });

  test('结构无效响应（非数组、长度不符、字段不合规）时展示可读错误', async () => {
    const { initLevelSelect } = require('../../web/level-select.js');
    const invalidBodies = [
      JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'not a list' } }),
      JSON.stringify(VALID_LEVELS.slice(0, 4)),
      JSON.stringify([
        ...VALID_LEVELS.slice(0, 4),
        { id: 'level-05', name: '佩恩袭击木叶', difficulty: '地狱', unlocked: false },
      ]),
      JSON.stringify([
        ...VALID_LEVELS.slice(0, 4),
        { id: 'level-01', name: '重复 id', difficulty: '简单', unlocked: true },
      ]),
      JSON.stringify([
        ...VALID_LEVELS.slice(0, 4),
        { id: 'level-05', name: '佩恩袭击木叶', difficulty: '困难', unlocked: 'yes' },
      ]),
    ];

    for (const body of invalidBodies) {
      const fakeDocument = createFakeDocument();
      const fetchImpl = () => Promise.resolve(makeOkResponse(body));

      await initLevelSelect({ document: fakeDocument, fetchImpl });

      assertPageFramePreserved(fakeDocument);
    }
  });

  test('错误提示保持可读且不含内部实现细节', async () => {
    const { initLevelSelect } = require('../../web/level-select.js');
    const fakeDocument = createFakeDocument();
    const fetchImpl = () => Promise.reject(new Error('ECONNREFUSED'));

    await initLevelSelect({ document: fakeDocument, fetchImpl });

    const errorText = collectText(fakeDocument.containers['error-message']);
    assert.doesNotMatch(errorText, /Error|at\s|ECONNREFUSED|\//, '错误提示不应包含堆栈、异常名或路径');
  });
});

// ---------- 页面产物标记（TASK-009 / AC-009）----------

describe('页面产物标记', () => {
  const indexHtmlPath = path.join(WEB_DIR, 'index.html');

  test('web/index.html 提供三容器标记与 level-select.js 脚本引用', () => {
    assert.equal(fs.existsSync(indexHtmlPath), true, 'web/index.html 应存在');
    const html = fs.readFileSync(indexHtmlPath, 'utf8');

    for (const containerId of ['loading', 'level-list', 'error-message']) {
      assert.match(html, new RegExp(`id="${containerId}"`), `应包含容器 id=${containerId}`);
    }
    assert.match(html, /<script[^>]*src="level-select\.js"/, '应引用 web/level-select.js');
  });
});
