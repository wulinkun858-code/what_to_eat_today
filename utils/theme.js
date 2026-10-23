// utils/theme.js
// ============================================================================
// 主题系统（两套：青瓷 / 墨黑；保留 ink 存储键）
// ----------------------------------------------------------------------------
// 设计约束：
//   1. 配色真源在 styles/tokens.wxss，JS 元信息用于原生窗口与转场取色；
//   2. 切换不做大面积颜色过渡，用 theme-reveal 的遮罩盖住切换瞬间；
//   3. 主题要同时作用于当前页 + 页面栈里的其他页 + 自定义 tabBar，
//      统一走 getCurrentPages() 广播 + 订阅。
// ============================================================================

const STORAGE_KEY = 'kk_theme'
const REDUCE_KEY = 'kk_reduce_motion'

// 旧主题 key → 现有 key；墨黑沿用 ink，已有偏好无需重新选择。
const LEGACY_KEYS = { sand: 'paper', gold: 'ink' }

// 元信息用于 UI 展示、原生窗口与转场取色，和 tokens.wxss 保持一致。
const THEMES = [
  {
    key: 'paper',
    name: '青瓷',
    desc: '晴山淡青',
    mode: 'light',
    bg: '#F3F5EE',
    bg2: '#E7EEE5',
    surface: '#FCFDF8',
    ink: '#203D35',
    accent: '#2E6558',
    swatch: ['#F3F5EE', '#2E6558']
  },
  {
    key: 'ink',
    name: '墨黑',
    desc: '柔黑暖灰',
    mode: 'dark',
    bg: '#181818',
    bg2: '#1E1E1E',
    surface: '#242424',
    ink: '#F0EDE6',
    accent: '#D8D1C4',
    swatch: ['#181818', '#D8D1C4']
  }
]

const { createEmitter } = require('./emitter')
const events = createEmitter()
let current = 'paper'
let reduceMotion = false

function findTheme(key) {
  return THEMES.find((t) => t.key === key) || THEMES[0]
}

function readStorage() {
  try {
    const saved = wx.getStorageSync(STORAGE_KEY)
    const key = LEGACY_KEYS[saved] || saved
    if (key && THEMES.some((t) => t.key === key)) current = key
    reduceMotion = !!wx.getStorageSync(REDUCE_KEY)
  } catch (e) {
    // 读取失败用默认值，不影响启动
  }
}

// 页面栈内所有页面一起换肤：返回时不会看到旧主题闪一下
function broadcast() {
  const pages = getCurrentPages()
  pages.forEach((page) => {
    try {
      page.setData({ theme: current, reduce: reduceMotion })
    } catch (e) {
      // 页面可能已销毁
    }
  })
  events.emit(current, reduceMotion)
}

// 原生导航栏 / 窗口底色跟随主题（自定义导航的页面此调用无副作用）
function syncNativeChrome(theme) {
  try {
    wx.setBackgroundColor({
      backgroundColor: theme.bg,
      backgroundColorTop: theme.bg,
      backgroundColorBottom: theme.bg
    })
  } catch (e) {}

  try {
    wx.setNavigationBarColor({
      frontColor: theme.mode === 'dark' ? '#ffffff' : '#000000',
      backgroundColor: theme.bg
    })
  } catch (e) {}
}

/**
 * 切换主题（即时生效，不含动画；动画由 theme-reveal 组件负责遮盖）
 * @param {string} key 主题 key
 */
function apply(key) {
  const theme = findTheme(key)
  if (theme.key === current) return theme
  current = theme.key
  try {
    wx.setStorageSync(STORAGE_KEY, current)
  } catch (e) {}
  syncNativeChrome(theme)
  broadcast()
  return theme
}

/**
 * 页面 onLoad / onShow 时同步一次主题
 * @param {object} page 页面实例（this）
 */
function sync(page) {
  if (!page || typeof page.setData !== 'function') return
  // 每次进入都补一次原生导航栏/窗口底色：
  // 从别的页面返回时，本页的导航栏是独立实例，必须重新着色
  syncNativeChrome(findTheme(current))
  if (page.data && page.data.theme === current && page.data.reduce === reduceMotion) return
  page.setData({ theme: current, reduce: reduceMotion })
}

/**
 * 下一套主题（两套主题直接来回切）
 */
function next() {
  const i = THEMES.findIndex((t) => t.key === current)
  return THEMES[(i + 1) % THEMES.length]
}

/**
 * 订阅主题变化（自定义 tabBar 等独立组件用）
 * @returns {function} 取消订阅
 */
function subscribe(fn) {
  return events.subscribe(fn)
}

function getTheme() {
  return findTheme(current)
}

function getThemes() {
  return THEMES
}

function isReduceMotion() {
  return reduceMotion
}

function setReduceMotion(on) {
  reduceMotion = !!on
  try {
    wx.setStorageSync(REDUCE_KEY, reduceMotion)
  } catch (e) {}
  broadcast()
}

/**
 * 圆形扩散半径：圆心到四个角的最远距离
 * 必须实算——写死 vmax 在长屏 / 折叠屏上会盖不满，四角留缝
 */
function revealRadius(x, y, w, h) {
  const dx = Math.max(x, w - x)
  const dy = Math.max(y, h - y)
  return Math.ceil(Math.sqrt(dx * dx + dy * dy)) + 8
}

module.exports = {
  THEMES,
  apply,
  sync,
  next,
  subscribe,
  getTheme,
  getThemes,
  isReduceMotion,
  setReduceMotion,
  revealRadius,
  init() {
    readStorage()
    syncNativeChrome(findTheme(current))
  }
}
