'use strict';

// 计数状态核心（REQ-009 / AC-007）。
//
// 语义契约：
//   - 初值恒为 0；
//   - increment() 是同步读改写，每次调用把读数恰好加 1，并返回新读数；
//   - 状态只存在于进程内存中，不做任何持久化，因此进程重启后必然回到 0。
//
// 不依赖任何第三方模块，也不触碰文件系统。

const INITIAL_COUNT = 0;

function createCountStore(initialCount = INITIAL_COUNT) {
  let count = initialCount;

  return {
    // 同步读：返回当前读数。
    getCount() {
      return count;
    },
    // 同步写：先读后写再加一，同一事件循环内不会被打断。
    increment() {
      count = count + 1;
      return count;
    },
  };
}

module.exports = { createCountStore, INITIAL_COUNT };
