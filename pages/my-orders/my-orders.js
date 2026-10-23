const navigation = require('../../utils/navigation')
const { definePage } = require('../../utils/page')
const pagination = require('../../utils/pagination')
// pages/my-orders/my-orders.js
// 我的订单：食客的报餐单列表（状态流转可见，待处理可取消）
const dbService = require('../../utils/db')
const biz = require('../../utils/biz')
const { formatRelative } = require('../../utils/format')

const { STATUS_META } = require('../../utils/order')

Page(definePage({
  onUnload() {
    pagination.dispose(this)
    this.clearHighlightTimer()
  },
  data: {
    list: [], // [{ _id, items, statusText, statusCls, timeText, cancellable }]
    total: 0,
    page: 1,
    loading: false,
    noMore: false,
    highlightId: '' // 刚提交的订单 _id（短暂高亮）
  },

  onLoad(options) {
    this._highlight = options.highlight || ''
  },

  onShow() {
    this.refresh()
  },

  onHide() {
    this.clearHighlightTimer()
    // 已经呈现过的高亮在离开时收尾，返回页面无需重播。
    if (!this.data.reduce && this.data.highlightId) this.setData({ highlightId: '' })
  },

  clearHighlightTimer() {
    clearTimeout(this._highlightTimer)
    this._highlightTimer = null
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.loading || this.data.noMore) return
    this.fetchPage(this.data.page + 1)
  },

  refresh() {
    return this.fetchPage(1)
  },

  decorate(order) {
    const meta = STATUS_META[order.status] || STATUS_META.pending
    return {
      _id: order._id,
      items: order.items || [],
      status: order.status,
      statusText: meta.text,
      statusCls: meta.cls,
      statusChar: meta.char,
      step: meta.step,
      timeText: formatRelative(order.createdAt),
      cancellable: order.status === 'pending'
    }
  },

  fetchPage(page) {
    return pagination.loadPage(this, page, dbService.getMyOrders, (order) => this.decorate(order), (list) => {
      // 隐藏时保留尚未呈现的意图，等下次可见刷新再定位新食单。
      if (page !== 1 || !this._highlight || this._disposed || this._visible === false) return
      const id = this._highlight
      this._highlight = ''
      if (list.some((order) => order._id === id)) {
        this.setData({ highlightId: id })
        this.clearHighlightTimer()
        if (this.data.reduce) return
        this._highlightTimer = setTimeout(() => {
          this._highlightTimer = null
          if (!this._disposed && this._visible !== false) this.setData({ highlightId: '' })
        }, 2000)
      }
    })
  },

  // 取消订单（仅待处理；云函数校验）
  onCancelTap(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '取消订单',
      content: '确定取消这份报餐单吗？',
      confirmText: '取消订单',
      success: (res) => {
        if (!res.confirm) return
        biz.call('orderCancel', { orderId: id }).then(() => {
          wx.showToast({ title: '已取消', icon: 'success' })
          this.refresh()
        }).catch(() => {
          // 错误提示由 biz 层统一 toast
        })
      }
    })
  },

  // 点菜品行回详情
  onDishTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) navigation.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  }
}))
