const crypto = require('crypto')
const { fail, id, stableId } = require('../lib/context')
const createOrderState = require('../lib/order-state')
const MAX_ORDER_ITEMS = 20

module.exports = function createOrderService(context) {
  const { db, readTx, getRole, requireRole } = context
  const state = createOrderState(context)

  async function orderCreate(payload, openid) {
    if (!Array.isArray(payload.dishIds)) fail('请先选择想吃的菜')
    if (payload.dishIds.length > MAX_ORDER_ITEMS) fail(`一次最多点 ${MAX_ORDER_ITEMS} 道菜`)
    const dishIds = Array.from(new Set(payload.dishIds.map((value) => id(value, '菜品')))).sort()
    if (!dishIds.length) fail('请先选择想吃的菜')
    const requestId = payload.requestId === undefined ? crypto.randomBytes(16).toString('hex') : id(payload.requestId, '请求')
    const orderId = stableId('order', openid, requestId)
    return db.runTransaction(async (tx) => {
      const existing = await readTx(tx, 'orders', orderId)
      if (existing) {
        const existingIds = existing.items.map((item) => item.dishId).sort()
        if (JSON.stringify(existingIds) !== JSON.stringify(dishIds)) fail('提交内容已变化，请重新提交')
        return { orderId }
      }
      const items = []
      for (const dishId of dishIds) {
        const dish = await readTx(tx, 'dishes', dishId)
        if (!dish) fail('部分菜品已下架，请刷新后重试')
        if (!dish._openid) fail('菜品缺少厨师信息，请联系管理员')
        items.push({ dishId, dishName: dish.name, dishImage: dish.image || '', chefOpenid: dish._openid, chefNickname: dish.chefNickname || '' })
      }
      const diner = await readTx(tx, 'profile', openid)
      const dinerNickname = diner && diner.nickname || '食客'
      const chefOpenids = Array.from(new Set(items.map((item) => item.chefOpenid)))
      const now = new Date()
      await tx.collection('orders').doc(orderId).set({ data: {
        _openid: openid, dinerNickname, items, chefOpenids, status: 'pending',
        completedDishIds: [], statusHistory: [{ status: 'pending', time: now }], createdAt: now, updatedAt: now
      } })
      for (const chef of chefOpenids) {
        await tx.collection('messages').doc(stableId('message', orderId, chef)).set({ data: {
          _openid: chef, type: 'new_order', orderId, orderStatus: 'pending', dinerNickname,
          items: items.filter((item) => item.chefOpenid === chef).map((item) => ({ dishName: item.dishName })),
          read: false, createdAt: now
        } })
      }
      return { orderId }
    })
  }

  async function orderCancel(payload, openid) {
    const role = await getRole(openid)
    const messages = await state.messageIds(payload.orderId)
    return db.runTransaction(async (tx) => {
      const order = await state.load(tx, payload.orderId)
      if (order._openid !== openid && role !== 'admin') fail('只能操作自己的订单')
      if (order.status === 'canceled') return true
      if (state.isTerminal(order.status)) fail('订单已结束')
      if (role !== 'admin' && order.status !== 'pending') fail('菜品已开始制作，无法取消')
      await state.transition(tx, order, 'canceled', messages)
      return true
    })
  }

  async function orderStatus(payload, openid) {
    await requireRole(openid, ['admin'])
    if (!['pending', 'cooking', 'done', 'canceled'].includes(payload.status)) fail('非法状态')
    const messages = await state.messageIds(payload.orderId)
    return db.runTransaction(async (tx) => {
      const order = await state.load(tx, payload.orderId)
      await state.transition(tx, order, payload.status, messages)
      return true
    })
  }

  return { orderCreate, orderCancel, orderStatus }
}
