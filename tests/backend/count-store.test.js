'use strict';

// 计数状态核心验收测试（TASK-002 / REQ-009 / AC-007）。
// 覆盖：初值 0、每次恰好 +1、同步读改写、无持久化（新实例回到 0）。

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { safeLoad } = require('./helpers');

const { createCountStore } = safeLoad(path.join(__dirname, '..', '..', 'server', 'count-store.js'));

function assertStoreContract() {
  assert.equal(
    typeof createCountStore,
    'function',
    'server/count-store.js 应导出 createCountStore()',
  );
}

describe('计数状态核心 count-store', () => {
  it('导出 createCountStore() 工厂', () => {
    assertStoreContract();
  });

  it('新实例的初值恒为 0', () => {
    assertStoreContract();
    const store = createCountStore();
    assert.equal(typeof store.getCount, 'function', 'store 应提供 getCount()');
    assert.equal(typeof store.increment, 'function', 'store 应提供 increment()');
    assert.equal(store.getCount(), 0);
  });

  it('每次 increment() 恰好把读数加 1，并同步返回新值', () => {
    assertStoreContract();
    const store = createCountStore();
    assert.equal(store.increment(), 1, '第 1 次递增应得到 1');
    assert.equal(store.increment(), 2, '第 2 次递增应得到 2');
    assert.equal(store.increment(), 3, '第 3 次递增应得到 3');
    assert.equal(store.getCount(), 3);
  });

  it('递增是同步读改写：连续 1000 次调用后读数精确等于 1000', () => {
    assertStoreContract();
    const store = createCountStore();
    for (let index = 0; index < 1000; index += 1) {
      store.increment();
    }
    assert.equal(store.getCount(), 1000);
  });

  it('不持久化也不跨实例共享：新实例总是从 0 重新开始', () => {
    assertStoreContract();
    const first = createCountStore();
    first.increment();
    first.increment();
    assert.equal(first.getCount(), 2);

    const second = createCountStore();
    assert.equal(second.getCount(), 0, '新实例不得继承任何已发生的计数');
  });
});
