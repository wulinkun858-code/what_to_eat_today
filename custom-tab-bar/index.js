// custom-tab-bar/index.js
// 底部 Dock：书签导航 + 常驻点菜单入口（单层，取代原先 tab / cart / FAB 三层叠压）
// v4：购物车数量走订阅，页面不再需要向 tabBar setData 传值
const theme = require('../utils/theme')
const haptic = require('../utils/haptic')
const cart = require('../utils/cart')
const navigation = require('../utils/navigation')

Component({
  data: {
    selected: 0,
    theme: 'paper',
    reduce: false,
    cartCount: 0,
    list: [
      { pagePath: '/pages/list/list', text: '寻味' },
      { pagePath: '/pages/comments/comments', text: '食话' },
      { pagePath: '/pages/my/my', text: '小院' }
    ]
  },

  attached() {
    this.setData({
      theme: theme.getTheme().key,
      reduce: theme.isReduceMotion(),
      cartCount: cart.count()
    })
    this.syncSelected()
    this._offTheme = theme.subscribe((key, reduce) => this.setData({ theme: key, reduce }))
    this._offCart = cart.subscribe((count) => this.setData({ cartCount: count }))
  },

  detached() {
    if (this._offTheme) this._offTheme()
    if (this._offCart) this._offCart()
  },

  pageLifetimes: {
    show() {
      this.syncSelected()
    }
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      if (!current) return
      const selected = this.data.list.findIndex((item) => item.pagePath.slice(1) === current.route)
      if (selected >= 0 && selected !== this.data.selected) this.setData({ selected })
    },

    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      if (index === this.data.selected) {
        haptic.light()
        return
      }
      haptic.light()
      return navigation.switchTab({ url: path })
    },

    // 空点菜单不跳转，避免落到一个只能返回的空页面
    goCart() {
      if (!this.data.cartCount) return
      haptic.light()
      return navigation.navigateTo({ url: '/pages/order-confirm/order-confirm' })
    }
  }
})
