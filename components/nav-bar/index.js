// components/nav-bar/index.js
// 统一导航：状态栏 + 胶囊对齐 + 返回
// v4 的目的不是"自绘更好看"，而是消除首页书眉与二级页原生导航的形态跳变。
const { getNavMetrics } = require('../../utils/ui')
const theme = require('../../utils/theme')
const navigation = require('../../utils/navigation')

Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: true },
    // 透明模式：压在头图上，不占位
    overlay: { type: Boolean, value: false },
    // 底部分隔线（浅色页面用）
    border: { type: Boolean, value: false },
    // 灶房等常暗页面：强制墨夜底色，不跟随日间主题
    board: { type: Boolean, value: false }
  },

  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    total: 64,
    theme: 'paper',
    reduce: false
  },

  attached() {
    const m = getNavMetrics()
    this.setData({
      statusBarHeight: m.statusBarHeight,
      navBarHeight: m.navBarHeight,
      total: m.statusBarHeight + m.navBarHeight,
      theme: theme.getTheme().key,
      reduce: theme.isReduceMotion()
    })
    this._off = theme.subscribe((key, reduce) => this.setData({ theme: key, reduce }))
  },

  detached() {
    if (this._off) this._off()
  },

  methods: {
    onBack() {
      // 统一防重；直接进入（扫码/分享）且只有一页时会回到首页。
      return navigation.navigateBack()
    }
  }
})
