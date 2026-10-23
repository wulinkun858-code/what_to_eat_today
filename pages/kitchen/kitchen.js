const { definePage } = require('../../utils/page')
// pages/kitchen/kitchen.js
// 厨师工作台：报餐消息（谁想吃我的菜 → 一键加入制作列表）+ 制作清单（完成/移除）
// 仅厨师与管理员可见；写操作走云函数 biz（服务端校验菜品归属）
const dbService = require('../../utils/db')
const biz = require('../../utils/biz')
const role = require('../../utils/role')
const haptic = require('../../utils/haptic')
const { formatRelative } = require('../../utils/format')
const { STATUS_META } = require('../../utils/order')

Page(definePage({
  data: {
    theme: 'paper',
    reduce: false,
    messages: [], // [{ _id, dinerNickname, items, timeText, read, orderStatusText }]
    cooklist: [], // [{ _id, dishName, dinerNickname, done, timeText }]
    loading: true,
    unreadCount: 0
  },


  onShow() {
    if (role.isChef()) this.refresh()
  },


  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  refresh() {
    const token = this._refreshToken = (this._refreshToken || 0) + 1
    this.setData({ loading: true })
    return Promise.all([
      dbService.getMyMessages(),
      dbService.getMyCooklist(),
      dbService.getUnreadCount()
    ]).then(([messages, cooklist, unreadCount]) => {
      if (token !== this._refreshToken || this._disposed) return
      this.setData({
        messages: messages.map((m) => ({
          _id: m._id,
          orderId: m.orderId,
          dinerNickname: m.dinerNickname || '食客',
          items: (m.items || []).map((i) => i.dishName).join('、'),
          read: !!m.read,
          actionable: m.orderStatus !== 'done' && m.orderStatus !== 'canceled',
          statusText: this.statusText(m.orderStatus),
          timeText: formatRelative(m.createdAt)
        })),
        cooklist: cooklist.map((c) => ({
          _id: c._id,
          dishName: c.dishName,
          dinerNickname: c.dinerNickname || '',
          orderId: c.orderId,
          done: !!c.done,
          timeText: formatRelative(c.createdAt)
        })),
        unreadCount,
        loading: false
      })
    }).catch(() => {
      if (token === this._refreshToken) this.setData({ loading: false })
    })
  },

  statusText(status) {
    return STATUS_META[status] ? STATUS_META[status].text : ''
  },

  // 点击消息：标记已读
  onMessageTap(e) {
    const id = e.currentTarget.dataset.id
    const target = this.data.messages.find((m) => m._id === id)
    if (!target || target.read) return
    if (!this._reading) this._reading = new Set()
    if (this._reading.has(id)) return
    this._reading.add(id)
    dbService.markMessageRead(id).then(() => {
      const messages = this.data.messages.map((m) => (
        m._id === id ? Object.assign({}, m, { read: true }) : m
      ))
      this.setData({
        messages,
        unreadCount: Math.max(0, this.data.unreadCount - 1)
      })
    }).catch(() => {
      // 错误提示由数据层统一 toast
    }).finally(() => {
      this._reading.delete(id)
    })
  },

  // 一键把该订单中自己的菜全部加入制作列表
  onAddAllTap(e) {
    const { orderId, index } = e.currentTarget.dataset
    const target = this.data.messages[index]
    if (target && !target.actionable) return
    if (!orderId) {
      wx.showToast({ title: '该消息没有关联订单', icon: 'none' })
      return
    }
    if (!this._adding) this._adding = new Set()
    if (this._adding.has(orderId)) return
    this._adding.add(orderId)
    biz.call('cooklistAdd', { orderId }).then(async ({ added }) => {
      wx.showToast({ title: added ? `已加入 ${added} 道菜` : '都已在制作列表中', icon: added ? 'success' : 'none' })
      // 消息标记已读
      if (target && !target.read) await dbService.markMessageRead(target._id).catch(() => {})
      return this.refresh()
    }).catch(() => {
      // 错误提示由 biz 层统一 toast
    }).finally(() => {
      this._adding.delete(orderId)
    })
  },

  // 完成一道菜（先落印，再走云函数；失败时 refresh 纠正）
  onDoneTap(e) {
    const id = e.currentTarget.dataset.id
    const target = this.data.cooklist.find((c) => c._id === id)
    if (!target || target.done) return
    haptic.light()
    this.setData({
      cooklist: this.data.cooklist.map((c) => (
        c._id === id ? Object.assign({}, c, { done: true }) : c
      ))
    })
    biz.call('cooklistDone', { cookId: id }).then(() => {
      wx.showToast({ title: '已起菜', icon: 'success' })
      this.refresh()
    }).catch(() => {
      this.refresh()
    })
  },

  // 移除误加的条目（云函数校验归属并保留完成凭据）
  onRemoveTap(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '移除条目',
      content: '确定把这道菜移出制作列表吗？',
      confirmText: '移除',
      success: (res) => {
        if (!res.confirm) return
        dbService.removeCookItem(id).then(() => this.refresh()).catch(() => {})
      }
    })
  }
}, 'chef'))
