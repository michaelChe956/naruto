'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEVEL_DATA_ERROR_CODE = 'LEVEL_DATA_UNAVAILABLE';
const REQUIRED_LEVEL_COUNT = 5;
const VALID_DIFFICULTIES = ['简单', '普通', '困难'];

class LevelDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LevelDataError';
    this.code = LEVEL_DATA_ERROR_CODE;
  }
}

function loadLevels(dataPath) {
  let raw;
  try {
    raw = fs.readFileSync(dataPath, 'utf8');
  } catch (error) {
    throw new LevelDataError(`无法读取关卡数据文件：${path.resolve(String(dataPath))}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new LevelDataError('关卡数据文件不是可解析的 JSON');
  }

  validateLevels(parsed);
  return parsed;
}

function validateLevels(levels) {
  if (!Array.isArray(levels)) {
    throw new LevelDataError('关卡数据顶层必须是数组');
  }
  if (levels.length !== REQUIRED_LEVEL_COUNT) {
    throw new LevelDataError(`关卡数据必须恰为 ${REQUIRED_LEVEL_COUNT} 项，实际为 ${levels.length} 项`);
  }

  const seenIds = new Set();
  levels.forEach((record, index) => {
    const label = `第 ${index + 1} 项关卡记录`;

    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      throw new LevelDataError(`${label}必须是对象`);
    }
    if (typeof record.id !== 'string' || record.id.length === 0) {
      throw new LevelDataError(`${label}的 id 必须是非空字符串`);
    }
    if (seenIds.has(record.id)) {
      throw new LevelDataError(`${label}的 id「${record.id}」在文件内重复`);
    }
    seenIds.add(record.id);
    if (typeof record.name !== 'string' || record.name.length === 0) {
      throw new LevelDataError(`${label}的 name 必须是非空字符串`);
    }
    if (!VALID_DIFFICULTIES.includes(record.difficulty)) {
      throw new LevelDataError(`${label}的 difficulty 必须是 ${VALID_DIFFICULTIES.join('、')} 之一`);
    }
    if (typeof record.unlocked !== 'boolean') {
      throw new LevelDataError(`${label}的 unlocked 必须是布尔值`);
    }
  });
}

module.exports = {
  loadLevels,
  validateLevels,
  LevelDataError,
  LEVEL_DATA_ERROR_CODE,
  REQUIRED_LEVEL_COUNT,
  VALID_DIFFICULTIES,
};
