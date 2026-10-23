const navigation = require('../../utils/navigation')
const { definePage } = require('../../utils/page')
// pages/my/my.js
// 我的：资料卡（头像/昵称，经云函数保存）、统计、按角色差异化的功能入口
// 食客：我的订单；厨师：+ 厨师工作台（未读红点）；管理员：+ 用户管理/全部订单
const dbService = require('../../utils/db')
const role = require('../../utils/role')
const biz = require('../../utils/biz')
const theme = require('../../utils/theme')
const haptic = require('../../utils/haptic')
const { getNavMetrics } = require('../../utils/ui')

const NICKNAME_MAX_LENGTH = 20 // 昵称上限

Page(definePage({
  data: {
    theme: 'paper', // 当前主题
    reduce: false, // 减弱动效
    nickname: '', // 昵称（空则显示默认占位）
    dishCount: 0, // 菜品总数（全局菜单）
    tagCount: 0, // 标签总数
    avatarFileID: '', // 自定义头像（空则显示默认渐变占位）
    avatarUploading: false, // 头像上传中
    roleLabel: '食客', // 角色徽章
    unreadCount: 0, // 厨师消息未读数
    canManage: false, // 厨师/管理员
    isAdmin: false,
    statusBarHeight: 20, // 自定义导航下的状态栏占位
    menu: [] // 按角色动态生成
  },

  onLoad() {
    this.setData({ statusBarHeight: getNavMetrics().statusBarHeight })
  },

  onShow() {
    this._hidden = false
    // 同步自定义 tabBar 选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    // 登记并刷新身份，随后按角色渲染菜单
    role.ensureProfile().then(() => this.applyRole())
    this.refreshStats()
  },

  // ===== 主题 =====

  // 两套主题直接来回切：圆形从手指位置铺开，遮罩盖住时换肤
  onThemeToggle(e) {
    const { x, y } = e.detail
    const target = theme.next()
    haptic.light()
    const reveal = this.selectComponent('#reveal')
    if (!reveal) {
      theme.apply(target.key)
      return
    }
    reveal.play({
      x,
      y,
      key: target.key
    })
  },

  // 减弱动效：立即生效，不做扩散
  onReduceToggle() {
    haptic.light()
    const reduce = !this.data.reduce
    theme.setReduceMotion(reduce)
    if (reduce) {
      clearInterval(this._countTimer)
      this._countTimer = null
      if (this._countTarget) this.setData(this._countTarget)
    }
  },

  // 按角色生成功能入口
  applyRole() {
    const profile = role.getProfile() || {}
    const canManage = role.isChef()
    const isAdmin = role.isAdmin()
    const menu = [{ key: 'orders', text: '我的食单', desc: '报餐单与制作状态' }]
    if (canManage) {
      menu.push({ key: 'kitchen', text: '灶房', desc: '飞帖与在灶单', badge: this.data.unreadCount })
    }
    if (isAdmin) {
      menu.push({ key: 'categories', text: '菜牌分类', desc: '定义菜单的菜品品类' })
      menu.push({ key: 'users', text: '伙计名册', desc: '查看所有用户并授权角色' })
      menu.push({ key: 'adminOrders', text: '账房', desc: '所有食客的报餐单' })
    }
    menu.push({ key: 'banner', text: '海报墙', desc: '首页顶部轮播图片' })
    this.setData({
      nickname: profile.nickname || '',
      avatarFileID: profile.avatarFileID || '',
      roleLabel: role.roleLabel(profile.role),
      canManage,
      isAdmin,
      menu
    })
    if (canManage) this.refreshUnread()
  },

  // 刷新统计数字（每次进入都拉最新），数字用 easeOutCubic 滚上去
  refreshStats() {
    dbService.getStats().then((stats) => {
      this.animateCount({
        dishCount: stats.dishCount || 0,
        tagCount: stats.tagCount || 0
      })
    }).catch(() => {
      // 统计失败保持旧值，不阻塞页面
    })
  },

  // 数字滚动：600ms 内从旧值过渡到新值，节流到 32ms 一次 setData
  animateCount(target) {
    this._countTarget = target
    if (this._disposed || this._hidden) return
    if (this._countTimer) {
      clearInterval(this._countTimer)
      this._countTimer = null
    }
    const from = { dishCount: this.data.dishCount, tagCount: this.data.tagCount }
    if (this.data.reduce) {
      this.setData(target)
      return
    }
    if (from.dishCount === target.dishCount && from.tagCount === target.tagCount) return

    const duration = 600
    const start = Date.now()
    this._countTimer = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / duration)
      const e = 1 - Math.pow(1 - p, 3)
      this.setData({
        dishCount: Math.round(from.dishCount + (target.dishCount - from.dishCount) * e),
        tagCount: Math.round(from.tagCount + (target.tagCount - from.tagCount) * e)
      })
      if (p >= 1) {
        clearInterval(this._countTimer)
        this._countTimer = null
      }
    }, 32)
  },

  onHide() {
    this._hidden = true
    if (this._countTimer) {
      clearInterval(this._countTimer)
      this._countTimer = null
    }
    if (this._countTarget) this.setData(this._countTarget)
  },

  onUnload() {
    if (this._countTimer) {
      clearInterval(this._countTimer)
      this._countTimer = null
    }
  },

  // 厨师未读消息数（工作台入口红点）
  refreshUnread() {
    dbService.getUnreadCount().then((count) => {
      const menu = this.data.menu.map((item) => (
        item.key === 'kitchen' ? Object.assign({}, item, { badge: count }) : item
      ))
      this.setData({ unreadCount: count, menu })
    })
  },

  // 点击头像：选图上传，经云函数保存
  onAvatarTap() {
    if (this.data.avatarUploading) return
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const temp = res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!temp) return
        this.setData({ avatarFileID: temp, avatarUploading: true })
        dbService.uploadImage(temp, 'avatar')
          .then((fileID) => biz.call('setProfile', { avatarFileID: fileID }))
          .then(() => role.ensureProfile(true))
          .then(() => {
            this.setData({ avatarFileID: (role.getProfile() || {}).avatarFileID || '' })
            wx.showToast({ title: '头像已更新', icon: 'success' })
          })
          .catch(() => {
            // 保存失败回退旧头像，提示由 biz 层统一 toast
            this.setData({ avatarFileID: (role.getProfile() || {}).avatarFileID || '' })
          })
          .finally(() => {
            this.setData({ avatarUploading: false })
          })
      }
    })
  },

  // 点击资料卡：弹窗修改昵称（经云函数保存）
  onProfileTap() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '输入新昵称（最多 ' + NICKNAME_MAX_LENGTH + ' 个字）',
      content: this.data.nickname,
      success: (res) => {
        if (!res.confirm) return
        const nickname = (res.content || '').trim()
        if (!nickname) {
          wx.showToast({ title: '昵称不能为空', icon: 'none' })
          return
        }
        if (nickname === this.data.nickname) return
        biz.call('setProfile', { nickname }).then(() => role.ensureProfile(true)).then(() => {
          this.setData({ nickname: (role.getProfile() || {}).nickname || '' })
          wx.showToast({ title: '已保存', icon: 'success' })
        }).catch(() => {
          // 错误提示由 biz 层统一 toast
        })
      }
    })
  },

  // 点击「菜品」统计：切到首页看全部菜品
  onStatDishTap() {
    navigation.switchTab({ url: '/pages/list/list' })
  },

  // 点击「标签」统计：弹窗一览全部标签（按使用频次排序）
  onStatTagTap() {
    dbService.getAllTags().then((tags) => {
      wx.showModal({
        title: `全部标签（${tags.length}）`,
        content: tags.length ? tags.join('、') : '还没有标签，去给菜品打上标签吧',
        showCancel: false,
        confirmText: '知道了'
      })
    }).catch(() => {
      // 错误提示由数据层统一 toast
    })
  },

  // 菜单入口
  onMenuTap(e) {
    const key = e.currentTarget.dataset.key
    const routes = {
      orders: '/pages/my-orders/my-orders',
      kitchen: '/pages/kitchen/kitchen',
      users: '/pages/user-manage/user-manage',
      adminOrders: '/pages/admin-orders/admin-orders',
      categories: '/pages/category-manage/category-manage',
      banner: '/pages/banner-manage/banner-manage'
    }
    if (routes[key]) navigation.navigateTo({ url: routes[key] })
  }
}))
