'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initLevelSelect } = require('../../web/level-select');

const LEVEL_DIFFICULTIES = new Set(['简单', '普通', '困难']);

function createDocument() {
  const loading = {
    tagName: 'DIV',
    id: 'loading',
    textContent: '',
    hidden: false,
  };
  const levelList = {
    tagName: 'UL',
    id: 'level-list',
    children: [],
    appendChild(child) {
      this.children.push(child);
    }
  };
  const errorMessage = {
    tagName: 'DIV',
    id: 'error-message',
    textContent: '',
    hidden: false
  };
  const elements = new Map([
    ['loading', loading],
    ['level-list', levelList],
    ['error-message', errorMessage]
  ]);

  return {
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        textContent: '',
        className: '',
        disabled: false,
        children: [],
        appendChild(child) {
          this.children.push(child);
        }
      };
    },
    __elements: { loading, levelList, errorMessage }
  };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function validLevels() {
  return [
    { id: 'opening', name: '波之国突围', difficulty: '简单', unlocked: true },
    { id: 'defense', name: '木叶保卫战', difficulty: '普通', unlocked: true },
    { id: 'exam', name: '中忍考试', difficulty: '困难', unlocked: false },
    { id: 'pursuit', name: '晓之追击', difficulty: '困难', unlocked: false },
    { id: 'valley', name: '终末之谷', difficulty: '困难', unlocked: false }
  ];
}

describe('initLevelSelect rendering', () => {
  it('shows loading first, then renders five levels and makes locked levels unselectable', async () => {
    const document = createDocument();
    let resolveFetch;
    const fetchImpl = () => new Promise((resolve) => {
      resolveFetch = () => resolve(jsonResponse(validLevels()));
    });
    const initialized = initLevelSelect({ document, fetchImpl });

    assert.equal(document.__elements.loading.hidden, false);
    assert.equal(document.__elements.errorMessage.textContent, '');
    assert.equal(document.__elements.levelList.children.length, 0);

    resolveFetch();
    await initialized;

    const items = document.__elements.levelList.children;
    assert.equal(document.__elements.loading.hidden, true);
    assert.equal(document.__elements.errorMessage.hidden, false);
    assert.equal(document.__elements.errorMessage.textContent, '');
    assert.equal(items.length, 5);
    validLevels().forEach((level, index) => {
      const item = items[index];
      assert.equal(item.className.includes('level-item'), true);
      assert.equal(item.className.includes('locked'), !level.unlocked);
      assert.equal(item.children.length, 1);
      assert.equal(item.children[0].tagName, 'BUTTON');
      assert.equal(item.children[0].type, 'button');
      assert.equal(item.children[0].textContent.includes(level.name), true);
      assert.equal(item.children[0].textContent.includes(level.difficulty), true);
      assert.equal(item.children[0].disabled, !level.unlocked);
    });
  });
});

describe('browser startup', () => {
  it('requests levels with the global document and fetch when the script loads', async () => {
    const document = createDocument();
    const requestedUrls = [];
    const fetchImpl = async (url) => {
      requestedUrls.push(url);
      return jsonResponse(validLevels());
    };
    const previousDocument = global.document;
    const previousFetch = global.fetch;
    const modulePath = require.resolve('../../web/level-select');
    delete require.cache[modulePath];

    global.document = document;
    global.fetch = fetchImpl;
    try {
      require(modulePath);
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(requestedUrls, ['/api/levels']);
      assert.equal(document.__elements.levelList.children.length, 5);
    } finally {
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
      if (previousFetch === undefined) delete global.fetch;
      else global.fetch = previousFetch;
      delete require.cache[modulePath];
      require(modulePath);
    }
  });
});

describe('initLevelSelect error handling', () => {
  it('keeps page containers and shows a readable message when the request fails', async () => {
    const document = createDocument();
    const fetchImpl = async () => {
      throw new TypeError('network failed');
    };

    await initLevelSelect({ document, fetchImpl });

    assert.equal(document.__elements.loading.hidden, true);
    assert.equal(document.__elements.levelList.children.length, 0);
    assert.equal(document.__elements.errorMessage.hidden, false);
    assert.ok(document.__elements.errorMessage.textContent.length > 0);
  });

  it('keeps page containers and shows a readable message for a non-200 response', async () => {
    const document = createDocument();
    const fetchImpl = async () => jsonResponse({ error: { code: 'SERVER_ERROR', message: '服务不可用' } }, 500);

    await initLevelSelect({ document, fetchImpl });

    assert.equal(document.__elements.loading.hidden, true);
    assert.equal(document.__elements.levelList.children.length, 0);
    assert.equal(document.__elements.errorMessage.hidden, false);
    assert.ok(document.__elements.errorMessage.textContent.length > 0);
  });

  it('keeps page containers and shows a readable message when level fields violate the contract', async () => {
    const document = createDocument();
    const invalidLevels = validLevels().map((level, index) => (
      index === 2 ? { ...level, unlocked: 'no' } : level
    ));
    const fetchImpl = async () => jsonResponse(invalidLevels);

    await initLevelSelect({ document, fetchImpl });

    assert.equal(document.__elements.loading.hidden, true);
    assert.equal(document.__elements.levelList.children.length, 0);
    assert.equal(document.__elements.errorMessage.hidden, false);
    assert.ok(document.__elements.errorMessage.textContent.length > 0);
  });
});

describe('page skeleton', () => {
  it('defines all required containers and loads the level select script', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');

    assert.match(html, /id=["']loading["']/);
    assert.match(html, /id=["']level-list["']/);
    assert.match(html, /id=["']error-message["']/);
    assert.match(html, /<script\s+src=["']level-select\.js["']/);
  });
});
