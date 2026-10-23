const navigation = require('../../utils/navigation')
const { groupByChef } = require('../../utils/order')
const { definePage } = require('../../utils/page')
// pages/order-confirm/order-confirm.js
// 确认点菜：展示点菜单中的菜品（按厨师分组），提交报餐单（无价格无数量，纯意向）
const cart = require('../../utils/cart')
const biz = require('../../utils/biz')
const haptic = require('../../utils/haptic')

Page(definePage({
  data: {
    theme: 'paper',
    reduce: false,
    groups: [], // [{ chefNickname, items: [...] }]
    total: 0,
    submitting: false,
    removingId: '', // 正在定向飞出的菜品
    stamped: false // 落单成功的印章遮罩
  },

  onShow() {
    this.refresh()
    if (this._submittedOrderId) this.finishSubmission()
  },

  // 从本地点菜单读取并按厨师分组
  refresh() {
    const items = cart.getItems()
    this.setData({ groups: groupByChef(items), total: items.length })
  },

  // 移除一道菜：先定向飞出，再从点菜单删除
  onRemoveTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id || this.data.removingId || this.data.submitting || this.data.stamped) return
    haptic.light()
    if (this.data.reduce) {
      cart.remove(id)
      this.refresh()
      return
    }
    cart.remove(id)
    this.setData({ removingId: id })
    this._removeTimer = setTimeout(() => {
      this.setData({ removingId: '' })
      this.refresh()
    }, 320)
  },

  // 提交报餐单（云函数校验并扇出厨师消息）
  onSubmit() {
    if (this._submittedOrderId) return this.finishSubmission()
    if (this.data.submitting || this.data.stamped || this.data.removingId || !this.data.total) return
    const dishIds = cart.getItems().map((item) => item._id)
    if (!dishIds.length) {
      this.refresh()
      return
    }
    this.setData({ submitting: true })
    const requestId = cart.submissionId()
    return biz.call('orderCreate', { dishIds, requestId }).then(({ orderId }) => {
      cart.removeMany(dishIds)
      if (this._disposed) return
      this._submittedOrderId = orderId
      this.finishSubmission()
    }).catch(() => {
      // 错误提示由 biz 层统一 toast
    }).finally(() => {
      this.setData({ submitting: false })
    })
  },

  finishSubmission() {
    if (this._disposed || this._visible === false || this._redirecting) return
    clearTimeout(this._submitTimer)
    haptic.medium()
    this.setData({ stamped: true })
    this._submitTimer = setTimeout(() => {
      if (this._disposed || this._visible === false) return
      this._redirecting = true
      navigation.redirectTo({
        url: `/pages/my-orders/my-orders?highlight=${this._submittedOrderId}`,
        fail: () => {
          this._redirecting = false
          this.setData({ stamped: false })
        }
      })
    }, this.data.reduce ? 0 : 560)
  },

  onHide() {
    clearTimeout(this._removeTimer)
    clearTimeout(this._submitTimer)
    this.setData({ removingId: '', stamped: false })
  },

  onUnload() {
    if (this._removeTimer) clearTimeout(this._removeTimer)
    if (this._submitTimer) clearTimeout(this._submitTimer)
  }
}))
