// utils/format.js
// 展示格式化工具

/**
 * 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / MM-DD / YYYY-MM-DD
 * @param {Date|number|string} input 时间（云开发 Date 字段返回 Date 对象）
 * @returns {string}
 */
function formatRelative(input, now = Date.now()) {
  if (input === null || input === undefined || input === '') return ''
  const t = input instanceof Date ? input.getTime() :
    (typeof input === 'number' || /^\d+$/.test(input) ? Number(input) : Date.parse(input))
  if (!Number.isFinite(t)) return ''
  const diff = now - t
  const MIN = 60 * 1000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  if (diff < MIN) return '刚刚'
  if (diff < HOUR) return Math.floor(diff / MIN) + ' 分钟前'
  if (diff < DAY) return Math.floor(diff / HOUR) + ' 小时前'
  if (diff < 2 * DAY) return '昨天'
  const d = new Date(t)
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  const md = pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  return d.getFullYear() === new Date(now).getFullYear() ? md : d.getFullYear() + '-' + md
}

module.exports = { formatRelative }
