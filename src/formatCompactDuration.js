/**
 * 将总秒数格式化为紧凑时长字符串。
 * 小于 1 小时：MM:SS；大于等于 1 小时：HH:MM:SS。
 * 各分量不足两位时左侧补零。
 *
 * @param {number} seconds 非负整数秒数
 * @returns {string} 紧凑时长字符串
 */
const pad = (value) => String(value).padStart(2, '0');

export function formatCompactDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(minutes)}:${pad(secs)}`;
}
