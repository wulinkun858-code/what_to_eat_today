// utils/tokenizer.js
// 搜索分词器：为 dishes.searchTokens 倒排字段生产词元
// 规则：CJK 连续串按一元+二元（bigram）切分，西文/数字按整词，统一小写、去重
// 查询与索引用同一套分词，保证「词元等值 AND」≈ 子串匹配（ES 倒排索引思路的文档库实现）
const CJK_RUN_RE = /[\u3400-\u4dbf\u4e00-\u9fa5\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/g
const WORD_RE = /[a-z0-9]+/g

/**
 * 提取单段文本的词元，写入 set
 * @param {string} text 原始文本（内部转小写）
 * @param {Set<string>} set 词元集合
 */
function extractTokens(text, set) {
  const s = typeof text === 'string' ? text.toLowerCase() : ''
  if (!s) return
  const cjkRuns = s.match(CJK_RUN_RE) || []
  cjkRuns.forEach((run) => {
    for (let i = 0; i < run.length; i++) {
      set.add(run[i]) // 一元：支持单字搜索
      if (i + 1 < run.length) set.add(run.slice(i, i + 2)) // 二元：保证连续性
    }
  })
  const words = s.match(WORD_RE) || []
  words.forEach((word) => set.add(word)) // 西文/数字整词
}

/**
 * 构建倒排词元数组（去重）
 * @param {Array<string|string[]>} parts 参与搜索的字段（字符串或字符串数组，缺省跳过）
 * @returns {string[]} 词元数组
 */
function buildSearchTokens(parts) {
  const set = new Set()
  function add(value) {
    if (Array.isArray(value)) {
      value.forEach(add)
    } else {
      extractTokens(value, set)
    }
  }
  const values = Array.isArray(parts) ? parts : []
  values.forEach(add)
  return Array.from(set)
}

module.exports = { buildSearchTokens }
