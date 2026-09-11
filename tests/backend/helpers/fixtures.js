'use strict';

// 测试自有 fixtures 夹具：写入临时目录，测试结束后自动清理，不触碰 web/**。
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function makeLevel(overrides = {}) {
  return {
    id: 'level-01',
    name: '木叶村演习场',
    difficulty: '简单',
    unlocked: true,
    ...overrides,
  };
}

// levels 传数组时序列化为 JSON，传字符串时原样写入（用于构造解析失败夹具）。
async function writeLevelsFixture(t, levels) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cadence-levels-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'levels.json');
  const content = typeof levels === 'string' ? levels : `${JSON.stringify(levels, null, 2)}\n`;
  await fs.writeFile(filePath, content, 'utf8');
  return filePath;
}

module.exports = { makeLevel, writeLevelsFixture };
