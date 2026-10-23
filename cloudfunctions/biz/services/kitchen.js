const { fail, id, stableId } = require('../lib/context')
const createOrderState = require('../lib/order-state')

module.exports = function createKitchenService(context) {
  const { db, read, readTx, requireRole } = context
  const state = createOrderState(context)

  async function cooklistAdd(payload, openid) {
    await requireRole(openid, ['chef', 'admin'])
    const orderId = payload.orderId ? id(payload.orderId, '订单') : ''
    if (!orderId && !payload.dishId) fail('缺少菜品')
    // 兼容旧版随机 ID 条目；新版使用确定 ID，让重试和并发调用自然去重。
    const legacy = await db.collection('cooklist').where({ _openid: openid, orderId }).limit(100).get()
    const messages = orderId ? await state.messageIds(orderId) : []
    return db.runTransaction(async (tx) => {
      const order = orderId ? await state.load(tx, orderId) : null
      if (order && state.isTerminal(order.status)) fail('订单已结束')
      let items
      if (order) {
        items = order.items.filter((item) => item.chefOpenid === openid && (!payload.dishId || item.dishId === payload.dishId))
        if (!items.length) fail('该订单没有你选择的菜品')
      } else {
        const dish = await readTx(tx, 'dishes', payload.dishId)
        if (!dish) fail('菜品不存在')
        if (dish._openid !== openid) fail('只能制作自己的菜品')
        items = [{ dishId: dish._id, dishName: dish.name }]
      }
      let added = 0
      for (const item of items) {
        const key = stableId('cook', openid, orderId, item.dishId)
        const existing = await readTx(tx, 'cooklist', key)
        if (existing && (order || !existing.done)) continue
        let duplicate = false
        for (const old of legacy.data.filter((row) => row.dishId === item.dishId && row._id !== key)) {
          const current = await readTx(tx, 'cooklist', old._id)
          if (current && (order || !current.done)) duplicate = true
        }
        if (duplicate || (order && (order.completedDishIds || []).includes(item.dishId))) continue
        await tx.collection('cooklist').doc(key).set({ data: {
          _openid: openid, dishId: item.dishId, dishName: item.dishName, orderId,
          dinerNickname: order ? order.dinerNickname : '', done: false, createdAt: new Date()
        } })
        added += 1
      }
      if (order && added) await state.transition(tx, order, 'cooking', messages)
      return { added }
    })
  }

  async function cooklistDone(payload, openid) {
    await requireRole(openid, ['chef', 'admin'])
    const initial = await read('cooklist', payload.cookId)
    if (!initial) fail('条目不存在')
    if (initial._openid !== openid) fail('只能操作自己的制作列表')
    const orderId = initial.orderId
    const messages = orderId ? await state.messageIds(orderId) : []
    const legacyDone = orderId ? await db.collection('cooklist').where({ orderId, done: true }).limit(100).get() : { data: [] }
    return db.runTransaction(async (tx) => {
      const item = await readTx(tx, 'cooklist', payload.cookId)
      if (!item) fail('条目不存在')
      if (item._openid !== openid || item.orderId !== initial.orderId) fail('制作条目已变化，请刷新')
      const order = orderId ? await state.load(tx, orderId) : null
      if (order && state.isTerminal(order.status)) {
        if (order.status === 'done' && item.done) return true
        fail('订单已结束')
      }
      if (order && !order.items.some((row) => row.dishId === item.dishId && row.chefOpenid === openid)) fail('制作条目不属于该订单')
      await tx.collection('cooklist').doc(payload.cookId).update({ data: { done: true, doneAt: new Date() } })
      if (order) {
        const completed = new Set(order.completedDishIds || [])
        legacyDone.data.forEach((row) => {
          if (order.items.some((entry) => entry.dishId === row.dishId && entry.chefOpenid === row._openid)) completed.add(row.dishId)
        })
        completed.add(item.dishId)
        const done = order.items.every((row) => completed.has(row.dishId))
        await state.transition(tx, order, done ? 'done' : 'cooking', messages, { completedDishIds: Array.from(completed) })
      }
      return true
    })
  }

  async function cooklistRemove(payload, openid) {
    return db.runTransaction(async (tx) => {
      const item = await readTx(tx, 'cooklist', payload.cookId)
      if (!item) return true
      if (item._openid !== openid) fail('只能操作自己的制作列表')
      if (item.orderId) {
        const order = await readTx(tx, 'orders', item.orderId)
        if (order) {
          // 保留完成凭据，同时写订单以与加入/完成/取消操作串行化。
          const completed = new Set(order.completedDishIds || [])
          if (item.done) completed.add(item.dishId)
          await tx.collection('orders').doc(order._id).update({ data: { completedDishIds: Array.from(completed), updatedAt: new Date() } })
        }
      }
      await tx.collection('cooklist').doc(payload.cookId).remove()
      return true
    })
  }

  return { cooklistAdd, cooklistDone, cooklistRemove }
}
