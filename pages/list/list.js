const navigation = require('../../utils/navigation')
const { definePage } = require('../../utils/page')
const pagination = require('../../utils/pagination')
// pages/list/list.js
// 首页：菜单浏览（全体可见）+ 搜索/标签/轮播/分页；厨师与管理员另有管理入口
// 食客点单：卡片「+ 想吃」→ 底部点菜单条 → 确认点菜页
const dbService = require('../../utils/db')
const role = require('../../utils/role')
const cart = require('../../utils/cart')
const haptic = require('../../utils/haptic')
const theme = require('../../utils/theme')
const { getNavMetrics } = require('../../utils/ui')

const DEBOUNCE_MS = 300 // 搜索输入防抖时长
const SCROLL_ON = 44 // 大标题收起的滚动阈值
const SCROLL_OFF = 16 // 回顶时恢复大标题的阈值（滞回，避免边界抖动）

Page(definePage({
  data: {
    theme: 'paper', // 当前主题（class 名）
    reduce: false, // 减弱动效
    keyword: '', // 搜索关键词
    searchFocused: false, // 搜索框聚焦态（边框点亮）
    categories: [], // 品类列表（首项为「全部」）
    activeCategory: '', // 当前选中分类 _id，空串代表全部
    activeCategoryName: '全部菜品', // 列表标题（跟随品类）
    catIntoView: '', // 品类横滑自动定位目标
    list: [], // 菜品列表
    total: 0, // 总条数
    page: 1, // 当前页码
    loading: false, // 是否正在加载
    noMore: false, // 是否已加载全部
    banners: [], // 轮播数据 [{ _id, image, title, type }]
    bannerSource: '', // 轮播来源：custom=自定义图 dish=最近菜品 空=不展示
    bannerCurrent: 0, // 当前轮播索引（自定义指示点用）
    wantBumpId: '', // 刚点过「想吃」的菜品 id（触发按钮回弹）
    canManage: false, // 厨师/管理员才显示管理入口
    postNo: 1, // 今日是本年度的第几帖
    // 自定义导航度量
    statusBarHeight: 20,
    navBarHeight: 44,
    navHeight: 118,
    scrolled: false, // 是否已滚过大标题（导航加投影 + 显示小标题）
    // 飞入点菜单的粒子
    fly: { show: false, x: 0, y: 0, dx: 0, dy: 0, scale: 1, opacity: 1 },
    emptyTitle: '食帖还是空的', // 空状态主文案（按场景变化）
    emptySub: '等第一道菜上桌' // 空状态副文案
  },

  onLoad() {
    this._searchTimer = null // 防抖定时器
    this._metrics = getNavMetrics()
    this.syncHomeChrome()
    const now = new Date()
    const start = new Date(now.getFullYear(), 0, 0)
    const postNo = Math.floor((now - start) / 86400000)
    this.setData({
      statusBarHeight: this._metrics.statusBarHeight,
      navBarHeight: this._metrics.navBarHeight,
      navHeight: this._metrics.navHeight,
      postNo
    })
    this.refreshList()
  },

  // 滚动：只在跨越阈值时 setData（滞回），避免逐帧写入造成卡顿
  onPageScroll(e) {
    const top = e.scrollTop
    if (!this.data.scrolled && top > SCROLL_ON) {
      this.setData({ scrolled: true })
    } else if (this.data.scrolled && top < SCROLL_OFF) {
      this.setData({ scrolled: false })
    }
  },

  onShow() {
    // 同步自定义 tabBar 选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.syncHomeChrome()
    // 身份 / 品类 / 轮播并行刷新：三次云调用从串行改为并发
    Promise.all([
      role.ensureProfile().then(() => this.setData({ canManage: role.isChef() })),
      // 品类可能被管理员增删，每次进入刷新
      this.fetchCategories(),
      // 轮播用轻量投影查询，保证管理页改动即时可见
      this.fetchBanners()
    ]).catch(() => {})
    // 从编辑/详情/订单页返回时刷新列表，保证新增/修改/删除即时可见
    if (this._needRefresh) {
      this._needRefresh = false
      this.refreshList()
    } else if (this._searchPending) {
      this._searchPending = false
      this.refreshList()
    }
  },

  // ===== 主题 =====

  // 原生状态栏跟随青瓷/墨黑主题，避免白底白字。
  syncHomeChrome() {
    const current = theme.getTheme()
    try {
      wx.setNavigationBarColor({
        frontColor: current.mode === 'dark' ? '#ffffff' : '#000000',
        backgroundColor: current.bg,
        animation: { duration: 0 }
      })
    } catch (e) {
      // 部分基础库不支持 animation 参数时静默降级
    }
  },

  // 两套主题直接来回切：墨晕从触点铺开，遮罩盖住时换肤
  onThemeToggle(e) {
    const { x, y } = e.detail
    const target = theme.next()
    haptic.light()
    const reveal = this.selectComponent('#reveal')
    if (!reveal) {
      theme.apply(target.key)
      this.syncHomeChrome()
      return
    }
    reveal.play({ x, y, key: target.key, onCover: () => this.syncHomeChrome() })
  },

  // 获取菜品分类（首项固定「全部」）
  fetchCategories() {
    return dbService.getCategories().then((list) => {
      const categories = [{ _id: '', name: '全部' }].concat(
        list.map((c) => ({ _id: c._id, name: c.name }))
      )
      // 分类可能被管理员删掉，选中项失效时回落到「全部」
      const current = categories.find((c) => c._id === this.data.activeCategory)
      this.setData({
        categories,
        activeCategory: current ? current._id : '',
        activeCategoryName: current && current._id ? current.name : '全部菜品'
      })
      if (!current) return this.refreshList()
    }).catch(() => {
      // 分类加载失败不阻塞主流程
    })
  },

  // 页面卸载：清理搜索防抖与动画定时器，避免对已卸载页面 setData
  onUnload() {
    pagination.dispose(this)
    this.stopTransientMotion()
  },

  onHide() {
    this.stopTransientMotion()
  },

  stopTransientMotion() {
    if (this._searchTimer) clearTimeout(this._searchTimer)
    if (this._flyTimers) this._flyTimers.forEach((t) => clearTimeout(t))
    if (this._bumpTimers) this._bumpTimers.forEach((t) => clearTimeout(t))
    this._flyTimers = []
    this._bumpTimers = []
    this.setData({ 'fly.show': false, wantBumpId: '' })
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.fetchBanners()
    this.refreshList().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 上拉触底加载更多
  onReachBottom() {
    if (this.data.loading || this.data.noMore) return
    this.fetchList(this.data.page + 1)
  },

  // 标记需要刷新（供详情页删除后调用）
  markNeedRefresh() {
    this._needRefresh = true
  },

  // 获取轮播图：优先自定义图，其次最近有图片的菜品
  fetchBanners() {
    return dbService.getBanners().then((customList) => {
      if (customList.length) {
        this.setData({
          bannerSource: 'custom',
          banners: customList.map((doc) => ({
            _id: doc._id,
            image: doc.fileID,
            title: '',
            type: 'custom'
          })),
          bannerCurrent: 0
        })
        return null
      }
      return dbService.getRecentDishesWithImage(dbService.BANNER_MAX).then((recent) => {
        this.setData({
          bannerSource: recent.length ? 'dish' : '',
          banners: recent.map((dish) => ({
            _id: dish._id,
            image: dish.image,
            title: dish.name || '',
            type: 'dish'
          })),
          bannerCurrent: 0
        })
      })
    }).catch(() => {
      // 轮播加载失败不阻塞主流程
    })
  },

  // 重新加载第一页（搜索/筛选/刷新时调用）
  // 首屏刷新保留旧列表：只在数据到达时整体替换，
  // 避免搜索/切分类时列表先闪空再回来
  refreshList() {
    return this.fetchList(1)
  },

  // 获取菜品列表（onLoad 时调用一次）
  fetchList(page) {
    return pagination.loadPage(this, page, (number) => dbService.getDishes({
      keyword: this.data.keyword, category: this.data.activeCategory, page: number
    })).then(() => { if (!this._disposed && !this.data.list.length) this.applyEmptyCopy() })
  },

  // 空状态文案：按当前场景（搜索无结果 / 分类为空 / 菜单为空）与角色给出指引
  applyEmptyCopy() {
    let emptyTitle = '还没有菜品'
    let emptySub = this.data.canManage ? '点「添一道」，写下第一道拿手菜' : '先去逛逛其他分类吧'
    if (this.data.keyword) {
      emptyTitle = '没有找到相关菜品'
      emptySub = '换个关键词试试，或清空搜索看全部'
    } else if (this.data.activeCategory) {
      emptyTitle = '该分类下还没有菜品'
      emptySub = this.data.canManage ? '点「添一道」，或看看其他分类' : '看看其他分类，或等厨师上新'
    }
    this.setData({ emptyTitle, emptySub })
  },

  // 搜索框聚焦 / 失焦：只切一个布尔值，样式过渡交给 CSS
  onSearchFocus() {
    this.setData({ searchFocused: true })
  },

  onSearchBlur() {
    this.setData({ searchFocused: false })
  },

  // 搜索输入（防抖 300ms）
  onSearchInput(e) {
    const keyword = e.detail.value
    this.setData({ keyword })
    this._searchPending = true
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this._searchPending = false
      this.refreshList()
    }, DEBOUNCE_MS)
  },

  // 键盘确认键或点击搜索按钮触发搜索（立即执行，不等防抖）
  onSearchConfirm() {
    this._searchPending = false
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this.refreshList()
  },

  // 清空搜索框
  onClearKeyword() {
    this._searchPending = false
    if (this._searchTimer) clearTimeout(this._searchTimer)
    this.setData({ keyword: '' })
    this.refreshList()
  },

  // 点击品类筛选：胶囊形变 + 横滑自动定位 + 轻触觉
  onCategoryTap(e) {
    const { id, index } = e.currentTarget.dataset
    if (id === this.data.activeCategory) return
    const cat = this.data.categories.find((c) => c._id === id)
    haptic.light()
    this.setData({
      activeCategory: id,
      activeCategoryName: cat ? cat.name : '全部菜品',
      // 让选中项滚到可视区（scroll-into-view 需要字符串 id）
      catIntoView: `cat-${Math.max(0, index - 1)}`
    })
    this.refreshList()
  },

  // 轮播切换：同步自定义指示点
  onBannerChange(e) {
    this.setData({ bannerCurrent: e.detail.current })
  },

  // 点击轮播：菜品图进详情，自定义图全屏预览
  onBannerTap(e) {
    const { type, id } = e.currentTarget.dataset
    if (type === 'dish' && id) {
      navigation.navigateTo({ url: `/pages/detail/detail?id=${id}` })
      return
    }
    const urls = this.data.banners.map((item) => item.image)
    const current = this.data.banners[this.data.bannerCurrent]
    wx.previewImage({ urls, current: current ? current.image : '' })
  },

  // 长按轮播：进入轮播图管理页（添加/删除/清空）
  onBannerLongPress() {
    navigation.navigateTo({ url: '/pages/banner-manage/banner-manage' })
  },

  // 点击「+ 想吃」：加入点菜单（catchtap，不触发卡片跳转）
  // 反馈三层：粒子飞入（空间关系）+ 按钮回弹（操作确认）+ 轻触觉（手感）
  onWantTap(e) {
    const id = e.currentTarget.dataset.id
    const dish = this.data.list.find((item) => item._id === id)
    if (!dish) return
    const { added } = cart.add(dish)
    haptic.light()
    if (!this.data.reduce) this.playFlyToCart(e)

    this.setData({ wantBumpId: id })
    if (this._bumpTimers) this._bumpTimers.forEach((t) => clearTimeout(t))
    this._bumpTimers = [setTimeout(() => this.setData({ wantBumpId: '' }), 460)]

    wx.showToast({ title: added ? '已加入点菜单' : '已在点菜单中', icon: 'none' })
  },

  // 粒子从手指位置飞向点菜单图标：起点先落位，下一帧再改终点，transition 才有插值
  playFlyToCart(e) {
    const point = e.detail || {}
    if (typeof point.x !== 'number' || typeof point.y !== 'number') return
    const target = this.getCartTarget()
    if (this._flyTimers) this._flyTimers.forEach((t) => clearTimeout(t))

    this.setData({
      fly: { show: true, x: point.x, y: point.y, dx: 0, dy: 0, scale: 1, opacity: 1 }
    })
    const t1 = setTimeout(() => {
      this.setData({
        'fly.dx': target.x - point.x,
        'fly.dy': target.y - point.y,
        'fly.scale': 0.3,
        'fly.opacity': 0
      })
    }, 24)
    const t2 = setTimeout(() => this.setData({ 'fly.show': false }), 580)
    this._flyTimers = [t1, t2]
  },

  // Dock 点菜单入口的落点。
  // 与 custom-tab-bar/index.wxss 保持一致：右内边距 24rpx、入口宽 216rpx、Dock 高 112rpx。
  getCartTarget() {
    const m = this._metrics || getNavMetrics()
    const rpx = m.windowWidth / 750
    return {
      x: m.windowWidth - (24 + 108) * rpx,
      y: m.windowHeight - m.safeBottom - (16 + 56) * rpx
    }
  },

  // 点击卡片进入详情页
  onDishTap(e) {
    const id = e.currentTarget.dataset.id
    navigation.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  // 点击悬浮 + 按钮进入添加页（厨师/管理员）
  onAddTap() {
    navigation.navigateTo({ url: '/pages/edit/edit' })
  }
}))
