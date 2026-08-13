import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatCompactDuration } from '../src/formatCompactDuration.js';

test('AC-001: 0 秒格式化为 00:00', () => {
  assert.equal(formatCompactDuration(0), '00:00');
});

test('AC-002: 1 秒格式化为 00:01', () => {
  assert.equal(formatCompactDuration(1), '00:01');
});

test('AC-003: 65 秒格式化为 01:05', () => {
  assert.equal(formatCompactDuration(65), '01:05');
});

test('AC-004: 3599 秒格式化为 59:59', () => {
  assert.equal(formatCompactDuration(3599), '59:59');
});

test('AC-005: 3600 秒格式化为 01:00:00', () => {
  assert.equal(formatCompactDuration(3600), '01:00:00');
});

test('AC-006: 3661 秒格式化为 01:01:01', () => {
  assert.equal(formatCompactDuration(3661), '01:01:01');
});

test('AC-007: 86400 秒格式化为 24:00:00', () => {
  assert.equal(formatCompactDuration(86400), '24:00:00');
});
