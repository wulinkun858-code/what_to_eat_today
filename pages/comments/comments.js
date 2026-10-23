const navigation = require('../../utils/navigation')
const { definePage } = require('../../utils/page')
const pagination = require('../../utils/pagination')
// pages/comments/comments.js
// 评论 tab：全部菜品评论的聚合流（新→旧），点击卡片直达对应菜品
const dbService = require('../../utils/db')
const { formatRelative } = require('../../utils/format')
const { getNavMetrics } = require('../../utils/ui')

Page(definePage({
  onUnload() {
    pagination.dispose(this)
    clearTimeout(this._highlightTimer)
  },
  data: {
    theme: 'paper',
    reduce: false,
    list: [], // [{ _id, content, dishId, dishName, timeText }]
    total: 0,
    page: 1,
    loading: false,
    noMore: false,
    statusBarHeight: 20
  },

  onLoad() {
    this.setData({ statusBarHeight: getNavMetrics().statusBarHeight })
  },

  onShow() {
    // 同步自定义 tabBar 选中态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.refresh()
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.refresh().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 上拉加载更多
  onReachBottom() {
    if (this.data.loading || this.data.noMore) return
    this.fetchPage(this.data.page + 1)
  },

  // 重载第一页
  refresh() {
    return this.fetchPage(1)
  },

  /**
   * 分页拉取评论流
   * @param {number} page 页码
   */
  fetchPage(page) {
    return pagination.loadPage(this, page, dbService.getRecentComments, (item) => ({
        _id: item._id,
        content: item.content,
        dishId: item.dishId,
        dishName: item.dishName,
        timeText: formatRelative(item.createdAt)
    }))
  },

  // 点击卡片：进入对应菜品详情（可继续评论）
  onCardTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) navigation.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  }
}))
