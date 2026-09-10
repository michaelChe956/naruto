'use strict';

const fs = require('node:fs/promises');

const REQUIRED_LEVEL_COUNT = 5;
const LEVEL_KEYS = ['difficulty', 'enemies', 'id', 'name'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertValidLevel(item, index, seenIds) {
  const label = `第 ${index + 1} 项关卡`;
  if (!isPlainObject(item)) {
    throw new Error(`${label}必须是对象`);
  }
  const keys = Object.keys(item).sort();
  if (keys.join(',') !== LEVEL_KEYS.join(',')) {
    throw new Error(`${label}字段必须恰好为 ${LEVEL_KEYS.join('、')}`);
  }
  if (!Number.isInteger(item.id) || item.id < 1) {
    throw new Error(`${label}的 id 必须是正整数`);
  }
  if (seenIds.has(item.id)) {
    throw new Error(`${label}的 id ${item.id} 重复`);
  }
  if (!isNonEmptyString(item.name)) {
    throw new Error(`${label}的 name 必须是非空字符串`);
  }
  if (!Number.isInteger(item.difficulty) || item.difficulty < 1 || item.difficulty > 5) {
    throw new Error(`${label}的 difficulty 必须是 1~5 的整数`);
  }
  if (!Array.isArray(item.enemies) || item.enemies.length < 1 || !item.enemies.every(isNonEmptyString)) {
    throw new Error(`${label}的 enemies 必须是由非空字符串组成的至少一项数组`);
  }
}

function parseLevels(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('顶层数据必须是数组');
  }
  if (parsed.length !== REQUIRED_LEVEL_COUNT) {
    throw new Error(`关卡数量必须恰好为 ${REQUIRED_LEVEL_COUNT} 项，实际为 ${parsed.length} 项`);
  }
  const seenIds = new Set();
  parsed.forEach((item, index) => assertValidLevel(item, index, seenIds));
  return parsed
    .map((item) => ({
      id: item.id,
      name: item.name.trim(),
      difficulty: item.difficulty,
      enemies: item.enemies.map((enemy) => enemy.trim()),
    }))
    .sort((a, b) => a.id - b.id);
}

async function readLevels(dataPath) {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    return { ok: true, levels: parseLevels(raw) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = { readLevels };
