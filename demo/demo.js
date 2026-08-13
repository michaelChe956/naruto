/**
 * 演示页交互逻辑：通过相对路径引用真实库函数实现，
 * 提供输入校验、实时格式化展示，以及 7 条验收示例的通过性标注。
 */
import { formatCompactDuration } from '../src/formatCompactDuration.js';

export const INVALID_INPUT_MESSAGE = '无效输入';

// 7 条验收示例（对应后端 AC-001 ~ AC-007）
export const EXAMPLES = [
  { id: 'AC-001', input: 0, expected: '00:00' },
  { id: 'AC-002', input: 1, expected: '00:01' },
  { id: 'AC-003', input: 65, expected: '01:05' },
  { id: 'AC-004', input: 3599, expected: '59:59' },
  { id: 'AC-005', input: 3600, expected: '01:00:00' },
  { id: 'AC-006', input: 3661, expected: '01:01:01' },
  { id: 'AC-007', input: 86400, expected: '24:00:00' },
];

/**
 * 输入两级校验。
 * 词法校验：仅允许非空纯数字串（拒绝负数、小数、正号、空白等）。
 * 数值校验：必须为安全整数。
 *
 * @param {string} raw 原始输入字符串
 * @returns {{ok: boolean, value?: number, reason?: 'empty'|'invalid'}}
 */
export function validateSecondsInput(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    return { ok: false, reason: 'empty' };
  }
  if (!/^\d+$/.test(text)) {
    return { ok: false, reason: 'invalid' };
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, value };
}

/**
 * 将原始输入转换为展示文本：有效则格式化，无效则返回提示。
 * 空输入返回空字符串，不展示提示。
 *
 * @param {string} raw 原始输入字符串
 * @returns {{ok: boolean, display: string}}
 */
export function formatInput(raw) {
  const result = validateSecondsInput(raw);
  if (result.ok) {
    return { ok: true, display: formatCompactDuration(result.value) };
  }
  if (result.reason === 'empty') {
    return { ok: false, display: '' };
  }
  return { ok: false, display: INVALID_INPUT_MESSAGE };
}

/**
 * 数据驱动计算 7 条验收示例的通过性。
 *
 * @returns {Array<{id: string, input: number, expected: string, actual: string, passed: boolean}>}
 */
export function buildExampleResults() {
  return EXAMPLES.map(({ id, input, expected }) => {
    const actual = formatCompactDuration(input);
    return { id, input, expected, actual, passed: actual === expected };
  });
}

if (typeof document !== 'undefined') {
  const inputEl = document.querySelector('#seconds-input');
  const resultEl = document.querySelector('#result');
  const examplesEl = document.querySelector('#examples');

  const renderResult = () => {
    const { ok, display } = formatInput(inputEl.value);
    resultEl.textContent = display;
    resultEl.dataset.state = ok ? 'valid' : display === '' ? 'empty' : 'invalid';
  };

  const renderExamples = () => {
    for (const item of buildExampleResults()) {
      const li = document.createElement('li');
      li.dataset.passed = String(item.passed);
      li.textContent = `${item.id} · ${item.input} 秒 → ${item.actual}（期望 ${item.expected}）· ${item.passed ? '通过' : '失败'}`;
      examplesEl.appendChild(li);
    }
  };

  inputEl.addEventListener('input', renderResult);
  renderResult();
  renderExamples();
}
