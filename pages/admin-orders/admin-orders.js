const { definePage } = require('../../utils/page')
const pagination = require('../../utils/pagination')
// pages/admin-orders/admin-orders.js
// 全部订单（管理员）：所有食客的报餐单，支持强制推进/取消
const biz = require('../../utils/biz')
const role = require('../../utils/role')
const { formatRelative } = require('../../utils/format')

const { STATUS_META } = require('../../utils/order')

Page(definePage({
  onUnload() {
    pagination.dispose(this)
    clearTimeout(this._highlightTimer)
  },
  data: {
    list: [],
    total: 0,
    page: 1,
    loading: false,
    noMore: false
  },


  onShow() {
    if (role.isAdmin()) this.refresh()
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

  fetchPage(page) {
    return pagination.loadPage(this, page, (number) => biz.call('adminOrders', { page: number, pageSize: 20 }), (order) => {
        const meta = STATUS_META[order.status] || STATUS_META.pending
        return {
          _id: order._id,
          dinerNickname: order.dinerNickname || '食客',
          items: (order.items || []).map((i) => i.dishName).join('、'),
          chefs: (order.chefOpenids || []).length,
          status: order.status,
          statusText: meta.text,
          statusCls: meta.cls,
          statusChar: meta.char,
          timeText: formatRelative(order.createdAt)
        }
    })
  },

  // 点击订单：管理员强制操作
  onOrderTap(e) {
    const index = e.currentTarget.dataset.index
    const order = this.data.list[index]
    if (!order) return
    const actions = []
    const statuses = []
    if (order.status !== 'done' && order.status !== 'canceled') {
      actions.push('标记为已完成')
      statuses.push('done')
    }
    if (order.status !== 'canceled' && order.status !== 'done') {
      actions.push('取消订单')
      statuses.push('canceled')
    }
    if (!actions.length) {
      wx.showToast({ title: '该订单已结束', icon: 'none' })
      return
    }
    wx.showActionSheet({
      itemList: actions,
      success: (res) => {
        const status = statuses[res.tapIndex]
        biz.call('orderStatus', { orderId: order._id, status }).then(() => {
          wx.showToast({ title: '已更新', icon: 'success' })
          this.refresh()
        }).catch(() => {
          // 错误提示由 biz 层统一 toast
        })
      },
      fail: () => {
        // 用户取消
      }
    })
  }
}, 'admin'))
